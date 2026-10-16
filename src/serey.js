import { SEREY_API } from './config.js';

const NAME = /^[a-z0-9][a-z0-9.-]{1,31}$/;
const PERMLINK = /^[a-z0-9][a-z0-9-]{0,255}$/i;

// A Serey post named by a link or a short "@account/permlink": serey.io/authors/<account>/<permlink>,
// any serey link with /@<account>/<permlink>, or this site's own /post/<account>/<permlink>.
export function parsePostLink(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/\/(?:authors|post)\/([^/?#\s]+)\/([^/?#\s]+)/) || raw.match(/(?:^|\/)@([^/?#\s]+)\/([^/?#\s]+)/);
  if (!m) return null;
  let author;
  let permlink;
  try {
    author = decodeURIComponent(m[1]).toLowerCase();
    permlink = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  if (!NAME.test(author) || !PERMLINK.test(permlink)) return null;
  return { author, permlink };
}

const KIND_NAMES = { images: 'Image', videos: 'Video', audio: 'Audio' };

// One row per S5 content ID of the post: each file, and a video's poster frame.
export function postRows(media) {
  const rows = [];
  const seen = new Set();
  for (const m of Array.isArray(media) ? media : []) {
    if (!m || typeof m !== 'object') continue;
    const name = KIND_NAMES[m.kind] || 'File';
    if (typeof m.s5_cid === 'string' && m.s5_cid && !seen.has(m.s5_cid)) {
      seen.add(m.s5_cid);
      rows.push({ cid: m.s5_cid, name, role: 'file', kind: m.kind });
    }
    if (typeof m.s5_thumb_cid === 'string' && m.s5_thumb_cid && !seen.has(m.s5_thumb_cid)) {
      seen.add(m.s5_thumb_cid);
      rows.push({ cid: m.s5_thumb_cid, name: 'Video poster', role: 'poster', kind: 'images' });
    }
  }
  // "Image 1", "Image 2" when a name repeats; plain "Image" when it does not.
  const total = {};
  rows.forEach((r) => { total[r.name] = (total[r.name] || 0) + 1; });
  const counter = {};
  return rows.map((r) => {
    counter[r.name] = (counter[r.name] || 0) + 1;
    return { ...r, label: total[r.name] > 1 ? `${r.name} ${counter[r.name]}` : r.name };
  });
}

const getJson = async (url, { signal, fetchImpl = fetch } = {}) => {
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new Error(`Serey answered ${res.status}`);
  return res.json();
};

export async function fetchPostMedia({ author, permlink }, opts) {
  const body = await getJson(`${SEREY_API}/api/v2/media-proof/posts/${encodeURIComponent(author)}/${encodeURIComponent(permlink)}`, opts);
  return Array.isArray(body && body.media) ? body.media : [];
}

// The post's title, or null; it only labels the page.
export async function fetchPostTitle({ author, permlink }, opts) {
  try {
    const body = await getJson(`${SEREY_API}/api/v1/sereyweb/getDetailByPermlink?permlink=${encodeURIComponent(permlink)}&authorName=${encodeURIComponent(author)}`, opts);
    const raw = body && body.content && body.content.title;
    if (typeof raw !== 'string') return null;
    // Titles can carry HTML entities (&amp;); only their text is kept. A parsed document runs nothing.
    const title = new DOMParser().parseFromString(raw, 'text/html').documentElement.textContent.replace(/\s+/g, ' ').trim();
    return title || null;
  } catch {
    return null;
  }
}

export const postUrl = ({ author, permlink }) => `https://serey.io/authors/${encodeURIComponent(author)}/${encodeURIComponent(permlink)}`;
export const explorerUrl = ({ author, permlink }) => `https://serey.io/sereyexplorer/explorer/@${encodeURIComponent(author)}/${encodeURIComponent(permlink)}`;
