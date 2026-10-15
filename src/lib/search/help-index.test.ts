import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
const { fetchHelpIndex, helpSearchUrl } = await import('./help-index');

beforeEach(() => apiMock.mockReset());

describe('help index', () => {
  it('maps articles to external help search items', async () => {
    apiMock.mockResolvedValue({ ok: true, articles: [
      { slug: 'api-key', category: 'developers', title: 'Creating and managing an API key', summary: 'Generate a key', keywords: ['token'] },
    ] });
    const items = await fetchHelpIndex();
    expect(apiMock).toHaveBeenCalledWith('/api/help/index');
    expect(items).toEqual([{
      id: 'help:developers/api-key', kind: 'help', title: 'Creating and managing an API key',
      summary: 'Generate a key', context: 'help.dosya.dev', keywords: ['token'],
      href: 'https://help.dosya.dev/developers/api-key', external: true,
    }]);
  });
  it('keeps only string keywords', async () => {
    apiMock.mockResolvedValue({ ok: true, articles: [{ slug: 'k', category: 'c', title: 'T', summary: 'S', keywords: ['ok', 3, null] }] });
    expect((await fetchHelpIndex())[0].keywords).toEqual(['ok']);
  });
  it('drops malformed rows and tolerates a missing list', async () => {
    apiMock.mockResolvedValue({ ok: true, articles: [{ slug: 'x' }, null] });
    expect(await fetchHelpIndex()).toEqual([]);
    apiMock.mockResolvedValue({ ok: true });
    expect(await fetchHelpIndex()).toEqual([]);
  });
  it('rejects when the request fails, so the query is marked errored', async () => {
    apiMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    await expect(fetchHelpIndex()).rejects.toThrow('offline');
  });
  it('builds an encoded help-center search URL', () => {
    expect(helpSearchUrl('reset password & 2fa')).toBe('https://help.dosya.dev/search?q=reset%20password%20%26%202fa');
  });
});
