import { Badge } from '@/components/ui/badge';
import type { AgentConfidence } from '@shared/api.interface';

interface ConfidenceBadgeProps {
  confidence: AgentConfidence;
  size?: 'sm' | 'md';
}

const confidenceMap: Record<AgentConfidence, { label: string; className: string }> = {
  high: {
    label: '高置信度',
    className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20',
  },
  medium: {
    label: '中置信度',
    className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20',
  },
  low: {
    label: '低置信度',
    className: 'bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30 hover:bg-slate-500/20',
  },
};

const sizeClasses: Record<'sm' | 'md', string> = {
  sm: 'text-xs px-2 py-0 h-5',
  md: 'text-sm px-2.5 py-0.5 h-6',
};

function ConfidenceBadge({ confidence, size = 'md' }: ConfidenceBadgeProps) {
  const { label, className } = confidenceMap[confidence];
  return (
    <Badge
      variant="outline"
      className={`${className} ${sizeClasses[size]} font-medium`}
    >
      {label}
    </Badge>
  );
}

export default ConfidenceBadge;
