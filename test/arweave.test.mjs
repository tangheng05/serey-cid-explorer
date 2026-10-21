import test from 'node:test';
import assert from 'node:assert';
import { parseArweaveId, cleanTx, fetchTx, findCopies } from '../src/arweave.js';

const ID = 'idlHA5FknbCa9gyT23wn_aZ2Hw9--MdslRIR6yQN-uY';
const CID = 'z2H78ykZ1s4ED35ukefijV9f4sRcjMmTMAS4BatAUarUyj6JkTE1';
// The shape arweave.net/graphql returned for a real Serey upload.
const NODE = {
  id: ID,
  owner: { address: 'OWbotbFOnhyFMY309nf7DyM_ZA_YNWX408bA_9aoM6w' },
  data: { size: '187254', type: 'image/jpeg' },
  tags: [{ name: 'App-Name', value: 'Serey' }, { name: 'S5-CID', value: CID }],
  block: { height: 2018071, timestamp: 1791582380 },
};

test('an ID, or an arweave.net link to one, is recognised', () => {
  assert.strictEqual(parseArweaveId(ID), ID);
  assert.strictEqual(parseArweaveId(` ${ID} `), ID);
  assert.strictEqual(parseArweaveId(`https://arweave.net/${ID}`), ID);
  assert.strictEqual(parseArweaveId(`https://arweave.net/raw/${ID}`), ID);
  assert.strictEqual(parseArweaveId(`https://rhmuoa4rmso3bgxwbsj5w7bh7wthmhypp34mo3evcii6wjan7lta.arweave.net/${ID}`), ID);
});

test('anything else is not taken for an Arweave ID', () => {
  for (const bad of ['', CID, ID.slice(1), `${ID}x`, `http://arweave.net/${ID}`, `https://evilarweave.net/${ID}`, `https://arweave.net.evil.test/${ID}`, 'https://arweave.net/']) {
    assert.strictEqual(parseArweaveId(bad), null, bad);
  }
});

test('a transaction is read as is, and junk is tolerated', () => {
  const tx = cleanTx(NODE);
  assert.strictEqual(tx.s5Cid, CID);
  assert.strictEqual(tx.size, 187254);
  assert.strictEqual(tx.height, 2018071);
  const bare = cleanTx({ id: ID, tags: 'no', data: null, block: null });
  assert.deepStrictEqual([bare.s5Cid, bare.size, bare.height, bare.time], ['', null, null, null]);
  for (const bad of [null, {}, { id: 'short' }]) assert.strictEqual(cleanTx(bad), null);
});

test('the lookup sends the ID as a variable, and a missing transaction is null', async () => {
  let sent;
  const got = await fetchTx(ID, { fetchImpl: async (_, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ data: { transaction: NODE } })); } });
  assert.deepStrictEqual(sent.variables, { id: ID });
  assert.strictEqual(got.id, ID);
  assert.strictEqual(await fetchTx(ID, { fetchImpl: async () => new Response(JSON.stringify({ data: { transaction: null } })) }), null);
});

test('copies are matched by their own CID tag, once each', async () => {
  const other = { ...NODE, id: 'B'.repeat(43), tags: [{ name: 'S5-CID', value: 'zOTHER' }] };
  const edges = [{ node: NODE }, { node: NODE }, { node: other }];
  const found = await findCopies([CID, CID], { fetchImpl: async () => new Response(JSON.stringify({ data: { transactions: { edges } } })) });
  assert.deepStrictEqual(found, { [CID]: [ID] });
  assert.deepStrictEqual(await findCopies([], { fetchImpl: () => { throw new Error('asked'); } }), {});
});

test("only Serey's wallet counts as a copy: anyone can tag an upload with a CID", async () => {
  let sent;
  const fake = { ...NODE, id: 'F'.repeat(43), owner: { address: 'someone-else' } };
  const found = await findCopies([CID], { fetchImpl: async (_, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ data: { transactions: { edges: [{ node: fake }, { node: NODE }] } } })); } });
  assert.deepStrictEqual(sent.variables.o, [NODE.owner.address], 'the query asks for that wallet');
  assert.deepStrictEqual(found, { [CID]: [ID] });
});

test('a failing network is an error, not an empty answer', async () => {
  await assert.rejects(fetchTx(ID, { fetchImpl: async () => new Response('x', { status: 503 }) }), /503/);
  await assert.rejects(fetchTx(ID, { fetchImpl: async () => new Response(JSON.stringify({ errors: [{}] })) }), /could not answer/);
});
