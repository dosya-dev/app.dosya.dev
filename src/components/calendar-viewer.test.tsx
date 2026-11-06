import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';
import { CalendarView } from '@/components/calendar-viewer';
import { describeRule } from '@/lib/calendar-read';
import { parseIcal } from '@/lib/ical.generated';
import { t } from '@/lib/i18n';
import type { FileItem } from '@/lib/file-types';

const ics = (...lines: string[]) => ['BEGIN:VCALENDAR', 'X-WR-CALNAME:Personal', ...lines, 'END:VCALENDAR'].join('\r\n');

// Dates far ahead, so "today" never passes them and the agenda opens on them.
const CALENDAR = ics(
  'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Team standup', 'DTSTART:20990105T090000Z', 'DTEND:20990105T093000Z',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=10', 'LOCATION:Room 4',
  'ORGANIZER;CN=Priya Shah:mailto:priya@example.com',
  'ATTENDEE;PARTSTAT=ACCEPTED;CN=Alex Morgan:mailto:alex@example.com',
  'DESCRIPTION:Join https://meet.google.com/abc-defg-hij',
  'BEGIN:VALARM', 'TRIGGER:-PT10M', 'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Dentist', 'DTSTART;VALUE=DATE:20990107', 'DTEND;VALUE=DATE:20990108', 'END:VEVENT',
);

const file = (name: string, size = 2000): FileItem => ({ id: 'f1', name, mime_type: 'text/calendar', size_bytes: size }) as FileItem;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

let shown: Rendered | null = null;
afterEach(() => { shown?.unmount(); shown = null; vi.unstubAllGlobals(); });

async function show(body: string, name = 'Personal.ics', size?: number) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => body }));
  shown = await renderInLocale(
    <CalendarView file={file(name, size)} rawUrl={`/${name}`} source={<div data-testid="source">SOURCE</div>} oversize={<div>OVERSIZE</div>} />,
    'en',
  );
  await flush();
  await flush();
  return shown.container;
}

const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
};
const buttonWith = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

describe('CalendarView', () => {
  it('lists events as an agenda with the calendar name and count', async () => {
    const root = await show(CALENDAR);
    expect(root.textContent).toContain('Personal');
    expect(root.textContent).toContain('2 events');
    expect(root.textContent).toContain('Team standup');
    expect(root.textContent).toContain('Dentist');
    expect(root.textContent).toContain('All day');
    // Ten weekday standups plus the dentist.
    expect(root.querySelectorAll('button[aria-pressed]').length).toBe(11);
  });

  it('opens an event with its repeat, guests, reminder and call link', async () => {
    const root = await show(CALENDAR);
    await click(buttonWith(root, 'Team standup'));
    const text = root.textContent ?? '';
    expect(text).toContain('Every weekday, 10 times');
    expect(text).toContain('Priya Shah');
    expect(text).toContain('Organizer');
    expect(text).toContain('Going');
    expect(text).toContain('Reminder 10 minutes before');
    expect(root.querySelector('a[href="https://meet.google.com/abc-defg-hij"]')?.textContent).toBe('Join call');
  });

  it('filters by search and switches to the month grid and the source', async () => {
    const root = await show(CALENDAR);
    const input = root.querySelector<HTMLInputElement>('input[type=search]')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, 'dent');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(root.textContent).toContain('Dentist');
    expect(root.textContent).not.toContain('Team standup');

    await click([...root.querySelectorAll('[role=tab]')].find((b) => b.textContent === 'source'));
    expect(root.querySelector('[data-testid=source]')).toBeTruthy();
  });

  it('shows a file with one event as a card', async () => {
    const root = await show(ics('BEGIN:VEVENT', 'UID:x', 'SUMMARY:Flight QF 512', 'DTSTART:20990301T204000Z', 'DTEND:20990301T221500Z', 'END:VEVENT'), 'invite.ics');
    expect(root.textContent).toContain('Flight QF 512');
    expect(root.textContent).toContain('Add to Google Calendar');
    expect(root.querySelector('[role=tab]')).toBeTruthy();
  });

  it('falls back to the source for a file with no events, and to the oversize card for a huge one', async () => {
    let root = await show('just some text', 'notes.ics');
    expect(root.querySelector('[data-testid=source]')).toBeTruthy();
    shown?.unmount(); shown = null;
    root = await show(CALENDAR, 'big.ics', 50 * 1024 * 1024);
    expect(root.textContent).toContain('OVERSIZE');
  });
});

describe('describeRule', () => {
  const rule = (rrule: string) => {
    const cal = parseIcal(ics('BEGIN:VEVENT', 'UID:x', 'SUMMARY:x', 'DTSTART:20261102T090000Z', `RRULE:${rrule}`, 'END:VEVENT'));
    const ev = cal.events[0];
    return describeRule(ev.rule!, ev.start, t);
  };
  it('says common repeats in words', () => {
    expect(rule('FREQ=DAILY;INTERVAL=2')).toBe('Every 2 days');
    expect(rule('FREQ=WEEKLY;BYDAY=MO,TH')).toBe('Every week on Monday and Thursday');
    expect(rule('FREQ=MONTHLY;BYDAY=2TU')).toBe('Every month on the second Tuesday');
    expect(rule('FREQ=MONTHLY;BYDAY=-1FR')).toBe('Every month on the last Friday');
    expect(rule('FREQ=MONTHLY;BYMONTHDAY=-1')).toBe('Every month on the last day');
    expect(rule('FREQ=YEARLY')).toBe('Every year on November 2');
    expect(rule('FREQ=HOURLY')).toBe('Repeats');
    expect(rule('FREQ=DAILY;UNTIL=20261218T235959Z')).toBe('Every day, until December 18, 2026');
  });
});
