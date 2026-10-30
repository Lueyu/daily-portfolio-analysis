const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const source = readFileSync(resolve(__dirname, 'council-state.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exported = { exports: {} };
runInNewContext(compiled, { module: exported, exports: exported.exports });
const { isCurrentCouncilReport, budgetPercent, validateCouncilSettings, validateBudget } = exported.exports;

test('a report becomes obsolete after new input or a newer report version', () => {
  const report = { id: 'r1', version: 1, revision: 2 };
  const session = { revision: 2, profileVersion: 3, reports: [report] };
  assert.equal(isCurrentCouncilReport(report, session, 3), true);
  assert.equal(isCurrentCouncilReport(report, { ...session, revision: 3 }, 3), false);
  assert.equal(isCurrentCouncilReport(report, session, 4), false);
  assert.equal(isCurrentCouncilReport(report, { ...session, reports: [report, { id: 'r2', version: 2, revision: 2 }] }, 3), false);
});

test('budget bars remain bounded and handle unavailable limits', () => {
  assert.equal(budgetPercent(50, 100), 50);
  assert.equal(budgetPercent(150, 100), 100);
  assert.equal(budgetPercent(-5, 100), 0);
  assert.equal(budgetPercent(5, 0), 0);
});

test('team requires every distinct responsibility and finite cadence limits', () => {
  const members = ['researcher', 'challenger', 'manager'].map(role => ({ id: role, role, name: role, instructions: '', model: 'fast' }));
  const cadence = { reviewEveryTradingDays: 5, maxOrdersPerWeek: 2, cooldownTradingDays: 3, maxWeeklyTurnoverPct: 10 };
  assert.equal(validateCouncilSettings({ enabled: true, members }, cadence), null);
  assert.equal(validateCouncilSettings({ enabled: true, members: [members[0], members[0], members[2]] }, cadence), 'teamInvalid');
  assert.equal(validateCouncilSettings({ enabled: true, members }, { ...cadence, maxOrdersPerWeek: 1.5 }), 'cadenceInvalid');
  assert.equal(validateCouncilSettings({ enabled: false, members: [] }, cadence), null);
});

test('budget validation rejects impossible or nonfinite caps and accepts unknown prices', () => {
  const settings = { dailyTokenLimit: 60000, monthlyTokenLimit: 600000, perTaskTokenLimit: 24000, maxInputTokens: 6000, maxOutputTokens: 1000, maxCallsPerTask: 8, dailyCallLimit: 30, inputUsdPerMillion: null, outputUsdPerMillion: null };
  assert.equal(validateBudget(settings), null);
  assert.equal(validateBudget({ ...settings, maxOutputTokens: NaN }), 'invalid');
  assert.equal(validateBudget({ ...settings, inputUsdPerMillion: -1 }), 'priceInvalid');
  assert.equal(validateBudget({ ...settings, maxInputTokens: 30000 }), 'inconsistent');
});
