import test from 'node:test';
import assert from 'node:assert';
import { blake3 } from '@noble/hashes/blake3';
import { hashStream, compare, verifyUrl, verifyFile, sniffImage } from '../src/verify.js';
import { buildRawCid, parseCid } from '../src/cid.js';

const bytesOf = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) % 251);

// Delivers `data` in awkward chunk sizes, like a real network does.
const streamOf = (data, chunk) => new ReadableStream({
  start(controller) {
    for (let i = 0; i < data.length; i += chunk) controller.enqueue(data.slice(i, i + chunk));
    controller.close();
  },
});

const expectedFor = (data) => parseCid(buildRawCid(blake3(data), data.length));

test('streaming in any chunk size gives the same hash as hashing at once', async () => {
  const data = bytesOf(100000);
  const whole = Buffer.from(blake3(data)).toString('hex');
  for (const chunk of [1, 7, 1024, 65536, 100000, 200000]) {
    const got = await hashStream(streamOf(data, chunk));
    assert.strictEqual(Buffer.from(got.hash).toString('hex'), whole, `chunk ${chunk}`);
    assert.strictEqual(got.bytes, data.length);
  }
});

test('an empty file hashes like an empty file', async () => {
  const got = await hashStream(streamOf(new Uint8Array(0), 10));
  assert.strictEqual(Buffer.from(got.hash).toString('hex'), 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262');
  assert.strictEqual(got.bytes, 0);
});

test('the bytes match their own CID', async () => {
  const data = bytesOf(5000);
  const res = await verifyUrl('https://x.test/f', expectedFor(data), { fetchImpl: async () => new Response(streamOf(data, 999)) });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.hashOk && res.sizeOk, true);
});

test('one changed byte is caught', async () => {
  const data = bytesOf(5000);
  const tampered = data.slice();
  tampered[2500] ^= 1;
  const res = await verifyUrl('https://x.test/f', expectedFor(data), { fetchImpl: async () => new Response(streamOf(tampered, 999)) });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.hashOk, false);
  assert.strictEqual(res.sizeOk, true);
});

test('a truncated or padded file is caught by its size and hash', async () => {
  const data = bytesOf(5000);
  for (const other of [data.slice(0, 4999), Uint8Array.from([...data, 0])]) {
    const res = await verifyUrl('https://x.test/f', expectedFor(data), { fetchImpl: async () => new Response(streamOf(other, 500)) });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.sizeOk, false);
  }
});

test('a server error is an error, not a mismatch', async () => {
  await assert.rejects(
    () => verifyUrl('https://x.test/f', expectedFor(bytesOf(10)), { fetchImpl: async () => new Response('nope', { status: 404 }) }),
    /404/,
  );
});

test('a file from disk is verified the same way', async () => {
  const data = bytesOf(70000);
  const ok = await verifyFile(new Blob([data]), expectedFor(data));
  assert.strictEqual(ok.ok, true);
  const bad = await verifyFile(new Blob([bytesOf(70001)]), expectedFor(data));
  assert.strictEqual(bad.ok, false);
});

test('progress is reported and a cancel stops the download', async () => {
  const data = bytesOf(50000);
  const seen = [];
  await hashStream(streamOf(data, 10000), { onProgress: (n) => seen.push(n) });
  assert.deepStrictEqual(seen, [10000, 20000, 30000, 40000, 50000]);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => hashStream(streamOf(data, 10000), { signal: controller.signal }), { name: 'AbortError' });
});

test('bytes are kept for a preview only while they stay small', async () => {
  const data = bytesOf(3000);
  assert.strictEqual((await hashStream(streamOf(data, 1000), { keep: 5000 })).kept.length, 3);
  assert.strictEqual((await hashStream(streamOf(data, 1000), { keep: 2000 })).kept, null, 'over the limit: dropped');
  assert.strictEqual((await hashStream(streamOf(data, 1000))).kept, null, 'off by default');
});

test('only real pictures are recognised', () => {
  assert.strictEqual(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d])), 'image/png');
  assert.strictEqual(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.strictEqual(sniffImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39])), 'image/gif');
  assert.strictEqual(sniffImage(new TextEncoder().encode('RIFF1234WEBPVP8 ')), 'image/webp');
  assert.strictEqual(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>')), null, 'svg is never drawn');
  assert.strictEqual(sniffImage(new Uint8Array(0)), null);
});

test('compare reports hash and size separately', () => {
  const exp = expectedFor(bytesOf(10));
  assert.deepStrictEqual(
    (({ ok, hashOk, sizeOk }) => ({ ok, hashOk, sizeOk }))(compare(exp, { hash: exp.hash, bytes: 11 })),
    { ok: false, hashOk: true, sizeOk: false },
  );
});
