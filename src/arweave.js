import { sha256 } from '@noble/hashes/sha256';
import { ARWEAVE_GATEWAY, ARWEAVE_GRAPHQL, SEREY_ARWEAVE_OWNERS } from './config.js';
import { toHex } from './cid.js';

const ID = /^[A-Za-z0-9_-]{43}$/;

// A transaction ID, or an arweave.net link to one (the gateway's sandbox subdomain included).
export function parseArweaveId(text) {
  const raw = String(text || '').trim();
  if (ID.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !/(^|\.)arweave\.net$/.test(url.hostname)) return null;
    return url.pathname.split('/').find((s) => ID.test(s)) || null;
  } catch {
    return null;
  }
}

export const isSereyWallet = (owner) => SEREY_ARWEAVE_OWNERS.includes(owner);

export const arweaveUrl = (id) => `${ARWEAVE_GATEWAY}/${id}`;

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

// Tags are written by whoever uploaded, so they are only ever shown as text.
export function cleanTx(node) {
  if (!node || !ID.test(str(node.id))) return null;
  const tags = (Array.isArray(node.tags) ? node.tags : []).map((t) => ({ name: str(t && t.name), value: str(t && t.value) }));
  return {
    id: node.id,
    tags,
    s5Cid: (tags.find((t) => t.name === 'S5-CID') || {}).value || '',
    size: num(node.data && node.data.size),
    type: str(node.data && node.data.type),
    owner: str(node.owner && node.owner.address),
    height: num(node.block && node.block.height),
    time: num(node.block && node.block.timestamp),
  };
}

async function graphql(query, variables, { signal, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(ARWEAVE_GRAPHQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal,
  });
  if (!res.ok) throw new Error(`Arweave answered ${res.status}`);
  const body = await res.json();
  if (body.errors) throw new Error('Arweave could not answer that');
  return body.data;
}

// null when the network does not know the ID (a new upload can take a few minutes to appear).
export async function fetchTx(id, opts) {
  const data = await graphql(
    'query($id:ID!){transaction(id:$id){id owner{address} data{size type} tags{name value} block{height timestamp}}}',
    { id },
    opts,
  );
  return cleanTx(data && data.transaction);
}

// { "<s5 cid>": ["<arweave id>", ...] } for every CID that Serey's wallet copied to Arweave.
export async function findCopies(cids, opts) {
  const list = [...new Set(cids)];
  const found = {};
  if (!list.length) return found;
  const data = await graphql(
    'query($c:[String!]!,$o:[String!]){transactions(owners:$o,tags:[{name:"S5-CID",values:$c}],first:100,sort:HEIGHT_DESC){edges{node{id owner{address} tags{name value}}}}}',
    { c: list, o: SEREY_ARWEAVE_OWNERS },
    opts,
  );
  const edges = (data && data.transactions && data.transactions.edges) || [];
  for (const { node } of edges) {
    const tx = cleanTx(node);
    if (!tx || !list.includes(tx.s5Cid) || !isSereyWallet(tx.owner)) continue;
    const ids = (found[tx.s5Cid] = found[tx.s5Cid] || []);
    if (!ids.includes(tx.id)) ids.push(tx.id);
  }
  return found;
}

// A stored post text has no S5 copy; Serey tags it with its SHA-256 instead. '' when there is none.
export function textSha(tx) {
  const value = ((tx && tx.tags.find((t) => t.name === 'Content-SHA256')) || {}).value || '';
  return /^[0-9a-f]{64}$/.test(value) ? value : '';
}

// Post texts are small; nothing bigger is downloaded as one.
export const TEXT_MAX_BYTES = 1024 * 1024;

export async function verifyText(id, expected, { signal, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(arweaveUrl(id), { signal });
  if (!res.ok) throw new Error(`Arweave answered ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > TEXT_MAX_BYTES) throw new Error('This file is too big to be a post text');
  const gotHex = toHex(sha256(bytes));
  return { ok: gotHex === expected, gotHex, bytes };
}
