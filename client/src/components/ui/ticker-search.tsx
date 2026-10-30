/**
 * Searchable stock-ticker search box with suggestions (app-specific, not a generic primitive).
 *
 * Vendored shadcn-style UI primitive (Radix UI + Tailwind CSS).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, TrendingUp } from 'lucide-react';
import { logger } from '../../utils/logger';
import type { StockSearchResult } from '@shared/api.interface';
import { searchStocks } from '@/api';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface TickerSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: StockSearchResult) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
}

/** DEBOUNCE_MS component. */
const DEBOUNCE_MS = 250;

export default function TickerSearch({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
  disabled,
  invalid,
}: TickerSearchProps) {
  const { t } = useTranslation();
  const inputPlaceholder = placeholder ?? t('ui.tickerSearch.placeholder');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 1) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const items = (await searchStocks(trimmed)) as StockSearchResult[];
      setResults(items || []);
      setSelectedIndex(0);
    } catch (err) {
      logger.error('股票搜索失败', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      void doSearch(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [query, open, doSearch]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (val: string) => {
    setQuery(val);
    onChange(val);
    setOpen(true);
  };

  const handleSelect = (result: StockSearchResult) => {
    setQuery(result.symbol);
    onChange(result.symbol);
    onSelect(result);
    setOpen(false);
    setTimeout(() => inputRef.current?.blur(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        results.length > 0 ? (prev + 1) % results.length : 0,
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        results.length > 0 ? (prev - 1 + results.length) % results.length : 0,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const marketLabel = (market: string): string => {
    switch (market) {
      case 'US':
        return t('ui.tickerSearch.marketUS');
      case 'HK':
        return t('ui.tickerSearch.marketHK');
      case 'CN':
        return t('ui.tickerSearch.marketCN');
      default:
        return market;
    }
  };

  const sourceLabel = (source: string): string => {
    switch (source) {
      case 'holding':
        return t('ui.tickerSearch.holding');
      case 'watchlist':
        return t('ui.tickerSearch.watchlist');
      default:
        return '';
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative w-full">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query && query.trim() && setOpen(true)}
          placeholder={inputPlaceholder}
          disabled={disabled}
          autoComplete="off"
          className={cn(
            'pl-9',
            invalid && 'border-destructive focus-visible:ring-destructive',
            className,
          )}
        />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-[100] mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="py-1">
            {loading && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {t('ui.tickerSearch.searching')}
              </div>
            )}
            {!loading && results.length === 0 && query.trim() && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {t('ui.tickerSearch.noResults')}
              </div>
            )}
            {!loading && results.length === 0 && !query.trim() && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {t('ui.tickerSearch.startSearch')}
              </div>
            )}
            {!loading &&
              results.map((result, index) => (
                <button
                  key={`${result.symbol}-${result.source}`}
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
                    index === selectedIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50',
                  )}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => handleSelect(result)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <TrendingUp
                      size={14}
                      className="shrink-0 text-emerald-600 dark:text-emerald-400"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-medium">
                          {result.symbol}
                        </span>
                        {result.source !== 'external' && (
                          <Badge
                            variant="secondary"
                            className="h-4 px-1 text-[10px] font-normal"
                          >
                            {sourceLabel(result.source)}
                          </Badge>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {result.companyName}
                      </div>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 text-[10px] font-normal"
                  >
                    {marketLabel(result.market)}
                  </Badge>
                </button>
              ))}
            {!loading && results.length > 0 && (
              <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
                {t('ui.tickerSearch.keyboardHelp')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
