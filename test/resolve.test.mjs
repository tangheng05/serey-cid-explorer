import test from 'node:test';
import assert from 'node:assert';
import { sealCells, fromHex } from '../src/seal.js';
import { classify } from '../src/resolve.js';

const HASH = fromHex('7277588bfd24e5844feb9626b3dd4b3bf94068f6016809386e59cc50ecc13dce');

test('a fingerprint always draws the same seal, mirrored, and one changed bit draws another', () => {
  const cells = sealCells(HASH);
  assert.deepStrictEqual(sealCells(HASH), cells);
  const key = (c) => c.map(([x, y]) => `${x},${y}`).sort().join(' ');
  assert.strictEqual(key(cells), key(cells.map(([x, y]) => [4 - x, y])), 'left and right mirror each other');
  const other = HASH.slice();
  other[0] ^= 1;
  assert.notStrictEqual(key(sealCells(other)), key(cells));
});

test('what was pasted is named before anything is asked', () => {
  assert.deepStrictEqual(classify('  '), { kind: 'empty', label: '' });
  assert.strictEqual(classify('https://chhay.serey.io/gallery/chhaylin/some-post').label, 'Serey post by @chhaylin');
  assert.strictEqual(classify('idlHA5FknbCa9gyT23wn_aZ2Hw9--MdslRIR6yQN-uY').label, 'Arweave ID');
  assert.strictEqual(classify('z2H78ykZ1s4ED35ukefijV9f4sRcjMmTMAS4BatAUarUyj6JkTE1').label, 'S5 file ID, 183 KB');
  assert.strictEqual(classify('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG').label, 'An IPFS ID, which Serey does not use');
  assert.strictEqual(classify('hello').kind, 'invalid');
});
