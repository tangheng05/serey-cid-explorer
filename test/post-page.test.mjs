import test from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { blake3 } from '@noble/hashes/blake3';
import { buildRawCid, parseCid } from '../src/cid.js';

// The real bundle in a simulated browser; Serey's API, the S5 node and storage are faked.
const bundle = (await build({ entryPoints: ['src/main.js'], bundle: true, write: false, format: 'iife', target: 'es2020' })).outputFiles[0].text;
const html = await readFile('index.html', 'utf8');

const png = (seed) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 1500 }, (_, i) => (i * seed) % 256)]);
const cidOf = (bytes, size = bytes.length) => buildRawCid(blake3(bytes), size);
const POST = 'https://serey.io/sereyexplorer/explorer/@chhaylin/bruce-lee-and-daoism';

// files: CID -> bytes (or a status number); media: what Serey's API answers (or a status number).
function network({ media, files, title = 'Bruce Lee and Daoism' }) {
  const calls = [];
  const keyOf = Object.fromEntries(Object.keys(files).map((c) => [parseCid(c).key, c]));
  const fetchFake = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/api/v2/media-proof/posts/chhaylin/bruce-lee-and-daoism')) {
      return typeof media === 'number' ? new Response('', { status: media }) : new Response(JSON.stringify({ media }));
    }
    if (u.includes('/api/v1/sereyweb/getDetailByPermlink')) return new Response(JSON.stringify({ content: { title } }));
    if (u.startsWith('https://s5.serey.io/s5/debug/storage_locations/')) {
      const key = u.split('/').pop();
      return keyOf[key] ? new Response(JSON.stringify({ locations: [{ type: 3, parts: [`https://storage.serey.io/blob/1/${key}`], expiry: Math.floor(Date.now() / 1000) + 3600 }] })) : new Response('', { status: 404 });
    }
    if (u.startsWith('https://storage.serey.io/blob/1/')) {
      const body = files[keyOf[u.split('/').pop()]];
      return typeof body === 'number' ? new Response('', { status: body }) : new Response(body);
    }
    throw new Error(`unexpected request: ${u}`);
  };
  return { fetchFake, calls };
}

async function open(net, { path = '' } = {}) {
  const dom = new JSDOM(html, { url: `https://cid.serey.io/${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.setInterval = () => 0;
  window.fetch = net.fetchFake;
  window.URL.createObjectURL = () => 'blob:thumb';
  window.URL.revokeObjectURL = () => {};
  window.eval(bundle);
  const doc = window.document;
  return {
    window,
    doc,
    text: () => doc.getElementById('output').textContent,
    type: (value) => { const el = doc.getElementById('cid-input'); el.value = value; el.dispatchEvent(new window.Event('input')); },
    rows: () => [...doc.querySelectorAll('.file')],
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

test('pasting a post link checks every file of the post on one page', async () => {
  const a = png(13);
  const b = png(7);
  const poster = png(3);
  const video = cidOf(png(5), 90 * 1024 * 1024); // too big to check on its own
  const media = [
    { file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) },
    { file: 'b.jpg', kind: 'images', s5_cid: cidOf(b) },
    { file: 'v.mp4', kind: 'videos', s5_cid: video, s5_thumb_cid: cidOf(poster) },
  ];
  const net = network({ media, files: { [cidOf(a)]: a, [cidOf(b)]: b, [cidOf(poster)]: poster, [video]: 500 } });
  const page = await open(net);
  page.type(POST);

  assert.strictEqual(page.window.location.pathname, '/post/chhaylin/bruce-lee-and-daoism');
  await until(() => page.rows().length === 4, 'one row per content ID');
  assert.deepStrictEqual(page.rows().map((r) => r.querySelector('strong').textContent), ['Image 1', 'Image 2', 'Video', 'Video poster']);
  await until(() => page.text().includes('3 of 4 verified'), 'the small files were checked');
  assert.ok(page.text().includes('1 waiting for you'));
  assert.ok(page.text().includes('Bruce Lee and Daoism'), 'the post title is shown');
  const videoRow = page.rows()[2];
  assert.strictEqual(videoRow.dataset.state, 'waiting');
  assert.ok(videoRow.querySelector('.file-status button').textContent.includes('Verify'), 'a big file waits for a click');
  assert.ok(!net.calls.some((u) => u.endsWith(parseCid(video).key) && u.startsWith('https://storage')), 'the big file was not downloaded');
  assert.ok(videoRow.querySelector('.file-thumb img'), 'the video row borrows its verified poster as a thumbnail');
  assert.strictEqual(page.rows()[0].querySelector('a.file-open').getAttribute('href'), `/${cidOf(a)}`);
});

test('a file whose bytes do not match is called out in its row', async () => {
  const a = png(13);
  const tampered = a.slice();
  tampered[700] ^= 1;
  const page = await open(network({ media: [{ file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) }], files: { [cidOf(a)]: tampered } }));
  page.type('@chhaylin/bruce-lee-and-daoism');
  await until(() => page.rows()[0] && page.rows()[0].dataset.state === 'bad', 'the mismatch is shown');
  assert.ok(page.text().includes('Does not match'));
  assert.strictEqual(page.doc.querySelector('.file-thumb img'), null, 'no thumbnail from bytes that failed');
});

test('a post page opened from its own address shows the Serey link in the box', async () => {
  const a = png(13);
  const page = await open(network({ media: [{ file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) }], files: { [cidOf(a)]: a } }), { path: 'post/chhaylin/bruce-lee-and-daoism' });
  assert.strictEqual(page.doc.getElementById('cid-input').value, 'https://serey.io/authors/chhaylin/bruce-lee-and-daoism');
  await until(() => page.text().includes('All 1 file verified'), 'the file was checked');
});

test('a post the API cannot load, or with no files, says so plainly', async () => {
  const failing = await open(network({ media: 500, files: {} }));
  failing.type(POST);
  await until(() => failing.text().includes('Could not load the files of this post'), 'the failure is shown');
  assert.ok(failing.text().includes('500'));

  const empty = await open(network({ media: [], files: {} }));
  empty.type(POST);
  await until(() => empty.text().includes('No files on S5 for this post'), 'the empty post is explained');
});

test('a CID still opens the single-file page', async () => {
  const a = png(13);
  const page = await open(network({ media: [], files: { [cidOf(a)]: a } }));
  page.type(cidOf(a));
  assert.strictEqual(page.doc.querySelector('.file'), null);
  await until(() => page.doc.querySelector('.result'), 'the single-file result');
});
