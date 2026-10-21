import { parseCid } from './cid.js';
import { parseArweaveId } from './arweave.js';
import { parsePostLink, parsePodcastLink } from './serey.js';

// What was pasted. Nothing here asks the network.
export function classify(value) {
  const text = String(value || '').trim();
  if (!text) return { kind: 'empty' };
  const episode = parsePodcastLink(text);
  if (episode) return { kind: 'episode', episode };
  const post = parsePostLink(text);
  if (post) return { kind: 'post', post };
  const arweaveId = parseArweaveId(text);
  if (arweaveId) return { kind: 'arweave', arweaveId };
  const cid = parseCid(text);
  if (cid.ok) return { kind: 'cid', cid };
  return { kind: 'invalid', cid };
}

// The fingerprint every copy of an S5 file must match.
export const fingerprintOf = (cid) => ({ kind: 'blake3', hash: cid.hash, hashHex: cid.hashHex, size: cid.size });
