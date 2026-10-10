import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { DeepReport as DeepReportType } from '@shared/api.interface';
import { getDeepReport } from '@/api';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DeepReportView from '@/components/MultiAgent/DeepReportView';

function DeepReportPage() {
  const { runId = '' } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<DeepReportType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    let cancelled = false;
    (async () => {
      try {
        const data = await getDeepReport(runId);
        if (cancelled) return;
        setReport(data);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : '加载失败';
        setError(msg);
        toast.error('加载深度报告失败', { description: msg });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <div className="min-h-screen bg-[#0a1a1a]">
      {/* Top bar */}
      <div className="sticky top-0 z-20 border-b border-slate-800/60 bg-[#0a1a1a]/80 backdrop-blur-sm">
        <div className="flex items-center justify-end px-2 sm:px-4 py-3">
          {report && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/50 bg-amber-500/10 text-amber-400 font-medium"
            >
              <Sparkles size={12} />
              深度报告
            </Badge>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center p-16 text-slate-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          加载深度报告中...
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="p-8">
          <Empty>
            <EmptyMedia variant="icon">
              <Sparkles className="h-5 w-5" />
            </EmptyMedia>
            <EmptyContent>
              <EmptyTitle className="font-serif text-slate-100">
                加载失败
              </EmptyTitle>
              <EmptyDescription className="text-slate-400">
                {error}
              </EmptyDescription>
              <div className="mt-4">
                <Button onClick={() => window.location.reload()}>重试</Button>
              </div>
            </EmptyContent>
          </Empty>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && !report && (
        <div className="p-8">
          <Empty>
            <EmptyMedia variant="icon">
              <Sparkles className="h-5 w-5" />
            </EmptyMedia>
            <EmptyContent>
              <EmptyTitle className="font-serif text-slate-100">
                该分析暂无深度报告
              </EmptyTitle>
              <EmptyDescription className="text-slate-400">
                深度报告仅在完整 Multi-Agent 分析完成后生成
              </EmptyDescription>
            </EmptyContent>
          </Empty>
        </div>
      )}

      {/* Report content */}
      {!loading && !error && report && (
        <div className="px-2 sm:px-4 pb-16">
          <DeepReportView
            report={report}
            runId={runId}
            onBack={() => navigate(-1)}
          />
        </div>
      )}
    </div>
  );
}

export default DeepReportPage;
