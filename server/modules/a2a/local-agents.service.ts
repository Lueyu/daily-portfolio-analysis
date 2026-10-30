import { Injectable } from '@nestjs/common';
import { AgentCard, Message, SendMessageRequest, TaskState, type Part, type Task } from '@a2a-js/sdk';
import { ClientFactory, DefaultAgentCardResolver, JsonRpcTransportFactory, type Client } from '@a2a-js/sdk/client';
import { agentFetch, readAgentRegistry } from './local-agents.registry';
import { LocalAgentError, type LocalAgentEntry, type LocalAgentExecution, type LocalAgentResult } from './local-agents.types';

function partText(parts: Part[]): string {
  return parts.filter((part) => part.content?.$case === 'text')
    .map((part) => String(part.content?.value ?? '')).join('\n').slice(0, 60_000);
}
function usage(metadata: Record<string, unknown> | undefined): number | null {
  const raw = metadata?.usage;
  if (!raw || typeof raw !== 'object') return null;
  const tokens = (raw as Record<string, unknown>).totalTokens;
  return typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens >= 0 && tokens <= 1_000_000_000
    ? tokens : null;
}
function result(task: Task | Message): LocalAgentResult {
  const isTask = 'status' in task;
  const parts = isTask ? task.artifacts.flatMap((artifact) => artifact.parts) : task.parts;
  const text = partText(parts) || (isTask ? partText(task.status?.message?.parts ?? []) : '');
  const data = parts.find((part) => part.content?.$case === 'data')?.content?.value as unknown;
  if (!text && data === undefined) throw new LocalAgentError('A2A_EMPTY_RESULT');
  return { taskId: isTask ? task.id : task.taskId || undefined, contextId: task.contextId,
    text, ...(data === undefined ? {} : { data }), usageTokens: usage(task.metadata) };
}

@Injectable()
export class LocalAgentsService {
  async list(owner: string) {
    return (await readAgentRegistry()).filter((entry) => entry.owners.includes(owner))
      .map(({ id, name }) => ({ id, name, protocol: 'a2a' as const, available: true as const }));
  }

  async validate(owner: string, id: string): Promise<void> { await this.entry(owner, id); }

  private async entry(owner: string, id: string): Promise<LocalAgentEntry> {
    const entry = (await readAgentRegistry()).find((item) => item.id === id && item.owners.includes(owner));
    if (!entry) throw new LocalAgentError('A2A_AGENT_NOT_FOUND');
    return entry;
  }

  private async connect(entry: LocalAgentEntry): Promise<Client> {
    try {
      const fetchImpl = agentFetch(entry);
      const cardResolver = new DefaultAgentCardResolver({ fetchImpl });
      const discovered = await cardResolver.resolve(entry.cardUrl, '');
      const card = AgentCard.fromJSON(AgentCard.toJSON(discovered));
      const allowed = card.supportedInterfaces.find((item) => item.protocolBinding === 'JSONRPC'
        && item.protocolVersion === '1.0' && new URL(item.url).origin === new URL(entry.cardUrl).origin);
      if (!allowed) throw new LocalAgentError('A2A_PROTOCOL_UNSUPPORTED');
      card.supportedInterfaces = [allowed];
      return await new ClientFactory({ cardResolver, transports: [new JsonRpcTransportFactory({ fetchImpl })],
        clientConfig: { polling: true } }).createFromAgentCard(card);
    } catch (error) {
      throw error instanceof LocalAgentError ? error : new LocalAgentError('A2A_UNAVAILABLE');
    }
  }

  async test(owner: string, id: string): Promise<{ ok: true; protocol: 'a2a'; version: string }> {
    const client = await this.connect(await this.entry(owner, id));
    return { ok: true, protocol: 'a2a', version: client.protocolVersion };
  }

