import { blake3 } from '@noble/hashes/blake3';
import { equalBytes, toHex } from './cid.js';

/*
| Hashes a stream of bytes as it arrives, so a multi-gigabyte file never sits
| in memory. `keep` > 0 also collects the bytes (for a preview) while they stay
| under that many; it is dropped the moment they go over. Past `limit` bytes
| the download stops: it can no longer match, so the rest is never fetched.
*/
export async function hashStream(body, { onProgress, signal, keep = 0, limit = Infinity } = {}) {
  const reader = body.getReader();
  const hasher = blake3.create({});
  let bytes = 0;
  let kept = keep > 0 ? [] : null;
  try {
    for (;;) {
      if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      bytes += value.length;
      if (kept) {
        if (bytes > keep) kept = null;
        else kept.push(value);
      }
      if (onProgress) onProgress(bytes);
      if (bytes > limit) {
        kept = null;
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { hash: hasher.digest(), bytes, kept };
}

// Did these bytes come from exactly the file the CID names?
export function compare(expected, got) {
  const hashOk = equalBytes(expected.hash, got.hash);
  const sizeOk = expected.size === got.bytes;
  return { ok: hashOk && sizeOk, hashOk, sizeOk, gotHashHex: toHex(got.hash), gotBytes: got.bytes };
}

export async function verifyUrl(url, expected, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`The file server answered ${res.status}`);
  if (!res.body) throw new Error('This browser cannot stream the download');
  const got = await hashStream(res.body, { ...opts, limit: expected.size });
  return { ...compare(expected, got), kept: got.kept };
}

export async function verifyFile(file, expected, opts = {}) {
  const got = await hashStream(file.stream(), { ...opts, limit: expected.size });
  return { ...compare(expected, got), kept: got.kept };
}

// Only pictures the browser can show safely; the CID carries no media type.
// A verified video can be played from the bytes already in memory.
export function sniffVideo(bytes) {
  const b = bytes;
  if (b.length > 12 && String.fromCharCode(...b.slice(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...b.slice(8, 12));
    // AVIF and HEIC pictures share MP4's container.
    if (['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1'].includes(brand)) return null;
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  return null;
}

export function sniffImage(bytes) {
  const b = bytes;
  if (b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
