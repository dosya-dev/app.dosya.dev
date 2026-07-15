// Minimal, dependency-free vCard (.vcf) parser/serializer for the contact viewer.
// Values are stored ESCAPED (as in the source) so serialize can re-emit them
// verbatim; display extraction unescapes on read. Unedited properties round-trip
// via their original raw line; edited/added ones are rebuilt.

export interface VProp {
  name: string;                        // base name, uppercased (group stripped), e.g. "TEL"
  group: string | null;               // "item1" for grouped lines, else null
  params: Record<string, string[]>;   // uppercased keys → values
  value: string;                       // escaped, as in the source
  raw: string | null;                 // original unfolded line, or null when rebuilt
}

export interface VPhone { type: string; value: string; }
export interface VEmail { type: string; value: string; }
export interface VAddress { type: string; value: string; }

export interface ParsedVCard {
  fullName: string;
  org: string | null;
  title: string | null;
  phones: VPhone[];
  emails: VEmail[];
  addresses: VAddress[];
  urls: string[];
  birthday: string | null;
  note: string | null;
  photo: { dataUrl: string } | null;
  props: VProp[];
}

const CRLF = '\r\n';

// ── text escaping ──────────────────────────────────────────
function unescapeText(s: string): string {
  return s.replace(/\\([\\nN,;:])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}
function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
// Split a structured value (N, ORG, ADR) on unescaped ';', then unescape each part.
function splitStructured(value: string): string[] {
  return value.split(/(?<!\\);/).map(unescapeText);
}

// ── line unfolding ─────────────────────────────────────────
function unfold(text: string): string[] {
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

// ── property parsing ───────────────────────────────────────
function parseParams(segments: string[]): Record<string, string[]> {
  const params: Record<string, string[]> = {};
  const add = (k: string, v: string) => {
    const key = k.toUpperCase();
    (params[key] ??= []).push(v.replace(/^"|"$/g, ''));
  };
  for (const seg of segments) {
    const eq = seg.indexOf('=');
    if (eq === -1) {
      if (seg) add('TYPE', seg); // v2.1 bare type, e.g. TEL;HOME;VOICE
    } else {
      const key = seg.slice(0, eq);
      for (const v of seg.slice(eq + 1).split(',')) add(key, v);
    }
  }
  return params;
}

function parseLine(line: string): VProp | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segments = head.split(';');
  let nameSeg = segments[0];
  let group: string | null = null;
  const dot = nameSeg.indexOf('.');
  if (dot !== -1) {
    group = nameSeg.slice(0, dot);
    nameSeg = nameSeg.slice(dot + 1);
  }
  return {
    name: nameSeg.toUpperCase(),
    group,
    params: parseParams(segments.slice(1)),
    value,
    raw: line,
  };
}

// ── type labels ────────────────────────────────────────────
function phoneType(types: string[]): string {
  const U = types.map((t) => t.toUpperCase());
  if (U.some((t) => t === 'CELL' || t === 'MOBILE' || t === 'IPHONE')) return 'mobile';
  if (U.includes('WORK')) return 'work';
  if (U.includes('HOME')) return 'home';
  if (U.includes('FAX')) return 'fax';
  if (U.includes('MAIN')) return 'main';
  const m = U.find((t) => !['VOICE', 'PREF', 'INTERNET', 'CANONICAL'].includes(t));
  return m ? m.toLowerCase() : 'other';
}
function emailType(types: string[]): string {
  const U = types.map((t) => t.toUpperCase());
  if (U.includes('HOME')) return 'home';
  if (U.includes('WORK')) return 'work';
  const m = U.find((t) => !['INTERNET', 'PREF'].includes(t));
  return m ? m.toLowerCase() : 'other';
}
function typeToParam(type: string): string | null {
  const map: Record<string, string> = { mobile: 'CELL', home: 'HOME', work: 'WORK', fax: 'FAX', main: 'MAIN' };
  if (map[type]) return map[type];
  if (!type || type === 'other') return null;
  return type.toUpperCase();
}

function photoDataUrl(prop: VProp): string {
  if (prop.value.startsWith('data:')) return prop.value;
  const t = (prop.params.TYPE?.[0] ?? 'JPEG').toUpperCase();
  const mime = t.includes('PNG') ? 'image/png' : t.includes('GIF') ? 'image/gif' : t.includes('WEBP') ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${prop.value}`;
}

function formatAddress(value: string): string {
  const [po, ext, street, city, region, postal, country] = splitStructured(value);
  const streetLine = [po, ext, street].filter(Boolean).join(' ');
  const cityLine = [city, [region, postal].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ');
  return [streetLine, cityLine, country].filter(Boolean).join(', ');
}

// ── build the display view from raw props ──────────────────
function fromProps(props: VProp[]): ParsedVCard {
  const first = (name: string) => props.find((p) => p.name === name);
  const all = (name: string) => props.filter((p) => p.name === name);

  let fullName = first('FN') ? unescapeText(first('FN')!.value) : '';
  if (!fullName && first('N')) {
    const [family, given] = splitStructured(first('N')!.value);
    fullName = [given, family].filter(Boolean).join(' ').trim();
  }
  const orgProp = first('ORG');
  const org = orgProp ? (splitStructured(orgProp.value).find(Boolean) ?? null) : null;
  const photoProp = first('PHOTO');

  return {
    fullName,
    org,
    title: first('TITLE') ? unescapeText(first('TITLE')!.value) : null,
    phones: all('TEL').map((p) => ({ type: phoneType(p.params.TYPE ?? []), value: unescapeText(p.value) })),
    emails: all('EMAIL').map((p) => ({ type: emailType(p.params.TYPE ?? []), value: unescapeText(p.value) })),
    addresses: all('ADR').map((p) => ({ type: phoneType(p.params.TYPE ?? []), value: formatAddress(p.value) })),
    urls: all('URL').map((p) => unescapeText(p.value)),
    birthday: first('BDAY') ? unescapeText(first('BDAY')!.value) : null,
    note: first('NOTE') ? unescapeText(first('NOTE')!.value) : null,
    photo: photoProp ? { dataUrl: photoDataUrl(photoProp) } : null,
    props,
  };
}

// ── public API ─────────────────────────────────────────────
export function parseVCards(text: string): ParsedVCard[] {
  const lines = unfold(text);
  const cards: ParsedVCard[] = [];
  let cur: VProp[] | null = null;
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === 'BEGIN:VCARD') { cur = []; continue; }
    if (upper === 'END:VCARD') { if (cur) cards.push(fromProps(cur)); cur = null; continue; }
    if (cur === null) continue;
    const prop = parseLine(line);
    if (prop) cur.push(prop);
  }
  if (cur && cur.length) cards.push(fromProps(cur)); // tolerate a missing END
  return cards;
}

function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  let isCont = false;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const max = 75 - (isCont ? 1 : 0);
    if (curBytes + b > max && cur !== '') {
      out.push((isCont ? ' ' : '') + cur);
      isCont = true;
      cur = ch;
      curBytes = b;
    } else {
      cur += ch;
      curBytes += b;
    }
  }
  out.push((isCont ? ' ' : '') + cur);
  return out.join(CRLF);
}

function serializeProp(p: VProp): string {
  if (p.raw !== null) return foldLine(p.raw);
  let head = (p.group ? p.group + '.' : '') + p.name;
  for (const [k, vals] of Object.entries(p.params)) {
    for (const v of vals) head += `;${k}=${v}`;
  }
  return foldLine(`${head}:${p.value}`);
}

export function serializeVCards(cards: ParsedVCard[]): string {
  return cards.map((card) => {
    const hasVersion = card.props.some((p) => p.name === 'VERSION');
    const body: string[] = ['BEGIN:VCARD'];
    if (!hasVersion) body.push('VERSION:3.0');
    for (const p of card.props) body.push(serializeProp(p));
    body.push('END:VCARD');
    return body.join(CRLF);
  }).join(CRLF);
}

// ── editing (basics: name, phones, emails) ─────────────────
export function applyEdits(
  card: ParsedVCard,
  edits: { fullName?: string; phones?: VPhone[]; emails?: VEmail[] },
): ParsedVCard {
  let props = card.props.map((p) => ({ ...p }));

  if (edits.fullName !== undefined) {
    const fnProp: VProp = { name: 'FN', group: null, params: {}, value: escapeText(edits.fullName), raw: null };
    const idx = props.findIndex((p) => p.name === 'FN');
    if (idx === -1) props.unshift(fnProp);
    else props[idx] = fnProp;
  }

  const rebuild = (kind: 'TEL' | 'EMAIL', items: { type: string; value: string }[]) => {
    const at = props.findIndex((p) => p.name === kind);
    props = props.filter((p) => p.name !== kind);
    const built: VProp[] = items
      .filter((it) => it.value.trim() !== '')
      .map((it): VProp => {
        const param = typeToParam(it.type);
        const params: Record<string, string[]> = param ? { TYPE: [param] } : {};
        return { name: kind, group: null, params, value: escapeText(it.value.trim()), raw: null };
      });
    const insertAt = at === -1 ? props.length : at;
    props.splice(insertAt, 0, ...built);
  };

  if (edits.phones !== undefined) rebuild('TEL', edits.phones);
  if (edits.emails !== undefined) rebuild('EMAIL', edits.emails);

  return fromProps(props);
}
