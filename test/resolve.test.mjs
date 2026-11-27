import test from 'node:test';
import assert from 'node:assert';
import { classify } from '../src/resolve.js';

test('what was pasted is told apart before anything is asked', () => {
  const kind = (text) => classify(text).kind;
  assert.strictEqual(kind('  '), 'empty');
  assert.strictEqual(kind('https://chhay.serey.io/gallery/chhaylin/some-post'), 'post');
  assert.strictEqual(kind('https://serey.io/podcast?episode=3097'), 'episode');
  assert.strictEqual(kind('idlHA5FknbCa9gyT23wn_aZ2Hw9--MdslRIR6yQN-uY'), 'arweave');
  assert.strictEqual(kind('z2H78ykZ1s4ED35ukefijV9f4sRcjMmTMAS4BatAUarUyj6JkTE1'), 'cid');
  assert.strictEqual(kind('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'), 'invalid');
  assert.strictEqual(kind('hello'), 'invalid');
});

test('links that carry an ID in their path open that ID', () => {
  const cid = 'z2H72Rjmp9QkiGfccgpNhFPWN1F8DF3tWCcRjGZfi1aGYAVZK1qK';
  assert.strictEqual(classify(`https://cid.serey.io/${cid}`).kind, 'cid');
  assert.strictEqual(classify(`https://cid.serey.io/${'A'.repeat(43)}`).kind, 'arweave');
  assert.strictEqual(classify(`https://s5.serey.io/s5/blob/${cid}`).kind, 'cid');
  assert.strictEqual(classify('https://cid.serey.io/post/chhaylin/some-post').kind, 'post');
});
