import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packDiscussionContext } from './council.context';
import { discussionPrompt } from './council.dialogue';
import { evidenceExcerpts, type CouncilEvidence } from './council.rules';
import { normalizeBuilderConfig } from '../paper-trading/agent-builder.rules';

const statement = 'Period: 2026-01-01 to 2026-09-30. Revenue: USD 314389000000; Net income: USD 85204000000; Operating cash flow: USD 81389000000 (period total); Liabilities: USD 290437000000. Liabilities are a balance as of 2026-09-30; income and cash flow cover the stated period (may be YTD), not annualized. Form: 10-Q. Filed: 2026-10-29.';
const fact = (id: string, evidenceType: string, title: string, content: string): CouncilEvidence => ({ id, evidenceType,
  title, content, role: 'fundamental', sourceUrl: 'https://www.sec.gov/Archives/filing', sourceName: 'SEC EDGAR',
  fetchedAt: '2026-10-30T10:00:00Z', relevanceScore: 1 });

test('financial excerpts include verified values, units and periods instead of just provenance', () => {
  const excerpt = evidenceExcerpts([fact('filing', 'financial', 'AAPL SEC reported financial statements', statement)])[0];
  for (const value of ['314389000000', '85204000000', '81389000000', '290437000000', 'USD', '2026-01-01', '2026-09-30', 'may be YTD']) {
    assert.ok(excerpt.content.includes(value), `financial excerpt must retain ${value}`);
  }
});

test('a requested web source and financial statement both reach the next speaker with a populated, compressed context', () => {
  const config = normalizeBuilderConfig({ name: 'Research', template: 'guard', tickers: ['AAPL'], minimumRating: 'Buy',
    customPrompt: '审查现金流和负债。'.repeat(100), maxOrderPct: 5, dailyLossLimitPct: 3, maxOrdersPerDay: 1, notifyOnProposal: false });
  const member = { id: 'risk', role: 'challenger' as const, name: '风险分析师', model: 'fast' as const,
    instructions: '核对财务数据并提出问题。'.repeat(80), personality: '严谨务实，善于核对数据。'.repeat(20) };
  const turn = { memberId: 'risk', phase: 'challenge' as const };
  const data = packDiscussionContext({ ticker: 'AAPL', candidate: null, config, member, turn,
    systemPrompt: discussionPrompt(turn, 'zh-CN', false), userMessages: ['请核对最近的财报与现金流，解释最新风险。'.repeat(26).slice(0, 500)],
    previousDiscussion: [], currentDiscussion: [{ id: 'm1', memberName: 'Researcher', role: 'researcher', content: '这里有需要讨论的事实。'.repeat(100),
      metadata: { reasoningSummary: ['现金流属于累计口径，需要核对季度与年度的区别'], questions: ['最新新闻是否改变了收入趋势？'] } }],
    evidence: [fact('price', 'price', 'AAPL current quote', 'Price USD 100. '.repeat(30)),
      fact('technical', 'price', 'AAPL current-session price action', 'High USD 103. Low USD 99. '.repeat(20)),
      fact('valuation', 'financial', 'AAPL Finnhub valuation metrics', 'P/E 25. P/S 8.'),
      fact('filing', 'financial', 'AAPL SEC reported financial statements', statement),
      { ...fact('requested-web', 'other', 'Recent company release', 'A public web lead, not a verified financial statement. '.repeat(20)), researchKind: 'web' }],
  });
  assert.ok(data.evidence.some((item) => item.id === 'filing'));
  assert.ok(data.evidence.some((item) => item.id === 'requested-web'), 'Successful requested research must not silently disappear from the prompt');
});

test('ordinary cash-flow discussions retain capex, derived FCF, cash and equity inside the financial excerpt', () => {
  const config = normalizeBuilderConfig({ name: 'Research', template: 'guard', tickers: ['AAPL'], minimumRating: 'Buy',
    customPrompt: '', maxOrderPct: 5, dailyLossLimitPct: 3, maxOrdersPerDay: 1, notifyOnProposal: false });
  const member = { id: 'value', role: 'researcher' as const, name: '价值研究员', model: 'fast' as const,
    instructions: '核对已披露现金流和资本开支，回应同伴的质疑。' };
  const turn = { memberId: 'value', phase: 'response' as const };
  const financials = 'Period: 2025-09-28 to 2026-06-27 (may be YTD; not TTM; not annualized). Revenue: USD 364357000000; Net income: USD 101464000000; Operating cash flow: USD 116996000000 (period total); Liabilities: USD 275746000000; Capex (PP&E): USD 6799000000; Derived FCF (CFO-capex, non-GAAP): USD 110197000000; Cash/equivalents: USD 39544000000; Equity (parent): USD 107520000000; Assets: USD 383266000000.';
  const data = packDiscussionContext({ ticker: 'AAPL', candidate: null, config, member, turn,
    systemPrompt: discussionPrompt(turn, 'zh-CN', false), userMessages: ['现金流、负债和资本开支是否支持当前估值？'],
    previousDiscussion: [], currentDiscussion: [{ id: 'risk', memberName: '风险研究员', role: 'challenger', content: '请核对自由现金流与净现金。'.repeat(20) }],
    evidence: [fact('filing', 'financial', 'AAPL SEC reported financial statements', financials),
      fact('price', 'price', 'AAPL current price', 'USD 348.91'), fact('valuation', 'financial', 'AAPL valuation', 'P/E 39.56'),
      fact('news', 'news', 'AAPL earnings event', 'Upcoming quarterly report')],
  });
  const excerpt = data.evidence.find(item => item.id === 'filing')?.content ?? '';
  for (const value of ['6799000000', '110197000000', '39544000000', '107520000000', 'not TTM', 'non-GAAP']) assert.ok(excerpt.includes(value), value);
});
