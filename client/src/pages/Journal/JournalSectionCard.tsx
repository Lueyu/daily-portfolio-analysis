import {
  Globe,
  Target,
  ClipboardList,
  BookOpen,
  Lightbulb,
} from 'lucide-react';
import type { JournalEntry } from '@shared/api.interface';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

export interface JournalSection {
  key: keyof Pick<JournalEntry, 'marketSummary' | 'portfolioSummary' | 'actions' | 'plan' | 'lessons'>;
  label: string;
  icon: typeof Globe;
}

export const sections: JournalSection[] = [
  { key: 'marketSummary', label: '市场与宏观', icon: Globe },
  { key: 'portfolioSummary', label: '组合表现归因', icon: Target },
  { key: 'actions', label: '当日操作', icon: ClipboardList },
  { key: 'plan', label: '明日计划', icon: BookOpen },
  { key: 'lessons', label: '心得纪律', icon: Lightbulb },
];

interface JournalSectionCardProps {
  section: JournalSection;
  content: string | null | undefined;
  editing: boolean;
  editValue: string;
  onEditChange: (value: string) => void;
}

export function JournalSectionCard({
  section,
  content,
  editing,
  editValue,
  onEditChange,
}: JournalSectionCardProps) {
  const SectionIcon = section.icon;

  if (editing) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <SectionIcon size={16} className="text-primary" />
            <CardTitle className="font-serif text-base">{section.label}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            placeholder={`记录${section.label}...`}
            className="min-h-[120px] text-sm leading-relaxed"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <SectionIcon size={16} className="text-primary" />
          <CardTitle className="font-serif text-base">{section.label}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {content ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {content}
          </div>
        ) : (
          <div className="py-4 text-center text-sm text-muted-foreground">
            暂无记录
          </div>
        )}
      </CardContent>
    </Card>
  );
}
