#!/usr/bin/env node
/**
 * fake-agent.cjs — deterministic stand-in for the Python coding agent.
 *
 * The real `agent dev run/approve` calls an LLM and is slow/non-deterministic.
 * End-to-end tests need a reproducible driver, so this script implements the
 * same CLI surface and on-disk work-product contract without any model calls:
 *
 *   dev new   --title T --problem P --acceptance id:kind:desc[:target] ... [--workdir W]
 *   dev run       <id> [--resume-budget]
 *   dev approve   <id>
 *   dev reject    <id> --reason R
 *
 * The Nest runner always appends `--json`. The tasks directory is taken from
 * AGENT_DEV_TASKS_DIR (the same env the Nest server injects into the child).
 *
 * State machine it drives:
 *   new --(run)--> awaiting_approval --(approve)--> verified
 *                                      \-(reject)--> blocked
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const tasksDir = process.env.AGENT_DEV_TASKS_DIR;
if (!tasksDir) {
  console.error('fake-agent: AGENT_DEV_TASKS_DIR is not set');
  process.exit(2);
}

function now() {
  return new Date().toISOString();
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function parseFlags(args) {
  // Returns { positional: string[], flags: Map<string, string[]> }
  const positional = [];
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const values = flags.get(name) || [];
      // Accept both --flag value and --flag=value.
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        values.push(args[i + 1]);
        i++;
      } else if (name.includes('=')) {
        const [k, v] = splitOnce(name, '=');
        flags.set(k, [v]);
        continue;
      }
      flags.set(name, values);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function splitOnce(s, sep) {
  const idx = s.indexOf(sep);
  return idx === -1 ? [s, ''] : [s.slice(0, idx), s.slice(idx + 1)];
}

function parseAcceptance(raw) {
  // Mirrors the Python parser: split(":", 3) -> id, kind, description, target?
  const parts = raw.split(':');
  const [id, kind, ...rest] = parts;
  let description = rest[0];
  let target = null;
  if (rest.length === 2) {
    description = rest[0];
    target = rest[1];
  } else if (rest.length > 2) {
    // description itself contained colons (the backend replaces them); keep
    // the last segment as target and rejoin the middle.
    target = rest[rest.length - 1];
    description = rest.slice(0, -1).join(':');
  }
  return { id, description, check: kind, target };
}

function taskDir(id) {
  return path.join(tasksDir, id);
}

function taskPath(id) {
  return path.join(taskDir(id), 'task.json');
}

function loadTask(id) {
  return JSON.parse(fs.readFileSync(taskPath(id), 'utf8'));
}

function saveTask(task) {
  task.updated_at = now();
  const dir = taskDir(task.id);
  fs.mkdirSync(path.join(dir, 'iterations'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'patches'), { recursive: true });
  fs.writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2));
}

function appendIteration(id, it) {
  const file = path.join(taskDir(id), 'iterations', 'iterations.jsonl');
  fs.appendFileSync(file, JSON.stringify(it) + '\n', 'utf8');
}

function baseIteration(index, phase, hypothesis, action, observations, decision, modelCalls = 0) {
  return {
    index,
    phase,
    hypothesis,
    action,
    // Python records the cumulative calls of this process, not per-row calls.
    model_calls: modelCalls,
    observations,
    decision,
    created_at: now(),
  };
}

function cmdNew(flags) {
  const id = `dev_fake${Math.random().toString(36).slice(2, 10)}`;
  const acceptance = (flags.get('acceptance') || []).map(parseAcceptance);
  const ts = now();
  const task = {
    id,
    title: (flags.get('title') || [''])[0],
    problem: (flags.get('problem') || [''])[0],
    acceptance,
    workdir: (flags.get('workdir') || [process.cwd()])[0],
    branch: '',
    status: 'new',
    red_seen: false,
    diagnosis_rethink_count: 0,
    created_at: ts,
    updated_at: ts,
  };
  // Only explicitly named test fixtures emulate pre-P1a artifacts.
  if (!task.title.includes('legacy')) {
    task.sandbox_dirty = false;
    task.verify_state = 'none';
  }
  saveTask(task);
  emit({ ok: true, id });
}

function cmdRun(id, flags) {
  const task = loadTask(id);
  let index = iterationCount(id);
  let modelCalls = 0;
  const record = (phase, hypothesis, action, observations, decision) => {
    if (phase === 'react') modelCalls++;
    appendIteration(id, baseIteration(index++, phase, hypothesis, action, observations, decision, modelCalls));
  };
  if (flags.has('resume-budget')) {
    const file = path.join(taskDir(id), 'iterations', 'iterations.jsonl');
    const last = fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line)).at(-1);
    if (task.status !== 'blocked' || last?.phase !== 'block' || last.decision !== 'iteration budget reached') {
      throw new Error('resume-budget requires an automatic budget stop');
    }
    record('resume', '', 'resume_budget', ['old budget evidence retained'], 'resumed automatic budget stop');
    task.status = 'new';
    task.red_seen = false;
    task.sandbox_dirty = false;
    task.verify_state = 'none';
    saveTask(task);
  } else if (task.title.includes('budget')) {
    record('block', '', '', [], 'iteration budget reached');
    task.status = 'blocked';
    saveTask(task);
    emit({ ok: true, status: task.status });
    return;
  }
  if (task.title.includes('hold')) {
    record('react', 'Inspecting the task before proceeding.', 'read_file',
      ['HOLD_PROGRESS_PRESERVED'], 'waiting for the test to stop this process');
    task.status = 'diagnosed';
    saveTask(task);
    // Keep the child alive until the real backend stop endpoint terminates it.
    setInterval(() => {}, 1000);
    return;
  }
  record('react', 'Inspect the final rating and action mapping.', 'read_file',
    ['rating is capped to Hold', "action still reads the model's original Buy"], 'tool observed');
  const longLog = Array.from({ length: 80 }, (_, line) =>
    `saved check line ${line + 1}: the rating and action disagree`).join('\n');
  record('react', 'The failure can be reproduced by the acceptance check.', 'run_check',
    [`check failed as expected (RED)\n${longLog}\nSAVED_OUTPUT_END_MARKER`, 'exit code 1'], 'red observed');

  const history = task.title.includes('history');
  if (history) {
    record('react', 'FIRST_PATCH_HYPOTHESIS: align the initial action.', 'apply_patch',
      ['wrote patches/0001.diff'], 'patch proposed');
    writePatch(id, '0001', 'actionForInitialRating(rating)');
    record('verify', 'The initial mapping may miss hard guards.', 'run_check',
      ['unit: failed; guarded Hold still carries Buy'], 'verification failed');
    record('react', 'The failed check points to the final guarded rating.', 'read_file',
      ['hard guard runs after the initial rating'], 'tool observed');
  }
  const patchId = history ? '0002' : '0001';
  record('react', 'FINAL_PATCH_HYPOTHESIS: derive the action from the final rating.', 'apply_patch',
    [`wrote patches/${patchId}.diff`, 'changed file: server/modules/multi-agent/pipeline.service.ts'],
    'patch proposed');
  writePatch(id, patchId, 'actionForRating(finalRating)');
  record('verify', 'Check the candidate patch in the sandbox.', 'run_check',
    ['targeted check passes (GREEN)', 'no adjacent regressions'], 'verification passed');
  record('react', 'The verified candidate is ready for human review.', 'finish',
    ['candidate saved; sandbox changes rolled back'], 'awaiting approval');

  const legacy = task.title.includes('legacy');
  if (legacy) {
    record('future_phase_v2', 'Retain an unfamiliar saved phase.', 'future_tool_v2',
      ['UNKNOWN_PHASE_OBSERVATION'], 'legacy artifact stopped');
  } else {
    task.sandbox_dirty = true;
    task.verify_state = 'passed';
  }
  task.red_seen = true;
  task.status = legacy ? 'diagnosed' : 'awaiting_approval';
  saveTask(task);
  emit({ ok: true, status: task.status });
}

function writePatch(id, patchId, expression) {
  const diff = [
    'diff --git a/server/modules/multi-agent/pipeline.service.ts b/server/modules/multi-agent/pipeline.service.ts',
    '--- a/server/modules/multi-agent/pipeline.service.ts',
    '+++ b/server/modules/multi-agent/pipeline.service.ts',
    '@@ -42,7 +42,7 @@',
    '   const finalRating = applyHardGuards(rating, guards);',
    '-  const action = modelAction;',
    `+  const action = ${expression};`,
    '   return { rating: finalRating, action };',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(taskDir(id), 'patches', `${patchId}.diff`), diff, 'utf8');
}

function iterationCount(id) {
  const file = path.join(taskDir(id), 'iterations', 'iterations.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
}

function cmdApprove(id) {
  const task = loadTask(id);
  appendIteration(
    id,
    baseIteration(
      iterationCount(id),
      'landing',
      'The reviewer approved the verified candidate.',
      'apply_patch',
      ['patch applied to the main workspace', 'unit checks pass (GREEN)'],
      'verified',
    ),
  );
  task.status = 'verified';
  saveTask(task);
  emit({ ok: true, status: task.status });
}

function cmdReject(id, reason) {
  const task = loadTask(id);
  appendIteration(
    id,
    baseIteration(
      iterationCount(id),
      'approval',
      'The reviewer rejected the proposed patch.',
      'Record the rejection reason and stop without applying.',
      [`reason: ${reason}`],
      'rejected; task stopped',
    ),
  );
  task.status = 'blocked';
  saveTask(task);
  emit({ ok: true, status: task.status });
}

function main() {
  // argv: node, script, 'dev', <sub>, ...
  const argv = process.argv.slice(2);
  if (argv[0] !== 'dev') {
    console.error(`fake-agent: expected 'dev' group, got '${argv[0]}'`);
    process.exit(2);
  }
  const sub = argv[1];
  const { positional, flags } = parseFlags(argv.slice(2));
  try {
    switch (sub) {
      case 'new':
        return cmdNew(flags);
      case 'run':
        return cmdRun(positional[0], flags);
      case 'approve':
        return cmdApprove(positional[0]);
      case 'reject':
        return cmdReject(positional[0], (flags.get('reason') || [''])[0]);
      default:
        console.error(`fake-agent: unknown subcommand '${sub}'`);
        process.exit(2);
    }
  } catch (err) {
    emit({ ok: false, error: String(err && err.message ? err.message : err) });
    process.exit(1);
  }
}

main();
