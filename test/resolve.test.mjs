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
