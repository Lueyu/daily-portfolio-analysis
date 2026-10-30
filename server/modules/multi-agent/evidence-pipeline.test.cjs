const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const directory = __dirname;
const holdings = { name: 'holdings' };
const watchlist = { name: 'watchlist' };

function loadService(name) {
  const source = fs.readFileSync(path.join(directory, name), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
    },
  }).outputText;
  const module = { exports: {} };
  const dependencies = {
    '@nestjs/common': {
      Injectable: () => (target) => target,
      Inject: () => () => undefined,
      Logger: class {
        log() {}
        warn() {}
        error() {}
      },
    },
    '../../common/platform': { DRIZZLE_DATABASE: 'db' },
    'drizzle-orm': { eq: () => true, and: () => true },
    '@server/database/schema': { holdings, watchlist, agentRuns: {} },
    './finnhub-evidence.service': { FinnhubEvidenceService: class {} },
    '../settings/settings.service': { SettingsService: class {} },
  };
  const localRequire = (id) => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    if (id === './analysis-report' || id === './evidence-language') return loadService(`${id.slice(2)}.ts`);
    throw new Error(`Unexpected import in test: ${id}`);
  };
  new Function('require', 'module', 'exports', compiled)(
    localRequire,
    module,
    module.exports,
  );
  return module.exports;
}

function fakeDb(holdingRows = [], watchRows = []) {
  return {
    select: () => ({
      from: (table) => ({
        where: () => Promise.resolve(table === holdings ? holdingRows : watchRows),
      }),
    }),
  };
}

const quote = {
  symbol: 'AAPL',
  price: '100',
  change: '1',
  changePercent: '1',
  open: '99',
  high: '101',
  low: '98',
  volume: '1000',
  market: 'US',
  currency: 'USD',
  timestamp: Date.now(),
  delayed: true,
};

function evidenceRow(overrides = {}) {
  return {
    id: 'e-1',
    role: 'fundamental',
    evidenceType: 'price',
    title: '实时价格',
    content: '原始价格 100.00',
    sourceName: 'Tencent Finance',
    relevanceScore: '0.9',
    ...overrides,
  };
}

function pipelineWith({ llm, multi } = {}) {
  const { PipelineService } = loadService('pipeline.service.ts');
  return new PipelineService(
    {},
    llm ?? {},
    {},
    {},
    multi ?? {},
  );
}

test('missing news, valuation, and historical data are gaps, not research facts', async () => {
  const { EvidenceService } = loadService('evidence.service.ts');
  const service = new EvidenceService(fakeDb(), {
    getQuote: async () => quote,
  }, { getMetrics: async () => null, getNews: async () => null });

  const items = await service.collectEvidence('AAPL', 'user-1', { totalValue: 1000 });
  const gaps = items.filter((item) => item.sourceName === 'Data Unavailable');
  const gapText = gaps.map((item) => item.content).join(' ');

  assert.match(gapText, /新闻/);
  assert.match(gapText, /估值/);
  assert.match(gapText, /历史/);
  assert.ok(gaps.every((item) => item.relevanceScore === 0));
  assert.ok(!items.some((item) => /情绪判断：中性/.test(item.content)));
  assert.ok(!items.some((item) => item.evidenceType === 'levels'));
  assert.ok(!items.some((item) => item.title.includes('实时行情')));
  assert.ok(!items.some((item) => item.sourceName === 'Tencent Finance'));
});

test('verified Finnhub valuation is cited while missing statements remain a gap', async () => {
  const { EvidenceService } = loadService('evidence.service.ts');
  const seen = [];
  const service = new EvidenceService(fakeDb(), { getQuote: async () => quote }, {
    getMetrics: async (userId, ticker) => {
      seen.push([userId, ticker]);
      return {
        hasValuation: true,
        items: [{
          role: 'fundamental', evidenceType: 'financial',
          title: `${ticker} Finnhub valuation`, content: 'P/E (TTM): 25',
          sourceName: 'Finnhub API', relevanceScore: 0.8,
        }],
      };
    },
    getNews: async () => null,
  });

  const items = await service.collectEvidence('AAPL', 'user-1', { totalValue: 1000 });
  assert.deepEqual(seen, [['user-1', 'AAPL']]);
  assert.ok(items.some((item) => item.sourceName === 'Finnhub API'));
  assert.ok(items.some((item) => item.title.includes('财报数据缺失')));
  assert.ok(!items.some((item) => item.title.includes('估值数据缺失')));
});

