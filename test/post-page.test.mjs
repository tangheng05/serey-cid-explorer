import test from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { parseCid } from '../src/cid.js';
import { network, open, until, png, cidOf, POST, SEREY_WALLET } from './helpers.mjs';

const cell = (row, place) => row.querySelector(`.cell-copy[data-place='${place}']`);

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
  await until(() => page.text().includes('3 of 4 verified on S5'), 'the small files were checked');
  assert.ok(page.text().includes('1 waiting for you'));
  assert.ok(page.text().includes('none kept on Arweave'));
  assert.ok(page.text().includes('Bruce Lee and Daoism'), 'the post title is shown');
  const videoRow = page.rows()[2];
  assert.strictEqual(cell(videoRow, 's5').dataset.state, 'waiting');
  assert.ok(cell(videoRow, 's5').querySelector('button').textContent.includes('Check'), 'a big file waits for a click');
  assert.ok(!net.calls.some((u) => u.endsWith(parseCid(video).key) && u.startsWith('https://storage')), 'the big file was not downloaded');
  assert.ok(videoRow.querySelector('.file-thumb img'), 'the video row borrows its verified poster as a thumbnail');

  // Details open under the row: each copy in full, and a link to the file's own record.
  const first = page.rows()[0];
  first.querySelector('.file-toggle').click();
  assert.ok(first.classList.contains('open'));
  assert.strictEqual(first.querySelector('.file-toggle').getAttribute('aria-expanded'), 'true');
  const panel = first.querySelector('.file-details');
  assert.ok(panel.textContent.includes('storage.serey.io'), 'where it is stored');
  assert.ok(panel.querySelector(".copy-row[data-place='s5'] .seal"), 'the fingerprint of the checked bytes');
  assert.strictEqual(panel.querySelector('.file-record').getAttribute('href'), `/${cidOf(a)}`);
  first.querySelector('.file-toggle').click();
  assert.ok(!first.classList.contains('open'), 'a second click closes it');
});

test('a file whose bytes do not match is called out in its row', async () => {
  const a = png(13);
  const tampered = a.slice();
  tampered[700] ^= 1;
  const page = await open(network({ media: [{ file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) }], files: { [cidOf(a)]: tampered } }));
  page.type('@chhaylin/bruce-lee-and-daoism');
  await until(() => page.rows()[0] && page.rows()[0].dataset.state === 'bad', 'the mismatch is shown');
  assert.ok(page.text().includes('Does not match'));
  assert.ok(page.text().includes('1 does not match'));
  assert.strictEqual(page.doc.querySelector('.file-thumb img'), null, 'no thumbnail from bytes that failed');
});

test('a post page opened from its own address shows the Serey link in the box', async () => {
  const a = png(13);
  const page = await open(network({ media: [{ file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) }], files: { [cidOf(a)]: a } }), { path: 'post/chhaylin/bruce-lee-and-daoism' });
  assert.strictEqual(page.doc.getElementById('cid-input').value, 'https://serey.io/authors/chhaylin/bruce-lee-and-daoism');
  await until(() => page.text().includes('1 file. All intact on S5'), 'the file was checked');
});

test('a post the API cannot load, or with nothing stored, says so plainly', async () => {
  const failing = await open(network({ media: 500 }));
  failing.type(POST);
  await until(() => failing.text().includes('Could not load the files of this post'), 'the failure is shown');
  assert.ok(failing.text().includes('500'));

  const empty = await open(network({ media: [] }));
  empty.type(POST);
  await until(() => empty.text().includes('This post has no stored files'), 'the empty post is explained');
});

test('a CID still opens the file record, not a post', async () => {
  const a = png(13);
  const page = await open(network({ files: { [cidOf(a)]: a } }));
  page.type(cidOf(a));
  assert.strictEqual(page.doc.querySelector('.file'), null);
  await until(() => page.doc.querySelector('.record'), 'the file record');
});

test('a file that cannot be downloaded says why and can be tried again', async () => {
  const a = png(13);
  const files = { [cidOf(a)]: 503 };
  const page = await open(network({ media: [{ file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) }], files }));
  page.type(POST);
  await until(() => page.rows()[0] && cell(page.rows()[0], 's5').dataset.state === 'failed', 'the failure is shown');
  assert.ok(cell(page.rows()[0], 's5').title.includes('The file server answered 503'));
  page.rows()[0].querySelector('.file-toggle').click();
  assert.ok(page.rows()[0].querySelector('.file-details').textContent.includes('The file server answered 503'), 'the reason is visible, not only on hover');
  files[cidOf(a)] = a;
  cell(page.rows()[0], 's5').querySelector('button').click();
  await until(() => cell(page.rows()[0], 's5').dataset.state === 'ok', 'the retry verified the file');
  await until(() => page.text().includes('All intact on S5'), 'the summary caught up');
});

test('a file the node does not know is marked Not found', async () => {
  const a = png(13);
  const page = await open(network({ media: [{ file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) }] }));
  page.type(POST);
  await until(() => page.rows()[0] && cell(page.rows()[0], 's5').dataset.state === 'missing', 'the missing file is shown');
  assert.ok(page.text().includes('Not found'));
});

