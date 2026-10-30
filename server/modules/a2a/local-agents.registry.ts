import { readFile } from 'node:fs/promises';
import type { LocalAgentEntry } from './local-agents.types';
import { LocalAgentError } from './local-agents.types';

export async function readAgentRegistry(): Promise<LocalAgentEntry[]> {
  const path = process.env.A2A_AGENTS_FILE;
  if (!path) return [];
  try {
    const contents = await readFile(path, 'utf8');
    if (contents.length > 1_000_000) throw new Error('large');
    const input: unknown = JSON.parse(contents);
    if (!Array.isArray(input) || input.length > 64) throw new Error('array');
    const ids = new Set<string>();
    return input.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('entry');
      const raw = entry as Record<string, unknown>;
      if (typeof raw.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/u.test(raw.id) || ids.has(raw.id)
        || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80
        || typeof raw.cardUrl !== 'string' || raw.cardUrl.length > 1000
        || !Array.isArray(raw.owners) || !raw.owners.length || raw.owners.length > 1000
        || raw.owners.some((owner: unknown) => typeof owner !== 'string' || !owner.trim()
          || owner === '*' || owner.length > 200)
        || (raw.token !== undefined && (typeof raw.token !== 'string' || !raw.token
          || raw.token.length > 4096 || /[\u0000-\u001f\u007f]/u.test(raw.token)))) throw new Error('fields');
      const url = new URL(raw.cardUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('url');
      }
      ids.add(raw.id);
      return { id: raw.id, name: raw.name.trim(), cardUrl: url.href,
        owners: raw.owners as string[], ...(raw.token === undefined ? {} : { token: raw.token as string }) };
    });
  } catch { throw new LocalAgentError('A2A_CONFIG_INVALID'); }
}

/** Only operator-owned registry origins are contacted. Discovery cannot redirect a credential. */
export function agentFetch(entry: LocalAgentEntry): typeof fetch {
  const origin = new URL(entry.cardUrl).origin;
  return async (input, init) => {
    const address = input instanceof Request ? input.url : String(input);
    const url = new URL(address);
    if (url.origin !== origin || url.username || url.password) throw new LocalAgentError('A2A_ENDPOINT_REJECTED');
    const headers = new Headers(init?.headers);
    if (entry.token) headers.set('Authorization', `Bearer ${entry.token}`);
    const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000);
    const response = await fetch(input, { ...init, headers, redirect: 'error', signal });
    if (!response.ok) throw new LocalAgentError('A2A_UNAVAILABLE');
    const maximum = 512_000;
    if (Number(response.headers.get('content-length')) > maximum) {
      await response.body?.cancel();
      throw new LocalAgentError('A2A_RESPONSE_TOO_LARGE');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (reader) try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > maximum) { await reader.cancel(); throw new LocalAgentError('A2A_RESPONSE_TOO_LARGE'); }
        chunks.push(item.value);
      }
    } finally { reader.releaseLock(); }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
  };
}
