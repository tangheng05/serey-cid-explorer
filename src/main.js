import { parseCid, fromHex } from './cid.js';
import { fetchTx, textSha } from './arweave.js';
import { parsePostLink, postUrl, fetchEpisode, episodeUrl } from './serey.js';
import { h, external, paintExpiry } from './ui.js';
import { classify, fingerprintOf } from './resolve.js';
import { renderFile, renderTx, releaseFile, problemCard } from './file-view.js';
import { renderPost, releasePost } from './post.js';

const input = document.getElementById('cid-input');
const intro = document.getElementById('intro');
const out = document.getElementById('output');
const clear = document.getElementById('clear');
const recognised = document.getElementById('recognised');

let generation = 0;
let controller = null;

// An Arweave ID names its file through its tags: an S5 ID for a file, a SHA-256 for a post text.
async function openArweave(id, ctx) {
  out.append(h('section', { class: 'card loading-card' }, h('span', { class: 'spinner' }), 'Looking up this Arweave ID…'));
  let tx;
  try {
    tx = await fetchTx(id, ctx);
  } catch (e) {
    if (!ctx.isCurrent()) return;
    const why = e && e.name === 'TypeError' ? 'Arweave could not be reached from this page' : (e.message || String(e));
    out.replaceChildren(problemCard('alert', 'Could not look this up', `${why}. Try again in a moment.`));
    return;
  }
  if (!ctx.isCurrent()) return;
  out.replaceChildren();
  if (!tx) {
    out.append(problemCard('file', 'Arweave does not know this ID', 'Check the ID. A file uploaded in the last few minutes can take a while to appear.'));
    return;
  }
  const cid = parseCid(tx.s5Cid);
  const sha = textSha(tx);
  const arweave = { id, tx };
  if (cid.ok) renderFile(out, { ...ctx, fp: fingerprintOf(cid), cid, arweave });
  else if (sha) renderFile(out, { ...ctx, fp: { kind: 'sha256', hash: fromHex(sha), hashHex: sha, size: tx.size || 0 }, arweave });
  else renderTx(out, tx);
}

// An episode link names a number; Serey says whose episode it is, and its files are listed like a post's.
async function openEpisode(id, ctx) {
  out.append(h('section', { class: 'card loading-card' }, h('span', { class: 'spinner' }), 'Looking up this episode…'));
  let post;
  try {
    post = await fetchEpisode(id, ctx);
  } catch (e) {
    if (!ctx.isCurrent()) return;
    const why = e && e.name === 'TypeError' ? "Serey's API could not be reached from this page" : (e.message || String(e));
    out.replaceChildren(problemCard('alert', 'Could not look this episode up', `${why}. Try again in a moment.`));
    return;
  }
  if (!ctx.isCurrent()) return;
  out.replaceChildren();
  if (!post) {
    out.append(problemCard('file', 'Serey does not know this episode', 'Check the link. The episode may have been deleted, or it is not public.'));
    return;
  }
  renderPost(out, post, ctx);
}

function render(value) {
  generation += 1;
  const gen = generation;
  if (controller) controller.abort();
  controller = new AbortController();
  releaseFile();
  releasePost();
  out.replaceChildren();

  const what = classify(value);
  recognised.textContent = what.label;
  recognised.dataset.kind = what.kind;
  intro.hidden = what.kind !== 'empty';
  clear.hidden = what.kind === 'empty';
  document.body.classList.toggle('has-result', what.kind !== 'empty');
  const ctx = { signal: controller.signal, isCurrent: () => gen === generation };

  if (what.kind === 'post') renderPost(out, what.post, ctx);
  else if (what.kind === 'episode') openEpisode(what.episode, ctx);
  else if (what.kind === 'arweave') openArweave(what.arweaveId, ctx);
  else if (what.kind === 'cid') renderFile(out, { ...ctx, fp: fingerprintOf(what.cid), cid: what.cid });
  else if (what.kind === 'invalid') {
    const extra = what.cid.kind === 'ipfs' ? h('p', null, external(`https://cid.ipfs.tech/#${encodeURIComponent(what.cid.ipfs)}`, 'Open it in the IPFS CID inspector')) : null;
    out.append(problemCard('alert', 'Not an ID this page can check', what.cid.message || 'Paste a Serey post link, an S5 file ID or an Arweave ID.', extra));
  }
}

// Offers count down while the page is open.
setInterval(() => document.querySelectorAll('.expiry').forEach(paintExpiry), 30000);

// The header gets a shadow once the page scrolls under it.
const top = document.querySelector('.top');
const onScroll = () => top.classList.toggle('scrolled', window.scrollY > 4);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();


// A CID arrives as cid.serey.io/<cid> (the link from the Serey Explorer) or, from older links, #<cid>.
// A post opens as cid.serey.io/post/<account>/<permlink> and an episode as /podcast/<number>; the box then shows its Serey link.
function fromUrl() {
  const raw = window.location.hash.slice(1) || window.location.pathname.slice(1);
  if (raw.startsWith('post/')) {
    const post = parsePostLink(`/${raw}`);
    return post ? postUrl(post) : '';
  }
  const episode = raw.match(/^podcast\/([1-9]\d{0,9})$/);
  if (episode) return episodeUrl(episode[1]);
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return ''; // an unreadable address is just empty
  }
}

function show(value) {
  const what = classify(value);
  const text = value.trim();
  const path = what.kind === 'post' ? `/post/${encodeURIComponent(what.post.author)}/${encodeURIComponent(what.post.permlink)}`
    : what.kind === 'episode' ? `/podcast/${what.episode}`
    : what.kind === 'arweave' ? `/${what.arweaveId}`
      : `/${text ? encodeURIComponent(text) : ''}`;
  window.history.replaceState(null, '', path);
  render(value);
}

input.addEventListener('input', () => show(input.value));

clear.addEventListener('click', () => {
  input.value = '';
  show('');
  input.focus();
});

document.querySelectorAll('[data-example]').forEach((button) => {
  button.addEventListener('click', () => {
    input.value = button.dataset.example;
    show(input.value);
  });
});

window.addEventListener('hashchange', () => {
  const value = fromUrl();
  if (value !== input.value.trim()) {
    input.value = value;
    render(value);
  }
});

input.value = fromUrl();
render(input.value);
