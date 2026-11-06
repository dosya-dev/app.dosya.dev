import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage, API_BASE } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronLeft, Loader2, Save, Upload, Lock, Maximize2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { SWATCH_BY_NAME } from '@/lib/palette';
import { formatExactDateTime } from '@/lib/date-format';
import { SharePagePreview } from './branding-share-preview';
import { t as translate, useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

// ── Advisory validation ────────────────────────────────────
// These mirror the cheap rules in apps/api (branding.ts, lib/branding/handle.ts)
// so a typo is caught before a round trip. They are advisory: the API is the
// authority and its refusal text is what is shown when the two disagree. The
// reserved-name list is deliberately NOT mirrored; the availability check
// returns the server's own reason for that.

const MAX_BRAND_NAME = 48;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const HANDLE_SHAPE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MIN_HANDLE = 3;
const MAX_HANDLE = 30;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const AVAILABILITY_DEBOUNCE_MS = 400;
// The email preview is rendered server-side from the real template, so it is
// asked for only after typing pauses, like the availability check.
const EMAIL_PREVIEW_DEBOUNCE_MS = 400;
// A native colour input must always hold a hex value. While the field is empty
// the swatch shows dosya's own green, from the generated packages/brand palette.
const EMPTY_PICKER = SWATCH_BY_NAME.green.light;

function nameProblem(name: string): string | null {
  if (CONTROL_CHARS.test(name)) return translate('settings.error.aBrandNameCannotContainLineBreaksOrControlCharacters');
  if (name.trim().length > MAX_BRAND_NAME) return translate('settings.description.aBrandNameCanBeAtMostMaxBrandNameCharacters', { MAX_BRAND_NAME });
  return null;
}

function colorProblem(color: string): string | null {
  if (color.trim() === '') return null;
  return HEX.test(color.trim()) ? null : translate('settings.description.useASixDigitHexColourThatStartsWith');
}

function handleProblem(handle: string): string | null {
  if (handle === '') return null;
  if (handle !== handle.toLowerCase()) return translate('settings.description.useLowercaseLettersOnlySoTheLinkReadsTheWayYou');
  if (!HANDLE_SHAPE.test(handle)) return translate('settings.description.useLowercaseLettersNumbersAndHyphensStartingAndEndingWithA');
  if (/--/.test(handle)) return translate('settings.description.useSingleHyphensOnly');
  if (handle.length < MIN_HANDLE) return translate('settings.description.aHandleNeedsAtLeastMinHandleCharacters', { MIN_HANDLE });
  if (handle.length > MAX_HANDLE) return translate('settings.description.aHandleCanBeAtMostMaxHandleCharacters', { MAX_HANDLE });
  return null;
}

// ── Types ──────────────────────────────────────────────────

interface BrandingValues {
  brand_name: string | null;
  logo_url: string | null;
  brand_color: string | null;
  share_handle: string | null;
  handle_set_at: number | null;
  apply_share: boolean;
  apply_email: boolean;
  hide_save_cta: boolean;
}

interface BrandingResponse {
  ok: boolean;
  enabled: boolean;
  revoked: boolean;
  can_edit: boolean;
  is_owner: boolean;
  branding: BrandingValues;
}

type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'unavailable'; reason: string | null }
  | { state: 'error'; message: string };

// ── Page ───────────────────────────────────────────────────

