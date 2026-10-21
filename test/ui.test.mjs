import test from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { blake3 } from '@noble/hashes/blake3';
import { buildRawCid, parseCid } from '../src/cid.js';
import { fileSize } from '../src/format.js';
import { network, open, until, png, cidOf, location, SEREY_WALLET } from './helpers.mjs';

const PNG = png(13, 2000);
const AR = 'A'.repeat(43);

test('a CID in the link opens its record, with the S5 copy and technical details', async () => {
  const cid = cidOf(PNG);
  const parsed = parseCid(cid);
  const net = network({ serey: location(parsed.key), garden: location(parsed.key), blob: PNG });
  const page = await open(net, { hash: cid });

  assert.strictEqual(page.doc.getElementById('intro').hidden, true, 'the explainer steps aside');
  await until(() => page.text().includes('Other S5 nodes') && page.text().includes('Also has this file'), 'both nodes answered');
  const t = page.text();
  assert.ok(t.includes(`${PNG.length.toLocaleString('en-US')} bytes`));
  assert.ok(t.includes(parsed.hashHex), 'the hash is in the details');
  const link = page.doc.querySelector('#output .loc a');
  assert.strictEqual(link.href, `https://storage.serey.io/blob/1/${parsed.key}`);
  assert.strictEqual(link.rel, 'noopener noreferrer');
  assert.ok(!t.includes('[object'), 'no unrendered nested lists');
  assert.ok(net.calls.some((u) => u.startsWith(`https://s5.serey.io/s5/debug/storage_locations/${parsed.key}`)));
});

test('a CID in the path, as the Serey Explorer links it, opens the same way', async () => {
  const cid = cidOf(PNG);
  const page = await open(network({ files: { [cid]: PNG } }), { path: cid });
  assert.strictEqual(page.doc.getElementById('cid-input').value, cid);
  await until(() => page.doc.querySelector('#output .loc'), 'the Serey node answered');
  assert.ok(page.text().includes(parseCid(cid).hashHex));
});

test('typing a CID puts it in the path, so the address can be shared', async () => {
  const cid = cidOf(PNG);
  const page = await open(network({ files: { [cid]: PNG } }));
  page.type(cid);
  assert.strictEqual(page.window.location.pathname, `/${cid}`);
  page.type('');
  assert.strictEqual(page.window.location.pathname, '/');
});

test('a small file is checked on its own, proving the bytes and showing a picture', async () => {
  const cid = cidOf(PNG);
  const page = await open(network({ files: { [cid]: PNG } }), { hash: cid });
  await until(() => page.state('s5') === 'ok', 'the check finished without a click');
  await until(() => page.state('arweave') === 'none', 'no Arweave copy was found');
  assert.ok(page.text().includes('Intact on S5'));
  assert.strictEqual(page.doc.querySelector('.preview img').src, 'blob:preview');
  assert.ok(page.copy('arweave').textContent.includes('Only Forever posts are kept on Arweave'));
  await until(() => page.text().includes('No answer'), 'a silent other node is reported, not fatal');
});

test('a verified video plays from the checked bytes', async () => {
  const MP4 = Uint8Array.from([0, 0, 0, 0x18, ...'ftypisom'].map((c) => (typeof c === 'string' ? c.charCodeAt(0) : c)).concat(Array.from({ length: 3000 }, (_, i) => (i * 7) % 256)));
  const cid = cidOf(MP4);
  const page = await open(network({ files: { [cid]: MP4 } }), { hash: cid });
  await until(() => page.doc.querySelector('.preview video'), 'the video is shown after the check');
  assert.strictEqual(page.doc.querySelector('.preview video').getAttribute('src'), 'blob:preview');
});

test('bytes that do not match are called out, with no picture', async () => {
  const cid = cidOf(PNG);
  const tampered = PNG.slice();
  tampered[500] ^= 1;
  const page = await open(network({ files: { [cid]: tampered } }), { hash: cid });
  await until(() => page.text().includes('A copy does not match'), 'a mismatch was reported');
  assert.ok(page.doc.querySelector('.verdict.bad'));
  assert.ok(page.text().includes('The S5 copy is NOT this file'));
  assert.strictEqual(page.doc.querySelector('.preview img'), null, 'never draw bytes that failed the check');
  assert.strictEqual(page.state('s5'), 'bad');
  assert.ok(page.copy('s5').textContent.includes('Does not match'), 'the copy itself says so');
});

