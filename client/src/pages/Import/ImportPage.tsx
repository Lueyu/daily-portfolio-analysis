/**
 * @file pages/Import/ImportPage.tsx
 * @description Route `/import`: portfolio import hub.
 *
 * Three flows sharing one commit path:
 *  1. CSV 文件导入 — client-side parsing (papaparse) with encoding switch
 *     (UTF-8 / GBK for domestic brokers), auto column mapping with manual
 *     override, editable preview, then commit.
 *  2. Robinhood CSV — a preset over the same flow: known headers are mapped
 *     automatically.
 *  3. 截图识别导入 — upload a brokerage screenshot, extract rows with the
 *     user's own multimodal LLM key (stored only in this browser, like the
 *     Finnhub token), review the editable extraction, then commit.
 *
 * Import history card lists recent runs with per-row failure reasons.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Papa from 'papaparse';
import {
  FileSpreadsheet,
  Camera,
  History,
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  Wand2,
} from 'lucide-react';

import { commitImport, extractScreenshot, fetchImportHistory } from '@/api';
import type { ImportRowCandidate, ImportSource, OcrExtractResult } from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

/** localStorage keys for the OCR provider config (browser-only, like Finnhub). */
const OCR_LS = { baseUrl: 'sq-ocr-base', model: 'sq-ocr-model', apiKey: 'sq-ocr-key' };

/** Field keys the CSV mapper can assign. */
type MapField = 'ticker' | 'shares' | 'avgCost' | 'company';

/** Header aliases used for auto-mapping suggestions. */
const FIELD_ALIASES: Record<MapField, string[]> = {
  ticker: ['ticker', 'symbol', 'code', '股票代码', '证券代码', '代码', 'symbol(id)'],
  shares: ['shares', 'quantity', 'qty', '股数', '持仓数量', '数量', '持有数量', '持仓'],
  avgCost: ['avgcost', 'averagecost', 'costbasis', 'avgcostbasis', 'cost', 'price', '成本价', '买入成本', '成本', '均价', '平均成本', '购买价'],
  company: ['company', 'name', 'description', '名称', '证券名称', '股票名称', '描述'],
};

/** Suggest a column index for each field from the header row. */
function suggestMapping(headers: string[]): Partial<Record<MapField, number>> {
  const out: Partial<Record<MapField, number>> = {};
  const used = new Set<number>();
  for (const field of Object.keys(FIELD_ALIASES) as MapField[]) {
    const aliases = FIELD_ALIASES[field];
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const h = headers[i].toLowerCase().replace(/\s+/g, '');
      if (aliases.some((a) => h === a || h.includes(a))) {
        out[field] = i;
        used.add(i);
        break;
      }
    }
  }
  return out;
}

/** Robinhood preset: map by exact known headers (case-insensitive contains). */
const ROBINHOOD_ALIASES: Record<MapField, string[]> = {
  ticker: ['symbol'],
  shares: ['quantity'],
  avgCost: ['average cost', 'cost basis', 'avg cost', 'total cost'],
  company: ['description', 'name', 'instrument'],
};

/** Futu (富途牛牛) CSV preset. */
const FUTU_ALIASES: Record<MapField, string[]> = {
  ticker: ['代码', 'code', 'symbol', 'ticker'],
  shares: ['数量', '股数', 'qty', 'quantity', 'shares'],
  avgCost: ['成本价', '买入均价', '平均成本', 'cost', 'avg cost', 'price'],
  company: ['名称', '股票名称', 'name', 'company'],
};

/** Tiger (老虎证券) CSV preset. */
const TIGER_ALIASES: Record<MapField, string[]> = {
  ticker: ['symbol', '代码', 'ticker'],
  shares: ['quantity', '数量', '股数', 'shares'],
  avgCost: ['avg cost', '成本价', 'cost basis', '平均成本'],
  company: ['name', '名称', 'description'],
};

/** Xueqiu (雪球) CSV preset. */
const XUEQIU_ALIASES: Record<MapField, string[]> = {
  ticker: ['symbol', '代码', 'ticker'],
  shares: ['volume', '数量', '股数', 'shares', '持有数量'],
  avgCost: ['cost', '成本价', 'avg cost', '买入成本'],
  company: ['name', '名称', '股票名称'],
};

/** All broker presets keyed by selector value. */
const BROKER_PRESETS: Record<string, { label: string; aliases: Record<MapField, string[]> }> = {
  generic: { label: '通用 CSV', aliases: FIELD_ALIASES },
  robinhood: { label: 'Robinhood 导出', aliases: ROBINHOOD_ALIASES },
  futu: { label: '富途牛牛导出', aliases: FUTU_ALIASES },
  tiger: { label: '老虎证券导出', aliases: TIGER_ALIASES },
  xueqiu: { label: '雪球导出', aliases: XUEQIU_ALIASES },
};