  async execute(owner: string, options: LocalAgentExecution): Promise<LocalAgentResult> {
    const client = await this.connect(await this.entry(owner, options.agentId));
    let task: Task | undefined;
    let dispatched = false;
    const send = async (prior?: Task): Promise<Task | Message> => {
      if (!(await options.shouldContinue())) throw new LocalAgentError('A2A_PAUSED', prior?.id, prior?.contextId);
      await options.onDispatch?.();
      // No transport or auth retry: a lost response may already have started paid work.
      dispatched = true;
      try {
        return await client.sendMessage(SendMessageRequest.fromJSON({
          message: Message.toJSON(Message.fromJSON({ messageId: options.messageId, role: 'ROLE_USER',
            taskId: prior?.id, contextId: prior?.contextId ?? options.contextId,
            parts: [{ text: options.prompt }] })),
          configuration: { returnImmediately: true, acceptedOutputModes: ['text/plain', 'application/json'], historyLength: 0 },
        }));
      } catch { throw new LocalAgentError('A2A_DISPATCH_UNCERTAIN', prior?.id, prior?.contextId); }
    };
    try {
      if (options.remoteTaskId) {
        task = await client.getTask({ id: options.remoteTaskId, tenant: '', historyLength: 0 });
        if (task.id !== options.remoteTaskId || (options.contextId && task.contextId !== options.contextId)) {
          throw new LocalAgentError('A2A_TASK_MISMATCH');
        }
      }
      if (!task || (task.status?.state === TaskState.TASK_STATE_INPUT_REQUIRED && options.resumeInput)) {
        const response = await send(task);
        if (task && (!('status' in response) || response.id !== task.id || response.contextId !== task.contextId)) {
          throw new LocalAgentError('A2A_TASK_MISMATCH', task.id, task.contextId);
        }
        if (!('status' in response)) return result(response);
        task = response;
      }
      if (!task.id || !task.contextId) throw new LocalAgentError('A2A_INVALID_TASK');
      await options.onTask({ taskId: task.id, contextId: task.contextId });
      const deadline = Date.now() + 10 * 60_000;
      let previousProgress = '';
      for (;;) {
        const state = task.status?.state;
        const progress = partText(task.status?.message?.parts ?? []).slice(0, 3000);
        if (progress && progress !== previousProgress) { await options.onProgress(progress); previousProgress = progress; }
        if (state === TaskState.TASK_STATE_COMPLETED) return result(task);
        if (state === TaskState.TASK_STATE_INPUT_REQUIRED) throw new LocalAgentError('A2A_INPUT_REQUIRED', task.id, task.contextId);
        if (state === TaskState.TASK_STATE_AUTH_REQUIRED) throw new LocalAgentError('A2A_AUTH_REQUIRED', task.id, task.contextId);
        if (state === TaskState.TASK_STATE_CANCELED) throw new LocalAgentError('A2A_CANCELLED', task.id, task.contextId);
        if (state === TaskState.TASK_STATE_FAILED || state === TaskState.TASK_STATE_REJECTED) {
          throw new LocalAgentError('A2A_TASK_FAILED', task.id, task.contextId);
        }
        if (!(await options.shouldContinue())) {
          let cancelled = false;
          try { cancelled = (await client.cancelTask({ id: task.id, tenant: '', metadata: undefined }))
            .status?.state === TaskState.TASK_STATE_CANCELED; } catch { /* Keep the task reference until status is known. */ }
          throw new LocalAgentError(cancelled ? 'A2A_CANCELLED' : 'A2A_PAUSED', task.id, task.contextId);
        }
        if (Date.now() >= deadline) throw new LocalAgentError('A2A_TIMEOUT', task.id, task.contextId);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const next = await client.getTask({ id: task.id, tenant: '', historyLength: 0 });
        if (next.id !== task.id || next.contextId !== task.contextId) throw new LocalAgentError('A2A_TASK_MISMATCH');
        task = next;
      }
    } catch (error) {
      if (error instanceof LocalAgentError) throw error;
      // Persist callbacks may fail after dispatch; never present that as safely retryable.
      throw new LocalAgentError(task ? 'A2A_UNAVAILABLE' : dispatched ? 'A2A_DISPATCH_UNCERTAIN' : 'A2A_UNAVAILABLE',
        task?.id ?? options.remoteTaskId, task?.contextId ?? options.contextId);
    }
  }
}
