import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { blake3 } from '@noble/hashes/blake3';
import { buildRawCid, parseCid } from '../src/cid.js';

// The real bundle, in a simulated browser, with every service faked.
const bundle = (await build({ entryPoints: ['src/main.js'], bundle: true, write: false, format: 'iife', target: 'es2020' })).outputFiles[0].text;
const html = await readFile('index.html', 'utf8');

export const SEREY_WALLET = 'OWbotbFOnhyFMY309nf7DyM_ZA_YNWX408bA_9aoM6w';
export const POST = 'https://serey.io/sereyexplorer/explorer/@chhaylin/bruce-lee-and-daoism';
export const png = (seed, length = 1500) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length }, (_, i) => (i * seed) % 256)]);
export const cidOf = (bytes, size = bytes.length) => buildRawCid(blake3(bytes), size);
export const location = (key, extra = {}) => ({ locations: [{ type: 3, parts: [`https://storage.serey.io/blob/1/${key}`], expiry: Math.floor(Date.now() / 1000) + 86400 * 3, nodeId: 'z2DXAXfpQUWWjMxxC6nu15PAN2g73pYy3EUVFq3bDddZdSb', score: 1, ...extra }] });

const answer = (v) => (typeof v === 'number' ? new Response('', { status: v }) : new Response(v instanceof Uint8Array || typeof v === 'string' ? v : JSON.stringify(v)));

/*
| files: CID -> bytes (or a status) kept on S5. serey / garden / blob override what
| the S5 node, S5 Garden and storage answer for every file. copies: CID -> Arweave ID
| of Serey's copy; arweaveFiles: Arweave ID -> bytes; txs: Arweave ID -> transaction.
*/
export function network({ files = {}, serey, garden = 404, blob, media = [], title = 'Bruce Lee and Daoism', textArweave = null, copies = {}, arweaveFiles = {}, txs = {} } = {}) {
  const calls = [];
  const keyOf = () => Object.fromEntries(Object.keys(files).map((c) => [parseCid(c).key, c]));
  const fetchFake = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith('https://s5.serey.io/')) {
      if (serey !== undefined) return answer(serey);
      const key = u.split('/').pop();
      return keyOf()[key] ? answer(location(key)) : answer(404);
    }
    if (u.startsWith('https://s5.garden/')) return answer(garden);
    if (u.startsWith('https://storage.serey.io/blob/1/')) return answer(blob !== undefined ? blob : files[keyOf()[u.split('/').pop()]] ?? 404);
    if (u.includes('/api/v2/podcast/get-by-id/7')) return answer({ podcast: { id: 7, author: 'chhaylin', permlink: 'bruce-lee-and-daoism', title: 'Episode seven' } });
    if (u.includes('/api/v2/podcast/get-by-id/')) return answer(404);
    if (u.includes('/api/v2/media-proof/posts/chhaylin/bruce-lee-and-daoism')) return typeof media === 'number' ? answer(media) : answer({ media });
    if (u.includes('/api/v1/sereyweb/getDetailByPermlink')) return answer({ content: { title }, forever: textArweave ? { document: { arweave_id: textArweave } } : null });
    if (u === 'https://arweave.net/graphql') {
      const body = JSON.parse(init.body);
      if (body.query.includes('transaction(id')) return answer({ data: { transaction: txs[body.variables.id] || null } });
      const edges = Object.entries(copies).filter(([cid]) => body.variables.c.includes(cid)).map(([cid, id]) => ({ node: { id, owner: { address: SEREY_WALLET }, tags: [{ name: 'S5-CID', value: cid }] } }));
      return answer({ data: { transactions: { edges } } });
    }
    if (u.startsWith('https://arweave.net/')) return answer(arweaveFiles[u.split('/').pop()] ?? 404);
    throw new Error(`unexpected request: ${u}`);
  };
  return { fetchFake, calls };
}

export async function open(net, { path = '', hash = '' } = {}) {
  const dom = new JSDOM(html, { url: `https://cid.serey.io/${path}${hash ? `#${hash}` : ''}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.setInterval = () => 0; // the offer countdown would keep the test run alive
  window.fetch = net.fetchFake;
  window.TextDecoder = TextDecoder;
  window.URL.createObjectURL = () => 'blob:preview';
  window.URL.revokeObjectURL = () => {};
  window.eval(bundle);
  const doc = window.document;
  return {
    window,
    doc,
    text: () => doc.getElementById('output').textContent,
    button: (label) => [...doc.querySelectorAll('#output button')].find((b) => b.textContent.includes(label)),
    state: (place) => { const el = doc.querySelector(`.record .copy-row[data-place='${place}']`); return el && el.dataset.state; },
    copy: (place) => doc.querySelector(`.record .copy-row[data-place='${place}']`),
    rows: () => [...doc.querySelectorAll('.file')],
    type: (value) => { const el = doc.getElementById('cid-input'); el.value = value; el.dispatchEvent(new window.Event('input')); },
  };
}

export async function until(check, what, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`timed out waiting for: ${what}`);
}
