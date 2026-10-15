import test from 'node:test';
import assert from 'node:assert';
import { parseCid, buildRawCid, b58encode, b58decode, b32encode, b32decode, b64urlEncode, b64urlDecode } from '../src/cid.js';

// Real CIDs a live s5-dart node returned for Serey files.
const CID_A = 'z2H72Rjmp9QkiGfccgpNhFPWN1F8DF3tWCcRjGZfi1aGYAVZK1qK';
const CID_B = 'z6e5Pk2Lwe3BhoftarcmHTuXjQafAXNczeZSWSpbu8M2TJEDpmZeT';

test('a real CID decodes to its size, hash and node key', () => {
  const r = parseCid(CID_A);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.size, 184534);
  assert.strictEqual(r.hashHex.length, 64);
  assert.ok(r.hashHex.startsWith('30cd57abcc3a7259'));
  // The key the storage API's /blob route and the S5 node both use.
  assert.strictEqual(r.key, 'HzDNV6vMOnJZ0saWLlw1ZToHWmndPxZ_iy_XROpjkNps');
});

test('rebuilding a real CID from its hash and size gives it back', () => {
  for (const cid of [CID_A, CID_B]) {
    const r = parseCid(cid);
    assert.strictEqual(buildRawCid(r.hash, r.size), cid);
  }
});

test('sizes round-trip, including the awkward ones', () => {
  const hash = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  for (const size of [0, 1, 255, 256, 65535, 65536, 2 ** 31, 2 ** 40, 2 ** 52]) {
    const r = parseCid(buildRawCid(hash, size));
    assert.strictEqual(r.ok, true, `size ${size}`);
    assert.strictEqual(r.size, size);
    assert.deepStrictEqual([...r.hash], [...hash]);
  }
});

test('the same file in base32 and base64url reads as the same CID', () => {
  const base = parseCid(CID_A);
  for (const form of [base.forms.base32, base.forms.base64url, base.forms.base58]) {
    const r = parseCid(form);
    assert.strictEqual(r.ok, true, form);
    assert.strictEqual(r.size, base.size);
    assert.strictEqual(r.hashHex, base.hashHex);
  }
});

test('a trailing .ext and surrounding space are ignored', () => {
  assert.strictEqual(parseCid(`  ${CID_A}.jpg \n`).size, 184534);
});

test('the encoders agree with themselves on arbitrary bytes', () => {
  for (const len of [0, 1, 2, 3, 31, 32, 33, 40]) {
    const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) % 256);
    assert.deepStrictEqual([...b58decode(b58encode(bytes))], [...bytes]);
    assert.deepStrictEqual([...b32decode(b32encode(bytes))], [...bytes]);
    assert.deepStrictEqual([...b64urlDecode(b64urlEncode(bytes))], [...bytes]);
  }
  // leading zero bytes survive base58
  assert.deepStrictEqual([...b58decode(b58encode(Uint8Array.from([0, 0, 5])))], [0, 0, 5]);
});

test('IPFS CIDs are recognised, not misread', () => {
  const r = parseCid('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.kind, 'ipfs');
});

test('bad input is refused with a reason, and never throws', () => {
  const junk = ['', '   ', 'hello', 'z', 'zOOOO', 'z0000', 'u!!!', 'b1', 'z' + '1'.repeat(80), '../../etc/passwd', '<script>', 'z' + 'a'.repeat(300), null, undefined, 42];
  for (const input of junk) {
    const r = parseCid(input);
    assert.strictEqual(r.ok, false, String(input));
    assert.ok(typeof r.kind === 'string');
  }
});

test('a CID of another type or hash function is named, not verified', () => {
  const otherType = `z${b58encode(Uint8Array.from([0x25, 0x1f, ...new Array(32).fill(7)]))}`;
  const r1 = parseCid(otherType);
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.kind, 'other-type');
  assert.ok(r1.message.includes('0x25'));

  const otherHash = `z${b58encode(Uint8Array.from([0x26, 0x12, ...new Array(32).fill(7), 1]))}`;
  assert.strictEqual(parseCid(otherHash).kind, 'other-hash');
});

test('a hash that is too short or a size that is absurdly long is invalid', () => {
  const short = `z${b58encode(Uint8Array.from([0x26, 0x1f, ...new Array(20).fill(7)]))}`;
  assert.strictEqual(parseCid(short).kind, 'invalid');
  const huge = `z${b58encode(Uint8Array.from([0x26, 0x1f, ...new Array(32).fill(7), 1, 1, 1, 1, 1, 1, 1, 1]))}`;
  assert.strictEqual(parseCid(huge).kind, 'invalid');
});
