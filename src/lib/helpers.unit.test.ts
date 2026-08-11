import { describe, it, expect } from "vitest";
import { humanSize, humanSizeShort, timeAgo, timeUntil, initials, extOf, isImage, isHeic, fileIconSrc, isOfficeFile, hiddenTitle } from "./helpers";

describe("humanSize", () => {
  it("formats sizes with the right unit", () => {
    expect(humanSize(0)).toBe("0 B");
    expect(humanSize(1024)).toBe("1 KB");
    expect(humanSize(1048576)).toBe("1.0 MB");
  });
});

describe("humanSizeShort", () => {
  it("does not round sub-megabyte sizes down to '0 MB'", () => {
    // The dashboard reports storage with this. A new account holding 500 KB
    // read "0 MB used", and 40 KB of trash read "0 MB in trash".
    expect(humanSizeShort(0)).toBe("0 B");
    expect(humanSizeShort(512)).toBe("512 B");
    expect(humanSizeShort(40 * 1024)).toBe("40 KB");
    expect(humanSizeShort(1048575)).not.toBe("0 MB");
  });

  it("still uses MB and GB above a megabyte", () => {
    expect(humanSizeShort(1048576)).toBe("1 MB");
    expect(humanSizeShort(250 * 1048576)).toBe("250 MB");
    expect(humanSizeShort(1073741824)).toBe("1.0 GB");
    expect(humanSizeShort(3 * 1073741824)).toBe("3.0 GB");
  });
});

describe("timeAgo", () => {
  const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

  it("uses relative wording inside a week", () => {
    const now = at("2026-07-30T12:00:00Z");
    expect(timeAgo(now - 10, now)).toBe("just now");
    expect(timeAgo(now - 300, now)).toBe("5m ago");
    expect(timeAgo(now - 7200, now)).toBe("2h ago");
    expect(timeAgo(now - 3 * 86400, now)).toBe("3d ago");
  });

  it("includes the year for dates outside the current year", () => {
    // "Jul 23" alone cannot distinguish a 2024 upload from a 2026 one.
    const now = at("2026-07-30T12:00:00Z");
    const twoYearsAgo = at("2024-07-23T12:00:00Z");
    expect(timeAgo(twoYearsAgo, now)).toMatch(/2024/);
  });

  it("omits the year for older dates within the current year", () => {
    const now = at("2026-07-30T12:00:00Z");
    const march = at("2026-03-14T12:00:00Z");
    const label = timeAgo(march, now);
    expect(label).toMatch(/Mar/);
    expect(label).not.toMatch(/2026/);
  });
});

describe("initials", () => {
  it("takes the first letter of the first two names", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
  });
  it("handles a single name", () => {
    expect(initials("Madonna")).toBe("M");
  });
});

describe("extOf", () => {
  it("extracts and lowercases the extension", () => {
    expect(extOf("photo.PNG")).toBe("png");
  });
  it("returns empty string when there is no extension", () => {
    expect(extOf("noext")).toBe("");
  });
});

describe("isImage", () => {
  it("treats heic/heif as images", () => {
    expect(isImage("IMG_0001.heic")).toBe(true);
    expect(isImage("IMG_0001.heif")).toBe(true);
  });

  it("is case-insensitive (iPhones produce .HEIC)", () => {
    expect(isImage("IMG_0001.HEIC")).toBe(true);
  });

  it("still recognizes the existing formats and rejects non-images", () => {
    expect(isImage("a.jpg")).toBe(true);
    expect(isImage("a.png")).toBe(true);
    expect(isImage("a.pdf")).toBe(false);
  });
});

describe("isHeic", () => {
  it("is true only for heic/heif", () => {
    expect(isHeic("IMG_0001.heic")).toBe(true);
    expect(isHeic("IMG_0001.heif")).toBe(true);
  });

  it("is case-insensitive (iPhones produce .HEIC)", () => {
    expect(isHeic("IMG_0001.HEIC")).toBe(true);
  });

  it("is false for every other image format - those render natively in the browser", () => {
    expect(isHeic("a.jpg")).toBe(false);
    expect(isHeic("a.png")).toBe(false);
    expect(isHeic("a.webp")).toBe(false);
    expect(isHeic("a.pdf")).toBe(false);
  });
});

