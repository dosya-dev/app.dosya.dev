import { Copy, Download, FileText, Lock, Plus } from 'lucide-react';
import { Logo } from '@/components/BrandLogo';
import { brandInkVar } from '@/lib/brand-ink';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

/**
 * A replica of the public share page (src/components/share/ShareShell.astro and
 * src/styles/share.css at the repo root), drawn inside the signed-in app from
 * the branding form's state.
 *
 * It mirrors ShareShell.astro's layout and copy by hand: update this file with
 * any change to that page's top bar, note card, password gate, dock or legal line.
 *
 * Deliberately NOT an iframe of dosya.dev and not a route there: a public page
 * that renders whatever brand it is handed would be a ready-made impersonation
 * tool. This exists only behind the settings page's own gate.
 *
 * The share page is always dark, so the replica opens a `dark` token scope and
 * takes every default colour from the app's tokens. The brand colour arrives
 * through style props only, already checked as a strict #rrggbb by the caller,
 * and the brand name is rendered as text only.
 */

export interface SharePreviewBrand {
  name: string;
  logoUrl: string | null;
  /** A strict #rrggbb, or null for dosya's green. */
  color: string | null;
  hideSaveCta: boolean;
}

const SAMPLE_FILE = { name: 'Q4-report.pdf', size: '2.4 MB', kind: 'PDF', sender: 'Firat' } as const;

/** The sender's note (share_links.title / message), drawn above the file the way the share page does. */
const SAMPLE_NOTE = {
  title: 'Q4 numbers for Thursday',
  message: 'Final draft. Page 4 has the regional split you asked for.',
} as const;

export function SharePagePreview({ brand, locked, phone }: {
  /** Null renders dosya's own page, exactly what recipients get while branding is off. */
  brand: SharePreviewBrand | null;
  /** The password gate: the brand shows, the file, size and sender do not (spec 7.5). */
  locked: boolean;
  /** Mirrors share.css's narrow-screen rules, which a media query cannot see inside a frame. */
  phone: boolean;
}) {
  const t = useT();
  const accent = brand?.color ?? null;
  const primary = accent
    ? { backgroundColor: accent, color: brandInkVar(accent) }
    : { backgroundColor: 'var(--brand)', color: 'var(--brand-foreground)' };
  const showSaveCta = !brand || !brand.hideSaveCta;

  return (
    <div
      data-testid="share-preview"
      className="dark flex flex-col overflow-hidden rounded-lg border bg-background text-foreground font-sans"
      style={{ height: phone ? 640 : 520 }}
    >
      {/* Top bar: brand, what the file is */}
      <header className="flex h-14 flex-none items-center gap-4 border-b bg-card px-3.5">
        {brand ? (
          <span className="flex flex-none items-center gap-2 text-[15px] font-semibold">
            {brand.logoUrl && (
              <img
                src={brand.logoUrl} alt=""
                className={cn('block h-[22px] w-auto object-contain', phone ? 'max-w-[96px]' : 'max-w-[150px]')}
              />
            )}
            {/* The name hides on a phone to make room, unless there is no logo to stand in for it. */}
            <span className={cn(phone && brand.logoUrl && 'hidden')}>{brand.name}</span>
          </span>
        ) : (
          <span className="flex flex-none items-center gap-2 text-[15px] font-semibold">
            <Logo className="size-[22px]" />
            <span className={cn(phone && 'hidden')}>dosya.dev</span>
          </span>
        )}

        {!locked && (
          <div className="flex min-w-0 flex-1 flex-col items-start">
            <div className="max-w-full truncate text-[13px] font-semibold">{SAMPLE_FILE.name}</div>
            <div className="flex gap-1.5 text-xs text-muted-foreground">
              <span>{SAMPLE_FILE.size}</span><span>·</span><span>{SAMPLE_FILE.kind}</span>
            </div>
          </div>
        )}
      </header>

      {/* Stage */}
      <div className="flex min-h-0 flex-1 flex-col">
        {locked ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="flex w-full max-w-[340px] flex-col items-center gap-2 text-center">
              <span className="mb-1 flex size-11 items-center justify-center rounded-full border text-muted-foreground">
                <Lock className="size-5" />
              </span>
              <h2 className="text-[17px] font-semibold">{t('settings.heading.thisFileIsPasswordProtected')}</h2>
              <p className="text-[13px] text-muted-foreground">
                {brand ? t('settings.description.enterThePasswordBrandnameSharedWithYou', { brandName: brand.name }) : t('settings.description.enterThePasswordTheSenderSharedWithYou')}
              </p>
              <div className="mt-2 flex w-full flex-col gap-2">
                <span className="rounded-lg border bg-card px-3 py-2.5 text-start text-[13px] text-muted-foreground">{t('common.label.password')}</span>
                <span className="rounded-lg px-4 py-2.5 text-[13px] font-semibold" style={primary}>{t('common.label.unlock')}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('settings.description.noAccountNeeded')}</p>
            </div>
          </div>
        ) : (
          <>
            {/* The sender's note card, above the stage */}
            <div className="flex flex-none justify-center px-6 pt-5" data-testid="share-preview-note">
              <div className="w-full max-w-[340px] rounded-xl border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">{t('settings.label.noteFromSender', { sender: SAMPLE_FILE.sender })}</p>
                <p className="mt-0.5 truncate text-[13px] font-semibold">{SAMPLE_NOTE.title}</p>
                <p className={cn('mt-1 text-xs text-muted-foreground', phone && 'line-clamp-2')}>{SAMPLE_NOTE.message}</p>
              </div>
            </div>
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="flex w-full max-w-[340px] flex-col items-center gap-2 rounded-2xl border bg-card px-6 py-8 text-center">
                <FileText className="size-10 text-muted-foreground" />
                <p className="max-w-full truncate text-[15px] font-semibold">{SAMPLE_FILE.name}</p>
                <p className="text-xs text-muted-foreground">{SAMPLE_FILE.size} · {SAMPLE_FILE.kind}</p>
              </div>
            </div>

            {/* Dock */}
            <div className="flex flex-none flex-col items-center gap-2 border-t bg-card px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <span data-role="download" className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold" style={primary}>
                  <Download className="size-[15px]" />{t('settings.label.downloadSampleFilesize', { SAMPLE_FILESize: SAMPLE_FILE.size })}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium">
                  <Copy className="size-3.5" /><span className={cn(phone && 'hidden')}>{t('settings.label.copyLink')}</span>
                </span>
                {showSaveCta && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium">
                    <Plus className="size-3.5" /><span className={cn(phone && 'hidden')}>{t('settings.label.saveToDosya')}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t('settings.label.sharedBySampleFilesender', { SAMPLE_FILESender: SAMPLE_FILE.sender })}</p>
              <p className="flex flex-wrap justify-center gap-x-2.5 text-[11px] text-muted-foreground">
                <span>
                  {brand ? richText(t('settings.label.hostedByBrand', { brand: '{brand}' }), { brand: <span className="underline">dosya</span> }) : t('settings.label.hostedByDosyaDevNoAccountNoTracking')}
                </span>
                <span className="underline">{t('settings.label.privacy')}</span>
                <span className="underline">{t('settings.label.reportAbuse')}</span>
                <span className="underline">{t('common.label.contact')}</span>
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