test('an unreachable API is explained in words, and titles lose their HTML entities', async () => {
  const net = network();
  const real = net.fetchFake;
  net.fetchFake = async (url, init) => { if (String(url).includes('media-proof')) throw new TypeError('Failed to fetch'); return real(url, init); };
  const page = await open(net);
  page.type(POST);
  await until(() => page.text().includes("Serey's API could not be reached"), 'the reason is in words');

  const a = png(13);
  const titled = await open(network({ media: [{ file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) }], files: { [cidOf(a)]: a }, title: 'Tom &amp; Jerry <b>live</b>' }));
  titled.type(POST);
  await until(() => titled.doc.querySelector('.post-title').textContent === 'Tom & Jerry live', 'the title is plain text');
  assert.strictEqual(titled.doc.querySelector('.post-title b'), null);
});

test('each row shows its copy on S5 and on Arweave side by side, the text included', async () => {
  const a = png(13);
  const b = png(7);
  const AR_A = 'A'.repeat(43);
  const AR_TEXT = 'T'.repeat(43);
  const text = '{"v":2,"title":"","body":"<p>Hello</p>"}';
  const sha = createHash('sha256').update(text).digest('hex');
  const net = network({
    media: [{ file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) }, { file: 'b.jpg', kind: 'images', s5_cid: cidOf(b) }],
    files: { [cidOf(a)]: a, [cidOf(b)]: b },
    copies: { [cidOf(a)]: AR_A },
    arweaveFiles: { [AR_A]: a, [AR_TEXT]: text },
    textArweave: AR_TEXT,
    txs: { [AR_TEXT]: { id: AR_TEXT, owner: { address: SEREY_WALLET }, data: { size: String(text.length) }, tags: [{ name: 'Content-SHA256', value: sha }] } },
  });
  const page = await open(net);
  page.type(POST);
  await until(() => page.rows().length === 3, 'two files and the post text');
  const [first, second, row] = page.rows();
  await until(() => cell(first, 'arweave').dataset.state === 'ok', 'the Arweave copy is checked against the same fingerprint');
  await until(() => cell(second, 'arweave').dataset.state === 'none', 'a file with no Arweave copy says so');
  assert.ok(cell(second, 'arweave').textContent.includes('Not kept'));
  assert.strictEqual(row.querySelector('strong').textContent, 'Post text');
  assert.strictEqual(cell(row, 's5').dataset.state, 'none', 'a post text has no S5 copy');
  await until(() => cell(row, 'arweave').dataset.state === 'ok', 'the text is checked against its SHA-256');
  await until(() => page.text().includes('2 files and the post text. All intact on S5; 2 copies kept on Arweave, all intact.'), 'one sentence for the post');
  first.querySelector('.file-toggle').click();
  assert.ok(first.querySelector(".file-details .copy-row[data-place='arweave'] a").href.endsWith(AR_A), 'the Arweave copy can be opened');
  assert.strictEqual(row.querySelector('.file-record').getAttribute('href'), `/${AR_TEXT}`);
});

test('a text-only Forever post lists its text instead of "no files"', async () => {
  const AR_TEXT = 'T'.repeat(43);
  const page = await open(network({ textArweave: AR_TEXT }));
  page.type(POST);
  await until(() => page.rows().length === 1, 'the post text row');
  assert.ok(!page.text().includes('This post has no stored files'));
  assert.ok(page.text().startsWith('Bruce Lee and Daoism') || page.text().includes('The post text.'));
});

test('an opened row shows the technical details right there, asking Arweave once', async () => {
  const a = png(13);
  const AR_A = 'A'.repeat(43);
  const net = network({
    media: [{ file: 'a.jpg', kind: 'images', s5_cid: cidOf(a) }],
    files: { [cidOf(a)]: a },
    copies: { [cidOf(a)]: AR_A },
    arweaveFiles: { [AR_A]: a },
    txs: { [AR_A]: { id: AR_A, owner: { address: SEREY_WALLET }, data: { size: String(a.length) }, tags: [], block: { height: 9, timestamp: 1791582380 } } },
  });
  const page = await open(net);
  page.type(POST);
  await until(() => page.rows()[0] && cell(page.rows()[0], 'arweave').dataset.state === 'ok', 'both copies checked');
  const row = page.rows()[0];
  row.querySelector('.file-main').click();
  row.querySelector('.tech-toggle').click();
  const tech = row.querySelector('.file-details .tech-body');
  await until(() => tech.textContent.includes("Serey's wallet"), 'the Arweave transaction is shown');
  const text = tech.textContent;
  assert.ok(text.includes(parseCid(cidOf(a)).hashHex), 'the fingerprint');
  assert.ok(text.includes(`https://storage.serey.io/blob/1/${parseCid(cidOf(a)).key}`), 'where S5 keeps it');
  assert.ok(text.includes('S5 copy') && text.includes('Arweave copy'), 'what each check found');
  assert.ok(!text.includes('base32'), 'the long lists stay on the full record');
  assert.strictEqual(net.calls.filter((u) => u === 'https://arweave.net/graphql').length, 2, 'one lookup for the copies, one for this transaction');
});
