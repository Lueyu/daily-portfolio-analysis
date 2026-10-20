#!/usr/bin/env node
/**
 * fake-agent.cjs — deterministic stand-in for the Python coding agent.
 *
 * The real `agent dev run/approve` calls an LLM and is slow/non-deterministic.
 * End-to-end tests need a reproducible driver, so this script implements the
 * same CLI surface and on-disk work-product contract without any model calls:
 *
 *   dev new   --title T --problem P --acceptance id:kind:desc[:target] ... [--workdir W]
 *   dev run       <id>
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

function baseIteration(index, phase, hypothesis, action, observations, decision) {
  return {
    index,
    phase,
    hypothesis,
    action,
    model_calls: 1,
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
  saveTask(task);
  emit({ ok: true, id });
}

function cmdRun(id) {
  const task = loadTask(id);
  appendIteration(
    id,
    baseIteration(
      0,
      'reproduce',
      'The failure can be reproduced by the acceptance check.',
      'Run the targeted check and capture the red output.',
      ['check failed as expected (RED)', 'exit code 1'],
      'Move to diagnosis.',
    ),
  );
  appendIteration(
    id,
    baseIteration(
      1,
      'diagnose',
      'The guard overwrites the rating but not the saved action.',
      'Trace the rating/action mapping in the pipeline.',
      ['rating is capped to Hold', "action still reads the model's original Buy"],
      'Patch the action together with the rating.',
    ),
  );
  appendIteration(
    id,
    baseIteration(
      2,
      'patch',
      'Deriving the action from the final rating removes the contradiction.',
      'Apply a minimal change and write the diff.',
      ['wrote patches/0001.diff', 'changed file: server/modules/multi-agent/pipeline.service.ts'],
      'Request approval after the fix is staged.',
    ),
  );
  const diff = [
    'diff --git a/server/modules/multi-agent/pipeline.service.ts b/server/modules/multi-agent/pipeline.service.ts',
    '--- a/server/modules/multi-agent/pipeline.service.ts',
    '+++ b/server/modules/multi-agent/pipeline.service.ts',
    '@@ -42,7 +42,7 @@',
    '   const finalRating = applyHardGuards(rating, guards);',
    '-  const action = modelAction;',
    '+  const action = actionForRating(finalRating);',
    '   return { rating: finalRating, action };',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(taskDir(id), 'patches', '0001.diff'), diff, 'utf8');
  task.red_seen = true;
  task.status = 'awaiting_approval';
  saveTask(task);
  emit({ ok: true, status: task.status });
}

function cmdApprove(id) {
  const task = loadTask(id);
  appendIteration(
    id,
    baseIteration(
      3,
      'verify',
      'The staged patch satisfies the acceptance criteria.',
      'Run the full targeted check plus adjacent cases.',
      ['targeted check passes (GREEN)', 'no adjacent regressions'],
      'Mark the task verified.',
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
      task.diagnosis_rethink_count,
      'reject',
      'The reviewer rejected the proposed patch.',
      'Record the rejection reason and stop without applying.',
      [`reason: ${reason}`],
      'Block the task pending a new diagnosis.',
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
        return cmdRun(positional[0]);
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
