import test from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { blake3 } from '@noble/hashes/blake3';
import { buildRawCid, parseCid } from '../src/cid.js';

// The real bundle, in a simulated browser, with a faked network.
const bundle = (await build({ entryPoints: ['src/main.js'], bundle: true, write: false, format: 'iife', target: 'es2020' })).outputFiles[0].text;
const html = await readFile('index.html', 'utf8');

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 2000 }, (_, i) => (i * 13) % 256)]);
const cidOf = (bytes) => buildRawCid(blake3(bytes), bytes.length);

// answers: { node: locations body | status number, blob: bytes | status number }
function network({ serey, garden, blob }) {
  const calls = [];
  const fetchFake = async (url) => {
    calls.push(String(url));
    const json = (v) => (typeof v === 'number' ? new Response('', { status: v }) : new Response(JSON.stringify(v)));
    if (String(url).startsWith('https://s5.serey.io/')) return json(serey);
    if (String(url).startsWith('https://s5.garden/')) return json(garden);
    if (String(url).startsWith('https://storage.serey.io/blob/')) return typeof blob === 'number' ? new Response('', { status: blob }) : new Response(blob);
    throw new Error(`unexpected request: ${url}`);
  };
  return { fetchFake, calls };
}

const location = (key, extra = {}) => ({ locations: [{ type: 3, parts: [`https://storage.serey.io/blob/1/${key}`], expiry: Math.floor(Date.now() / 1000) + 86400 * 3, nodeId: 'z2DXAXfpQUWWjMxxC6nu15PAN2g73pYy3EUVFq3bDddZdSb', score: 1, ...extra }] });

async function open(hash, net, { path = '' } = {}) {
  const dom = new JSDOM(html, { url: `https://cid.serey.io/${path}${hash ? `#${hash}` : ''}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = net.fetchFake;
  window.URL.createObjectURL = () => 'blob:preview';
  window.URL.revokeObjectURL = () => {};
  window.eval(bundle);
  const doc = window.document;
  return {
    window,
    doc,
    text: () => doc.getElementById('output').textContent,
    button: (label) => [...doc.querySelectorAll('button')].find((b) => b.textContent.includes(label)),
    type: (value) => { const el = doc.getElementById('cid-input'); el.value = value; el.dispatchEvent(new window.Event('input')); },
  };
}

async function until(check, what, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`timed out waiting for: ${what}`);
}

test('a CID in the link opens straight onto its details and storage', async () => {
  const cid = cidOf(PNG);
  const parsed = parseCid(cid);
  const net = network({ serey: location(parsed.key), garden: location(parsed.key), blob: PNG });
  const page = await open(cid, net);

  assert.strictEqual(page.doc.getElementById('intro').hidden, true, 'the explainer steps aside');
  await until(() => page.text().includes('Other S5 nodes') && page.text().includes('Also reports this file'), 'both nodes answered');
  const t = page.text();
  assert.ok(t.includes('File (raw bytes)') && t.includes(`${PNG.length.toLocaleString('en-US')} bytes`));
  assert.ok(t.includes(parsed.hashHex), 'the hash is shown');
  const link = page.doc.querySelector('#output .loc a');
  assert.strictEqual(link.href, `https://storage.serey.io/blob/1/${parsed.key}`);
  assert.strictEqual(link.rel, 'noopener noreferrer');
  assert.ok(!t.includes('[object'), 'no unrendered nested lists');
  assert.ok(net.calls.some((u) => u.startsWith(`https://s5.serey.io/s5/debug/storage_locations/${parsed.key}`)));
});

test('a CID in the path, as the Serey Explorer links it, opens the same way', async () => {
  const cid = cidOf(PNG);
  const parsed = parseCid(cid);
  const page = await open('', network({ serey: location(parsed.key), garden: location(parsed.key), blob: PNG }), { path: cid });

  assert.strictEqual(page.doc.getElementById('cid-input').value, cid);
  await until(() => page.doc.querySelector('#output .loc'), 'the Serey node answered');
  assert.ok(page.text().includes(parsed.hashHex));
});

test('typing a CID puts it in the path, so the address can be shared', async () => {
  const cid = cidOf(PNG);
  const parsed = parseCid(cid);
  const page = await open('', network({ serey: location(parsed.key), garden: location(parsed.key), blob: PNG }));
  page.type(cid);
  assert.strictEqual(page.window.location.pathname, `/${cid}`);
  page.type('');
  assert.strictEqual(page.window.location.pathname, '/');
});

test('a small file is checked on its own, proving the bytes and showing a picture', async () => {
  const cid = cidOf(PNG);
  const key = parseCid(cid).key;
  const page = await open(cid, network({ serey: location(key), garden: 404, blob: PNG }));

  await until(() => page.text().includes('Verified'), 'the check finished without a click');
  assert.ok(page.text().includes('exactly the file this ID names'));
  assert.ok(page.doc.querySelector('.preview img'), 'a verified picture is shown');
  assert.strictEqual(page.doc.querySelector('.preview img').src, 'blob:preview');
  await until(() => page.text().includes('No answer'), 'a silent other node is reported, not fatal');
});

test('bytes that do not match are called out, with no picture', async () => {
  const cid = cidOf(PNG);
  const tampered = PNG.slice();
  tampered[500] ^= 1;
  const page = await open(cid, network({ serey: location(parseCid(cid).key), garden: 404, blob: tampered }));
  await until(() => page.text().includes('do NOT match'), 'a mismatch was reported');
  assert.ok(page.doc.querySelector('.badge.bad'));
  assert.strictEqual(page.doc.querySelector('.preview img'), null, 'never draw bytes that failed the check');
});

test('a file server error is a failed check, not a mismatch', async () => {
  const cid = cidOf(PNG);
  const page = await open(cid, network({ serey: location(parseCid(cid).key), garden: 404, blob: 500 }));
  await until(() => page.text().includes('Could not finish the check'), 'the failure was shown');
  assert.ok(page.text().includes('500'));
  assert.ok(!page.text().includes('do NOT match'));

  await until(() => page.button('Download and verify') && !page.button('Download and verify').disabled, 'the check can be tried again');
});

test('a big file waits for a click before anything is downloaded', async () => {
  const cid = buildRawCid(blake3(PNG), 26 * 1024 * 1024);
  const key = parseCid(cid).key;
  const net = network({ serey: location(key), garden: 404, blob: PNG });
  const page = await open(cid, net);
  await until(() => page.button('Download and verify') && !page.button('Download and verify').disabled, 'the button shows once a location is known');
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!net.calls.some((u) => u.startsWith('https://storage.serey.io/')), 'no download started');
  assert.ok(page.text().includes('Not verified yet'));
});

