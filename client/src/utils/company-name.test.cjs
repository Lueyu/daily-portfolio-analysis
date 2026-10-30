const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const source = readFileSync(resolve(__dirname, 'company-name.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exported = { exports: {} };
runInNewContext(compiled, { module: exported, exports: exported.exports });
const { displayCompanyName } = exported.exports;

test('English selects the English name from an explicitly bilingual company name', () => {
  assert.equal(displayCompanyName('英伟达 (NVIDIA Corporation)', 'NVDA', 'en'), 'NVIDIA Corporation');
  assert.equal(displayCompanyName('腾讯控股（Tencent Holdings）', '0700', 'en-US'), 'Tencent Holdings');
  assert.equal(displayCompanyName('贵州茅台 (Kweichow Moutai)', '600519', 'en'), 'Kweichow Moutai');
});

test('Chinese retains the original bilingual name and can be selected after English', () => {
  const name = '苹果 (Apple Inc.)';
  assert.equal(displayCompanyName(name, 'AAPL', 'en'), 'Apple Inc.');
  assert.equal(displayCompanyName(name, 'AAPL', 'zh-CN'), name);
});

test('custom and single-language names are preserved without inventing translations', () => {
  for (const name of ['腾讯控股', 'Apple Inc.', '腾讯 (自选)', '我的持仓 (2026)', 'Berkshire Hathaway (Class B)']) {
    assert.equal(displayCompanyName(name, 'CUSTOM', 'en'), name);
  }
});

test('empty names and ticker duplicates are omitted', () => {
  for (const name of [undefined, null, '', '  ', 'nvda', 'NVDA.US']) {
    assert.equal(displayCompanyName(name, 'NVDA', 'en'), null);
  }
});
