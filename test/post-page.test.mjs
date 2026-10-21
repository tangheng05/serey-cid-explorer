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
function network({ media, files, title = 'Bruce Lee and Daoism', arweave = {}, textArweave = null }) {
  const calls = [];
  const keyOf = Object.fromEntries(Object.keys(files).map((c) => [parseCid(c).key, c]));
  const fetchFake = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/api/v2/media-proof/posts/chhaylin/bruce-lee-and-daoism')) {
      return typeof media === 'number' ? new Response('', { status: media }) : new Response(JSON.stringify({ media }));
    }
    if (u.includes('/api/v1/sereyweb/getDetailByPermlink')) {
      return new Response(JSON.stringify({ content: { title }, forever: textArweave ? { document: { arweave_id: textArweave } } : null }));
    }
    if (u === 'https://arweave.net/graphql') {
      const edges = Object.entries(arweave).map(([cid, id]) => ({ node: { id, owner: { address: 'OWbotbFOnhyFMY309nf7DyM_ZA_YNWX408bA_9aoM6w' }, tags: [{ name: 'S5-CID', value: cid }] } }));
      return new Response(JSON.stringify({ data: { transactions: { edges } } }));
    }
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

  // Details open under the row instead of leaving the page.
  const first = page.rows()[0];
  first.querySelector('.file-toggle').click();
  assert.ok(first.classList.contains('open'));
  assert.strictEqual(first.querySelector('.file-toggle').getAttribute('aria-expanded'), 'true');
  const panel = first.querySelector('.file-details').textContent;
  assert.ok(panel.includes(cidOf(a)), 'the full content ID');
  assert.ok(panel.includes(parseCid(cidOf(a)).hashHex), 'the hash');
  assert.ok(panel.includes(`https://storage.serey.io/blob/1/${parseCid(cidOf(a)).key}`), 'where it is stored');
  assert.ok(panel.includes('Checked hash'), 'the comparison from the check');
  assert.strictEqual(first.querySelector('.file-details-foot a').getAttribute('href'), `/${cidOf(a)}`);
  first.querySelector('.file-toggle').click();
  assert.ok(!first.classList.contains('open'), 'a second click closes it');

  // A big file not checked yet still learns where it is kept when its details open.
  videoRow.querySelector('.file-toggle').click();
  await until(() => videoRow.querySelector('.file-details').textContent.includes('Expected') === false && videoRow.querySelector('.file-details a.addr'), 'the address of an unchecked file');
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

test('a file that cannot be downloaded says why and can be tried again', async () => {
  const a = png(13);
  const files = { [cidOf(a)]: 503 };
  const page = await open(network({ media: [{ file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) }], files }));
  page.type(POST);
  await until(() => page.rows()[0] && page.rows()[0].dataset.state === 'failed', 'the failure is shown');
  assert.ok(page.text().includes('The file server answered 503'), 'the reason is visible, not only on hover');
  files[cidOf(a)] = a;
  page.rows()[0].querySelector('.file-status button').click();
  await until(() => page.rows()[0].dataset.state === 'ok', 'the retry verified the file');
  assert.ok(page.text().includes('All 1 file verified'));
});

test('a file the node does not know is marked Not found', async () => {
  const a = png(13);
  const page = await open(network({ media: [{ file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) }], files: {} }));
  page.type(POST);
  await until(() => page.rows()[0] && page.rows()[0].dataset.state === 'missing', 'the missing file is shown');
  assert.ok(page.text().includes('Not found'));
});

test('an unreachable API is explained in words, and titles lose their HTML entities', async () => {
  const net = network({ media: [], files: {} });
  const real = net.fetchFake;
  net.fetchFake = async (url) => { if (String(url).includes('media-proof')) throw new TypeError('Failed to fetch'); return real(url); };
  const page = await open(net);
  page.type(POST);
  await until(() => page.text().includes("Serey's API could not be reached"), 'the reason is in words');

  const a = png(13);
  const titled = await open(network({ media: [{ file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) }], files: { [cidOf(a)]: a }, title: 'Tom &amp; Jerry <b>live</b>' }));
  titled.type(POST);
  await until(() => titled.doc.querySelector('.post-title').textContent === 'Tom & Jerry live', 'the title is plain text');
  assert.strictEqual(titled.doc.querySelector('.post-title b'), null);
});

test('a post lists the Arweave copy of each file and of its text beside the S5 one', async () => {
  const a = png(13);
  const b = png(7);
  const AR_A = 'A'.repeat(43);
  const AR_TEXT = 'T'.repeat(43);
  const net = network({
    media: [{ file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) }, { file: 'b.jpg', kind: 'images', s5_cid: cidOf(b) }],
    files: { [cidOf(a)]: a, [cidOf(b)]: b },
    arweave: { [cidOf(a)]: AR_A },
    textArweave: AR_TEXT,
  });
  const page = await open(net);
  page.type(POST);
  await until(() => page.rows().length === 3, 'two files and the post text');
  const [first, second, text] = page.rows();
  await until(() => first.querySelector('.file-ar a'), 'the Arweave copy of the first file');
  assert.strictEqual(first.querySelector('.file-ar a').getAttribute('href'), `/${AR_A}`);
  assert.ok(first.textContent.includes('S5'), 'the S5 line stays');
  assert.ok(!second.querySelector('.file-ar'), 'a file with no Arweave copy shows none');
  assert.strictEqual(text.querySelector('strong').textContent, 'Post text');
  assert.strictEqual(text.querySelector('.file-ar a').getAttribute('href'), `/${AR_TEXT}`);
  await until(() => page.text().includes('All 2 files verified'), 'the summary counts only the S5 files');
});

test('a text-only Forever post lists its text on Arweave instead of "no files"', async () => {
  const AR_TEXT = 'T'.repeat(43);
  const page = await open(network({ media: [], files: {}, textArweave: AR_TEXT }));
  page.type(POST);
  await until(() => page.rows().length === 1, 'the post text row');
  assert.strictEqual(page.rows()[0].querySelector('.file-ar a').getAttribute('href'), `/${AR_TEXT}`);
  assert.ok(!page.text().includes('No files on S5 for this post'));
});
