// node scripts/live-check.mjs [cid]
// The page's whole job, without a browser: decode, ask the Serey node where the
// file is, download it, and prove its bytes hash to the CID.
import { parseCid } from '../src/cid.js';
import { fetchLocations } from '../src/nodes.js';
import { verifyUrl } from '../src/verify.js';
import { SEREY_NODE, OTHER_NODES } from '../src/config.js';
import { fileSize } from '../src/format.js';

const input = process.argv[2] || 'z2H72Rjmp9QkiGfccgpNhFPWN1F8DF3tWCcRjGZfi1aGYAVZK1qK';
const cid = parseCid(input);
if (!cid.ok) {
  console.error(`not usable: ${cid.message}`);
  process.exit(2);
}
console.log(`CID     ${cid.cid}\nsize    ${fileSize(cid.size)} (${cid.size} bytes)\nhash    ${cid.hashHex}`);

for (const node of [SEREY_NODE, ...OTHER_NODES]) {
  try {
    const locations = await fetchLocations(node, cid.key);
    console.log(`${node.name.padEnd(14)} knows it: ${locations.length ? locations.map((l) => `${l.type} ${l.parts[0] || '(no https address)'}`).join(', ') : 'no'}`);
  } catch (e) {
    console.log(`${node.name.padEnd(14)} ${e.message}`);
  }
}

const locations = await fetchLocations(SEREY_NODE, cid.key);
const url = locations.flatMap((l) => l.parts)[0];
if (!url) {
  console.error('the Serey node has no downloadable address for this file');
  process.exit(1);
}

const started = Date.now();
const res = await verifyUrl(url, cid, { onProgress: () => {} });
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\ndownloaded ${fileSize(res.gotBytes)} from ${new URL(url).host} in ${seconds}s`);
console.log(`hash   ${res.hashOk ? 'MATCHES' : 'DIFFERENT'}  (${res.gotHashHex})`);
console.log(`size   ${res.sizeOk ? 'MATCHES' : 'DIFFERENT'}`);
console.log(res.ok ? '\nVERIFIED: these bytes are exactly what the CID names' : '\nNOT VERIFIED');
process.exit(res.ok ? 0 : 1);
