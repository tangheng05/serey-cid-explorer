import { parseCid } from './cid.js';
import { parseArweaveId } from './arweave.js';
import { parsePostLink, parsePodcastLink } from './serey.js';
import { fileSize } from './format.js';

// What was pasted, and how to say so under the box. Nothing here asks the network.
export function classify(value) {
  const text = String(value || '').trim();
  if (!text) return { kind: 'empty', label: '' };
  const episode = parsePodcastLink(text);
  if (episode) return { kind: 'episode', episode, label: 'Serey podcast episode' };
  const post = parsePostLink(text);
  if (post) return { kind: 'post', post, label: `Serey post by @${post.author}` };
  const arweaveId = parseArweaveId(text);
  if (arweaveId) return { kind: 'arweave', arweaveId, label: 'Arweave ID' };
  const cid = parseCid(text);
  if (cid.ok) return { kind: 'cid', cid, label: `S5 file ID, ${fileSize(cid.size)}` };
  return { kind: 'invalid', cid, label: cid.kind === 'ipfs' ? 'An IPFS ID, which Serey does not use' : 'Not an ID this page knows' };
}

// The fingerprint every copy of an S5 file must match.
export const fingerprintOf = (cid) => ({ kind: 'blake3', hash: cid.hash, hashHex: cid.hashHex, size: cid.size });