test('a file server error is a failed check, not a mismatch, and can be tried again', async () => {
  const cid = cidOf(PNG);
  const files = { [cid]: 500 };
  const page = await open(network({ files }), { hash: cid });
  await until(() => page.state('s5') === 'failed', 'the failure was shown');
  assert.ok(page.copy('s5').textContent.includes('500'));
  assert.ok(!page.text().includes('does not match'));
  files[cid] = PNG;
  page.button('Try again').click();
  await until(() => page.state('s5') === 'ok', 'the retry verified the file');
});

test('a big file waits for a click before anything is downloaded', async () => {
  const cid = buildRawCid(blake3(PNG), 26 * 1024 * 1024);
  const net = network({ files: { [cid]: PNG } });
  const page = await open(net, { hash: cid });
  await until(() => page.button('Check this copy'), 'the button shows once a location is known');
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!net.calls.some((u) => u.startsWith('https://storage.serey.io/')), 'no download started');
  assert.ok(page.text().includes('Not checked yet'));
});

test('typing something that is not an ID explains why and asks nobody', async () => {
  const net = network();
  const page = await open(net);
  assert.strictEqual(page.doc.getElementById('intro').hidden, false);

  page.type('hello world');
  assert.ok(page.text().includes('Not an ID this page can check'));
  page.type('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
  assert.ok(page.text().includes('IPFS'));
  assert.ok(page.doc.querySelector('#output a').href.startsWith('https://cid.ipfs.tech/#'));
  assert.deepStrictEqual(net.calls, [], 'nothing left the page');

  page.type('');
  assert.strictEqual(page.doc.getElementById('intro').hidden, false, 'clearing brings the explainer back');
  assert.strictEqual(page.text(), '');
});

test('the Serey node being down is said plainly and a copy you have can still be checked', async () => {
  const cid = cidOf(PNG);
  const page = await open(network({ serey: 503, garden: 503 }), { hash: cid });
  await until(() => page.text().includes('did not answer'), 'the outage was shown');
  assert.ok(page.text().includes('503'));
  assert.ok(!page.button('Check this copy'), 'nothing to download from');
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
  const page = await open(network({ serey: hostile, garden: hostile, blob: PNG }), { hash: cid });
  await until(() => page.text().includes('Other S5 nodes') && page.text().includes('Also has this file'), 'rendered');
  const stray = [...page.doc.querySelectorAll('#output img')].filter((img) => !img.closest('.preview'));
  assert.deepStrictEqual(stray, [], 'no element was injected; the only picture is the verified preview');
  assert.ok(page.text().includes('<img src=x onerror=alert(2)>'), 'the hostile node id is shown as plain text');
  const hrefs = [...page.doc.querySelectorAll('#output .loc a')].map((a) => a.href);
  assert.deepStrictEqual(hrefs, [`https://storage.serey.io/blob/1/${key}`], 'only the https address became a link');
});

test('an expired storage offer says so and can be asked for again', async () => {
  const cid = cidOf(PNG);
  const key = parseCid(cid).key;
  const net = network({ serey: location(key, { expiry: Math.floor(Date.now() / 1000) - 300 }), blob: PNG });
  const page = await open(net, { hash: cid });
  await until(() => page.text().includes('Expired 5 min ago'), 'the expired offer is shown');
  const asked = () => net.calls.filter((u) => u.startsWith('https://s5.serey.io/')).length;
  const before = asked();
  page.button('Ask again').click();
  await until(() => asked() > before, 'the node was asked again');
});

test('a live storage offer shows how long it lasts', async () => {
  const cid = cidOf(PNG);
  const page = await open(network({ serey: location(parseCid(cid).key, { expiry: Math.floor(Date.now() / 1000) + 42 * 60 + 20 }), blob: PNG }), { hash: cid });
  await until(() => page.text().includes('Valid for 42 min'), 'the remaining time is shown');
});

test('moving to another CID drops the old results', async () => {
  const a = new Uint8Array(100).fill(1);
  const b = new Uint8Array(200).fill(2);
  const page = await open(network({ files: { [cidOf(a)]: a } }), { hash: cidOf(a) });
  await until(() => page.doc.querySelector('#output .loc'), 'first result');
  page.type(cidOf(b));
  assert.ok(page.text().includes('200 bytes') && !page.text().includes('100 bytes'));
});

test("a file kept on Arweave shows both copies, each checked against the same fingerprint", async () => {
  const cid = cidOf(PNG);
  const page = await open(network({ files: { [cid]: PNG }, copies: { [cid]: AR }, arweaveFiles: { [AR]: PNG } }), { hash: cid });
  await until(() => page.state('arweave') === 'ok' && page.state('s5') === 'ok', 'both copies verified');
  assert.ok(page.text().includes('Intact in both copies'));
  page.doc.querySelector('.tech').open = true;
  assert.ok(page.text().includes('S5 copy') && page.text().includes('Arweave copy'), 'each check is listed against the same fingerprint');
  assert.strictEqual(page.copy('arweave').querySelector('a').href, `https://arweave.net/${AR}`);
});

test('an Arweave ID opens the same record as its S5 ID', async () => {
  const cid = cidOf(PNG);
  const tx = { id: AR, owner: { address: SEREY_WALLET }, data: { size: String(PNG.length), type: 'image/png' }, tags: [{ name: 'S5-CID', value: cid }, { name: 'Serey-Author', value: 'chhaylin' }], block: { height: 7, timestamp: 1791582380 } };
  const page = await open(network({ files: { [cid]: PNG }, txs: { [AR]: tx }, arweaveFiles: { [AR]: PNG } }));
  page.type(`https://arweave.net/${AR}`);
  assert.strictEqual(page.window.location.pathname, `/${AR}`);
  await until(() => page.text().includes('Intact in both copies'), 'both copies verified');
  const facts = [...page.doc.querySelectorAll('.fact')].filter((f) => !f.hidden).map((f) => `${f.querySelector('dt').textContent}: ${f.querySelector('dd').textContent}`);
  assert.deepStrictEqual(facts.slice(0, 3), ['Type: Image', `Size: ${fileSize(PNG.length)}`, 'Posted by: @chhaylin']);
  assert.ok(page.text().includes("Serey's wallet"));
});

test('a post text from Arweave is checked against its SHA-256 and shown as plain text', async () => {
  const text = '{"v":2,"title":"<p>Hello</p>","body":"<p>Hello</p><p>Second <b>line</b><img src=x onerror=alert(1)></p>"}';
  const sha = createHash('sha256').update(text).digest('hex');
  const tx = { id: AR, owner: { address: SEREY_WALLET }, data: { size: String(text.length), type: 'application/json' }, tags: [{ name: 'Content-SHA256', value: sha }] };
  const page = await open(network({ txs: { [AR]: tx }, arweaveFiles: { [AR]: text } }), { path: AR });
  await until(() => page.state('arweave') === 'ok', 'the text is verified');
  assert.ok(page.text().includes('Intact on Arweave'));
  assert.strictEqual(page.state('s5'), 'none', 'a post text has no S5 copy');
  const shown = page.doc.querySelector('.reading .doc');
  assert.deepStrictEqual([...shown.querySelectorAll('p')].map((p) => p.textContent), ['Hello', 'Second line'], 'one paragraph per paragraph; the repeated title is dropped');
  assert.ok(!shown.querySelector('img, b'), 'no HTML from the file reaches the page');
});

test('an Arweave ID that names nothing to check says why', async () => {
  const page = await open(network({ txs: { [AR]: { id: AR, tags: [{ name: 'App-Name', value: 'Other' }] } } }), { path: AR });
  await until(() => page.text().includes('can’t be checked'), 'the reason is shown');
  assert.ok(page.text().includes('App-Name'));
  const missing = await open(network(), { path: 'B'.repeat(43) });
  await until(() => missing.text().includes('Arweave does not know this ID'), 'an unknown ID is explained');
});

test('the examples fill the box and open their page', async () => {
  const page = await open(network());
  page.doc.querySelector('[data-example]').click();
  assert.ok(page.doc.getElementById('cid-input').value.startsWith('https://serey.io/authors/chhaylin/'));
});
