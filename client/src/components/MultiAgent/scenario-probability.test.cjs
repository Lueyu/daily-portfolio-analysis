const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const source = readFileSync(resolve(__dirname, 'scenario-probability.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exported = { exports: {} };
runInNewContext(compiled, { module: exported, exports: exported.exports });
const { formatScenarioProbabilities } = exported.exports;

function display(bear, base, bull) {
  const result = formatScenarioProbabilities({ probBear: bear, probBase: base, probBull: bull });
  return [result.probBear, result.probBase, result.probBull];
}

test('complete fractional probabilities display as percentage points', () => {
  assert.deepEqual(display('0.20', '0.55', '0.25'), ['20', '55', '25']);
  assert.deepEqual(display('0.125', '0.625', '0.25'), ['12.5', '62.5', '25']);
  assert.deepEqual(display('1', '0', '0'), ['100', '0', '0']);
});

test('legacy percentage inputs are preserved, including a one-percent scenario', () => {
  assert.deepEqual(display('20', '55', '25'), ['20', '55', '25']);
  assert.deepEqual(display('1', '49', '50'), ['1', '49', '50']);
});

test('incomplete, invalid, and ambiguous totals retain their original display', () => {
  for (const values of [
    ['0.20', null, '0.25'], ['0.20', '', '0.25'], ['0.20', 'unknown', '0.25'],
    ['0.20', 'Infinity', '0.25'], ['-0.20', '0.95', '0.25'],
    ['0.20', '0.50', '0.25'], ['0.33', '0.33', '0.33'],
  ]) {
    assert.deepEqual(display(...values), values);
  }
});