describe("fileIconSrc", () => {
  it("gives heic a photo icon, not the default text icon", () => {
    expect(fileIconSrc("a.heic")).toBe("/file-icons/009-jpg.svg");
  });
});

describe('isOfficeFile', () => {
  it('recognizes office extensions case-insensitively', () => {
    expect(isOfficeFile('a.docx')).toBe(true);
    expect(isOfficeFile('A.XLSX')).toBe(true);
    expect(isOfficeFile('deck.pptx')).toBe(true);
    expect(isOfficeFile('legacy.doc')).toBe(true);
    expect(isOfficeFile('sheet.csv')).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isOfficeFile('pic.jpg')).toBe(false);
    expect(isOfficeFile('notes.txt')).toBe(false);
    expect(isOfficeFile('noext')).toBe(false);
  });

  // Drift guard: mirrors apps/api/src/lib/onlyoffice/formats.ts, whose
  // OFFICE_EDIT_EXTENSIONS + OFFICE_VIEW_EXTENSIONS union is asserted equal
  // to this same sorted list in formats.unit.test.ts. If the two lists ever
  // diverge, the web app and the API disagree on which files open in the
  // ONLYOFFICE editor.
  //
  // There are FOUR copies of this 11-extension list and no shared source of
  // truth, so a change to one must be mirrored in the other three by hand:
  //   1. apps/api/src/lib/onlyoffice/formats.ts (OFFICE_EDIT_EXTENSIONS + OFFICE_VIEW_EXTENSIONS)
  //   2. apps/web/src/lib/helpers.ts (OFFICE_EXTS, isOfficeFile)
  //   3. apps/desktop/src/renderer/lib/file-type.ts (OFFICE_EXTS, isOfficeFile)
  //   4. this test file (the sorted list below)
  // The desktop app has no vitest runner (Playwright only), so its copy
  // cannot be pinned by an assertion - this comment is that pin. If you
  // touch this list, update all four.
  it('is driven by exactly this sorted 11-extension list', () => {
    const extensions = [
      'csv', 'doc', 'docx', 'odp', 'ods', 'odt', 'ppt', 'pptx', 'rtf', 'xls', 'xlsx',
    ];
    expect(extensions).toHaveLength(11);
    for (const ext of extensions) {
      expect(isOfficeFile(`file.${ext}`)).toBe(true);
    }
  });
});

describe('timeUntil', () => {
  const NOW = 1_760_000_000;

  it('counts forward, where timeAgo would say "just now"', () => {
    // The bug this exists to fix: timeAgo(now + 12d) returns "just now",
    // because its diff goes negative for anything in the future.
    expect(timeAgo(NOW + 12 * 86400, NOW)).toBe('just now');
    expect(timeUntil(NOW + 12 * 86400, NOW)).toBe('in 12 days');
  });

  it.each([
    [30, 'in under a minute'],
    [90, 'in 1m'],
    [3 * 3600, 'in 3h'],
    [86400, 'in 1 day'],
    [3 * 86400, 'in 3 days'],
    [59 * 86400, 'in 59 days'],
  ])('formats +%is', (delta, expected) => {
    expect(timeUntil(NOW + delta, NOW)).toBe(expected);
  });

  it('falls back to a date beyond two months, so "in 400 days" never ships', () => {
    expect(timeUntil(NOW + 400 * 86400, NOW)).toMatch(/^[A-Z][a-z]{2} \d+(, \d{4})?$/);
  });

  it.each([0, -1, -86400])('reports an elapsed deadline as Expired (%i)', (delta) => {
    expect(timeUntil(NOW + delta, NOW)).toBe('Expired');
  });
});

describe('hiddenTitle', () => {
  // "Hidden" is never binary from the viewer's own perspective: if they can
  // see the row at all, they're someone it is NOT hidden from. The copy says
  // who ELSE it's hidden from, and warns that hidden items drop out of share
  // links - never "hidden from you".
  it('names everyone specifically for hidden_mode "everyone"', () => {
    expect(hiddenTitle('everyone')).toBe('Hidden from everyone. Not included in share links.');
  });

  it.each(['users', 'roles'])('says "some people" for a targeted hidden_mode (%s)', (mode) => {
    expect(hiddenTitle(mode)).toBe('Hidden from some people. Not included in share links.');
  });
});
