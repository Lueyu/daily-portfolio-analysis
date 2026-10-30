const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const source = readFileSync(resolve(__dirname, 'pipeline-step-state.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exported = { exports: {} };
runInNewContext(compiled, { module: exported, exports: exported.exports });
const { getPipelineStepState } = exported.exports;

const run = (overrides = {}) => ({
  status: 'awaiting_human', evidence: [{ sourceName: 'Tencent' }],
  arguments: [], debate: [], riskGate: [{ passed: true }], rating: {}, ...overrides,
});

test('basic reports never claim that debate or critique ran', () => {
  for (const status of ['awaiting_human', 'completed']) {
    const basic = run({ status });
    assert.equal(getPipelineStepState('debating', basic), 'skipped');
    assert.equal(getPipelineStepState('critiquing', basic), 'skipped');
    assert.equal(getPipelineStepState('fetching', basic), 'done');
    assert.equal(getPipelineStepState('risk_check', basic), 'done');
    assert.equal(getPipelineStepState('completed', basic), 'done');
  }
});

test('AI calls with no accepted arguments still count their persisted debate records', () => {
  const ai = run({ debate: [
    { speaker: 'bull', content: 'No supported arguments.' },
    { speaker: 'bear', content: 'No supported arguments.' },
    { speaker: 'critic', content: 'Evidence is insufficient.' },
  ] });
  assert.equal(getPipelineStepState('debating', ai), 'done');
  assert.equal(getPipelineStepState('critiquing', ai), 'done');
});

test('partial AI records cannot turn missing stages into completed or skipped stages', () => {
  const partial = run({ debate: [{ speaker: 'bull', content: 'One side only.' }] });
  assert.equal(getPipelineStepState('debating', partial), 'partial');
  assert.equal(getPipelineStepState('critiquing', partial), 'partial');
});

test('an empty critic response is incomplete', () => {
  assert.equal(getPipelineStepState('critiquing', run({ debate: [{ speaker: 'critic', content: '' }] })), 'partial');
});

test('data gaps remain partial while stages with saved outputs survive a failed run', () => {
  const failed = run({ status: 'failed', evidence: [{ sourceName: 'Data Unavailable' }], rating: null, riskGate: [] });
  assert.equal(getPipelineStepState('fetching', failed), 'partial');
  assert.equal(getPipelineStepState('debating', failed), 'pending');
  assert.equal(getPipelineStepState('completed', failed), 'pending');
});

test('current stages remain active and future stages remain pending', () => {
  const active = run({ status: 'debating', rating: null, riskGate: [] });
  assert.equal(getPipelineStepState('fetching', active), 'done');
  assert.equal(getPipelineStepState('debating', active), 'active');
  assert.equal(getPipelineStepState('critiquing', active), 'pending');
});
