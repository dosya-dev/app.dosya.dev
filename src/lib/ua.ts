export interface ParsedUA {
  browser: string;
  os: string;
}

/** Lightweight user-agent → browser/OS. Client-side, no dependency. */
export function parseUA(ua: string | null | undefined): ParsedUA {
  if (!ua) return { browser: "Unknown", os: "" };

  let os = "";
  if (/Windows NT/.test(ua)) os = "Windows";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";

  // Order matters: Edge/Opera UAs also contain "Chrome"; Chrome UAs contain "Safari".
  let m: RegExpMatchArray | null;
  let browser = "Unknown";
  if ((m = ua.match(/Edg\/(\d+)/))) browser = `Edge ${m[1]}`;
  else if ((m = ua.match(/OPR\/(\d+)/))) browser = `Opera ${m[1]}`;
  else if ((m = ua.match(/Firefox\/(\d+)/))) browser = `Firefox ${m[1]}`;
  else if ((m = ua.match(/Chrome\/(\d+)/))) browser = `Chrome ${m[1]}`;
  else if ((m = ua.match(/Version\/(\d+)[.\d]*\s+.*Safari/))) browser = `Safari ${m[1]}`;
  else if (/Safari/.test(ua)) browser = "Safari";

  return { browser, os };
}