export default function BrandingPage() {
  const t = useT();
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [data, setData] = useState<BrandingResponse | null>(null);
  // Which workspace `data` belongs to. Compared against wsId at render, so the
  // very first render after a switch already shows the skeleton instead of
  // workspace A's form under workspace B's id, before any effect has run.
  const [loadedWs, setLoadedWs] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [applyShare, setApplyShare] = useState(true);
  const [applyEmail, setApplyEmail] = useState(true);
  const [hideSaveCta, setHideSaveCta] = useState(true);
  const [handle, setHandle] = useState('');
  const [claimedHandle, setClaimedHandle] = useState<string | null>(null);
  const [claimedAt, setClaimedAt] = useState<number | null>(null);

  const [colorError, setColorError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' });
  const [busy, setBusy] = useState<null | 'save' | 'logo' | 'claim' | 'reset'>(null);
  const [confirmClaim, setConfirmClaim] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // The workspace on screen now. A request started for another workspace
  // checks this before it writes any state, so a late answer for workspace A
  // cannot land on workspace B's page.
  const wsRef = useRef(wsId);
  wsRef.current = wsId;

  const apply = useCallback((res: BrandingResponse, forWs: string) => {
    setData(res);
    setLoadedWs(forWs);
    setName(res.branding.brand_name ?? '');
    setColor(res.branding.brand_color ?? '');
    setLogoUrl(res.branding.logo_url);
    setApplyShare(res.branding.apply_share);
    setApplyEmail(res.branding.apply_email);
    setHideSaveCta(res.branding.hide_save_cta);
    setClaimedHandle(res.branding.share_handle);
    setClaimedAt(res.branding.handle_set_at);
  }, []);

  useEffect(() => {
    // A workspace switch starts from nothing: no form values, no handle being
    // typed, no errors, no open dialog. Save stays unavailable (the skeleton
    // has no button) until this workspace's own GET lands.
    setData(null);
    setLoadedWs(null);
    setLoadError(null);
    setName(''); setColor(''); setLogoUrl(null);
    setApplyShare(true); setApplyEmail(true); setHideSaveCta(true);
    setHandle(''); setClaimedHandle(null); setClaimedAt(null);
    setColorError(null); setSaveError(null); setLogoError(null); setHandleError(null);
    setAvailability({ state: 'idle' });
    setConfirmClaim(false); setConfirmReset(false); setViewOpen(false);
    // An operation still running for the old workspace must not keep this
    // one's buttons disabled; its own completion is guarded and stays silent.
    setBusy(null);
    if (!wsId) return;
    let live = true;
    api<BrandingResponse>(`/api/workspaces/${wsId}/branding`)
      .then((res) => { if (live) apply(res, wsId); })
      .catch((err) => { if (live) setLoadError(apiErrorMessage(err, translate('settings.error.couldNotLoadBrandingPleaseTryAgain'))); });
    return () => { live = false; };
  }, [wsId, apply]);

  // Availability: debounced, and skipped when the shape is already wrong. The
  // endpoint is rate limited per user (30 a minute), so a keystroke must never
  // map to a request.
  const typedHandle = handle.trim();
  const localHandleProblem = handleProblem(typedHandle);
  useEffect(() => {
    if (typedHandle === '' || localHandleProblem) { setAvailability({ state: 'idle' }); return; }
    setAvailability({ state: 'checking' });
    let live = true;
    const timer = setTimeout(() => {
      api<{ ok: boolean; available: boolean; reason?: string }>(
        `/api/workspaces/${wsId}/branding/handle/available?handle=${encodeURIComponent(typedHandle)}`,
      )
        .then((r) => {
          if (!live) return;
          setAvailability(r.available ? { state: 'available' } : { state: 'unavailable', reason: r.reason ?? null });
        })
        .catch((err) => { if (live) setAvailability({ state: 'error', message: apiErrorMessage(err, translate('settings.error.couldNotCheckThatHandle')) }); });
    }, AVAILABILITY_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [typedHandle, localHandleProblem, wsId]);

  if (loadError) {
    return (
      <div className="p-6">
        <div className="max-w-2xl mx-auto">
          <BackLink />
          <p dir="auto" role="alert" className="text-sm text-destructive">{loadError}</p>
        </div>
      </div>
    );
  }
  if (!data || loadedWs !== wsId) {
    return (
      <div className="p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  const editable = data.can_edit;
  const nameMsg = nameProblem(name);
  const trimmedColor = color.trim();
  const tenantColor = HEX.test(trimmedColor) ? trimmedColor : null;

  const save = async () => {
    const cProblem = colorProblem(color);
    setColorError(cProblem);
    setSaveError(null);
    if (cProblem || nameMsg) return;
    const forWs = wsId;
    setBusy('save');
    try {
      await api(`/api/workspaces/${wsId}/branding`, {
        method: 'PUT',
        body: JSON.stringify({
          brand_name: name.trim() === '' ? null : name.trim(),
          brand_color: trimmedColor === '' ? null : trimmedColor,
          apply_share: applyShare,
          apply_email: applyEmail,
          hide_save_cta: hideSaveCta,
        }),
      });
      toast.success(t('common.feedback.saved'), t('settings.feedback.yourBrandingHasBeenUpdated'));
    } catch (err) {
      const msg = apiErrorMessage(err, t('settings.error.couldNotReachTheServerPleaseTryAgain'));
      if (wsRef.current === forWs) setSaveError(msg);
      toast.error(t('common.error.couldnTSave'), msg);
    }
    if (wsRef.current === forWs) setBusy(null);
  };

  const uploadLogo = async (file: File) => {
    setLogoError(null);
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) { setLogoError(t('settings.error.svgLogosAreNotAcceptedExportYourLogoAsAPng')); return; }
    if (!LOGO_TYPES.includes(file.type)) { setLogoError(t('settings.error.useAPngJpegOrWebpImage')); return; }
    if (file.size > MAX_LOGO_BYTES) { setLogoError(t('settings.error.logosMustBe2MbOrSmaller')); return; }
    const forWs = wsId;
    setBusy('logo');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/api/workspaces/${wsId}/branding/logo`, { method: 'POST', body: form, credentials: 'include' });
      const body = await res.json().catch(() => ({})) as { ok?: boolean; logo_url?: string; error?: string };
      if (wsRef.current !== forWs) return;
      if (res.ok && body.ok && body.logo_url) { setLogoUrl(body.logo_url); toast.success(t('settings.feedback.logoUpdated'), t('settings.feedback.yourLogoHasBeenUploaded')); }
      else setLogoError(body.error ?? t('settings.error.theLogoCouldNotBeUploaded'));
    } catch { if (wsRef.current === forWs) setLogoError(t('settings.error.theLogoCouldNotBeUploaded')); }
    if (wsRef.current === forWs) setBusy(null);
  };

  const removeLogo = async (): Promise<boolean> => {
    const forWs = wsId;
    try {
      const res = await fetch(`${API_BASE}/api/workspaces/${wsId}/branding/logo`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) { if (wsRef.current === forWs) setLogoUrl(null); return true; }
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (wsRef.current === forWs) setLogoError(body.error ?? t('settings.error.theLogoCouldNotBeRemoved'));
    } catch { if (wsRef.current === forWs) setLogoError(t('settings.error.theLogoCouldNotBeRemoved')); }
    return false;
  };

  const claim = async () => {
    setConfirmClaim(false);
    setHandleError(null);
    const forWs = wsId;
    setBusy('claim');
    try {
      const res = await api<{ ok: boolean; handle: string }>(`/api/workspaces/${wsId}/branding/handle`, {
        method: 'POST', body: JSON.stringify({ handle: typedHandle }),
      });
      toast.success(t('settings.feedback.handleClaimed'), t('settings.feedback.yourShareHandleIsNowSet'));
      if (wsRef.current !== forWs) return;
      setClaimedHandle(res.handle);
      // The claim endpoint does not echo the time; the server stamped it a
      // moment ago, and the next load shows the stored value.
      setClaimedAt(Math.floor(Date.now() / 1000));
      setHandle('');
    } catch (err) {
      if (wsRef.current === forWs) setHandleError(apiErrorMessage(err, t('settings.error.couldNotReachTheServerPleaseTryAgain')));
    }
    if (wsRef.current === forWs) setBusy(null);
  };

  // Reset clears the name, the colour and the logo. It leaves the three
  // switches and, above all, the handle alone: a claimed handle is permanent
  // and no button here may touch it.
  const reset = async () => {
    setConfirmReset(false);
    setSaveError(null);
    const forWs = wsId;
    setBusy('reset');
    try {
      await api(`/api/workspaces/${wsId}/branding`, { method: 'PUT', body: JSON.stringify({ brand_name: null, brand_color: null }) });
      if (wsRef.current === forWs) { setName(''); setColor(''); setColorError(null); }
      if (logoUrl && !(await removeLogo())) {
        toast.error(t('settings.error.partlyReset'), t('settings.error.yourNameAndColourWereClearedButTheLogoCouldNot'));
      } else {
        toast.success(t('settings.feedback.reset'), t('settings.feedback.yourNameColourAndLogoWereCleared'));
      }
    } catch (err) {
      const msg = apiErrorMessage(err, t('settings.error.couldNotReachTheServerPleaseTryAgain'));
      if (wsRef.current === forWs) setSaveError(msg);
      toast.error(t('settings.error.couldnTReset'), msg);
    }
    if (wsRef.current === forWs) setBusy(null);
  };

  const shownName = name.trim();
  // The server resolves no brand at all without a name (resolveBrand), so with
  // an empty name nothing ships: no logo, no colour, and the Save CTA stays.
  const named = shownName !== '';
  const shareOn = applyShare && named;
  const emailOn = applyEmail && named;
  const shareName = shareOn ? shownName : 'dosya.dev';
  const emailName = emailOn ? shownName : 'dosya.dev';
  const shareLogo = shareOn ? logoUrl : null;
  const shareAccent = shareOn ? tenantColor : null;
  const showSaveCta = !(shareOn && hideSaveCta);

  return (
    <div className="p-6">
      <div className="max-w-2xl mx-auto space-y-5">
        {/* 1. Back link and title */}
        <div>
          <BackLink />
          <h1 className="text-xl font-bold mb-1">{t('settings.heading.branding')}</h1>
          <p className="text-sm text-muted-foreground">{t('settings.description.putYourNameAndColourOnWhatPeopleOutsideTheWorkspace')}</p>
        </div>

        <Notice data={data} />

        {/* 2. Logo, name, colour */}
        <Card className="gap-0 py-0">
          <CardContent className="divide-y">
            <Row label={t('settings.label.logo')} desc={t('settings.description.pngJpegOrWebpUpTo2MbSvgIsNot')}>
              <div className="flex items-center gap-3">
                <div className="size-12 rounded-lg border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                  {logoUrl ? <img src={logoUrl} alt={t('settings.alternative.yourLogo')} className="w-full h-full object-contain" /> : <span className="text-xs text-muted-foreground">{t('common.label.none')}</span>}
                </div>
                {editable && (
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
                      {busy === 'logo' ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />} {t('common.action.upload')}
                    </Button>
                    {logoUrl && <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy !== null} onClick={() => { setLogoError(null); setBusy('logo'); void removeLogo().finally(() => setBusy(null)); }}>{t('common.remove')}</Button>}
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" data-testid="logo-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ''; }} />
                  </div>
                )}
              </div>
            </Row>
            {logoError && <p dir="auto" role="alert" className="text-xs text-destructive py-2">{logoError}</p>}

            <Row label={t('settings.label.brandName')} desc={t('settings.description.upToMaxBrandNameCharactersShownAsTextOnly', { MAX_BRAND_NAME })}>
              <div className="space-y-1">
                <Input aria-label={t('settings.accessibility.brandName')} value={name} disabled={!editable} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} className="h-8 text-xs w-56" placeholder={t('settings.placeholder.kayaStudio')} />
                {nameMsg && <p className="text-xs text-destructive">{nameMsg}</p>}
              </div>
            </Row>

            <Row label={t('settings.label.brandColour')} desc={t('settings.description.aSixDigitHexColourUsedOnTheSharePageOnlyEmail')}>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    type="color" aria-label={t('settings.accessibility.pickAColour')} disabled={!editable}
                    value={tenantColor ?? EMPTY_PICKER}
                    onChange={(e) => { setColor(e.target.value.toUpperCase()); setColorError(null); }}
                    className="size-8 rounded border bg-transparent p-0.5 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <Input aria-label={t('settings.accessibility.brandColour')} value={color} disabled={!editable} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setColor(e.target.value); setColorError(null); }} className="h-8 text-xs w-28 font-mono" placeholder="#RRGGBB" />
                </div>
                {colorError && <p dir="auto" role="alert" className="text-xs text-destructive">{colorError}</p>}
              </div>
            </Row>
          </CardContent>
        </Card>

        {/* 3. Handle: owner only, read-only once claimed */}
        {(claimedHandle || data.is_owner) && (
          <Card className="gap-0 py-0">
            <CardContent className="py-4 space-y-2">
              <p className="text-sm font-medium">{t('settings.label.shareHandle')}</p>
              {claimedHandle ? (
                <>
                  <p className="text-sm font-mono">{t('settings.label.dosyaDevSClaimedhandle', { claimedHandle })}</p>
                  {claimedAt !== null && <p className="text-xs text-muted-foreground">{t('settings.label.claimedClaimedat', { claimedAt: formatExactDateTime(claimedAt) })}</p>}
                  <p className="text-xs text-muted-foreground">{t('settings.error.yourHandleIsPermanentAndCannotBeChangedHereContactSupport')}</p>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{t('settings.error.claimANameForYourShareLinksLikeDosyaDevSYournameYou')}</p>
                  {editable && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <label htmlFor="share-handle" className="sr-only">{t('settings.label.shareHandle')}</label>
                        <span className="text-sm text-muted-foreground">@</span>
                        <Input id="share-handle" value={handle} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setHandle(e.target.value); setHandleError(null); }} dir="ltr" className="h-8 text-xs w-56 font-mono" placeholder={t('settings.placeholder.yourname')} autoComplete="off" spellCheck={false} />
                        <Button size="sm" className="h-8 text-xs" disabled={busy !== null || typedHandle === '' || !!localHandleProblem || availability.state === 'unavailable'} onClick={() => setConfirmClaim(true)}>
                          {busy === 'claim' && <Loader2 className="size-3 animate-spin" />}{t('settings.action.claimHandle')}
                        </Button>
                      </div>
                      <HandleStatus problem={localHandleProblem} availability={availability} />
                      {handleError && <p dir="auto" role="alert" className="text-xs text-destructive">{handleError}</p>}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* 4. Switches */}
        <Card className="gap-0 py-0">
          <CardContent className="divide-y">
            <Row label={t('settings.label.sharePageAndShareLinks')} desc={t('settings.description.showYourLogoNameAndColourOnThePublicSharePage')}>
              <Toggle label={t('settings.label.brandTheSharePage')} checked={applyShare} disabled={!editable} onChange={setApplyShare} />
            </Row>
            <Row label={t('common.label.email')} desc={t('settings.description.showYourNameInTheEmailMastheadAndAsTheSender')}>
              <Toggle label={t('settings.label.brandEmail')} checked={applyEmail} disabled={!editable} onChange={setApplyEmail} />
            </Row>
            <Row label={t('settings.label.hideTheSaveToDosyaButton')} desc={t('settings.description.removeTheSaveToDosyaButtonFromTheSharePageApplies')}>
              <Toggle label={t('settings.label.hideTheSaveToDosyaButton')} checked={hideSaveCta} disabled={!editable} onChange={setHideSaveCta} />
            </Row>
          </CardContent>
        </Card>

        {/* 5. Live preview, rendered from the form state */}
        <Card className="gap-0 py-0">
          <CardContent className="py-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{t('settings.label.preview')}</p>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setViewOpen(true)}>
                <Maximize2 className="size-3" />{t('common.view')}
              </Button>
            </div>
            {!named && <p className="text-xs text-muted-foreground">{t('settings.error.aBrandNameIsRequiredForAnyBrandingToTakeEffect')}</p>}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">{t('settings.label.sharePage')}</p>
              {/* The tenant colour reaches the DOM only through this style prop. */}
              <div className="rounded-lg border bg-card overflow-hidden" style={shareAccent ? { borderTopColor: shareAccent, borderTopWidth: 3 } : { borderTopColor: 'var(--brand)', borderTopWidth: 3 }}>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {shareLogo && <img src={shareLogo} alt="" className="size-6 object-contain shrink-0" />}
                    <span className="text-sm font-semibold truncate">{shareName}</span>
                  </div>
                  {showSaveCta && <span className="text-xs rounded border px-2 py-0.5 text-muted-foreground shrink-0">{t('settings.label.saveToDosya')}</span>}
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">{t('common.label.email')}</p>
              <div className="rounded-lg border bg-background text-foreground overflow-hidden">
                <div className="px-3 py-2 border-b text-sm font-semibold truncate">{emailName}</div>
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  <p>{t('settings.label.fromEmailnameNoreplyDosyaDev', { emailName })}</p>
                  <p>{t('settings.description.subjectLinesStillSayDosyaDevEmailIsBlackAndWhite')}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 6. Save and reset */}
        {saveError && <p dir="auto" role="alert" className="text-xs text-destructive">{saveError}</p>}
        {editable && (
          <div className="flex items-center justify-between gap-3">
            <Button className="gap-1.5" disabled={busy !== null} onClick={() => void save()}>
              {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}{t('settings.action.saveBranding')}
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => setConfirmReset(true)}>{t('settings.action.resetToDosya')}</Button>
          </div>
        )}
      </div>

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto">
          {viewOpen && (
            <RecipientView
              wsId={wsId}
              shareBrand={shareOn ? { name: shownName, logoUrl: shareLogo, color: shareAccent, hideSaveCta } : null}
              emailBrandName={emailOn ? shownName : null}
              hasLogo={logoUrl !== null}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmClaim} onOpenChange={setConfirmClaim}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('settings.heading.claimThisHandle')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{richText(t('settings.error.youAreClaimingTypedhandleItIsPermanent', { typedHandle: '{typedHandle}' }), { typedHandle: <span className="font-mono">{typedHandle}</span> })}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClaim(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void claim()}>{t('settings.action.claimPermanently')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('settings.heading.resetToDosya')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t('settings.description.thisRemovesYourBrandNameColourAndLogoStraightAwayYour')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={() => void reset()}>{t('settings.action.reset')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Full-size view ─────────────────────────────────────────

type EmailPreview =
  | { state: 'loading' }
  | { state: 'ready'; html: string; from: string; subject: string }
  | { state: 'error'; message: string };

/**
 * What recipients get, at full size, from the form as it stands (unsaved edits
 * included). The caller has already applied the same gating as the real
 * surfaces, so a null brand here means "recipients see dosya's defaults".
 */
function RecipientView({ wsId, shareBrand, emailBrandName, hasLogo }: {
  wsId: string;
  shareBrand: React.ComponentProps<typeof SharePagePreview>['brand'];
  /** The draft name when email branding would apply, else null. */
  emailBrandName: string | null;
  /** A stored logo the form has not removed. An unsaved logo does not exist server-side. */
  hasLogo: boolean;
}) {
  const t = useT();
  const [tab, setTab] = useState<'share' | 'email'>('share');
  const [width, setWidth] = useState<'desktop' | 'phone'>('desktop');
  const [locked, setLocked] = useState(false);
  const phone = width === 'phone';

  return (
    <div className="space-y-4 min-w-0">
      <DialogHeader><DialogTitle>{t('settings.heading.whatRecipientsSee')}</DialogTitle></DialogHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'share' | 'email')}>
          <TabsList>
            <TabsTrigger value="share" className="px-3 text-xs">{t('settings.action.sharePage')}</TabsTrigger>
            <TabsTrigger value="email" className="px-3 text-xs">{t('settings.action.email')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-4">
          {tab === 'share' && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Toggle label={t('common.label.passwordProtected')} checked={locked} onChange={setLocked} />
              {t('common.label.passwordProtected')}
            </label>
          )}
          <Tabs value={width} onValueChange={(v) => setWidth(v as 'desktop' | 'phone')}>
            <TabsList aria-label={t('settings.accessibility.previewWidth')}>
              <TabsTrigger value="desktop" className="px-3 text-xs">{t('common.action.desktop')}</TabsTrigger>
              <TabsTrigger value="phone" className="px-3 text-xs">{t('settings.action.phone')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      <div className={phone ? 'mx-auto w-[390px] max-w-full' : 'w-full'}>
        {tab === 'share'
          ? <SharePagePreview brand={shareBrand} locked={locked} phone={phone} />
          : <EmailView wsId={wsId} brandName={emailBrandName} hasLogo={hasLogo} />}
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.description.sampleFileAndSenderUnsavedChangesAreShownRecipientsSeeThem')}</p>
    </div>
  );
}

/** Mounted only while the Email tab is showing, so nothing is requested otherwise. */
function EmailView({ wsId, brandName, hasLogo }: { wsId: string; brandName: string | null; hasLogo: boolean }) {
  const t = useT();
  const [preview, setPreview] = useState<EmailPreview>({ state: 'loading' });
  const logo = hasLogo ? 'current' : 'none';

  // The last answer stays on screen while the next one is pending, so typing
  // does not blank the email between keystrokes.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api<{ ok: boolean; html: string; from: string; subject: string }>(`/api/workspaces/${wsId}/branding/preview-email`, {
        method: 'POST',
        body: JSON.stringify({ brand_name: brandName, logo }),
      })
        .then((r) => { if (live) setPreview({ state: 'ready', html: r.html, from: r.from, subject: r.subject }); })
        .catch((err) => { if (live) setPreview({ state: 'error', message: apiErrorMessage(err, translate('settings.error.couldNotRenderTheEmailPreview')) }); });
    }, EMAIL_PREVIEW_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [wsId, brandName, logo]);

  if (preview.state === 'error') return <p role="alert" dir="auto" className="text-xs text-destructive">{preview.message}</p>;
  if (preview.state === 'loading') {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-lg border text-xs text-muted-foreground gap-2">
        <Loader2 className="size-3.5 animate-spin" />{t('settings.description.renderingTheEmail')}
      </div>
    );
  }
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="border-b px-3 py-2 text-xs space-y-0.5">
        <p className="truncate"><span className="text-muted-foreground">{t('settings.label.from')} </span>{preview.from}</p>
        <p className="truncate"><span className="text-muted-foreground">{t('settings.label.subject')} </span>{preview.subject}</p>
      </div>
      {/* An empty sandbox: no scripts, no same-origin, no navigation out. */}
      <iframe title={t('settings.tooltip.emailPreview')} sandbox="" srcDoc={preview.html} className="block h-[560px] w-full bg-background" />
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────

function BackLink() {
  const t = useT();
  return (
    <Link to="/settings" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
      <ChevronLeft className="size-3.5 rtl:-scale-x-100" /> {t('common.action.backToSettings')}
    </Link>
  );
}

function Notice({ data }: { data: BrandingResponse }) {
  const t = useT();
  if (data.revoked) {
    return (
      <div role="status" className="flex items-start gap-2 rounded-lg border p-3 text-sm">
        <Lock className="size-4 mt-0.5 shrink-0" />
        <p>{t('settings.error.brandingIsDisabledForThisWorkspaceYourValuesAreShownBelow')}</p>
      </div>
    );
  }
  if (!data.enabled) {
    return (
      <div role="status" className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
        <p>{t('settings.description.brandingIsAvailableOnStarterAndUpYourSavedValuesAre')}</p>
        <Link to="/billing" className="underline shrink-0">{t('common.action.seePlans')}</Link>
      </div>
    );
  }
  if (!data.can_edit) {
    return <div role="status" className="rounded-lg border p-3 text-sm">{t('settings.error.youCanSeeTheseSettingsButYourRoleCannotChangeThem')}</div>;
  }
  return null;
}

function HandleStatus({ problem, availability }: { problem: string | null; availability: Availability }) {
  const t = useT();
  if (problem) return <p className="text-xs text-destructive">{problem}</p>;
  switch (availability.state) {
    case 'checking': return <p className="text-xs text-muted-foreground">{t('profile.status.checking')}</p>;
    case 'available': return <p className="text-xs text-muted-foreground">{t('settings.description.thatHandleIsAvailable')}</p>;
    case 'unavailable': return <p className="text-xs text-destructive">{availability.reason ?? t('settings.error.thatHandleIsNotAvailable')}</p>;
    case 'error': return <p dir="auto" className="text-xs text-destructive">{availability.message}</p>;
    default: return <p className="text-xs text-muted-foreground">{t('settings.description.3To30CharactersLowercaseLettersNumbersAndHyphens')}</p>;
  }
}

function Row({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 gap-4">
      <div className="min-w-0"><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground mt-0.5">{desc}</p></div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-primary' : 'bg-muted-foreground/30'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`absolute top-[2px] w-4 h-4 bg-background rounded-full shadow transition-all ${checked ? 'inset-s-[18px]' : 'inset-s-[2px]'}`} />
    </button>
  );
}
