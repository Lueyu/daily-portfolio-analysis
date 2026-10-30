import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, MessageCircle, X } from 'lucide-react';
import type { BuilderProfile } from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/pages/AgentBuilder/errorMessage';

interface CouncilNewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: BuilderProfile[];
  loading: boolean;
  error: unknown;
  pending: boolean;
  initialProfileId: string;
  initialTicker: string;
  onCreate: (profileId: string, ticker: string) => Promise<void>;
}

export default function CouncilNewDialog({ open, onOpenChange, profiles, loading, error, pending,
  initialProfileId, initialTicker, onCreate }: CouncilNewDialogProps) {
  const { t } = useTranslation();
  const [profileId, setProfileId] = useState(initialProfileId);
  const [ticker, setTicker] = useState(initialTicker);
  const [formError, setFormError] = useState<string | null>(null);
  const create = async () => {
    if (pending) return;
    const owner = profileId || profiles[0]?.id;
    const symbol = ticker.trim().toUpperCase();
    if (!owner || !profiles.some((profile: BuilderProfile) => profile.id === owner)
      || !/^[A-Z0-9.^-]{1,20}$/u.test(symbol)) {
      setFormError(t('council.newInvalid')); return;
    }
    setFormError(null);
    try { await onCreate(owner, symbol); }
    catch (cause) { setFormError(errorMessage(cause, t('council.actionFailed'))); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto" showCloseButton={false}>
      <DialogHeader className="pr-6 text-left"><DialogTitle>{t('council.newTitle')}</DialogTitle>
        <DialogDescription>{t('council.newHint')}</DialogDescription></DialogHeader>
      <DialogClose asChild><Button variant="ghost" size="icon" className="absolute right-3 top-3" aria-label={t('council.close')}><X className="size-4" /></Button></DialogClose>
      {error ? <p role="alert" className="text-sm text-destructive">{errorMessage(error, t('council.loadFailed'))}</p>
        : loading ? <p className="text-sm text-muted-foreground">{t('council.loading')}</p>
          : profiles.length === 0 ? <div className="space-y-4"><p className="text-sm text-muted-foreground">{t('council.noProfiles')}</p>
            <Button asChild><Link to="/agent-builder">{t('council.createTeam')}</Link></Button></div>
            : <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void create(); }}>
              <div className="space-y-2"><Label htmlFor="council-ticker">{t('council.ticker')}</Label>
                <Input autoFocus id="council-ticker" value={ticker} maxLength={20} placeholder="AAPL / 0700.HK / 600519.SS"
                  onChange={(event) => setTicker(event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="council-profile">{t('council.profile')}</Label>
                <select id="council-profile" value={profileId || profiles[0]?.id} onChange={(event) => setProfileId(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {profiles.map((profile: BuilderProfile) => <option key={profile.id} value={profile.id}>{profile.config.name}</option>)}
                </select></div>
              {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}{t('council.startChat')}</Button>
            </form>}
    </DialogContent>
  </Dialog>;
}
