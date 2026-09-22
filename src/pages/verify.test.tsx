import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import VerifyPage from './verify';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={['/verify?email=ada%40example.com']}>
        <Routes><Route path="/verify" element={<VerifyPage />} /></Routes>
      </MemoryRouter>,
    );
  });
}

// F7 (field report): "Resend code" was the only way out. Someone whose mail
// never arrives (typo, blocked domain, spam filter) needs a way to reach a
// person and a way to start over with another address.
describe('VerifyPage fallbacks', () => {
  it('offers Contact support (verification topic) and Use a different email', () => {
    mount();
    const links = [...container!.querySelectorAll('a')];
    const support = links.find((a) => a.textContent?.includes('Contact support'));
    expect(support, 'Contact support link').toBeTruthy();
    expect(support!.getAttribute('href')).toContain('/contact?topic=verification');
    const other = links.find((a) => a.textContent?.includes('Use a different email'));
    expect(other, 'Use a different email link').toBeTruthy();
    expect(other!.getAttribute('href')).toBe('/sign-up');
    expect(container!.textContent).toContain("Didn't get the code?");
  });
});
