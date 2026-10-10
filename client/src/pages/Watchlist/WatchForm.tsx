/**
 * @file pages/Watchlist/WatchForm.tsx
 * @description Controlled form shared by the add-watch and detail-edit dialogs.
 *
 * All fields are strings; numeric inputs are parsed by the parent on submit.
 * The ticker field is optional (hidden) when editing an existing watch item,
 * since the ticker is immutable after creation.
 */
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/** Controlled form model for a watch item. */
export interface WatchFormData {
  ticker: string;
  company: string;
  sector: string;
  dateAdded: string;
  entryPrice: string;
  currentPrice: string;
  targetBuy: string;
  rating: string;
  signal: string;
  analysis: string;
}

/** Selectable signal values. */
const SIGNAL_OPTIONS = ['强烈买入', '买入', '观望', '回避'];
/** Selectable rating values. */
const RATING_OPTIONS = ['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'];

/** Props for {@link WatchForm}. */
interface WatchFormProps {
  /** Current form values (controlled). */
  data: WatchFormData;
  /** Change handler receiving the next form state. */
  onChange: (d: WatchFormData) => void;
  /** When true, show the ticker input (used by the create dialog). */
  includeTicker?: boolean;
}

/**
 * Render the watch-item form grid.
 */
function WatchForm({ data, onChange, includeTicker }: WatchFormProps) {
  /** Merge a single field update into the controlled form state. */
  const update = (k: keyof WatchFormData, v: string) =>
    onChange({ ...data, [k]: v });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {includeTicker && (
        <div className="space-y-1.5 sm:col-span-1">
          <label className="text-xs font-medium text-muted-foreground">
            Ticker <span className="text-destructive">*</span>
          </label>
          <Input
            value={data.ticker}
            onChange={(e) =>
              update('ticker', e.target.value.toUpperCase())
            }
            placeholder="如 AAPL"
            className="font-mono-nums"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          公司名称
        </label>
        <Input
          value={data.company}
          onChange={(e) => update('company', e.target.value)}
          placeholder="公司名称"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          行业
        </label>
        <Input
          value={data.sector}
          onChange={(e) => update('sector', e.target.value)}
          placeholder="行业"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          加入日期
        </label>
        <Input
          type="date"
          value={data.dateAdded}
          onChange={(e) => update('dateAdded', e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          买入价
        </label>
        <Input
          type="number"
          step="0.01"
          value={data.entryPrice}
          onChange={(e) => update('entryPrice', e.target.value)}
          className="font-mono-nums"
          placeholder="0.00"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          现价
        </label>
        <Input
          type="number"
          step="0.01"
          value={data.currentPrice}
          onChange={(e) => update('currentPrice', e.target.value)}
          className="font-mono-nums"
          placeholder="0.00"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          目标买入价
        </label>
        <Input
          type="number"
          step="0.01"
          value={data.targetBuy}
          onChange={(e) => update('targetBuy', e.target.value)}
          className="font-mono-nums"
          placeholder="0.00"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          评级
        </label>
        <Select
          value={data.rating}
          onValueChange={(v) => update('rating', v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择评级" />
          </SelectTrigger>
          <SelectContent>
            {RATING_OPTIONS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          信号
        </label>
        <Select
          value={data.signal}
          onValueChange={(v) => update('signal', v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择信号" />
          </SelectTrigger>
          <SelectContent>
            {SIGNAL_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <label className="text-xs font-medium text-muted-foreground">
          分析
        </label>
        <Textarea
          value={data.analysis}
          onChange={(e) => update('analysis', e.target.value)}
          placeholder="分析内容…"
          rows={4}
          className="resize-y"
        />
      </div>
    </div>
  );
}

export default WatchForm;