function suggestForPreset(headers: string[], presetKey: string): Partial<Record<MapField, number>> {
  const aliases = BROKER_PRESETS[presetKey]?.aliases ?? FIELD_ALIASES;
  const out: Partial<Record<MapField, number>> = {};
  const used = new Set<number>();
  for (const field of Object.keys(aliases) as MapField[]) {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const h = headers[i].toLowerCase().replace(/\s+/g, '');
      if (aliases[field].some((a) => h === a || h.includes(a))) {
        out[field] = i;
        used.add(i);
        break;
      }
    }
  }
  return out;
}

/** Turn mapped CSV cells into import row candidates. */
function rowsFromMatrix(matrix: string[][], mapping: Partial<Record<MapField, number>>): ImportRowCandidate[] {
  const has = (v?: string) => v != null && v.trim() !== '';
  const num = (v?: string) => {
    if (!has(v)) return null;
    const n = Number(String(v).replace(/[,$￥HK$]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  return matrix
    .map((cells) => ({
      ticker: mapping.ticker != null ? String(cells[mapping.ticker] ?? '').trim() : '',
      company: mapping.company != null && has(cells[mapping.company]) ? String(cells[mapping.company]).trim() : null,
      shares: num(mapping.shares != null ? cells[mapping.shares] : undefined) ?? 0,
      avgCost: num(mapping.avgCost != null ? cells[mapping.avgCost] : undefined),
    }))
    .filter((r) => r.ticker !== '');
}

/** localStorage helpers for the OCR provider config. */
const ocrConfig = {
  load() {
    return {
      baseUrl: localStorage.getItem(OCR_LS.baseUrl) ?? 'https://ark.cn-beijing.volces.com/api/v3',
      model: localStorage.getItem(OCR_LS.model) ?? '',
      apiKey: localStorage.getItem(OCR_LS.apiKey) ?? '',
    };
  },
  save(v: { baseUrl?: string; model?: string; apiKey?: string }) {
    if (v.baseUrl !== undefined) localStorage.setItem(OCR_LS.baseUrl, v.baseUrl);
    if (v.model !== undefined) localStorage.setItem(OCR_LS.model, v.model);
    if (v.apiKey !== undefined) localStorage.setItem(OCR_LS.apiKey, v.apiKey);
  },
};

function ImportPage() {
  const [mode, setMode] = useState<'csv' | 'ocr'>('csv');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 font-serif text-2xl font-semibold">
          <Upload size={22} className="text-primary" />
          持仓导入
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          从 CSV 文件或券商 App 截图把现有持仓搬进吵股——全程预览确认，导入前不会写入任何数据。
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant={mode === 'csv' ? 'default' : 'outline'} size="sm" onClick={() => setMode('csv')}>
          <FileSpreadsheet size={14} className="mr-1" /> CSV 文件
        </Button>
        <Button variant={mode === 'ocr' ? 'default' : 'outline'} size="sm" onClick={() => setMode('ocr')}>
          <Camera size={14} className="mr-1" /> 截图识别
        </Button>
      </div>

      {mode === 'csv' ? <CsvImport /> : <OcrImport />}
      <ImportHistoryCard />
    </div>
  );
}

// ---------------------------------------------------------------------
// CSV flow
// ---------------------------------------------------------------------

function CsvImport() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<string[][]>([]);
  const [encoding, setEncoding] = useState<'utf-8' | 'gbk'>('utf-8');
  const [mapping, setMapping] = useState<Partial<Record<MapField, number>>>({});
  const [buyDate, setBuyDate] = useState('');
  const [source, setSource] = useState<string>('generic');
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; failed: Array<{ ticker: string; reason: string }> } | null>(null);

  const readFile = (file: File) => {
    setFilename(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
      const data = (parsed.data as string[][]).filter((r) => r.some((c) => String(c).trim() !== ''));
      if (data.length === 0) {
        toast.warning('文件里没有数据行');
        return;
      }
      const hdrs = (data[0] ?? []).map((h, i) => String(h).trim() || `第${i + 1}列`);
      const body = data.slice(1);
      setHeaders(hdrs);
      setMatrix(body);
      setMapping(suggestForPreset(hdrs, source));
      if (String(text).includes('\uFFFD')) {
        toast.info('检测到乱码——若中文显示异常，请把编码切换为 GBK 后重新选择文件');
      }
    };
    reader.readAsText(file, encoding);
  };

  const previewRows = matrix.length > 0 ? rowsFromMatrix(matrix, mapping) : [];

  const commit = async () => {
    if (previewRows.length === 0) {
      toast.warning('没有可导入的行，请先完成列映射');
      return;
    }
    try {
      setCommitting(true);
      const r = await commitImport({
        source: source === 'generic' ? 'csv' : source as 'csv' | 'robinhood',
        rows: previewRows,
        filename: filename || undefined,
        buyDate: buyDate || undefined,
      });
      setResult(r);
      toast.success(`导入完成：新建 ${r.created} 只，跳过 ${r.skipped} 只`);
      queryClient.invalidateQueries({ queryKey: ['import'] });
      queryClient.invalidateQueries({ queryKey: ['holdings'] });
    } catch (error) {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '导入失败');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">CSV 文件导入</CardTitle>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={source}
            onChange={(e) => {
              const v = e.target.value;
              setSource(v);
              if (headers.length > 0) setMapping(suggestForPreset(headers, v));
            }}
          >
            {Object.entries(BROKER_PRESETS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={encoding}
            onChange={(e) => setEncoding(e.target.value as 'utf-8' | 'gbk')}
          >
            <option value="utf-8">UTF-8</option>
            <option value="gbk">GBK（国内软件导出）</option>
          </select>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload size={14} className="mr-1" /> 选择文件
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {matrix.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            选择一个 CSV 文件开始——支持任意券商/App 导出的表格，上传后自动猜测列含义，可手动调整。
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              {filename} · {matrix.length} 行数据（识别到 {headers.length} 列）
              {source === 'robinhood' && ' · Robinhood 预设已自动套用'}
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              {(['ticker', 'shares', 'avgCost', 'company'] as MapField[]).map((field) => (
                <div key={field} className="space-y-1.5">
                  <Label className="text-xs">
                    {field === 'ticker' ? '股票代码 *' : field === 'shares' ? '股数 *' : field === 'avgCost' ? '成本价（每股）' : '名称（可选）'}
                  </Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={mapping[field] ?? ''}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [field]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  >
                    <option value="">（不映射）</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="max-h-56 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/50">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">代码</th>
                    <th className="px-3 py-2 font-medium">名称</th>
                    <th className="px-3 py-2 font-medium">股数</th>
                    <th className="px-3 py-2 font-medium">成本</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 20).map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5 font-medium">{r.ticker}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.company ?? '—'}</td>
                      <td className="px-3 py-1.5 font-mono-nums">{r.shares}</td>
                      <td className="px-3 py-1.5 font-mono-nums">{r.avgCost ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previewRows.length > 20 && (
              <div className="text-xs text-muted-foreground">仅预览前 20 行，提交时会导入全部 {previewRows.length} 行。</div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <div className="space-y-1">
                <Label className="text-xs">买入日期（可选，应用到全部）</Label>
                <Input type="date" className="h-9 w-40" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} />
              </div>
              <Button className="mt-4" onClick={commit} disabled={committing || mapping.ticker == null || mapping.shares == null}>
                {committing ? <Loader2 size={14} className="mr-1 animate-spin" /> : <CheckCircle2 size={14} className="mr-1" />}
                确认导入 {previewRows.length} 行
              </Button>
            </div>
          </>
        )}

        {result && (
          <div className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                新建 {result.created}
              </Badge>
              <Badge variant="outline" className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
                跳过 {result.skipped}
              </Badge>
            </div>
            {result.failed.length > 0 && (
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {result.failed.slice(0, 10).map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <XCircle size={12} className="shrink-0 text-amber-500" />
                    <span>{f.ticker}：{f.reason}</span>
                  </div>
                ))}
                {result.failed.length > 10 && <div>…以及另外 {result.failed.length - 10} 条</div>}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Screenshot OCR flow
// ---------------------------------------------------------------------

function OcrImport() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageBase64, setImageBase64] = useState('');
  const [ocrResult, setOcrResult] = useState<OcrExtractResult | null>(null);
  const [rows, setRows] = useState<ImportRowCandidate[]>([]);
  const [provider, setProvider] = useState(() => ocrConfig.load());
  const [extracting, setExtracting] = useState(false);
  const [committing, setCommitting] = useState(false);

  const readFile = (file: File) => {
    setOcrResult(null);
    setRows([]);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      setImageBase64(dataUrl.split(',')[1] ?? '');
    };
    reader.readAsDataURL(file);
  };

  const extract = async () => {
    if (!imageBase64) {
      toast.warning('请先选择截图');
      return;
    }
    if (!provider.apiKey.trim() || !provider.model.trim()) {
      toast.warning('需要填写你自己的多模态模型 Key 和模型名称（只存在本浏览器，不会入库）');
      return;
    }
    try {
      setExtracting(true);
      ocrConfig.save(provider);
      const r = await extractScreenshot({
        imageBase64,
        apiKey: provider.apiKey.trim(),
        baseUrl: provider.baseUrl.trim() || undefined,
        model: provider.model.trim(),
      });
      setOcrResult(r);
      setRows(r.rows);
      toast.success(`识别到 ${r.rows.length} 行持仓${r.broker ? `（来自 ${r.broker}）` : ''}，请核对后提交`);
    } catch (error) {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '识别失败');
    } finally {
      setExtracting(false);
    }
  };

  const commit = async () => {
    try {
      setCommitting(true);
      const r = await commitImport({ source: 'ocr', rows });
      toast.success(`导入完成：新建 ${r.created} 只，跳过 ${r.skipped} 只`);
      setRows([]);
      setOcrResult(null);
      setImageBase64('');
      queryClient.invalidateQueries({ queryKey: ['import'] });
      queryClient.invalidateQueries({ queryKey: ['holdings'] });
    } catch (error) {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '导入失败');
    } finally {
      setCommitting(false);
    }
  };

  const updateRow = (i: number, patch: Partial<ImportRowCandidate>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">截图识别导入</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <p className="text-xs text-muted-foreground">
          上传券商 App 的持仓页截图（同花顺 / 东方财富 / 雪球 / 富途 / 老虎 / Robinhood 等），用你自己的多模态大模型识别。
          Key 只保存在本浏览器（与行情 Token 同一隐私模式），服务端不留存。
        </p>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">接口地址（OpenAI 兼容）</Label>
            <Input
              className="h-9"
              placeholder="https://ark.cn-beijing.volces.com/api/v3"
              value={provider.baseUrl}
              onChange={(e) => setProvider((p) => ({ ...p, baseUrl: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">视觉模型名称</Label>
            <Input
              className="h-9"
              placeholder="如 doubao-1.5-vision-pro / gpt-4o-mini"
              value={provider.model}
              onChange={(e) => setProvider((p) => ({ ...p, model: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">你的 API Key</Label>
            <Input
              className="h-9"
              type="password"
              placeholder="只存本浏览器，不入库"
              value={provider.apiKey}
              onChange={(e) => setProvider((p) => ({ ...p, apiKey: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Camera size={14} className="mr-1" /> 选择截图
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
          />
          <Button size="sm" onClick={extract} disabled={extracting || !imageBase64}>
            {extracting ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Wand2 size={14} className="mr-1" />}
            {extracting ? '识别中…' : '开始识别'}
          </Button>
          {imageBase64 && (
            <img
              src={`data:image/jpeg;base64,${imageBase64}`}
              alt="截图预览"
              className="h-16 rounded-md border border-border object-cover"
            />
          )}
        </div>

        {rows.length > 0 && (
          <>
            <div className="max-h-56 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/50">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">代码（可改）</th>
                    <th className="px-3 py-2 font-medium">名称</th>
                    <th className="px-3 py-2 font-medium">股数（可改）</th>
                    <th className="px-3 py-2 font-medium">成本（可改）</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1"><Input className="h-8" value={r.ticker} onChange={(e) => updateRow(i, { ticker: e.target.value })} /></td>
                      <td className="px-2 py-1 text-xs text-muted-foreground">{r.company ?? '—'}</td>
                      <td className="w-28 px-2 py-1"><Input className="h-8 font-mono-nums" type="number" value={String(r.shares)} onChange={(e) => updateRow(i, { shares: Number(e.target.value) })} /></td>
                      <td className="w-28 px-2 py-1"><Input className="h-8 font-mono-nums" type="number" value={r.avgCost == null ? '' : String(r.avgCost)} onChange={(e) => updateRow(i, { avgCost: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button onClick={commit} disabled={committing}>
              {committing ? <Loader2 size={14} className="mr-1 animate-spin" /> : <CheckCircle2 size={14} className="mr-1" />}
              确认导入 {rows.length} 行
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// History
// ---------------------------------------------------------------------

function ImportHistoryCard() {
  const historyQuery = useQuery({
    queryKey: ['import', 'history'],
    queryFn: fetchImportHistory,
  });
  const items = historyQuery.data ?? [];
  const sourceLabel: Record<string, string> = { csv: 'CSV', robinhood: 'Robinhood CSV', ocr: '截图识别' };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm"><History size={14} /> 导入历史</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-4">
        {items.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            还没有导入记录
          </div>
        )}
        {items.map((h) => (
          <div key={h.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
            <Badge variant="outline" className="shrink-0 text-[10px]">{sourceLabel[h.source] ?? h.source}</Badge>
            <span className="truncate text-foreground/90">{h.filename ?? '（无文件名）'}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              新建 {h.rowsImported}/{h.rowsTotal} · {new Date(h.createdAt).toLocaleString('zh-CN', { hour12: false })}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default ImportPage;
