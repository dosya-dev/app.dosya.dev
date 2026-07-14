import { createHeicCache, type HeicDecoder, type HeicRequest } from '@/lib/heic-cache';

interface WorkerReply {
  id: number;
  blob?: Blob;
  error?: string;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>();

/** Created lazily, so a session that never opens a HEIC never spawns a worker. */
function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL('./heic.worker.ts', import.meta.url), { type: 'module' });

  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const { id, blob, error } = e.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error !== undefined || !blob) entry.reject(new Error(error ?? 'HEIC decode failed'));
    else entry.resolve(blob);
  };

  worker.onerror = () => {
    // The worker itself died (e.g. the WASM chunk failed to load). Fail every
    // in-flight decode rather than leaving callers hanging forever.
    for (const entry of pending.values()) entry.reject(new Error('HEIC decoder crashed'));
    pending.clear();
    // The error may not have been fatal to the underlying thread (e.g. an
    // uncaught async rejection inside the worker); terminate explicitly so
    // it can't keep running as an orphan after we drop our only reference.
    worker?.terminate();
    worker = null;
  };

  worker.onmessageerror = () => {
    // A posted message failed structured-clone deserialization. We can't tell
    // which in-flight request it belonged to, so fail them all rather than
    // leaving the corresponding caller(s) hanging forever. Mirrors onerror:
    // discard this worker (terminate + null) so a future call starts fresh.
    for (const entry of pending.values()) entry.reject(new Error('HEIC decoder message error'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };

  return worker;
}

const workerDecode: HeicDecoder = (url, maxDim) =>
  new Promise<Blob>((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, url, maxDim });
  });

// One worker, and the cache admits at most 3 decodes at a time; the worker then
// processes them serially. That's deliberate — it bounds both CPU and the number
// of full-size originals held in memory at once.
const cache = createHeicCache({ decoder: workerDecode });

/** Resolves to an object URL for a decoded, downscaled preview of a HEIC file. */
export function getHeicPreviewUrl(req: HeicRequest): Promise<string> {
  return cache.get(req);
}
