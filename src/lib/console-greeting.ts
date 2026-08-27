// Logs on every load rather than trying to detect an opened DevTools panel -
// that detection is unreliable across browsers and reads as fingerprinting.
// A message that is simply always there, invisible until the console is
// opened, gets the same result honestly.

const BUG_BOUNTY_URL = 'https://dosya.dev/bug-bounty';

interface GreetingLine {
  text: string;
  style?: string;
}

const GREETING_LINES: GreetingLine[] = [
  { text: 'dosya.dev', style: 'color:#5fb0ff;font-weight:800;font-size:20px;' },
  { text: '' },
  { text: 'Poking around in here? We like that.' },
  { text: '' },
  { text: 'If you spot something that shouldn’t be possible -' },
  { text: 'an access-control gap, a bypass, anything - we’d' },
  { text: 'rather hear it from you first.' },
  { text: '' },
  { text: 'Our bug bounty program:' },
  { text: BUG_BOUNTY_URL, style: 'color:#5fb0ff;font-weight:700;' },
  { text: '' },
  { text: 'Scope, rules of engagement, and safe harbor are all there.', style: 'color:#7d8590;' },
];

export function logConsoleGreeting(): void {
  for (const line of GREETING_LINES) {
    if (line.style) console.log(`%c${line.text}`, line.style);
    else console.log(line.text);
  }
}
