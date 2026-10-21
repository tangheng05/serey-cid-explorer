import { SEREY_API } from './config.js';
import { parseArweaveId } from './arweave.js';

const NAME = /^[a-z0-9][a-z0-9.-]{1,31}$/;
const PERMLINK = /^[a-z0-9][a-z0-9-]{0,255}$/i;

// Community sites put a section before the post: chhay.serey.io/gallery/<account>/<permlink>, /video/..., and so on.
const COMMUNITY_POST = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*serey\.io\/(?!sereyexplorer\/|api\/)[a-z0-9-]+\/([^/?#\s]+)\/([^/?#\s]+)/i;

// Video pages name the post in the query: <name>.serey.io/video-component/watch?author=<account>&permalink=<permlink>.
const QUERY_LINK = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*serey\.io\/[^?#\s]*\?([^#\s]+)/i;

function postFromQuery(raw) {
  const m = raw.match(QUERY_LINK);
  if (!m) return null;
  const params = new URLSearchParams(m[1]);
  const author = (params.get('author') || '').toLowerCase();
  const permlink = params.get('permalink') || params.get('permlink') || '';
  return NAME.test(author) && PERMLINK.test(permlink) ? { author, permlink } : null;
}

// A podcast episode is named by its number: <name>.serey.io/podcast?episode=3097, or /<community>/podcast?episode=3097.
const PODCAST_LINK = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*serey\.io\/(?:[^?#\s]*\/)?podcast\/?\?([^#\s]+)/i;

export function parsePodcastLink(text) {
  const m = String(text || '').trim().match(PODCAST_LINK);
  if (!m) return null;
  const episode = new URLSearchParams(m[1]).get('episode') || '';
  return /^[1-9]\d{0,9}$/.test(episode) ? Number(episode) : null;
}

// A Serey post named by a link or a short "@account/permlink": serey.io/authors/<account>/<permlink>,
// a community link such as <name>.serey.io/gallery/<account>/<permlink>, any serey link with
// /@<account>/<permlink>, or this site's own /post/<account>/<permlink>.
export function parsePostLink(text) {
  const raw = String(text || '').trim();
  const byQuery = postFromQuery(raw);
  if (byQuery) return byQuery;
  const m = raw.match(/\/(?:authors|post)\/([^/?#\s]+)\/([^/?#\s]+)/)
    || raw.match(/(?:^|\/)@([^/?#\s]+)\/([^/?#\s]+)/)
    || raw.match(COMMUNITY_POST);
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

// The post's title and the Arweave ID of its text (null when it has none); they only label the page.
export async function fetchPostInfo({ author, permlink }, opts) {
  try {
    const body = await getJson(`${SEREY_API}/api/v1/sereyweb/getDetailByPermlink?permlink=${encodeURIComponent(permlink)}&authorName=${encodeURIComponent(author)}`, opts);
    const raw = body && body.content && body.content.title;
    // Titles can carry HTML entities (&amp;); only their text is kept. A parsed document runs nothing.
    const title = typeof raw === 'string' ? new DOMParser().parseFromString(raw, 'text/html').documentElement.textContent.replace(/\s+/g, ' ').trim() : '';
    const doc = body && body.forever && body.forever.document;
    return { title: title || null, textArweave: parseArweaveId(doc && doc.arweave_id) };
  } catch {
    return { title: null, textArweave: null };
  }
}

// The author and permlink of an episode, which is where its stored files are listed; null when Serey does not know it.
export async function fetchEpisode(id, opts) {
  let body;
  try {
    body = await getJson(`${SEREY_API}/api/v2/podcast/get-by-id/${id}`, opts);
  } catch (e) {
    if (/ 404$/.test(e.message)) return null;
    throw e;
  }
  const p = body && body.podcast;
  const author = p && typeof p.author === 'string' ? p.author.toLowerCase() : '';
  const permlink = p && typeof p.permlink === 'string' ? p.permlink : '';
  if (!NAME.test(author) || !PERMLINK.test(permlink)) return null;
  const title = typeof p.title === 'string' ? p.title.replace(/\s+/g, ' ').trim() : '';
  return { author, permlink, title: title || null, episode: id };
}

export const episodeUrl = (id) => `https://serey.io/podcast?episode=${id}`;

export const postUrl = ({ author, permlink }) => `https://serey.io/authors/${encodeURIComponent(author)}/${encodeURIComponent(permlink)}`;
export const explorerUrl = ({ author, permlink }) => `https://serey.io/sereyexplorer/explorer/@${encodeURIComponent(author)}/${encodeURIComponent(permlink)}`;
