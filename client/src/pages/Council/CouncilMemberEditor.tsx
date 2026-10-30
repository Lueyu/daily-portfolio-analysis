import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import type { CouncilMember, CouncilResearchKind, CouncilRole } from '@shared/council.interface';
import { COUNCIL_AVATARS, COUNCIL_RESEARCH_KINDS, COUNCIL_SPEAKING_STYLES } from '@shared/council-templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import CouncilMemberAvatar from './CouncilMemberAvatar';
import { councilModelValue, type CouncilModelOption } from './useCouncilModels';

interface CouncilMemberEditorProps {
  member: CouncilMember;
  webResearch: boolean;
  modelOptions: CouncilModelOption[];
  onSave: (member: CouncilMember) => string | null;
  onClose: () => void;
}

const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function CouncilMemberEditor({ member, webResearch, modelOptions, onSave, onClose }: CouncilMemberEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CouncilMember>({ ...member, researchFocus: [...(member.researchFocus ?? [])] });
  const [error, setError] = useState<string | null>(null);
  const update = (value: Partial<CouncilMember>) => { setDraft((current) => ({ ...current, ...value })); setError(null); };
  const currentModel = modelOptions.find((option: CouncilModelOption) => option.value === councilModelValue(draft));
  const save = () => {
    if (draft.connectionId && (!currentModel || currentModel.disabled)) { setError(t('council.members.connectionMissing')); return; }
    const problem = onSave({ ...draft, name: draft.name.trim(), roleTitle: draft.roleTitle?.trim(), personality: draft.personality?.trim() });
    if (problem) setError(problem); else onClose();
  };
  const toggleFocus = (focus: CouncilResearchKind) => {
    const current = draft.researchFocus ?? [];
    update({ researchFocus: current.includes(focus) ? current.filter((item) => item !== focus) : [...current, focus] });
  };

  return <Sheet open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
    <SheetContent className="w-[min(480px,96vw)] gap-0 p-0 sm:max-w-[480px]">
      <SheetHeader className="shrink-0 border-b border-border px-5 py-5 pr-12 text-left">
        <SheetTitle>{t('council.members.editTitle')}</SheetTitle><SheetDescription>{t('council.members.editHint')}</SheetDescription>
      </SheetHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); save(); }}>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <div className="space-y-2"><Label>{t('council.members.avatar')}</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('council.members.avatar')}>
              {COUNCIL_AVATARS.map((avatar) => <button type="button" key={avatar} aria-pressed={draft.avatar === avatar}
                aria-label={t(`council.members.avatars.${avatar}`)} title={t(`council.members.avatars.${avatar}`)}
                onClick={() => update({ avatar })} className={`rounded-xl p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring ${draft.avatar === avatar ? 'ring-2 ring-primary' : 'hover:bg-muted'}`}>
                <CouncilMemberAvatar avatar={avatar} role={draft.role} />
              </button>)}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="member-editor-name">{t('council.team.name')}</Label>
              <Input id="member-editor-name" value={draft.name} maxLength={40} onChange={(event) => update({ name: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="member-editor-title">{t('council.members.roleTitle')}</Label>
              <Input id="member-editor-title" value={draft.roleTitle ?? ''} maxLength={60} onChange={(event) => update({ roleTitle: event.target.value })} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="member-editor-personality">{t('council.members.personality')}</Label>
            <Textarea id="member-editor-personality" rows={2} maxLength={240} value={draft.personality ?? ''}
              placeholder={t('council.members.personalityPlaceholder')} onChange={(event) => update({ personality: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="member-editor-style">{t('council.members.style')}</Label>
            <select id="member-editor-style" className={selectClass} value={draft.speakingStyle ?? 'concise'}
              onChange={(event) => update({ speakingStyle: COUNCIL_SPEAKING_STYLES.find((style) => style === event.target.value) ?? 'concise' })}>
              {COUNCIL_SPEAKING_STYLES.map((style) => <option key={style} value={style}>{t(`council.members.styles.${style}`)}</option>)}
            </select></div>
          <div className="space-y-2"><Label>{t('council.members.focus')}</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('council.members.focus')}>
              {COUNCIL_RESEARCH_KINDS.map((focus) => <Button key={focus} type="button" size="sm"
                variant={draft.researchFocus?.includes(focus) ? 'secondary' : 'outline'} aria-pressed={draft.researchFocus?.includes(focus) ?? false}
                disabled={focus === 'web' && !webResearch} onClick={() => toggleFocus(focus)}>
                {draft.researchFocus?.includes(focus) && <Check className="size-3" />}{t(`council.members.focuses.${focus}`)}
              </Button>)}
            </div>
            {!webResearch && <p className="text-xs leading-5 text-muted-foreground">{t('council.members.webDisabled')}</p>}
          </div>
          <div className="space-y-2"><Label htmlFor="member-editor-model">{t('council.model')}</Label>
            <select id="member-editor-model" className={selectClass} value={councilModelValue(draft)} onChange={(event) => {
              const option = modelOptions.find((item: CouncilModelOption) => item.value === event.target.value);
              if (option) update({ connectionId: option.connectionId, model: option.model });
            }}>
              {!currentModel && <option value={councilModelValue(draft)} disabled>{t('council.members.connectionMissing')}</option>}
              {modelOptions.map((option: CouncilModelOption) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
            </select>
            <Link to="/settings" className="inline-block text-xs text-primary hover:underline">{t('council.members.manageModels')}</Link>
          </div>
          <Collapsible className="rounded-xl border border-border">
            <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="h-auto min-h-9 w-full justify-between px-3 py-2 text-left text-sm">
              <span className="min-w-0 whitespace-normal">{t('council.members.advanced')}</span><ChevronDown className="size-4" /></Button></CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 px-3 pb-4">
              <div className="space-y-2"><Label htmlFor="member-editor-role">{t('council.members.responsibility')}</Label>
                <select id="member-editor-role" className={selectClass} value={draft.role}
                  onChange={(event) => update({ role: event.target.value as CouncilRole })}>
                  <option value="researcher">{t('council.roles.researcher')}</option>
                  <option value="challenger">{t('council.roles.challenger')}</option>
                  <option value="manager">{t('council.members.moderator')}</option>
                </select><p className="text-xs leading-5 text-muted-foreground">{t('council.members.moderatorHint')}</p>
              </div>
              <div className="space-y-2"><Label htmlFor="member-editor-instructions">{t('council.members.prompt')}</Label>
                <Textarea id="member-editor-instructions" rows={5} maxLength={1000} value={draft.instructions}
                  onChange={(event) => update({ instructions: event.target.value })} />
                <p className="text-xs text-muted-foreground">{t('council.members.promptHint')}</p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
        <div className="shrink-0 space-y-3 border-t border-border p-4">
          {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>{t('council.members.cancel')}</Button>
            <Button type="submit">{t('council.members.save')}</Button></div>
        </div>
      </form>
    </SheetContent>
  </Sheet>;
}
