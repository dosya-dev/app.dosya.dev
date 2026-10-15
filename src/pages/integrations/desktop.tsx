import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Smartphone } from 'lucide-react';
import { IntegrationLayout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { API_BASE } from '@/api/client';
import { getIntegration, desktopDownload, MAC_APP_STORE_URL, SNAP_STORE_URL } from '@/lib/integrations';
import { MsStoreBadge } from '@/components/ms-store-badge';
import {
  detectDesktopOs, isHandheld, macArchitecture, snapInstallCommand, buildSize,
  OS_LABEL, type DesktopOs, type DesktopInfo,
} from '@/lib/desktop-os';

const meta = getIntegration('desktop')!;
const ORDER: DesktopOs[] = ['windows', 'mac', 'linux'];

/*
 * Download page for the desktop app.
 *
 * It used to be three identical buttons with no instructions, which left the
 * reader to work out which file was theirs and what to do with it. It now
 * leads with the one build they can actually run and tells them how to
 * install it, with the other two kept one click away rather than removed:
 * detection is a guess, and somebody downloading for another machine is a
 * real case.
 *
 * Everything version-specific comes from GET /api/desktop/info at runtime, so
 * the size, the version, the mac architecture and the snap channel are what
 * shipped rather than what someone typed here. The page renders fully without
 * it - the buttons work, only the numbers are missing - because a download
 * page that needs a second request to be usable is worse than one that does
 * not.
 */
export default function DesktopSetup() {
  const [os, setOs] = useState<DesktopOs | null>(null);
  const [handheld, setHandheld] = useState(false);
  const [picked, setPicked] = useState<DesktopOs | null>(null);
  const [info, setInfo] = useState<DesktopInfo | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    setOs(detectDesktopOs(ua));
    setHandheld(isHandheld(ua));
  }, []);

  useEffect(() => {
    let live = true;
    fetch(`${API_BASE}/api/desktop/info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setInfo(d as DesktopInfo); })
      .catch(() => { /* sizes and version stay hidden; the buttons still work */ });
    return () => { live = false; };
  }, []);

  // Detection is only a default. Once the reader picks, that is the answer.
  const active = picked ?? os;
  const others = ORDER.filter((p) => p !== active);
  const version = info?.version;

  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      {handheld && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
          <Smartphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-medium">This one is for a computer</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              You are on a phone or tablet, so none of these will install here. dosya has native
              mobile apps instead.{' '}
              <a
                href="https://dosya.dev/mobile/"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                See the mobile apps
              </a>
              . You can still send a download link to your computer from below.
            </p>
          </div>
        </div>
      )}

      <Step n={1} title={active ? `Download for ${OS_LABEL[active]}` : 'Download the app'}>
        {active ? (
          <>
            <p>
              {active === 'mac' && `A universal .dmg for ${macArchitecture(info)}, macOS 12 or later.`}
              {active === 'windows' && 'An .exe installer for 64-bit Windows 10 and 11.'}
              {active === 'linux' && 'An AppImage that runs on any modern 64-bit distribution.'}
            </p>
            {/* The store badge sits beside the direct download rather than in
                a later step: they are the same decision, made once, and each
                vendor's artwork says what it is without a label. */}
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={desktopDownload(API_BASE, active)}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
              >
                <Download className="size-4" />
                Download for {OS_LABEL[active]}
                {(version || buildSize(info?.builds?.[active]?.size)) && (
                  <span className="font-normal opacity-70">
                    {version ? `v${version}` : ''}
                    {version && buildSize(info?.builds?.[active]?.size) ? ' · ' : ''}
                    {buildSize(info?.builds?.[active]?.size) ?? ''}
                  </span>
                )}
              </a>
              {active === 'mac' && <MacAppStoreBadge />}
              {active === 'windows' && <MsStoreBadge className="inline-block leading-none" />}
              {/* Only once a snap exists: the badge is a promise that the
                  listing has something on it. */}
              {active === 'linux' && snapInstallCommand(info) && <SnapStoreBadge />}
            </div>

            {active !== 'linux' && (
              <p className="text-xs text-muted-foreground">
                The store build handles its own updates. It trails the direct download by a
                release while review runs, so it can be a version behind.
              </p>
            )}

            {active === 'linux' && snapInstallCommand(info) && (
              <>
                <p className="text-xs text-muted-foreground">
                  snapd handles updates after install. The Snap Store's own install button only
                  appears once a revision reaches the stable channel, so until then this is the
                  command that works:
                </p>
                <CodeBlock code={snapInstallCommand(info)!} lang="bash" />
              </>
            )}
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            {ORDER.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPicked(p)}
                className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
              >
                <Download className="size-4" /> {OS_LABEL[p]}
              </button>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {active ? 'On a different computer? ' : 'Or pick one: '}
          {others.map((p, i) => (
            <span key={p}>
              {i > 0 && ' · '}
              <button
                type="button"
                onClick={() => setPicked(p)}
                className="underline underline-offset-2 hover:text-foreground"
              >
                {OS_LABEL[p]}
              </button>
            </span>
          ))}
        </p>
      </Step>

      {active && (
        <Step n={2} title="Install it">
          {active === 'mac' && (
            <p>
              Open the .dmg, drag <strong>dosya</strong> into Applications, then launch it from
              there. macOS checks the signature on first run, which can take a few seconds.
            </p>
          )}
          {active === 'windows' && (
            <p>
              Run the .exe. It installs for the current user, so it needs no administrator
              password. SmartScreen may ask once before the certificate is widely seen; choose
              <strong> More info</strong> then <strong>Run anyway</strong>.
            </p>
          )}
          {active === 'linux' && (
            <>
              <p>Make the AppImage executable and run it:</p>
              <CodeBlock code={'chmod +x dosya-*.AppImage\n./dosya-*.AppImage'} lang="bash" />
              {info?.builds?.linux?.deb?.fileName && (
                <p>
                  On Debian or Ubuntu the{' '}
                  <a
                    href={`${desktopDownload(API_BASE, 'linux')}&format=deb`}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    .deb package
                  </a>{' '}
                  {buildSize(info.builds.linux.deb.size) ? `(${buildSize(info.builds.linux.deb.size)}) ` : ''}
                  integrates with your package manager instead. It does not self-update.
                </p>
              )}
            </>
          )}
        </Step>
      )}

      {/* Every store route now lives in step 1 beside its download, so the
          page is the same three steps on all three platforms: get it,
          install it, or skip both and use the terminal. */}
      <Step n={active ? 3 : 2} title="Prefer the terminal?">
        <p>
          The{' '}
          <Link to="/integrations/cli" className="underline underline-offset-2 hover:text-foreground">
            dosya CLI
          </Link>{' '}
          gives you scriptable uploads, downloads and folder sync from the command line.
        </p>
      </Step>
    </IntegrationLayout>
  );
}

/**
 * Apple's official "Download on the Mac App Store" badge.
 *
 * public/badges/mac-appstore.svg is the unmodified US/UK black badge from
 * Apple's marketing resources, and it has to stay unmodified: Apple's
 * guidelines cover the artwork, its proportions and its clear space. So the
 * intrinsic 156x40 is declared, height drives it, width follows, and nothing
 * here recolours or crops it. Same artwork and the same rules as
 * MacAppStoreBadge.astro on the marketing site.
 */
function MacAppStoreBadge() {
  const alt = 'Download on the Mac App Store';
  return (
    <a
      href={MAC_APP_STORE_URL}
      target="_blank"
      rel="noopener"
      aria-label={alt}
      className="inline-block leading-none transition-opacity hover:opacity-85"
    >
      <img src="/badges/mac-appstore.svg" alt={alt} width={156} height={40} className="block h-11 w-auto" />
    </a>
  );
}

/**
 * Canonical's official "Get it from the Snap Store" badge.
 *
 * The artwork is named after ITS OWN colour, not the surface it belongs on,
 * so the black badge goes on the light theme and the white one on dark. Both
 * are in the markup and CSS picks one, which is how the marketing twin does
 * it: no script, no flash, and the theme toggle just works. The unmodified
 * 182x56 artwork from snapcraft.io/docs/snap-store-badges, height-driven so
 * the proportions survive sitting in a row.
 */
function SnapStoreBadge() {
  const alt = 'Get it from the Snap Store';
  return (
    <a
      href={SNAP_STORE_URL}
      target="_blank"
      rel="noopener"
      aria-label={alt}
      className="inline-block leading-none transition-opacity hover:opacity-85"
    >
      <img
        src="/badges/snap-store-black.svg"
        alt={alt}
        width={182}
        height={56}
        className="block h-11 w-auto dark:hidden"
      />
      <img
        src="/badges/snap-store-white.svg"
        alt={alt}
        width={182}
        height={56}
        className="hidden h-11 w-auto dark:block"
      />
    </a>
  );
}

