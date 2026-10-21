import { parseCid } from './cid.js';
import { sniffImage } from './verify.js';
import { fileSize } from './format.js';
import { findCopies, fetchTx, textSha, TEXT_MAX_BYTES } from './arweave.js';
import { h, fill, icon, external, mono, copyButton, concat } from './ui.js';
import { fetchPostMedia, fetchPostInfo, postRows, postUrl, explorerUrl } from './serey.js';
import { createCopy, copyRow, copyCell, limiter } from './copies.js';
import { fromHex } from './seal.js';
import { problemCard, short } from './file-view.js';

// Pictures up to this size are kept after their check, to show as thumbnails.
const THUMB_MAX_BYTES = 8 * 1024 * 1024;

let blobUrls = [];
export function releasePost() {
  blobUrls.forEach((u) => URL.revokeObjectURL(u));
  blobUrls = [];
}

const titleFromPermlink = (p) => {
  const words = p.replace(/-/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const KIND_ICON = { images: 'image', videos: 'play', audio: 'music', text: 'file' };
const SUB = { file: 'Attached to the post', poster: 'Poster frame of the video', text: 'The written post' };
const BUSY = ['idle', 'looking', 'finding', 'queued', 'checking'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Every file of a Serey post, and its text, each with its copy on S5 and on Arweave.
export function renderPost(out, post, { signal, isCurrent }) {
  const run = limiter(2);
  const title = h('h2', { class: 'post-title' }, titleFromPermlink(post.permlink));
  const summary = h('p', { class: 'post-summary' }, 'Loading the files of this post…');
  const segments = h('div', { class: 'segments' });
  const head = h(
    'section',
    { class: 'card post-head' },
    title,
    h('p', { class: 'post-by' }, 'A Serey post by ', h('strong', null, `@${post.author}`)),
    h('div', { class: 'post-links' }, external(postUrl(post), [icon('out'), 'Open on Serey'], 'chip-link'), external(explorerUrl(post), [icon('out'), 'Open in Serey Explorer'], 'chip-link')),
    h('div', { class: 'post-progress' }, segments, summary),
  );
  const list = h('div', { class: 'file-list' });
  const table = h(
    'section',
    { class: 'card files' },
    h('div', { class: 'files-head', 'aria-hidden': 'true' }, h('span', null, 'File'), h('span', null, 'On S5'), h('span', null, 'On Arweave'), h('span')),
    list,
  );
  out.append(head);

  const items = [];
  const info = fetchPostInfo(post, { signal });
  info.then(({ title: t }) => { if (t && isCurrent()) title.textContent = t; });

  fetchPostMedia(post, { signal }).then(async (media) => {
    if (!isCurrent()) return;
    const rows = postRows(media);
    const { textArweave } = await info;
    if (!isCurrent()) return;
    if (!rows.length && !textArweave) {
      summary.textContent = 'Nothing to check.';
      out.append(problemCard('file', 'This post has no stored files', 'Text-only posts, and posts published before Serey stored files on S5, have nothing to check.'));
      return;
    }
    out.append(table);
    addFiles(rows);
    if (textArweave) addText(textArweave);
    summarize();
  }).catch((e) => {
    if (!isCurrent()) return;
    summary.textContent = 'Could not load this post.';
    // A network or cross-origin failure has no status; say so in words.
    const why = e && e.name === 'TypeError' ? "Serey's API could not be reached from this page" : (e.message || String(e));
    out.append(problemCard('alert', 'Could not load the files of this post', `${why}. Check the link, or try again in a moment.`));
  });

  function addFiles(rows) {
    let lastVideo = null;
    for (const r of rows) {
      const cid = parseCid(r.cid);
      const fp = cid.ok ? { kind: 'blake3', hash: cid.hash, hashHex: cid.hashHex, size: cid.size } : { kind: 'blake3', size: 0 };
      const keep = r.kind === 'images' && cid.ok && cid.size <= THUMB_MAX_BYTES ? THUMB_MAX_BYTES : 0;
      const base = { fp, signal, isCurrent, run, keep };
      const s5 = createCopy({ ...base, place: 's5', cid });
      const ar = createCopy({ ...base, place: 'arweave' });
      const item = fileItem({ ...r, size: cid.ok ? cid.size : null, id: r.cid, href: `/${encodeURIComponent(r.cid)}` }, s5, ar);
      if (r.kind === 'videos' && r.role === 'file') lastVideo = item;
      if (r.role === 'poster') item.videoItem = lastVideo;
      if (!cid.ok) {
        s5.set('invalid', cid.message);
        ar.set('none');
        continue;
      }
      s5.locate();
      ar.set('looking');
    }

    // One query finds the Arweave copy of every file.
    const byCid = new Map(items.filter((i) => i.cid).map((i) => [i.cid, i]));
    findCopies([...byCid.keys()], { signal }).then((found) => {
      if (!isCurrent()) return;
      byCid.forEach((item, cid) => {
        const [id] = found[cid] || [];
        if (!id) {
          item.ar.about = 'Only Forever posts are kept on Arweave.';
          item.ar.set('none');
          return;
        }
        item.ar.attach(id);
        item.ar.auto();
      });
    }).catch((e) => {
      if (!isCurrent()) return;
      byCid.forEach((item) => { item.ar.retry = false; item.ar.set('failed', `Arweave did not answer (${e.message}).`); });
    });
  }

  // The post's text is kept on Arweave only, checked against the SHA-256 it was tagged with.
  function addText(id) {
    const fp = { kind: 'sha256', size: 0 };
    const s5 = createCopy({ fp, place: 's5', signal, isCurrent });
    const ar = createCopy({ fp, place: 'arweave', arweaveId: id, signal, isCurrent, run });
    const item = fileItem({ kind: 'text', role: 'text', label: 'Post text', id, href: `/${id}` }, s5, ar);
    s5.about = 'Post texts are kept on Arweave only.';
    s5.set('none');
    ar.set('looking');
    fetchTx(id, { signal }).then((tx) => {
      if (!isCurrent()) return;
      const sha = textSha(tx);
      if (!sha || (tx.size || 0) > TEXT_MAX_BYTES) {
        ar.retry = false;
        ar.set('failed', 'This upload carries no SHA-256 to check it against.');
        return;
      }
      Object.assign(fp, { hash: fromHex(sha), hashHex: sha, size: tx.size || 0 });
      item.setSize(tx.size);
      ar.auto();
    }).catch((e) => {
      if (!isCurrent()) return;
      ar.retry = false;
      ar.set('failed', `Arweave did not answer (${e.message}).`);
    });
  }

  function fileItem(r, s5, ar) {
    const thumb = h('div', { class: 'file-thumb' }, icon(KIND_ICON[r.kind] || 'file'));
    const sizeText = h('span', { class: 'file-size' }, r.size != null ? fileSize(r.size) : '');
    const toggle = h('button', { type: 'button', class: 'file-toggle', 'aria-expanded': 'false', 'aria-label': `Details of ${r.label}` }, icon('chevron'));
    const panel = h(
      'div',
      { class: 'file-details' },
      h(
        'div',
        { class: 'file-details-in' },
        h('div', { class: 'copy-list' }, copyRow(s5), copyRow(ar)),
        h('a', { class: 'link file-record', href: r.href, target: '_blank', rel: 'noopener' }, 'Open the full record', icon('out')),
      ),
    );
    const el = h(
      'article',
      { class: 'file' },
      thumb,
      h(
        'div',
        { class: 'file-main' },
        h('div', { class: 'file-name' }, h('strong', null, r.label), sizeText),
        h('div', { class: 'file-sub' }, SUB[r.role]),
        h('div', { class: 'file-cid' }, mono(short(r.id)), copyButton(r.id)),
      ),
      h('div', { class: 'file-copy' }, h('span', { class: 'file-copy-k' }, 'On S5'), copyCell(s5)),
      h('div', { class: 'file-copy' }, h('span', { class: 'file-copy-k' }, 'On Arweave'), copyCell(ar)),
      toggle,
      panel,
    );
    toggle.addEventListener('click', () => {
      const open = !el.classList.contains('open');
      el.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });

    const item = {
      el,
      s5,
      ar,
      cid: r.role !== 'text' && parseCid(r.id).ok ? r.id : null,
      videoItem: null,
      setSize(n) { if (n != null) sizeText.textContent = fileSize(n); },
      setThumb(url) {
        fill(thumb, h('img', { src: url, alt: '' }));
        thumb.classList.add('has-img');
      },
    };
    const onChange = (copy, progress) => {
      if (progress) return;
      el.dataset.state = [s5, ar].some((c) => c.state === 'bad') ? 'bad' : '';
      if (copy.state === 'ok' && copy.res.kept && !thumb.classList.contains('has-img')) {
        const bytes = concat(copy.res.kept);
        const type = sniffImage(bytes);
        if (type) {
          const u = URL.createObjectURL(new Blob([bytes], { type }));
          blobUrls.push(u);
          item.setThumb(u);
          if (item.videoItem && !item.videoItem.el.querySelector('.file-thumb img')) item.videoItem.setThumb(u);
        }
      }
      summarize();
    };
    s5.on(onChange);
    ar.on(onChange);
    items.push(item);
    list.append(el);
    return item;
  }

  // One sentence for the whole post, and one segment per copy.
  function summarize() {
    if (!items.length) return;
    const files = items.filter((i) => i.cid !== null || i.s5.state === 'invalid');
    const text = items.some((i) => !files.includes(i));
    const s5 = items.map((i) => i.s5).filter((c) => c.state !== 'none');
    const ar = items.map((i) => i.ar).filter((c) => c.state !== 'none');
    const all = [...s5, ...ar];
    if (segments.children.length !== all.length) fill(segments, all.map(() => h('span', { class: 'seg' })));
    all.forEach((c, n) => { segments.children[n].className = `seg ${c.state}`; });

    const what = `${files.length ? plural(files.length, 'file', 'files') : 'The post text'}${files.length && text ? ' and the post text' : ''}.`;
    const busy = all.filter((c) => BUSY.includes(c.state)).length;
    const count = (list2, state) => list2.filter((c) => c.state === state).length;
    let line;
    if (busy) {
      line = `Checking copies… ${all.length - busy} of ${all.length} done.`;
    } else {
      const parts = [];
      if (s5.length) parts.push(count(s5, 'ok') === s5.length ? 'All intact on S5' : `${count(s5, 'ok')} of ${s5.length} verified on S5`);
      if (ar.length) parts.push(count(ar, 'ok') === ar.length ? `${plural(ar.length, 'copy', 'copies')} kept on Arweave, all intact` : `${plural(ar.length, 'copy', 'copies')} kept on Arweave, ${count(ar, 'ok')} verified`);
      else parts.push('none kept on Arweave');
      const bad = count(all, 'bad');
      const waiting = count(all, 'waiting');
      if (bad) parts.push(`${bad} ${bad === 1 ? 'does' : 'do'} not match`);
      if (waiting) parts.push(`${waiting} waiting for you`);
      line = `${parts.join('; ')}.`;
    }
    summary.textContent = `${what} ${line.charAt(0).toUpperCase()}${line.slice(1)}`;
    const done = !busy && all.every((c) => c.state === 'ok');
    summary.className = `post-summary ${done ? 'ok' : count(all, 'bad') ? 'bad' : ''}`;
  }
}
