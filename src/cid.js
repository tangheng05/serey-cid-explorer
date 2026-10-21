// S5 content IDs. Layout checked against a live s5-dart node (see
// deploy/s5/README.md in the storage API): multibase prefix, then
// 0x26 (raw file) || 0x1f (BLAKE3) || 32-byte hash || size, little endian.
export const TYPE_RAW = 0x26;
export const HASH_BLAKE3 = 0x1f;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export function b58decode(str) {
  const bytes = [];
  for (const ch of str) {
    const val = B58.indexOf(ch);
    if (val < 0) return null;
    let carry = val;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of str) {
    if (ch !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

export function b32encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function b32decode(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str.toLowerCase()) {
    const val = B32.indexOf(ch);
    if (val < 0) return null;
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) return null;
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  try {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export const fromHex = (hex) => Uint8Array.from(hex.match(/../g) || [], (b) => parseInt(b, 16));
export const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function sizeBytes(size) {
  const out = [];
  let rest = size;
  while (rest > 0) {
    out.push(rest % 256);
    rest = Math.floor(rest / 256);
  }
  return out;
}

function rawBytes(hash, size) {
  return Uint8Array.from([TYPE_RAW, HASH_BLAKE3, ...hash, ...sizeBytes(size)]);
}

// The same CID the storage API writes for a file of this hash and size.
export function buildRawCid(hash, size) {
  return `z${b58encode(rawBytes(hash, size))}`;
}

const IPFS = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{50,})$/;

/*
| Reads what a person pasted. Returns { ok: true, ... } for a file CID, or
| { ok: false, kind, message } with a reason a reader can act on. `CID.ext`
| is accepted and the extension ignored.
*/
export function parseCid(input) {
  const text = String(input || '').trim();
  const [main] = text.split('.');
  if (!main) return { ok: false, kind: 'empty', message: '' };
  if (IPFS.test(main)) {
    return { ok: false, kind: 'ipfs', message: 'This looks like an IPFS CID, not an S5 one.', ipfs: main };
  }

  const decoders = { z: b58decode, b: b32decode, u: b64urlDecode };
  const decode = decoders[main[0]];
  if (!decode) return { ok: false, kind: 'invalid', message: 'Not a CID. S5 CIDs start with z, b or u.' };
  const bytes = decode(main.slice(1));
  if (!bytes || bytes.length < 2) return { ok: false, kind: 'invalid', message: 'Not a valid CID: it has characters that do not belong.' };

  if (bytes[0] !== TYPE_RAW) {
    return {
      ok: false,
      kind: 'other-type',
      message: `This CID has type 0x${bytes[0].toString(16)}. This page checks file CIDs (type 0x26), which are the ones Serey publishes.`,
    };
  }
  if (bytes[1] !== HASH_BLAKE3) {
    return { ok: false, kind: 'other-hash', message: `Unsupported hash function 0x${bytes[1].toString(16)}. S5 file CIDs use BLAKE3 (0x1f).` };
  }
  if (bytes.length < 34 || bytes.length > 34 + 7) {
    return { ok: false, kind: 'invalid', message: 'Not a valid file CID: the length is wrong.' };
  }

  const hash = bytes.slice(2, 34);
  let size = 0;
  for (let i = bytes.length - 1; i >= 34; i -= 1) size = size * 256 + bytes[i];

  return {
    ok: true,
    cid: main,
    size,
    hash,
    hashHex: toHex(hash),
    // What nodes and the public /blob route call this file: base64url of 0x1f || hash.
    key: b64urlEncode(bytes.slice(1, 34)),
    forms: {
      base58: `z${b58encode(bytes)}`,
      base32: `b${b32encode(bytes)}`,
      base64url: `u${b64urlEncode(bytes)}`,
    },
  };
}
