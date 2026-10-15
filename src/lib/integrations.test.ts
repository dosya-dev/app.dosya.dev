import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  INTEGRATIONS, getIntegration, API_HOST, S3_REGION, ZAPIER_INVITE_URL, WORDPRESS_ZIP_URL,
  MAC_APP_STORE_URL, MS_STORE_URL, SNAP_STORE_URL, N8N_NODE_PUBLISHED, N8N_PACKAGE_NAME, N8N_EXAMPLES_URL,
  rcloneConfig, webdavUrl, webdavWindowsMount, webdavLinuxMount,
  sftpConnect, sftpConfig, s3Endpoint, s3Examples, desktopDownload,
  cliExamples, restExample,
} from './integrations';
import { ZAPIER_BRAND } from './zapier-brand';

const ctx = { workspaceId: 'ws_abc123', workspaceName: 'My Team', email: 'ada@example.com' };

describe('integrations metadata', () => {
  it('exposes exactly the seventeen integrations in order', () => {
    expect(INTEGRATIONS.map((i) => i.slug)).toEqual([
      'rclone', 'webdav', 'sftp', 's3', 'desktop', 'cli', 'rest-api', 'extension', 'zapier', 'n8n', 'lightroom', 'wordpress',
      'google', 'onedrive', 'dropbox', 'webhooks', 'remote-download',
    ]);
  });
  it('resolves a slug, and returns undefined for unknown', () => {
    expect(getIntegration('s3')?.title).toBe('S3');
    expect(getIntegration('sftp')?.title).toBe('SFTP');
    expect(getIntegration('nope')).toBeUndefined();
  });
  it('google uses a brand-logo iconSrc', () => {
    expect(getIntegration('google')?.iconSrc).toBe('/google-color.svg');
  });

  it('rclone and zapier use their own marks rather than a generic glyph', () => {
    expect(getIntegration('rclone')?.iconSrc).toBe('/rclone-color.svg');
    expect(getIntegration('zapier')?.iconSrc).toBe('/zapier-color.svg');
  });

  /**
   * An iconSrc with no file behind it renders a broken-image box, silently,
   * on the page that is meant to look most trustworthy. Both trees are
   * checked: src/components/demo is vendored to the marketing site, which
   * serves the same paths out of its own public directory, so a logo added
   * to one public/ and not the other breaks there and nowhere else.
   */
  it('every iconSrc exists in both public directories', () => {
    const webPublic = resolve(import.meta.dirname, '../../public');
    const marketingPublic = resolve(import.meta.dirname, '../../../../public');
    for (const { slug, iconSrc } of INTEGRATIONS) {
      if (!iconSrc) continue;
      expect(existsSync(resolve(webPublic, `.${iconSrc}`)), `${slug}: apps/web/public${iconSrc}`).toBe(true);
    }
    // Only the logos the demo actually names need to exist on the marketing side.
    const demo = readFileSync(
      resolve(import.meta.dirname, '../components/demo/web/WebIntegrations.tsx'),
      'utf8',
    );
    for (const src of demo.match(/iconSrc: '([^']+)'/g) ?? []) {
      const file = src.replace(/^iconSrc: '/, '').replace(/'$/, '');
      expect(existsSync(resolve(marketingPublic, `.${file}`)), `public${file}`).toBe(true);
    }
  });
  it('describes google drive as structure-preserving import', () => {
    const google = INTEGRATIONS.find((i) => i.slug === 'google')!;
    expect(google.tag).toBe('Import');
    expect(google.description).toContain('structure preserved');
  });
  /**
   * Every card's whole surface is a <Link to={`/integrations/${slug}`}>, so a
   * slug with no route and no page navigates to the catch-all 404. That is the
   * failure this guards: the page file and the router entry are two separate
   * edits and it is easy to land one without the other.
   */
  it('every slug has a setup page and a route', () => {
    const pages = readdirSync(resolve(import.meta.dirname, '../pages/integrations'));
    const router = readFileSync(resolve(import.meta.dirname, '../router.tsx'), 'utf8');
    for (const { slug } of INTEGRATIONS) {
      expect(pages, `no page for ${slug}`).toContain(`${slug}.tsx`);
      expect(router, `no route for ${slug}`).toContain(`path: '/integrations/${slug}'`);
    }
  });

  it('zapier is tagged no-code and points at its own marketing page', () => {
    const zapier = getIntegration('zapier')!;
    expect(zapier.tag).toBe('No-code');
    expect(zapier.docsUrl).toBe('https://dosya.dev/integration/zapier');
  });

  /**
   * The invite link is the only way into a private Zapier app, and it is
   * written out twice: here and in the marketing site's own module, which
   * cannot be imported across the app seam. A stale copy sends whoever
   * follows it from the dashboard to a dead end, so read the other one.
   */
  it('wordpress uses its own mark and points at its own marketing page', () => {
    const wp = getIntegration('wordpress')!;
    expect(wp.iconSrc).toBe('/logo-wordpress.svg');
    expect(existsSync(resolve(import.meta.dirname, '../../public/logo-wordpress.svg'))).toBe(true);
    // The edge firewall blocks root paths starting with /wordpress or /wp-.
    expect(wp.iconSrc).not.toMatch(/^\/(wordpress|wp-)/i);
    expect(wp.docsUrl).toBe('https://dosya.dev/integration/wordpress');
  });

  /**
   * The plugin zip is served by the marketing site and linked from here. Read
   * that module so the two cannot drift, and check the file is really there.
   */
  it('links the plugin zip the marketing site serves', () => {
    const marketing = readFileSync(
      resolve(import.meta.dirname, '../../../../src/lib/wordpress-integration.ts'),
      'utf8',
    );
    const path = marketing.match(/WORDPRESS_ZIP_PATH\s*=\s*"([^"]+)"/)?.[1];
    expect(path, 'could not find WORDPRESS_ZIP_PATH on the marketing site').toBeTruthy();
    expect(WORDPRESS_ZIP_URL).toBe(`https://dosya.dev${path}`);
    expect(existsSync(resolve(import.meta.dirname, '../../../../public', `.${path}`))).toBe(true);
  });

  it('n8n uses its own mark and points at its own marketing page', () => {
    const n8n = getIntegration('n8n')!;
    expect(n8n.iconSrc).toBe('/n8n-color.svg');
    expect(existsSync(resolve(import.meta.dirname, '../../public/n8n-color.svg'))).toBe(true);
    expect(n8n.docsUrl).toBe('https://dosya.dev/integration/n8n');
  });

  /** The n8n constants are copied from the marketing site; they must agree. */
  it('agrees with the marketing site about the n8n node', () => {
    const marketing = readFileSync(
      resolve(import.meta.dirname, '../../../../src/lib/n8n-integration.ts'),
      'utf8',
    );
    const published = marketing.match(/N8N_NODE_PUBLISHED\s*=\s*(true|false)/)?.[1];
    expect(published, 'could not find N8N_NODE_PUBLISHED on the marketing site').toBeTruthy();
    expect(N8N_NODE_PUBLISHED).toBe(published === 'true');
    expect(marketing).toContain(`PACKAGE_NAME = "${N8N_PACKAGE_NAME}"`);
    expect(N8N_EXAMPLES_URL).toBe('https://github.com/dosya-dev/n8n-nodes-dosya/tree/main/examples');
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../n8n/package.json'), 'utf8'));
    expect(pkg.name).toBe(N8N_PACKAGE_NAME);
  });

  it('carries the same Zapier invite link as the marketing site', () => {
    const marketing = readFileSync(
      resolve(import.meta.dirname, '../../../../src/lib/zapier-integration.ts'),
      'utf8',
    );
    const match = marketing.match(/ZAPIER_INVITE_URL\s*=\s*\n?\s*"([^"]+)"/);
    expect(match, 'could not find ZAPIER_INVITE_URL on the marketing site').not.toBeNull();
    expect(ZAPIER_INVITE_URL).toBe(match![1]);
  });

  /**
   * The invite button paints Zapier's mark in their orange. Both are copied
   * from the marketing site's zapier-marks.ts across the app seam, the same
   * way the invite URL is, so the same drift check applies: a mark that stops
   * matching is no longer the mark we checked the licence and colour against.
   */
  it('carries the same Zapier mark and orange as the marketing site', () => {
    const marketing = readFileSync(
      resolve(import.meta.dirname, '../../../../src/lib/zapier-marks.ts'),
      'utf8',
    );
    const block = marketing.match(/zapier:\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(block, 'no zapier entry on the marketing site').not.toBe('');
    expect(block).toContain(ZAPIER_BRAND.ORANGE);
    expect(block).toContain(ZAPIER_BRAND.PATH);
  });

  /**
   * White on #FF4F00 is 3.3:1, under the 4.5:1 WCAG AA needs for text this
   * size. The button therefore pairs the orange with graphite, at 5.4:1.
   * Stated as a test because "make it look like Zapier" is exactly the edit
   * that would reach for white.
   */
  it('pairs the Zapier orange with ink that passes AA', () => {
    const lum = (hex: string) => {
      const ch = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const a = lum(ZAPIER_BRAND.ORANGE);
    const b = lum(ZAPIER_BRAND.INK);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The store badges the desktop page renders. Same failure as a missing
   * iconSrc, and worse here: a broken image where a vendor's badge should be
   * is the kind of thing a reader reads as "this is not a real product".
   * Both Snap colourways are required, because the theme picks one in CSS
   * and a missing file only breaks in one theme.
   */
  it('ships every store badge the desktop page renders', () => {
    const page = readFileSync(
      resolve(import.meta.dirname, '../pages/integrations/desktop.tsx'),
      'utf8',
    );
    const used = [...page.matchAll(/src="(\/badges\/[^"]+)"/g)].map((m) => m[1]);
    expect(used.length, 'the desktop page renders no badge at all').toBeGreaterThan(0);
    for (const file of used) {
      expect(
        existsSync(resolve(import.meta.dirname, '../../public', `.${file}`)),
        `apps/web/public${file}`,
      ).toBe(true);
    }
    // The Microsoft component falls back to this when its script is blocked.
    expect(existsSync(resolve(import.meta.dirname, '../../public/badges/msstore.svg'))).toBe(true);
  });

  /**
   * The desktop page sends people to three store listings. Each URL is
   * written out again here because the app seam stops this importing the
   * marketing site's store-links.ts, and a store link that drifts lands the
   * reader on someone else's error page.
   *
   * The Mac one has two details that look cosmetic and are not: dropping the
   * locale segment keeps each visitor on their own storefront, and mt=12 is
   * what makes a Mac-only app resolve as available rather than as a missing
   * iOS app. Both are asserted so neither can be "tidied" away.
   */
  it('carries the same store listings as the marketing site', () => {
    const links = readFileSync(
      resolve(import.meta.dirname, '../../../../src/lib/store-links.ts'),
      'utf8',
    );
    const appId = links.match(/MAC_APP_STORE_APP_ID\s*=\s*"(\d+)"/)?.[1];
    expect(appId, 'no MAC_APP_STORE_APP_ID on the marketing site').toBeDefined();
    expect(MAC_APP_STORE_URL).toBe(`https://apps.apple.com/app/id${appId}?mt=12`);
    expect(MAC_APP_STORE_URL).not.toMatch(/apps\.apple\.com\/[a-z]{2}\//);

    const badge = readFileSync(
      resolve(import.meta.dirname, '../../../../src/components/MsStoreBadge.astro'),
      'utf8',
    );
    const productId = badge.match(/MS_STORE_PRODUCT_ID\s*=\s*"([^"]+)"/)?.[1];
    expect(productId, 'no MS_STORE_PRODUCT_ID on the marketing site').toBeDefined();
    expect(MS_STORE_URL).toBe(`https://apps.microsoft.com/store/detail/${productId}`);

    const snapBadge = readFileSync(
      resolve(import.meta.dirname, '../../../../src/components/SnapStoreBadge.astro'),
      'utf8',
    );
    expect(snapBadge).toContain(SNAP_STORE_URL);
  });

  /**
   * /settings/api-keys has never been a route in this app - /settings is a
   * single page with no children - so anything pointing users there lands
   * them on the 404. The real one is /profile/api, which ApiKeyCallout links.
   */
  it('sends people to a route that exists when they need an API key', () => {
    const callout = readFileSync(
      resolve(import.meta.dirname, '../components/integrations/integration-layout.tsx'),
      'utf8',
    );
    expect(callout).toContain('to="/profile/api"');
    const router = readFileSync(resolve(import.meta.dirname, '../router.tsx'), 'utf8');
    expect(router).toContain("path: '/profile/:section?'");
    expect(router).not.toContain('/settings/api-keys');
  });

  it('code integrations link to their marketing docs; google has none', () => {
    expect(getIntegration('cli')?.docsUrl).toBe('https://dosya.dev/developer/cli');
    expect(getIntegration('rest-api')?.docsUrl).toBe('https://dosya.dev/developer/api');
    expect(getIntegration('desktop')?.docsUrl).toBe('https://dosya.dev/desktop');
    expect(getIntegration('google')?.docsUrl).toBeUndefined();
    expect(getIntegration('lightroom')?.docsUrl).toBe('https://dosya.dev/integration/lightroom/');
  });
});

describe('snippet builders inject context + use the API host', () => {
  it('rclone config carries workspace id and explicit api_url', () => {
    const cfg = rcloneConfig(ctx);
    expect(cfg).toContain('type = dosya');
    expect(cfg).toContain('workspace_id = ws_abc123');
    expect(cfg).toContain(`api_url = ${API_HOST}`);
    expect(cfg).toContain('api_key = dos_your_api_key');
  });
  it('webdav url identifies by id and ends with the encoded name (Finder volume name)', () => {
    expect(webdavUrl(ctx)).toBe('https://api.dosya.dev/webdav/mount/ws_abc123/My%20Team/');
    expect(webdavLinuxMount(ctx)).toContain('mount -t davfs https://api.dosya.dev/webdav/mount/ws_abc123/My%20Team/');
    expect(webdavWindowsMount(ctx)).toContain('/user:ada@example.com');
  });
  it('webdav url falls back to the workspace id as the label while the name loads', () => {
    expect(webdavUrl({ ...ctx, workspaceName: '' })).toBe(
      'https://api.dosya.dev/webdav/mount/ws_abc123/ws_abc123/',
    );
  });
  it('sftp connect uses email as username, host and port 2222', () => {
    expect(sftpConnect(ctx)).toBe('sftp -P 2222 ada@example.com@sftp.dosya.dev');
  });
  it('sftp ssh-config block has hostname/port/user', () => {
    const c = sftpConfig(ctx);
    expect(c).toContain('HostName sftp.dosya.dev');
    expect(c).toContain('Port 2222');
    expect(c).toContain('User ada@example.com');
  });
  it('s3 endpoint/region/bucket', () => {
    expect(s3Endpoint()).toBe('https://api.dosya.dev/s3');
    expect(S3_REGION).toBe('us-east-1');
    expect(s3Examples(ctx)).toContain('s3://ws_abc123/');
  });
  it('cli examples include auth login and upload', () => {
    expect(cliExamples).toContain('dosya auth login');
    expect(cliExamples).toContain('dosya upload');
  });
  it('desktop download builds a platform url from the given base', () => {
    expect(desktopDownload('https://api.dosya.dev', 'mac'))
      .toBe('https://api.dosya.dev/api/desktop/latest?platform=mac');
  });
  it('rest example uses bearer auth against the api host', () => {
    const c = restExample();
    expect(c).toContain('https://api.dosya.dev/api/me');
    expect(c).toContain('Authorization: Bearer dos_your_api_key');
  });
});