test('configured Finnhub news is preserved as sourced evidence', async () => {
  const { EvidenceService } = loadService('evidence.service.ts');
  const service = new EvidenceService(fakeDb(), { getQuote: async () => quote }, {
    getMetrics: async () => null,
    getNews: async () => [{
      role: 'news', evidenceType: 'news', title: 'AAPL company update',
      content: 'Headline from provider', sourceUrl: 'https://example.com/article',
      sourceName: 'Finnhub API', relevanceScore: 0.7,
    }],
  });

  const items = await service.collectEvidence('AAPL', 'user-1', { totalValue: 1000 });
  assert.ok(items.some((item) => item.title === 'AAPL company update'));
  assert.ok(!items.some((item) => item.title.includes('新闻与情绪缺失')));
});

test('Finnhub requests use only the caller key and keep unsupported markets out', async () => {
  const { FinnhubEvidenceService } = loadService('finnhub-evidence.service.ts');
  const requested = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requested.push(new URL(String(input)));
    return Response.json({ metric: { peBasicExclExtraTTM: 25.4, pbAnnual: 5.2 } });
  };
  try {
    const service = new FinnhubEvidenceService({
      getFinnhubKey: async (userId) => userId === 'alice' ? 'alice-secret' : null,
    });
    const metrics = await service.getMetrics('alice', 'AAPL');
    assert.equal(metrics.hasValuation, true);
    assert.match(metrics.items[0].content, /P\/E.*25\.40/);
    assert.equal(requested[0].searchParams.get('token'), 'alice-secret');
    assert.equal(await service.getMetrics('bob', 'AAPL'), null);
    assert.equal(await service.getMetrics('alice', '0700.HK'), null);
    assert.equal(requested.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Finnhub transport errors cannot leak the key into an exception', async () => {
  const { FinnhubEvidenceService } = loadService('finnhub-evidence.service.ts');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('token=alice-secret'); };
  try {
    const service = new FinnhubEvidenceService({
      getFinnhubKey: async () => 'alice-secret',
    });
    await assert.rejects(service.getMetrics('alice', 'AAPL'), (error) => {
      assert.match(error.message, /Finnhub request failed/);
      assert.doesNotMatch(error.message, /alice-secret/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Finnhub news rejects invalid provider timestamps as unverified', async () => {
  const { FinnhubEvidenceService } = loadService('finnhub-evidence.service.ts');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{
    headline: '<b>Company update</b>', summary: '<p>Revenue update</p>',
    url: 'javascript:alert(1)', source: 'Publisher', datetime: Number.MAX_VALUE,
  }]);
  try {
    const service = new FinnhubEvidenceService({ getFinnhubKey: async () => 'key' });
    const news = await service.getNews('alice', 'AAPL');
    assert.equal(news.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Finnhub news sanitizes article metadata and unsafe links', async () => {
  const { FinnhubEvidenceService } = loadService('finnhub-evidence.service.ts');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{
    headline: '<b>Company update</b>', summary: '<p>Revenue update</p>',
    url: 'javascript:alert(1)', source: 'Publisher',
    datetime: Math.floor(Date.now() / 1000) - 60,
  }]);
  try {
    const service = new FinnhubEvidenceService({ getFinnhubKey: async () => 'key' });
    const news = await service.getNews('alice', 'AAPL');
    assert.equal(news.length, 1);
    assert.equal(news[0].title, 'Company update');
    assert.equal(news[0].sourceUrl, undefined);
    assert.equal(news[0].sourceName, 'Finnhub API');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('quote failure keeps portfolio facts and reports the missing price', async () => {
  const { EvidenceService } = loadService('evidence.service.ts');
  const service = new EvidenceService(
    fakeDb([{ ticker: 'AAPL', shares: '10', buyPrice: '80', currentPrice: '90' }]),
    { getQuote: async () => { throw new Error('provider down'); } },
    { getMetrics: async () => null, getNews: async () => null },
  );

  const items = await service.collectEvidence('AAPL', 'user-1', { totalValue: 1000 });
  assert.ok(items.some((item) => item.title.includes('持仓信息')));
  assert.ok(items.some((item) =>
    item.sourceName === 'Data Unavailable' && item.content.includes('行情')));
  const position = items.find((item) => item.title.includes('持仓信息'));
  assert.ok(!position.content.includes('浮盈亏'));
});

test('HK portfolio evidence uses native currency and the USD-normalized weight', async () => {
  const { EvidenceService } = loadService('evidence.service.ts');
  const hkQuote = {
    ...quote,
    symbol: '0700.HK',
    market: 'HK',
    currency: 'HKD',
    price: '120',
    change: '2',
    high: '121',
    low: '118',
  };
  const service = new EvidenceService(fakeDb([{
    ticker: '0700.HK', shares: '10', buyPrice: '100', currency: 'HKD', sector: 'Technology',
  }]), { getQuote: async () => hkQuote },
  { getMetrics: async () => null, getNews: async () => null });
  const portfolio = {
    totalValue: 1000,
    holdings: [{
      ticker: '0700.HK', marketValue: 150, weightPct: 15,
    }],
  };

  const items = await service.collectEvidence('0700.HK', 'user-1', portfolio);
  const position = items.find((item) => item.title.includes('持仓信息'));
  const quoteRow = items.find((item) => item.title.includes('行情报价'));
  const technical = items.find((item) => item.title.includes('价格行为'));

  assert.match(position.content, /成本价: HKD 100\.00/);
  assert.match(position.content, /报价: HKD 120\.00/);
  assert.match(position.content, /市值: HKD 1200\.00/);
  assert.match(position.content, /浮盈亏: HKD 200\.00/);
  assert.match(position.content, /组合记录市值: USD 150\.00/);
  assert.match(position.content, /组合权重: 15\.00%/);
  assert.match(quoteRow.content, /报价: HKD 120/);
  assert.match(technical.content, /报价: HKD 120/);
  assert.doesNotMatch(items.map((item) => item.content).join(' '), /\$/);
});

test('debate stores only current saved evidence IDs and drops unsupported arguments', async () => {
  const prompts = [];
  const savedArguments = [];
  let call = 0;
  const llm = {
    chatSlowJSON: async (messages) => {
      prompts.push(messages.map(message => message.content).join('\n'));
      const data = [
        { arguments: [
          { point: '有依据', evidence_refs: ['e-1', 'made-up-id'] },
        ] },
        { arguments: [
          { point: '无依据', evidence_refs: ['made-up-id'] },
        ] },
        { arguments: [
          { point: '有依据的反驳', evidence_refs: ['e-1', 'made-up-id'] },
        ] },
        { arguments: [
          { point: '无依据的反驳', evidence_refs: ['made-up-id'] },
        ] },
      ][call++];
      return { data, tokens: 1 };
    },
  };
  const multi = {
    addArgument: async (_user, _run, arg) => { savedArguments.push(arg); },
    addDebateRecord: async () => undefined,
  };
  const pipeline = pipelineWith({ llm, multi });
  const evidence = [
    evidenceRow(),
    evidenceRow({ id: 'gap-1', title: '新闻缺失', content: '新闻未接入',
      evidenceType: 'other', sourceName: 'Data Unavailable' }),
  ];

  await pipeline.runDebatePhase('run-1', 'user-1', 'AAPL', evidence);

  assert.match(prompts[0], /e-1/);
  assert.doesNotMatch(prompts[0], /gap-1/);
  assert.deepEqual(savedArguments.filter((arg) => arg.round === 1), [
    { side: 'bull', round: 1, argument: '有依据', evidenceIds: ['e-1'] },
  ]);
  assert.deepEqual(savedArguments.filter((arg) => arg.round === 2), [
    { side: 'bull', round: 2, argument: '有依据的反驳', evidenceIds: ['e-1'] },
  ]);
});

test('pipeline passes IDs returned by evidence persistence into the debate', async () => {
  const prompts = [];
  const budgetCalls = [];
  const savedArguments = [];
  const savedEvidence = [evidenceRow({ id: 'saved-id' })];
  const detail = {
    ticker: 'AAPL',
    runMode: 'full',
    evidence: savedEvidence,
    arguments: [],
    debate: [],
    riskGate: [],
  };
  let jsonCalls = 0;
  const llm = {
    isConfigured: async () => true,
    getExecutionInfo: async () => ({ provider: 'user', modelFast: 'fast', modelSlow: 'slow' }),
    chatSlowJSON: async (messages, userId, options) => {
      budgetCalls.push({ userId, options });
      prompts.push(messages.map(message => message.content).join('\n'));
      const data = jsonCalls < 2
        ? { arguments: [{ point: '有证据', evidence_refs: ['saved-id'] }] }
        : jsonCalls < 4
          ? { arguments: [] }
          : { rating: 'Watch', confidence: 'low', action: '观察' };
      jsonCalls += 1;
      return { data, tokens: 1 };
    },
    chatSlow: async (_messages, userId, options) => {
      budgetCalls.push({ userId, options });
      return { content: '审稿意见', totalTokens: 1 };
    },
  };
  const multi = {
    getRun: async () => detail,
    addEvidence: async () => savedEvidence,
    addArgument: async (_user, _run, argument) => {
      savedArguments.push(argument);
      detail.arguments.push({ ...argument, id: 'arg-id' });
    },
    addDebateRecord: async (_user, _run, record) => {
      detail.debate.push(record);
    },
    getStrategyRules: async () => [],
    saveRiskGateResults: async () => undefined,
    saveRating: async () => undefined,
    savePipelineReport: async () => undefined,
    addAuditLog: async () => undefined,
  };
  const db = {
    select: () => ({ from: () => ({ where: async () => [{ status: 'fetching' }] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  const { PipelineService } = loadService('pipeline.service.ts');
  const pipeline = new PipelineService(
    db,
    llm,
    { collectEvidence: async () => [
      { role: 'fundamental', evidenceType: 'price', title: '实时价格',
        content: '原始价格 100.00', sourceName: 'Tencent Finance',
        relevanceScore: 0.9 },
    ] },
    { getPortfolioContext: async () => ({ totalValue: 1000 }),
      checkRiskRules: () => [] },
    multi,
  );

  await pipeline.runPipeline('run-1', 'user-1');

  assert.match(prompts[0], /saved-id/);
  assert.ok(savedArguments.some((arg) => arg.evidenceIds?.includes('saved-id')));
  assert.equal(budgetCalls.length, 6);
  assert.ok(budgetCalls.every(call => call.userId === 'user-1'
    && call.options?.taskId === 'analysis:run-1' && call.options.maxOutputTokens === 1000));
  assert.equal(new Set(budgetCalls.map(call => call.options.purpose)).size, 6);
});

test('budget exhaustion in optional rebuttal stops the analysis rather than requesting more model work', async () => {
  let calls = 0;
  const exceeded = Object.assign(new Error('untrusted private payload'), { code: 'LLM_BUDGET_EXCEEDED' });
  const pipeline = pipelineWith({ llm: {
    chatSlowJSON: async () => {
      calls += 1;
      if (calls > 2) throw exceeded;
      return { data: { arguments: [] }, tokens: 1 };
    },
  }, multi: { addArgument: async () => undefined, addDebateRecord: async () => undefined } });
  await assert.rejects(() => pipeline.runDebatePhase('run-1', 'alice', 'AAPL', [evidenceRow()]),
    error => error === exceeded);
  assert.equal(calls, 4);
});

test('critic receives original evidence text and linked IDs', async () => {
  let prompt = '';
  const multi = {
    getRun: async () => ({
      evidence: [evidenceRow()],
      arguments: [
        { side: 'bull', round: 1, argument: '上涨论点', evidenceIds: ['e-1'] },
        { side: 'bear', round: 1, argument: '无效引用论点', evidenceIds: ['other-run-id'] },
      ],
    }),
    addDebateRecord: async () => undefined,
  };
  const llm = {
    chatSlow: async (messages) => {
      prompt = messages.map(message => message.content).join('\n');
      return { content: '批评', totalTokens: 1 };
    },
  };
  await pipelineWith({ llm, multi }).runCritiquePhase('run-1', 'user-1');

  assert.match(prompt, /原始价格 100\.00/);
  assert.match(prompt, /e-1/);
  assert.match(prompt, /上涨论点/);
  assert.doesNotMatch(prompt, /无效引用论点/);
});

test('free basic pipeline creates a real report without making any model calls', async () => {
  const states = [];
  const savedEvidence = [evidenceRow({ title: 'Price quote', content: 'USD 100' })];
  const detail = { ticker: 'AAPL', language: 'en', runMode: 'summary', evidence: savedEvidence,
    arguments: [], debate: [], riskGate: [], rating: null };
  let reportEngine;
  let collectedLanguage;
  const multi = {
    getRun: async () => detail,
    addEvidence: async () => savedEvidence,
    getStrategyRules: async () => [],
    saveRiskGateResults: async (_user, _run, values) => { detail.riskGate = values; },
    saveRating: async (_user, _run, value) => { detail.rating = value; },
    savePipelineReport: async (_user, _run, engine) => { reportEngine = engine; },
    addAuditLog: async () => undefined,
  };
  const { PipelineService } = loadService('pipeline.service.ts');
  const pipeline = new PipelineService({
    select: () => ({ from: () => ({ where: async () => [{ status: 'fetching' }] }) }),
    update: () => ({ set: value => ({ where: async () => { states.push(value.status); } }) }),
  }, { isConfigured: async () => false,
    chatSlowJSON: async () => { throw new Error('Basic mode must not call a model'); } },
  { collectEvidence: async (_ticker, _user, _portfolio, language) => { collectedLanguage = language; return []; } },
  { getPortfolioContext: async () => ({}), checkRiskRules: () => [] }, multi);
  await pipeline.runPipeline('run-1', 'user-1');
  assert.equal(reportEngine, 'basic');
  assert.equal(collectedLanguage, 'en');
  assert.equal(detail.rating.rating, 'Watch');
  assert.equal(detail.rating.confidence, 'low');
  assert.equal(detail.rating.targetPrice, undefined);
  assert.match(detail.rating.aggregationLogic, /did not call an LLM/);
  assert.ok(states.includes('awaiting_human'));
  assert.ok(!states.includes('debating') && !states.includes('critiquing'));
});

test('an explicitly configured model failure remains failed and never falls back to basic', async () => {
  const states = [];
  let reports = 0;
  const detail = { ticker: 'AAPL', language: 'en', runMode: 'full' };
  const { PipelineService } = loadService('pipeline.service.ts');
  const pipeline = new PipelineService({
    select: () => ({ from: () => ({ where: async () => [{ status: 'fetching' }] }) }),
    update: () => ({ set: value => ({ where: async () => { states.push(value.status); } }) }),
  }, { isConfigured: async () => true,
    getExecutionInfo: async () => ({ provider: 'user', modelFast: 'fast', modelSlow: 'slow' }),
    chatSlowJSON: async () => { throw new Error('Provider rejected credentials'); } },
  { collectEvidence: async () => [] }, { getPortfolioContext: async () => ({}) },
  { getRun: async () => detail, addEvidence: async () => [], addAuditLog: async () => undefined,
    savePipelineReport: async () => { reports++; } });
  await pipeline.runPipeline('run-1', 'user-1');
  assert.equal(reports, 0);
  assert.equal(states.at(-1), 'failed');
});

test('English evidence localizes built-in price and missing-data statements', async () => {
  const { EvidenceService } = loadService('evidence.service.ts');
  const service = new EvidenceService(fakeDb(), { getQuote: async () => quote },
    { getMetrics: async () => null, getNews: async () => null });
  const items = await service.collectEvidence('AAPL', 'user-1', { totalValue: 1000 }, 'en');
  assert.ok(items.some(item => item.title.includes('Financial statements unavailable')));
  assert.doesNotMatch(items.map(item => `${item.title} ${item.content}`).join(' '), /\p{Script=Han}/u);
});

test('cancelling a queued run does not restart it and releases its completion slot once', async () => {
  let started = false;
  let callbacks = 0;
  const { PipelineService } = loadService('pipeline.service.ts');
  const pipeline = new PipelineService({
    select: () => ({ from: () => ({ where: async () => [{ status: 'cancelled' }] }) }),
    update: () => { started = true; throw new Error('Cancelled run must not be restarted'); },
  }, {}, {}, {}, { getRun: async () => ({ runMode: 'summary', ticker: 'AAPL' }) });
  pipeline.onRunComplete(() => { callbacks++; });
  await pipeline.runPipeline('run-1', 'user-1');
  assert.equal(started, false);
  assert.equal(callbacks, 1);
});

test('an initial database read failure releases the reserved queue slot exactly once', async () => {
  const { PipelineService } = loadService('pipeline.service.ts');
  const callbacks = [];
  const pipeline = new PipelineService({
    update: () => { throw new Error('Database is unavailable'); },
  }, {}, {}, {}, { getRun: async () => { throw new Error('Database is unavailable'); } });
  pipeline.onRunComplete((...args) => { callbacks.push(args); });
  await pipeline.runPipeline('run-1', 'user-1', 'summary');
  assert.deepEqual(callbacks, [['run-1', 'user-1', 'summary']]);
});

test('Chinese basic conclusions localize displayed rating names without changing enums', async () => {
  let saved;
  const pipeline = pipelineWith({ multi: {
    getRun: async () => ({ evidence: [], riskGate: [] }),
    saveRating: async (_user, _run, rating) => { saved = rating; },
  } });
  await pipeline.runBasicRatingPhase('run-1', 'user-1', 'AAPL', 'zh-CN');
  assert.equal(saved.rating, 'Watch');
  assert.equal(saved.confidence, 'low');
  assert.match(saved.aggregationLogic, /观望\/低置信度/);
  assert.doesNotMatch(saved.aggregationLogic, /Watch|low/);
});

test('rating is Watch with low confidence and no target when key sources are missing', async () => {
  let saved;
  let prompt = '';
  const detail = {
    evidence: [
      evidenceRow(),
      evidenceRow({ id: 'gap-news', role: 'news', title: '新闻缺失',
        content: '新闻数据源暂未接入', evidenceType: 'other',
        sourceName: 'Data Unavailable' }),
      evidenceRow({ id: 'gap-value', title: '估值缺失', content: '估值数据缺失',
        evidenceType: 'other', sourceName: 'Data Unavailable' }),
      evidenceRow({ id: 'gap-history', role: 'technical', title: '历史技术数据缺失',
        content: '历史K线缺失', evidenceType: 'other',
        sourceName: 'Data Unavailable' }),
    ],
    arguments: [],
    debate: [],
    riskGate: [],
  };
  const multi = {
    getRun: async () => detail,
    saveRating: async (_user, _run, rating) => { saved = rating; },
  };
  const llm = {
    isConfigured: async () => true,
    getExecutionInfo: async () => ({ provider: 'user', modelFast: 'fast', modelSlow: 'slow' }),
    chatSlowJSON: async (messages) => {
      prompt = messages.map(message => message.content).join('\n');
      return { data: {
        rating: 'Strong Buy', confidence: 'high', target_price: 150,
        action: '立即买入', key_uncertainty: '无',
      }, tokens: 1 };
    },
  };
  await pipelineWith({ llm, multi }).runRatingPhase(
    'run-1', 'user-1', 'AAPL', false, [],
  );

  assert.equal(saved.rating, 'Watch');
  assert.equal(saved.confidence, 'low');
  assert.equal(saved.targetPrice, undefined);
  assert.match(saved.keyUncertainty, /新闻/);
  assert.match(saved.keyUncertainty, /估值/);
  assert.match(saved.keyUncertainty, /历史技术/);
  assert.doesNotMatch(saved.action, /买入/);
  assert.match(prompt, /缺失数据/);
});

test('rating remains cautious if saved evidence has only a quote and no gap rows', async () => {
  let saved;
  let prompt = '';
  const multi = {
    getRun: async () => ({ evidence: [evidenceRow()], arguments: [
      { side: 'bull', round: 1, argument: '跨运行的无效论点',
        evidenceIds: ['other-run-id'] },
    ],
      debate: [], riskGate: [] }),
    saveRating: async (_user, _run, rating) => { saved = rating; },
  };
  const llm = {
    chatSlowJSON: async (messages) => {
      prompt = messages.map(message => message.content).join('\n');
      return { data: {
        rating: 'Buy', confidence: 'high', target_price: 150,
        action: '买入',
      }, tokens: 1 };
    },
  };

  await pipelineWith({ llm, multi }).runRatingPhase(
    'run-1', 'user-1', 'AAPL', false, [],
  );

  assert.equal(saved.rating, 'Watch');
  assert.equal(saved.confidence, 'low');
  assert.match(saved.keyUncertainty, /新闻/);
  assert.match(saved.keyUncertainty, /财报/);
  assert.doesNotMatch(prompt, /跨运行的无效论点/);
});
