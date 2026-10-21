import test from 'node:test';
import assert from 'node:assert';
import { parsePostLink, parsePodcastLink, fetchEpisode, postRows } from '../src/serey.js';

test('Serey post links are recognised in every form', () => {
  const want = { author: 'chhaylin', permlink: 'why-is-this-important' };
  for (const link of [
    'https://serey.io/authors/chhaylin/why-is-this-important',
    'serey.io/authors/chhaylin/why-is-this-important?ref=x#top',
    'https://serey.io/sereyexplorer/explorer/@chhaylin/why-is-this-important',
    'https://serey.io/@chhaylin/why-is-this-important',
    '@chhaylin/why-is-this-important',
    'https://cid.serey.io/post/chhaylin/why-is-this-important',
    'https://chhay.serey.io/gallery/chhaylin/why-is-this-important',
    'chhay.serey.io/video/chhaylin/why-is-this-important?t=3',
    'https://serey.io/blog/chhaylin/why-is-this-important',
    'https://chhay.serey.io/video-component/watch?author=chhaylin&permalink=why-is-this-important',
    'serey.io/video-component/watch?permlink=why-is-this-important&author=ChhayLin',
  ]) assert.deepStrictEqual(parsePostLink(link), want, link);
});

test('CIDs and other text are not taken for post links', () => {
  for (const text of ['z2H73jdhLiG99GZ6D9bznDcAThVJNQF2LhGem4ZrQjj8mSVsteE5', 'hello', 'https://serey.io/authors/x', '@a/b c', '',
    'https://serey.io/sereyexplorer/explorer/@chhaylin', 'https://example.com/gallery/chhaylin/a-post', 'https://serey.io.evil.com/gallery/chhaylin/a-post',
    'https://serey.io.evil.com/video-component/watch?author=chhaylin&permalink=a-post', 'https://serey.io/video-component/watch?author=chhaylin',
    'https://serey.io/video-component/watch?author=<b>&permalink=a-post']) {
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

test('podcast links name their episode by number', () => {
  for (const link of ['https://serey.io/podcast?episode=3097', 'https://chhay.serey.io/podcast?episode=3097&t=5', 'serey.io/netherlands/podcast?episode=3097']) {
    assert.strictEqual(parsePodcastLink(link), 3097, link);
  }
  for (const text of ['https://serey.io/podcast', 'https://serey.io/podcast?episode=abc', 'https://serey.io/podcast?episode=0', 'https://serey.io.evil.com/podcast?episode=1', 'https://serey.io/podcasts?episode=1']) {
    assert.strictEqual(parsePodcastLink(text), null, text);
  }
});

test('an episode is looked up as its author and permlink, and only those are trusted', async () => {
  const answer = (body, status = 200) => ({ fetchImpl: async () => new Response(JSON.stringify(body), { status }) });
  assert.deepStrictEqual(await fetchEpisode(3097, answer({ podcast: { id: 3097, author: 'HengLay', permlink: 'ep-ghosts-0ca727', title: ' Ghosts ' } })), { author: 'henglay', permlink: 'ep-ghosts-0ca727', title: 'Ghosts', episode: 3097 });
  assert.strictEqual(await fetchEpisode(1, answer({ message: 'not found' }, 404)), null);
  assert.strictEqual(await fetchEpisode(1, answer({ podcast: { author: '<b>', permlink: 'x' } })), null);
  await assert.rejects(fetchEpisode(1, answer({}, 503)), /503/);
});