test('typing something that is not a CID explains why and asks nobody', async () => {
  const net = network({ serey: 500, garden: 500, blob: 500 });
  const page = await open('', net);
  assert.strictEqual(page.doc.getElementById('intro').hidden, false);

  page.type('hello world');
  assert.ok(page.text().includes('Not a CID this page can check'));
  page.type('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
  assert.ok(page.text().includes('IPFS'));
  assert.ok(page.doc.querySelector('#output a').href.startsWith('https://cid.ipfs.tech/#'));
  assert.deepStrictEqual(net.calls, [], 'nothing left the page');

  page.type('');
  assert.strictEqual(page.doc.getElementById('intro').hidden, false, 'clearing brings the explainer back');
  assert.strictEqual(page.text(), '');
});

test('the Serey node being down is said plainly and the check can still run from a file', async () => {
  const cid = cidOf(PNG);
  const page = await open(cid, network({ serey: 503, garden: 503, blob: PNG }));
  await until(() => page.text().includes('did not answer'), 'the outage was shown');
  assert.ok(page.text().includes('503'));
  const download = page.button('Download and verify');
  assert.ok(!download || download.disabled, 'nothing to download from');
  assert.strictEqual(page.doc.querySelector('input[type=file]').disabled, false, 'a local file can still be checked');
});

test('nothing a node says can inject markup or an unsafe link', async () => {
  const cid = cidOf(PNG);
  const key = parseCid(cid).key;
  const hostile = {
    locations: [{
      type: '<img src=x onerror=alert(1)>',
      parts: ['javascript:alert(1)', 'http://plain.test/a', `https://storage.serey.io/blob/1/${key}`],
      nodeId: '<img src=x onerror=alert(2)>',
      expiry: 'soon',
      score: 1,
    }],
  };
  const page = await open(cid, network({ serey: hostile, garden: hostile, blob: PNG }));
  await until(() => page.text().includes('Other S5 nodes') && page.text().includes('Also reports'), 'rendered');
  const stray = [...page.doc.querySelectorAll('#output img')].filter((img) => !img.closest('.preview'));
  assert.deepStrictEqual(stray, [], 'no element was injected; the only picture is the verified preview');
  assert.ok(page.text().includes('<img src=x onerror=alert(2)>'), 'the hostile node id is shown as plain text');
  const hrefs = [...page.doc.querySelectorAll('#output .loc a')].map((a) => a.href);
  assert.deepStrictEqual(hrefs, [`https://storage.serey.io/blob/1/${key}`], 'only the https address became a link');
});

test('moving to another CID drops the old results', async () => {
  const a = new Uint8Array(100).fill(1);
  const b = new Uint8Array(200).fill(2);
  const net = network({ serey: location(parseCid(cidOf(a)).key), garden: 404, blob: a });
  const page = await open(cidOf(a), net);
  await until(() => page.doc.querySelector('#output .loc'), 'first result');
  page.type(cidOf(b));
  assert.ok(page.text().includes('200 bytes') && !page.text().includes('100 bytes'));
});
