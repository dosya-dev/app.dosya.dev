/// <reference lib="webworker" />

interface DecodeRequest {
  id: number;
  url: string;
  maxDim: number;
}

async function toBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    // Safari decodes HEIC natively, so it never pays for the WASM at all.
    return await createImageBitmap(blob);
  } catch {
    // Everyone else: ~1.5MB of libheif, fetched only now — i.e. only when a HEIC
    // is actually on screen in a browser that can't decode it.
    const { heicTo } = await import('heic-to/next');
    return (await heicTo({ blob, type: 'bitmap' })) as ImageBitmap;
  }
}

async function decode(url: string, maxDim: number): Promise<Blob> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to fetch HEIC: HTTP ${res.status}`);

  const bitmap = await toBitmap(await res.blob());
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);

    // Downscale before encoding: a full-size 12MP RGBA bitmap is ~48MB, and a
    // grid can hold dozens. Only the small JPEG is ever handed back.
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const { id, url, maxDim } = e.data;
  try {
    const blob = await decode(url, maxDim);
    self.postMessage({ id, blob });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
