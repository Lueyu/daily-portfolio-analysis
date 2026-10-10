/**
 * @file pages/Watchlist/DetailDialog.tsx
 * @description Detail / edit dialog for a single watch item.
 *
 * Read-only view shows signal/rating/sector badges, key price stats, a
 * "below target" opportunity callout, and the analysis note. Toggling edit
 * swaps in the shared `WatchForm`; save PATCHes the item. A secondary confirm
 * dialog handles deletion.
 */
import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { WatchItem, Signal } from '@shared/api.interface';
import { updateWatchItem, deleteWatchItem } from '@/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  formatPrice,
  formatPercent,
  formatDate,
  signalColor,
  ratingColor,
  cn,
  toDate,
} from '@/utils/format';
import WatchForm, { type WatchFormData } from './WatchForm';

/** Props for {@link DetailDialog}. */
interface DetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: WatchItem | null;
  onUpdated: () => void;
  onDeleted: () => void;
}

/** Selectable signal values. */
const SIGNAL_OPTIONS: Signal[] = ['强烈买入', '买入', '观望', '回避'];
/** Selectable rating values. */
const RATING_OPTIONS = ['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'];

/**
 * Convert a WatchItem into the controlled form shape. Date is normalized to
 * an ISO `YYYY-MM-DD` for the date input; null fields become empty strings.
 */
function toFormData(item: WatchItem | null): WatchFormData {
  if (!item) {
    return {
      ticker: '',
      company: '',
      sector: '',
      dateAdded: new Date().toISOString().split('T')[0],
      entryPrice: '',
      currentPrice: '',
      targetBuy: '',
      rating: '',
      signal: '',
      analysis: '',
    };
  }
  return {
    ticker: item.ticker,
    company: item.company ?? '',
    sector: item.sector ?? '',
    dateAdded: item.dateAdded
      ? toDate(item.dateAdded)?.toISOString().split('T')[0] ?? ''
      : '',
    entryPrice: item.entryPrice ?? '',
    currentPrice: item.currentPrice ?? '',
    targetBuy: item.targetBuy ?? '',
    rating: item.rating ?? '',
    signal: item.signal ?? '',
    analysis: item.analysis ?? '',
  };
}

/** Parse a string to a number, returning undefined for empty/NaN input. */
function parseNumber(v: string): number | undefined {
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

/**
 * Compute how far the current price is below the target buy price, as a
 * positive percent. Returns null when the price is at/above target or inputs
 * are missing/invalid.
 */
function belowTargetPct(
  current: string | null,
  target: string | null
): number | null {
  const c = parseFloat(current ?? '');
  const t = parseFloat(target ?? '');
  if (isNaN(c) || isNaN(t) || t <= 0) return null;
  if (c >= t) return null;
  return ((t - c) / t) * 100;
}

/**
 * Render the watch-item detail dialog in either read-only or edit mode.
 */
function DetailDialog({
  open,
  onOpenChange,
  item,
  onUpdated,
  onDeleted,
}: DetailDialogProps) {
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState<WatchFormData>(toFormData(item));
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset state when dialog opens with a new item.
  const handleOpenChange = (o: boolean) => {
    if (o) {
      setFormData(toFormData(item));
      setEditMode(false);
      setConfirmDelete(false);
    }
    onOpenChange(o);
  };

  /** PATCH the edited fields and exit edit mode. */
  const handleUpdate = async () => {
    if (!item) return;
    setSubmitting(true);
    try {
      await updateWatchItem(item.id, {
        company: formData.company.trim() || undefined,
        sector: formData.sector.trim() || undefined,
        entryPrice: parseNumber(formData.entryPrice),
        currentPrice: parseNumber(formData.currentPrice),
        targetBuy: parseNumber(formData.targetBuy),
        rating: formData.rating || undefined,
        signal: formData.signal || undefined,
        analysis: formData.analysis.trim() || undefined,
      });
      toast.success('已保存修改');
      setEditMode(false);
      onUpdated();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '更新失败';
      toast.error('保存失败', { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  /** Delete the watch item after confirmation, then close and refresh. */
  const handleDelete = async () => {
    if (!item) return;
    setSubmitting(true);
    try {
      await deleteWatchItem(item.id);
      toast.success('已移除关注');
      setConfirmDelete(false);
      onDeleted();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除失败';
      toast.error('删除失败', { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const belowPct = belowTargetPct(
    item?.currentPrice ?? null,
    item?.targetBuy ?? null
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 font-serif text-xl">
              <span className="font-mono-nums text-2xl">
                {item?.ticker}
              </span>
              <span className="text-base font-normal text-muted-foreground">
                {item?.company ?? '—'}
              </span>
            </DialogTitle>
          </DialogHeader>

          {!editMode ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {item?.signal && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'border-transparent',
                      signalColor(item.signal)
                    )}
                  >
                    {item.signal}
                  </Badge>
                )}
                {item?.rating && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'border-transparent',
                      ratingColor(item.rating)
                    )}
                  >
                    {item.rating}
                  </Badge>
                )}
                {item?.sector && (
                  <Badge variant="secondary">{item.sector}</Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <Stat
                  label="加入日期"
                  value={formatDate(item?.dateAdded)}
                />
                <Stat
                  label="买入价"
                  value={formatPrice(item?.entryPrice)}
                  mono
                />
                <Stat
                  label="现价"
                  value={formatPrice(item?.currentPrice)}
                  mono
                />
                <Stat
                  label="目标买入价"
                  value={formatPrice(item?.targetBuy)}
                  mono
                />
              </div>

              {belowPct !== null && (
                <div className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
                  现价低于目标买入价{' '}
                  <span className="font-mono-nums font-semibold">
                    {formatPercent(belowPct).replace('+', '')}
                  </span>
                  ，可能是买入机会
                </div>
              )}

              {item?.analysis && (
                <div className="space-y-2">
                  <h4 className="font-serif text-sm font-semibold text-foreground">
                    分析
                  </h4>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {item.analysis}
                  </p>
                </div>
              )}

              <DialogFooter className="gap-2">
                <Button
                  variant="destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  删除
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditMode(true)}
                >
                  <Pencil className="h-4 w-4" />
                  编辑
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <WatchForm data={formData} onChange={setFormData} />
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setEditMode(false)}
                >
                  取消
                </Button>
                <Button onClick={handleUpdate} disabled={submitting}>
                  {submitting ? '保存中…' : '保存'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif">确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定要移除对{' '}
            <span className="font-mono-nums font-semibold text-foreground">
              {item?.ticker}
            </span>{' '}
            的关注吗？此操作无法撤销。
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={submitting}
            >
              {submitting ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Small label/value stat block used in the read-only detail view. */
function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-base font-medium',
          mono ? 'font-mono-nums' : ''
        )}
      >
        {value}
      </div>
    </div>
  );
}

export default DetailDialog;
