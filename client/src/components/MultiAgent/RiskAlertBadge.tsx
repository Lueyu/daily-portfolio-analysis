import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type { RiskGateResult } from '@shared/api.interface';

interface RiskAlertBadgeProps {
  results: RiskGateResult[];
}

function RiskAlertBadge({ results }: RiskAlertBadgeProps) {
  const failedHard = results.filter((r: RiskGateResult) => r.ruleType === 'hard' && !r.passed).length;
  const failedSoft = results.filter((r: RiskGateResult) => r.ruleType === 'soft' && !r.passed).length;

  if (failedHard > 0) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-400 font-medium"
      >
        <AlertTriangle size={12} />
        {failedHard} 条硬规则未通过
      </Badge>
    );
  }

  if (failedSoft > 0) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium"
      >
        <AlertTriangle size={12} />
        {failedSoft} 条软规则告警
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="gap-1 border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-medium"
    >
      <ShieldCheck size={12} />
      风控通过
    </Badge>
  );
}

export default RiskAlertBadge;
