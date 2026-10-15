import { describe, it, expect } from 'vitest';
import {
  detectDesktopOs, isHandheld, macArchitecture, snapInstallCommand, buildSize,
} from './desktop-os';

// Real user agents. Written out rather than synthesised, because the whole
// point of this module is the two that lie about themselves.
const UA = {
  win11Chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  ubuntuFirefox: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  // Says "Linux". Is a phone.
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  // Says "Mac OS X". Is a tablet.
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  crawler: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
};

describe('detectDesktopOs', () => {
  it('reads the three desktop platforms', () => {
    expect(detectDesktopOs(UA.win11Chrome)).toBe('windows');
    expect(detectDesktopOs(UA.macSafari)).toBe('mac');
    expect(detectDesktopOs(UA.macChrome)).toBe('mac');
    expect(detectDesktopOs(UA.ubuntuFirefox)).toBe('linux');
  });

  /**
   * The reason this module exists. Both of these contain a desktop OS name
   * and neither can run a desktop build, so a plain substring check hands a
   * phone a 250 MB installer.
   */
  it('refuses to call Android "linux" or an iPad "mac"', () => {
    expect(detectDesktopOs(UA.androidChrome)).toBeNull();
    expect(detectDesktopOs(UA.iphoneSafari)).toBeNull();
    expect(detectDesktopOs(UA.ipadSafari)).toBeNull();
  });

  it('separates "a handheld" from "could not tell"', () => {
    expect(isHandheld(UA.androidChrome)).toBe(true);
    expect(isHandheld(UA.ipadSafari)).toBe(true);
    expect(isHandheld(UA.crawler)).toBe(false);
    expect(detectDesktopOs(UA.crawler)).toBeNull();
  });

  it('returns null rather than guessing on an empty or unknown agent', () => {
    expect(detectDesktopOs('')).toBeNull();
    expect(detectDesktopOs('something else entirely')).toBeNull();
  });
});

describe('facts derived from the build manifest', () => {
  it('promises Intel only once the dmg is universal', () => {
    expect(macArchitecture({ builds: { mac: { fileName: 'dosya-3.1.1-universal.dmg' } } }))
      .toBe('Apple Silicon and Intel');
    expect(macArchitecture({ builds: { mac: { fileName: 'dosya-3.0.9-arm64.dmg' } } }))
      .toBe('Apple Silicon');
  });

  it('claims the narrower support when the manifest says nothing', () => {
    expect(macArchitecture(null)).toBe('Apple Silicon');
    expect(macArchitecture({})).toBe('Apple Silicon');
  });

  /**
   * `snap install dosya` finds nothing while the revision is on candidate,
   * so the channel has to be in the command or the instruction fails.
   */
  it('names the channel while the snap is not on stable', () => {
    expect(snapInstallCommand({ channels: { snap: { channel: 'candidate' } } }))
      .toBe('sudo snap install dosya --candidate');
    expect(snapInstallCommand({ channels: { snap: { channel: 'stable' } } }))
      .toBe('sudo snap install dosya');
  });

  it('offers no snap command when no snap has been published', () => {
    expect(snapInstallCommand(null)).toBeNull();
    expect(snapInstallCommand({ channels: {} })).toBeNull();
  });

  it('formats sizes, and says nothing when the manifest carried none', () => {
    expect(buildSize(251575955)).toBe('252 MB');
    expect(buildSize(120677912)).toBe('121 MB');
    expect(buildSize(1_500_000_000)).toBe('1.5 GB');
    expect(buildSize(0)).toBeNull();
    expect(buildSize(undefined)).toBeNull();
  });
});
