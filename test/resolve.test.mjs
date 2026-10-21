import test from 'node:test';
import assert from 'node:assert';
import { classify } from '../src/resolve.js';

test('what was pasted is named before anything is asked', () => {
  assert.deepStrictEqual(classify('  '), { kind: 'empty', label: '' });
  assert.strictEqual(classify('https://chhay.serey.io/gallery/chhaylin/some-post').label, 'Serey post by @chhaylin');
  assert.strictEqual(classify('idlHA5FknbCa9gyT23wn_aZ2Hw9--MdslRIR6yQN-uY').label, 'Arweave ID');
  assert.strictEqual(classify('z2H78ykZ1s4ED35ukefijV9f4sRcjMmTMAS4BatAUarUyj6JkTE1').label, 'S5 file ID, 183 KB');
  assert.strictEqual(classify('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG').label, 'An IPFS ID, which Serey does not use');
  assert.strictEqual(classify('hello').kind, 'invalid');
});
