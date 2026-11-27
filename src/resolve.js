import { parseCid } from './cid.js';
import { parseArweaveId } from './arweave.js';
import { parsePostLink, parsePodcastLink } from './serey.js';

// This site's own share links and S5 blob links carry the ID as their last path segment.
function idFromLink(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const own = url.hostname === 'cid.serey.io' && !/^\/(post|podcast)\//.test(url.pathname);
  if (!own && !url.pathname.startsWith('/s5/blob/')) return null;
  try {
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
  } catch {
    return null;
  }
}

// What was pasted. Nothing here asks the network.
export function classify(value) {
  const raw = String(value || '').trim();
  if (!raw) return { kind: 'empty' };
  const text = idFromLink(raw) || raw;
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
