/**
 * RatingBadge - renders the analyst rating as a colored outline badge.
 *
 * Color semantics mirror sell-side rating conventions:
 *   - Strong Buy / Buy   -> emerald (bullish)
 *   - Hold               -> blue
 *   - Sell / Strong Sell -> rose/red (bearish)
 *   - Watch              -> slate (no actionable call yet)
 */
import { Badge } from '@/components/ui/badge';
import type { AgentRating } from '@shared/api.interface';

interface RatingBadgeProps {
  /** Rating issued by the multi-agent pipeline, e.g. 'Strong Buy' | 'Hold' ... */
  rating: AgentRating;
  /** Badge size: 'sm' for dense layouts, 'md' for headers (default 'md') */
  size?: 'sm' | 'md';
}

/** Tailwind color classes per rating; stronger calls get stronger/fill-like emphasis */
const ratingStyles: Record<AgentRating, string> = {
  'Strong Buy': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20',
  'Buy': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/15',
  'Hold': 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/20',
  'Sell': 'bg-rose-500/10 text-rose-600 dark:text-rose-500 border-rose-500/20 hover:bg-rose-500/15',
  'Strong Sell': 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/20',
  'Watch': 'bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30 hover:bg-slate-500/20',
};

/** Compact padding/typography presets for the two supported sizes */
const sizeClasses: Record<'sm' | 'md', string> = {
  sm: 'text-xs px-2 py-0 h-5',
  md: 'text-sm px-2.5 py-0.5 h-6',
};

/** Renders an outline Badge colored by ratingStyles; displays the raw rating string. */
function RatingBadge({ rating, size = 'md' }: RatingBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={`${ratingStyles[rating]} ${sizeClasses[size]} font-medium`}
    >
      {rating}
    </Badge>
  );
}

export default RatingBadge;
