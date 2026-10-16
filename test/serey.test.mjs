import test from 'node:test';
import assert from 'node:assert';
import { parsePostLink, postRows } from '../src/serey.js';

test('Serey post links are recognised in every form', () => {
  const want = { author: 'chhaylin', permlink: 'why-is-this-important' };
  for (const link of [
    'https://serey.io/authors/chhaylin/why-is-this-important',
    'serey.io/authors/chhaylin/why-is-this-important?ref=x#top',
    'https://serey.io/sereyexplorer/explorer/@chhaylin/why-is-this-important',
    'https://serey.io/@chhaylin/why-is-this-important',
    '@chhaylin/why-is-this-important',
    'https://cid.serey.io/post/chhaylin/why-is-this-important',
  ]) assert.deepStrictEqual(parsePostLink(link), want, link);
});

test('CIDs and other text are not taken for post links', () => {
  for (const text of ['z2H73jdhLiG99GZ6D9bznDcAThVJNQF2LhGem4ZrQjj8mSVsteE5', 'hello', 'https://serey.io/authors/x', '@a/b c', '']) {
    assert.strictEqual(parsePostLink(text), null, text);
  }
});

test('a post becomes one row per content ID, with posters and numbered names', () => {
  const rows = postRows([
    { file: 'a.jpg', kind: 'images', s5_cid: 'z1' },
    { file: 'b.jpg', kind: 'images', s5_cid: 'z2' },
    { file: 'c.mp4', kind: 'videos', s5_cid: 'z3', s5_thumb_cid: 'z4' },
    { file: 'dup.jpg', kind: 'images', s5_cid: 'z1' },
    { file: 'none', kind: 'images' },
    null,
  ]);
  assert.deepStrictEqual(rows.map((r) => [r.label, r.cid, r.role]), [
    ['Image 1', 'z1', 'file'],
    ['Image 2', 'z2', 'file'],
    ['Video', 'z3', 'file'],
    ['Video poster', 'z4', 'poster'],
  ]);
});
