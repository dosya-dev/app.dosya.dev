import { describe, it, expect } from 'vitest';
import { parseVCards, serializeVCards, applyEdits } from './vcard';

// A realistic single-contact vCard as an iPhone exports it (v3.0, CRLF).
const IPHONE_VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Doe;John;;;',
  'FN:John Doe',
  'ORG:Acme Inc.;',
  'TITLE:Product Lead',
  'TEL;type=CELL;type=VOICE;type=pref:+1 555 0134',
  'TEL;type=WORK;type=VOICE:+1 555 0199',
  'EMAIL;type=INTERNET;type=HOME;type=pref:john@acme.com',
  'item1.ADR;type=HOME;type=pref:;;123 Main St;Springfield;IL;62704;USA',
  'URL;type=pref:https\\://acme.com',
  'BDAY:1990-03-04',
  'NOTE:Met at conf.',
  'END:VCARD',
].join('\r\n');

describe('parseVCards', () => {
  it('extracts the full name, org and title', () => {
    const [c] = parseVCards(IPHONE_VCARD);
    expect(c.fullName).toBe('John Doe');
    expect(c.org).toBe('Acme Inc.');
    expect(c.title).toBe('Product Lead');
  });

  it('extracts phones with a friendly type label', () => {
    const [c] = parseVCards(IPHONE_VCARD);
    expect(c.phones).toEqual([
      { type: 'mobile', value: '+1 555 0134' },
      { type: 'work', value: '+1 555 0199' },
    ]);
  });

  it('extracts emails with type', () => {
    const [c] = parseVCards(IPHONE_VCARD);
    expect(c.emails).toEqual([{ type: 'home', value: 'john@acme.com' }]);
  });

  it('formats the address into a readable one-line string', () => {
    const [c] = parseVCards(IPHONE_VCARD);
    expect(c.addresses[0].value).toBe('123 Main St, Springfield, IL 62704, USA');
  });

  it('unescapes escaped characters in values (URL colon)', () => {
    const [c] = parseVCards(IPHONE_VCARD);
    expect(c.urls).toEqual(['https://acme.com']);
  });

  it('reads birthday and note', () => {
    const [c] = parseVCards(IPHONE_VCARD);
    expect(c.birthday).toBe('1990-03-04');
    expect(c.note).toBe('Met at conf.');
  });

  it('parses multiple contacts from one file', () => {
    const two = IPHONE_VCARD + '\r\n' + [
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:Jane Smith', 'TEL:+1 555 7777', 'END:VCARD',
    ].join('\r\n');
    const cards = parseVCards(two);
    expect(cards).toHaveLength(2);
    expect(cards[1].fullName).toBe('Jane Smith');
  });

  it('unfolds soft-wrapped lines (RFC 6350: CRLF + one space removed)', () => {
    // Real folding splits mid-content; the leading space on each continuation is
    // the fold marker and is removed, reconstructing the exact original.
    const folded = [
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:John Doe',
      'NOTE:This is a very long note that was fol',
      ' ded across three li',
      ' nes.',
      'END:VCARD',
    ].join('\r\n');
    const [c] = parseVCards(folded);
    expect(c.note).toBe('This is a very long note that was folded across three lines.');
  });

  it('decodes an embedded base64 photo into a data URL', () => {
    const withPhoto = [
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:John Doe',
      'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQ==',
      'END:VCARD',
    ].join('\r\n');
    const [c] = parseVCards(withPhoto);
    expect(c.photo?.dataUrl).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==');
  });

  it('accepts an already-data-URL photo (v4 style)', () => {
    const withPhoto = [
      'BEGIN:VCARD', 'VERSION:4.0', 'FN:John Doe',
      'PHOTO:data:image/png;base64,iVBORw0KGgo=',
      'END:VCARD',
    ].join('\r\n');
    const [c] = parseVCards(withPhoto);
    expect(c.photo?.dataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
});

describe('serializeVCards (round-trip)', () => {
  it('re-serializes an unedited card preserving all fields', () => {
    const cards = parseVCards(IPHONE_VCARD);
    const out = serializeVCards(cards);
    // Data-preserving (not necessarily byte-identical): every field survives.
    expect(out).toMatch(/^BEGIN:VCARD/);
    expect(out).toMatch(/\r\nEND:VCARD/);
    expect(out).toContain('FN:John Doe');
    expect(out).toContain('ORG:Acme Inc.');
    expect(out).toContain('TITLE:Product Lead');
    expect(out).toContain('+1 555 0134');
    expect(out).toContain('john@acme.com');
    expect(out).toContain('NOTE:Met at conf.');
    // re-parsing the output yields the same structured contact
    const [again] = parseVCards(out);
    expect(again.fullName).toBe('John Doe');
    expect(again.phones).toHaveLength(2);
    expect(again.note).toBe('Met at conf.');
  });

  it('folds lines longer than 75 octets', () => {
    const longNote = 'x'.repeat(200);
    const card = parseVCards(['BEGIN:VCARD', 'VERSION:3.0', 'FN:A', `NOTE:${longNote}`, 'END:VCARD'].join('\r\n'));
    const out = serializeVCards(card);
    const lines = out.split('\r\n');
    expect(lines.every((l) => Buffer.byteLength(l, 'utf8') <= 75)).toBe(true);
    // and it still round-trips
    expect(parseVCards(out)[0].note).toBe(longNote);
  });
});

describe('applyEdits', () => {
  it('updates the name and keeps other fields intact', () => {
    const [c] = parseVCards(IPHONE_VCARD);
    const edited = applyEdits(c, { fullName: 'Johnny Doe' });
    expect(edited.fullName).toBe('Johnny Doe');
    const out = serializeVCards([edited]);
    expect(out).toContain('FN:Johnny Doe');
    expect(out).not.toContain('FN:John Doe');
    // untouched fields preserved
    expect(out).toContain('ORG:Acme Inc.');
    expect(out).toContain('NOTE:Met at conf.');
    expect(out).toContain('john@acme.com');
  });

  it('replaces phones (add/remove) and preserves emails', () => {
    const [c] = parseVCards(IPHONE_VCARD);
    const edited = applyEdits(c, {
      phones: [
        { type: 'mobile', value: '+1 555 0134' },
        { type: 'home', value: '+1 555 2222' },
      ],
    });
    expect(edited.phones).toHaveLength(2);
    const out = serializeVCards([edited]);
    expect(out).toContain('+1 555 2222');
    expect(out).not.toContain('+1 555 0199'); // old work number removed
    expect(out).toContain('john@acme.com');   // email untouched
  });

  it('updates emails without touching phones', () => {
    const [c] = parseVCards(IPHONE_VCARD);
    const edited = applyEdits(c, { emails: [{ type: 'work', value: 'jd@acme.com' }] });
    const out = serializeVCards([edited]);
    expect(out).toContain('jd@acme.com');
    expect(out).not.toContain('john@acme.com');
    expect(out).toContain('+1 555 0134'); // phones untouched
  });
});
