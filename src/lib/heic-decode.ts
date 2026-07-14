export interface DecodedHeic {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface HeifImage {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    callback: (out: unknown) => void
  ): void;
}

interface HeifDecoder {
  decode(bytes: ArrayBuffer | Uint8Array): HeifImage[];
}

interface LibheifModule {
  HeifDecoder: new () => HeifDecoder;
}

/**
 * Decodes a HEIC/HEIF image into raw RGBA pixel data using `libheif-js`'s real
 * WebAssembly build (`libheif-js/wasm-bundle`) — ~2.3x faster and half the
 * bundle size of the asm.js (`wasm2js`) transpile that `heic-to` ships.
 *
 * Kept as a dynamic import so the ~1.4MB decoder is only ever fetched by
 * callers that actually need it (i.e. code-split out of the worker chunk).
 */
export async function decodeHeicToRgba(bytes: ArrayBuffer | Uint8Array): Promise<DecodedHeic> {
  const mod = await import('libheif-js/wasm-bundle');
  // Interop: bundlers may hand back the module namespace directly, or wrap
  // the CJS export under `.default` — handle both.
  const lib = ((mod as { default?: LibheifModule }).default ?? mod) as LibheifModule;

  // Normalize to a same-realm Uint8Array. `bytes` may be a typed array
  // constructed in a different realm than this module (e.g. a Node `Buffer`
  // handed in from a `vm.Context`-isolated test runner) — the wasm glue's
  // internal `instanceof Uint8Array` checks use *this* realm's constructor,
  // so a foreign-realm view fails them silently and gets mis-marshalled.
  // Constructing fresh from it (array-like copy) always yields a local one;
  // for a real same-realm ArrayBuffer (the normal browser path) this is a
  // zero-copy view.
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(view);
  if (!images || images.length === 0) {
    throw new Error('HEIC decode produced no images');
  }

  const img = images[0];
  const width = img.get_width();
  const height = img.get_height();
  const data = new Uint8ClampedArray(width * height * 4);

  // display() is callback-based, not promise-based — wrap it.
  await new Promise<void>((resolve, reject) => {
    img.display({ data, width, height }, (out) => (out ? resolve() : reject(new Error('HEIC display() failed'))));
  });

  return { data, width, height };
}
