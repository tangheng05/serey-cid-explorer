import { parseCid } from './cid.js';
import { fetchLocations } from './nodes.js';
import { verifyUrl, sniffImage } from './verify.js';
import { fileSize } from './format.js';
import { SEREY_NODE, AUTO_VERIFY_MAX_BYTES, CONFIRM_ABOVE_BYTES } from './config.js';
import { h, fill, icon, external, mono, pill, copyButton, concat } from './ui.js';
import { fetchPostMedia, fetchPostTitle, postRows, postUrl, explorerUrl } from './serey.js';

// Pictures up to this size are kept after their check, to show as thumbnails.
const THUMB_MAX_BYTES = 8 * 1024 * 1024;
// How many files are checked at once.
const PARALLEL = 2;

let blobUrls = [];
export function releasePost() {
  blobUrls.forEach((u) => URL.revokeObjectURL(u));
  blobUrls = [];
}

const short = (cid) => (cid.length > 22 ? `${cid.slice(0, 10)}…${cid.slice(-8)}` : cid);
const titleFromPermlink = (p) => {
  const words = p.replace(/-/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const KIND_ICON = { images: 'image', videos: 'play', audio: 'music' };
const SUB = { file: 'Attached to the post', poster: 'Poster frame of the video' };

// Every file of a Serey post on one page: each S5 content ID is found and checked in turn.
export function renderPost(out, post, { signal, isCurrent }) {
  const title = h('h2', { class: 'post-title' }, titleFromPermlink(post.permlink));
  const summaryText = h('p', { class: 'post-summary' }, 'Loading the files of this post...');
  const segments = h('div', { class: 'segments' });
  const verifyAll = h('button', { type: 'button', class: 'btn primary', hidden: true }, icon('download'), 'Verify all');

  const head = h(
    'section',
    { class: 'card post-head' },
    h('span', { class: 'eyebrow' }, 'Serey post'),
    title,
    h('p', { class: 'post-by' }, 'by ', h('strong', null, `@${post.author}`)),
    h(
      'div',
      { class: 'post-links' },
      external(postUrl(post), [icon('out'), 'Open on Serey'], 'chip-link'),
      external(explorerUrl(post), [icon('out'), 'Open in Serey Explorer'], 'chip-link'),
    ),
    h('div', { class: 'post-progress' }, segments, h('div', { class: 'post-progress-row' }, summaryText, verifyAll)),
  );
  const list = h('div', { class: 'file-list' });
  const filesCard = h('section', { class: 'card files' }, h('header', { class: 'files-head' }, h('h2', null, 'Files'), h('span', { class: 'files-count' })), list);
  out.append(head);

  fetchPostTitle(post, { signal }).then((t) => { if (t && isCurrent()) title.textContent = t; });

  fetchPostMedia(post, { signal }).then((media) => {
    if (!isCurrent()) return;
    const rows = postRows(media);
    if (!rows.length) {
      summaryText.textContent = 'No files to check.';
      out.append(h('section', { class: 'card problem' }, h('div', { class: 'problem-icon' }, icon('file')), h('div', null, h('h2', null, 'No files on S5 for this post'), h('p', null, 'Text-only posts, and posts published before Serey stored files on S5, have no content IDs to check.'))));
      return;
    }
    filesCard.querySelector('.files-count').textContent = `${rows.length} ${rows.length === 1 ? 'file' : 'files'}`;
    out.append(filesCard);
    start(rows);
  }).catch((e) => {
    if (!isCurrent()) return;
    summaryText.textContent = 'Could not load this post.';
    // A network or cross-origin failure has no status; say so in words.
    const why = e && e.name === 'TypeError' ? "Serey's API could not be reached from this page" : (e.message || String(e));
    out.append(h('section', { class: 'card problem' }, h('div', { class: 'problem-icon' }, icon('alert')), h('div', null, h('h2', null, 'Could not load the files of this post'), h('p', null, `${why}. Check the link, or try again in a moment.`))));
  });

  function start(rows) {
    const items = [];
    let lastVideo = null;
    for (const r of rows) {
      const item = fileItem(r);
      if (r.kind === 'videos' && r.role === 'file') lastVideo = item;
      if (r.role === 'poster') item.videoItem = lastVideo;
      items.push(item);
      list.append(item.el);
    }

    const queue = [];
    let running = 0;
    const pump = () => {
      while (running < PARALLEL && queue.length && isCurrent()) {
        const item = queue.shift();
        running += 1;
        item.check().finally(() => { running -= 1; pump(); });
      }
    };
    const enqueue = (item) => { item.set('queued'); queue.push(item); pump(); };

    function summarize() {
      const count = (s) => items.filter((i) => i.state === s).length;
      const ok = count('ok');
      const bad = count('bad');
      const waiting = count('waiting');
      const busy = items.length - ok - bad - waiting - count('failed') - count('missing') - count('invalid');
      // One segment per file, made once; only their colour changes.
      if (segments.children.length !== items.length) fill(segments, items.map(() => h('span', { class: 'seg' })));
      items.forEach((i, n) => { segments.children[n].className = `seg ${i.state}`; });
      let text;
      if (busy) text = `Checking files... ${items.length - busy} of ${items.length} done`;
      else if (ok === items.length) text = `All ${items.length} ${items.length === 1 ? 'file' : 'files'} verified`;
      else {
        const parts = [`${ok} of ${items.length} verified`];
        if (bad) parts.push(`${bad} ${bad === 1 ? 'does' : 'do'} not match`);
        if (waiting) parts.push(`${waiting} waiting for you`);
        const other = items.length - ok - bad - waiting;
        if (other) parts.push(`${other} could not be checked`);
        text = parts.join(' · ');
      }
      summaryText.textContent = text;
      summaryText.className = `post-summary ${!busy && ok === items.length ? 'ok' : bad ? 'bad' : ''}`;
      verifyAll.hidden = busy > 0 || waiting < 2;
    }

    verifyAll.addEventListener('click', () => {
      const big = items.filter((i) => i.state === 'waiting');
      const total = big.reduce((n, i) => n + i.size, 0);
      if (total > CONFIRM_ABOVE_BYTES && !window.confirm(`This downloads ${fileSize(total)}. Check all of it?`)) return;
      big.forEach(enqueue);
    });

    function fileItem(r) {
      const cid = parseCid(r.cid);
      const thumb = h('div', { class: 'file-thumb' }, icon(KIND_ICON[r.kind] || 'file'));
      const status = h('div', { class: 'file-status' });
      const reason = h('div', { class: 'file-reason', hidden: true });
      const sizeText = cid.ok ? fileSize(cid.size) : '';
      const el = h(
        'article',
        { class: 'file' },
        thumb,
        h(
          'div',
          { class: 'file-main' },
          h('div', { class: 'file-name' }, h('strong', null, r.label), sizeText ? h('span', { class: 'file-size' }, sizeText) : null),
          h('div', { class: 'file-sub' }, SUB[r.role]),
          h('div', { class: 'file-cid' }, mono(short(r.cid)), copyButton(r.cid)),
          reason,
        ),
        h('div', { class: 'file-side' }, status, h('a', { class: 'link file-open', href: `/${encodeURIComponent(r.cid)}`, target: '_blank', rel: 'noopener' }, 'Details')),
      );

      const item = {
        el,
        state: 'queued',
        size: cid.ok ? cid.size : 0,
        videoItem: null,
        setThumb(url) {
          fill(thumb, h('img', { src: url, alt: '' }));
          thumb.classList.add('has-img');
        },
        set(state, pct, why) {
          // Progress only moves the row's progress line and the number; nothing is rebuilt, so nothing blinks.
          el.style.setProperty('--p', `${pct || 0}%`);
          if (state === item.state && state === 'checking' && item.pctText) {
            item.pctText.textContent = pct == null ? '' : ` ${pct}%`;
            return;
          }
          item.state = state;
          el.dataset.state = state;
          reason.hidden = !why;
          reason.textContent = why || '';
          item.pctText = null;
          const verify = h('button', { type: 'button', class: 'btn small' }, 'Verify');
          verify.addEventListener('click', () => {
            if (item.size > CONFIRM_ABOVE_BYTES && !window.confirm(`This file is ${fileSize(item.size)}. Download it to check it?`)) return;
            enqueue(item);
          });
          const view = {
            queued: pill('neutral', 'Waiting'),
            finding: pill('busy', 'Finding'),
            checking: (() => {
              item.pctText = h('span', { class: 'pct' }, pct == null ? '' : ` ${pct}%`);
              return pill('busy', ['Checking', item.pctText]);
            })(),
            ok: pill('ok', 'Verified'),
            bad: pill('bad', 'Does not match'),
            failed: [pill('warn', 'Could not check'), verify],
            missing: pill('warn', 'Not found'),
            invalid: pill('warn', 'Not a valid CID'),
            waiting: verify,
          }[state];
          fill(status, view);
          summarize();
        },
        async check() {
          if (!cid.ok) { item.set('invalid', null, cid.message); return; }
          try {
            item.set('finding');
            const locations = await fetchLocations(SEREY_NODE, cid.key, { signal });
            const url = locations.flatMap((l) => l.parts)[0];
            if (!url) { item.set('missing', null, `The ${SEREY_NODE.name} has no address for this file.`); return; }
            item.set('checking', 0);
            const keep = r.kind === 'images' && cid.size <= THUMB_MAX_BYTES ? THUMB_MAX_BYTES : 0;
            let last = -1;
            const res = await verifyUrl(url, cid, {
              signal,
              keep,
              onProgress: (done) => {
                const p = Math.min(100, Math.floor((done / Math.max(cid.size, 1)) * 100));
                if (p !== last) { last = p; item.set('checking', p); }
              },
            });
            if (!isCurrent()) return;
            if (!res.ok) { item.set('bad', null, 'The downloaded bytes are not the file this ID names.'); return; }
            item.set('ok');
            if (res.kept) {
              const bytes = concat(res.kept);
              const type = sniffImage(bytes);
              if (type) {
                const u = URL.createObjectURL(new Blob([bytes], { type }));
                blobUrls.push(u);
                item.setThumb(u);
                if (item.videoItem && !item.videoItem.el.querySelector('.file-thumb img')) item.videoItem.setThumb(u);
              }
            }
          } catch (e) {
            if (signal.aborted || !isCurrent()) return;
            const msg = e && e.name === 'TypeError' ? 'The file could not be downloaded' : (e.message || String(e));
            if (/ 404$/.test(msg)) item.set('missing', null, `The ${SEREY_NODE.name} does not know this file.`);
            else item.set('failed', null, `${msg}. Try again.`);
          }
        },
      };
      if (!cid.ok) item.set('invalid', null, cid.message);
      else if (cid.size > AUTO_VERIFY_MAX_BYTES) item.set('waiting');
      return item;
    }

    items.filter((i) => i.state === 'queued').forEach(enqueue);
    summarize();
  }
}
