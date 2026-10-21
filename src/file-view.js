import { fetchLocations } from './nodes.js';
import { sniffImage, sniffVideo } from './verify.js';
import { findCopies, fetchTx, arweaveUrl, isSereyWallet } from './arweave.js';
import { fileSize, relativeTime } from './format.js';
import { SEREY_NODE, OTHER_NODES, PREVIEW_MAX_BYTES, ARWEAVE_EXPLORER_URL } from './config.js';
import { h, fill, icon, mono, row, pill, copyButton, withCopy, concat, expiryValue, section } from './ui.js';
import { createCopy, copyRow, limiter, PLACES } from './copies.js';

let blobUrls = [];
export function releaseFile() {
  blobUrls.forEach((u) => URL.revokeObjectURL(u));
  blobUrls = [];
}

const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre';
const KIND = { LI: 'li', BLOCKQUOTE: 'quote', PRE: 'pre' };

// A stored post text is JSON with an HTML title and body. Only their text is kept, as paragraphs,
// headings and list items; a parsed document runs nothing and none of its markup reaches the page.
export function readPost(bytes) {
  try {
    const doc = JSON.parse(new TextDecoder().decode(bytes));
    const parse = (html) => new DOMParser().parseFromString(typeof html === 'string' ? html : '', 'text/html').body;
    const clean = (text) => text.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim();
    const title = clean(parse(doc.title).textContent).replace(/\n+/g, ' ');
    const body = parse(doc.body);
    body.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
    // Only the innermost blocks, so a list inside a quote is read once.
    let blocks = [...body.querySelectorAll(BLOCKS)]
      .filter((n) => !n.querySelector(BLOCKS))
      .map((n) => ({ kind: /^H\d$/.test(n.tagName) ? 'h' : KIND[n.tagName] || 'p', text: clean(n.textContent) }))
      .filter((b) => b.text);
    if (!blocks.length) blocks = clean(body.textContent).split(/\n{2,}/).filter(Boolean).map((text) => ({ kind: 'p', text }));
    if (!title && !blocks.length) return null;
    // Notes repeat their first line as the title.
    const repeats = blocks.length && blocks[0].text.startsWith(title);
    return { title: repeats ? '' : title, blocks };
  } catch {
    return null;
  }
}

const BLOCK_TAG = { h: 'h3', li: 'li', quote: 'blockquote', pre: 'pre', p: 'p' };
// Long texts open folded, so the copies below stay in view.
const LONG_TEXT = 1200;

function readingView(post) {
  const doc = h('article', { class: 'doc' }, post.title ? h('h2', { class: 'doc-title' }, post.title) : null, post.blocks.map((b) => h(BLOCK_TAG[b.kind], null, b.text)));
  const long = post.blocks.reduce((n, b) => n + b.text.length, 0) > LONG_TEXT;
  if (!long) return doc;
  doc.classList.add('folded');
  const toggle = h('button', { type: 'button', class: 'link doc-toggle', 'aria-expanded': 'false' }, 'Show the whole text');
  toggle.addEventListener('click', () => {
    const folded = doc.classList.toggle('folded');
    toggle.setAttribute('aria-expanded', String(!folded));
    toggle.textContent = folded ? 'Show the whole text' : 'Show less';
  });
  return [doc, toggle];
}

export const short = (text) => (text.length > 22 ? `${text.slice(0, 10)}…${text.slice(-8)}` : text);
const tagOf = (tx, name) => ((tx && tx.tags.find((t) => t.name === name)) || {}).value || '';
const link = (url) => h('span', { class: 'value copyable' }, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'addr' }, url), copyButton(url));

function kindName(type, isText) {
  if (isText) return 'Post text';
  if (/^image\//.test(type)) return 'Image';
  if (/^video\//.test(type)) return 'Video';
  if (/^audio\//.test(type)) return 'Audio';
  return 'File';
}

export const problemCard = (art, title, ...text) => h('section', { class: 'card problem' }, h('div', { class: 'problem-icon' }, icon(art)), h('div', null, h('h2', null, title), ...text.filter(Boolean).map((t) => (t instanceof Node ? t : h('p', null, t)))));

// What Arweave says about a transaction, for the technical details.
function arweaveRows(id, tx, full = true) {
  if (!tx) return [row('Transaction', withCopy(id)), row('Address', link(arweaveUrl(id)))];
  const when = tx.time ? `${new Date(tx.time * 1000).toLocaleString()}, ${relativeTime(tx.time)}, in block ${tx.height.toLocaleString('en-US')}` : 'Not in a block yet';
  return [
    row('Transaction', withCopy(id)),
    tx.owner ? row('Uploaded by', h('span', { class: 'value copyable' }, mono(tx.owner), copyButton(tx.owner), isSereyWallet(tx.owner) ? pill('ok', "Serey's wallet") : pill('warn', 'Not Serey'))) : null,
    row('Confirmed', when),
    full && tx.type ? row('Content type', tx.type) : null,
    row('Address', link(arweaveUrl(id))),
    row('Explorer', link(`${ARWEAVE_EXPLORER_URL}${id}`)),
    full && tx.tags.length ? h('h4', { class: 'tech-sub' }, 'Tags') : null,
    full ? tx.tags.map((t) => row(t.name, mono(t.value))) : null,
  ];
}

const compare = (label, expected, got) => row(label, h('span', { class: 'value cmp' }, h('span', { class: 'cmp-k' }, 'Expected'), expected, h('span', { class: 'cmp-k' }, 'Got'), got));

/*
| The technical details of a file: its fingerprint, where each copy is, and what each check found.
| The record shows them in full; a post row leaves out the other ID forms, other S5 nodes and tags.
*/
export function techSections({ fp, cid, copies, tx, others, full }) {
  const isText = fp.kind === 'sha256';
  const s5 = copies.find((c) => c.place === 's5' && c.state !== 'none');
  const ar = copies.find((c) => c.place === 'arweave' && c.arweaveId);
  const checked = copies.filter((c) => c.res);
  return [
    section('hash', 'Fingerprint', null, h(
      'div',
      { class: 'sect-body' },
      row('Method', isText ? 'SHA-256 of the stored text' : 'BLAKE3, 256 bit'),
      fp.hashHex ? row('Hash', withCopy(fp.hashHex)) : null,
      fp.size ? row('Size', `${fileSize(fp.size)} (${fp.size.toLocaleString('en-US')} bytes)`) : null,
      cid && cid.ok ? row(full ? 'S5 ID, base58' : 'S5 ID', withCopy(cid.forms.base58)) : null,
      full && cid ? [row('S5 ID, base32', withCopy(cid.forms.base32)), row('S5 ID, base64url', withCopy(cid.forms.base64url))] : null,
    )),
    s5 ? section('server', 'S5', null, h(
      'div',
      { class: 'sect-body' },
      s5.why && !s5.url ? h('p', { class: 'note' }, s5.why) : null,
      s5.locations.map((loc) => h(
        'div',
        { class: 'loc' },
        loc.parts.length ? loc.parts.map((url) => row('Address', link(url))) : row('Address', 'The node has no https address for it'),
        full ? row('Kind', loc.type) : null,
        loc.expiry ? row('Offer', expiryValue(loc.expiry, () => s5.locate())) : null,
        full && loc.nodeId ? row('Node ID', mono(loc.nodeId)) : null,
      )),
      full && others ? [h('h4', { class: 'tech-sub' }, 'Other S5 nodes'), others.map(({ node, found }) => row(node.name, h('span', { class: 'value' }, found === null ? pill('warn', 'No answer') : found ? pill('ok', 'Also has this file') : pill('neutral', 'Does not have it'))))] : null,
    )) : null,
    ar ? section('database', 'Arweave', null, h('div', { class: 'sect-body' }, arweaveRows(ar.arweaveId, tx, full))) : null,
    checked.length ? section('shield', 'Checks', null, h('div', { class: 'sect-body' }, checked.map((c) => compare(`${PLACES[c.place].name} copy`, mono(fp.hashHex), mono(c.res.gotHex))))) : null,
  ];
}

// An Arweave upload with nothing to check it against: its details, and why.
export function renderTx(out, tx) {
  out.append(
    problemCard('file', 'This Arweave upload can’t be checked', 'It names no S5 file and carries no SHA-256, so its bytes have nothing to be compared with.'),
    h('section', { class: 'card tech-card' }, section('database', 'Arweave', null, h('div', { class: 'sect-body' }, arweaveRows(tx.id, tx)))),
  );
}

/*
| The record of one file: what it is, whether it is intact, and each copy.
| fp is its fingerprint ({ kind, hash, hashHex, size }); cid is the parsed S5 ID
| when there is one, and arweave the Arweave copy already known ({ id, tx }).
*/
export function renderFile(out, { fp, cid, arweave, pasted, signal, isCurrent }) {
  const isText = fp.kind === 'sha256';
  const run = limiter(2);
  const size = Math.max(fp.size || 0, (arweave && arweave.tx && arweave.tx.size) || 0);
  const keep = size <= PREVIEW_MAX_BYTES ? PREVIEW_MAX_BYTES : 0;
  const base = { fp, signal, isCurrent, run, keep };
  let tx = arweave ? arweave.tx : null;
  let others = null;
  let previewed = false;

  const placeholder = () => h('div', { class: 'media-empty' }, icon(isText ? 'file' : 'image'), h('p', null, 'Shown here once a copy is verified.'));
  // A picture sits beside the verdict; a text gets a full-width panel to be read in.
  const media = isText ? null : h('div', { class: 'media' }, placeholder());
  const reading = isText ? h('div', { class: 'reading' }, h('h3', null, 'The post text'), h('div', { class: 'reading-body' }, placeholder())) : null;
  const kind = h('p', { class: 'record-kind' });
  const verdict = h('h2', { class: 'verdict' });
  const verdictSub = h('p', { class: 'verdict-sub' });
  const list = h('div', { class: 'copy-list' });
  const tech = h('div', { class: 'tech-body' });
  const fileInput = h('input', { type: 'file', class: 'visually-hidden' });
  const copiesBlock = h('div', { class: 'copies' }, h('h3', null, 'Copies'), list);
  const idText = cid ? cid.forms.base58 : fp.hashHex;

  const record = h(
    'section',
    { class: 'card record' },
    h(
      'div',
      { class: isText ? 'record-top is-text' : 'record-top' },
      media,
      h(
        'div',
        { class: 'record-summary' },
        kind,
        verdict,
        verdictSub,
        h(
          'div',
          { class: 'fingerprint' },
          h('span', { class: 'fingerprint-label' }, cid ? 'Fingerprint (S5 ID)' : 'Fingerprint (SHA-256)'),
          h('span', { class: 'value copyable' }, mono(short(idText)), copyButton(idText)),
        ),
        h('label', { class: 'btn' }, icon('shield'), 'Check a copy you have', fileInput),
        // Beside a picture the copies fill the column next to it; a text needs that room to be read.
        isText ? null : copiesBlock,
      ),
    ),
    reading,
    isText ? copiesBlock : null,
    h('details', { class: 'tech' }, h('summary', null, 'Technical details', icon('chevron')), tech),
  );
  out.append(record);

  const copies = [];
  function addCopy(copy, before) {
    copy.on(onChange);
    const el = copyRow(copy);
    copy.row = el;
    if (before) {
      list.replaceChild(el, before.row);
      copies[copies.indexOf(before)] = copy;
    } else {
      list.append(el);
      copies.push(copy);
    }
    return copy;
  }

  function onChange(copy, progress) {
    if (progress) return;
    if (copy.state === 'ok' && !previewed) preview(copy.res);
    paint();
  }

  // Only verified bytes are ever shown.
  function preview(res) {
    if (isText) {
      const post = res.bytes && readPost(res.bytes);
      if (!post) return;
      previewed = true;
      fill(reading.querySelector('.reading-body'), readingView(post));
      return;
    }
    if (!res.kept) return;
    const bytes = concat(res.kept);
    const type = sniffImage(bytes) || sniffVideo(bytes);
    if (!type) return;
    previewed = true;
    const src = URL.createObjectURL(new Blob([bytes], { type }));
    blobUrls.push(src);
    media.classList.add('has-preview');
    fill(media, h('div', { class: 'preview' }, type.startsWith('image/')
      ? h('img', { src, alt: 'The verified file' })
      : h('video', { src, controls: true, playsinline: true, preload: 'metadata' })));
    if (!tx) kind.textContent = `${type.startsWith('image/') ? 'Image' : 'Video'}, ${fileSize(fp.size)}`;
  }

  function paint() {
    const author = tagOf(tx, 'Serey-Author');
    if (!previewed || tx) kind.textContent = [kindName(tx ? tx.type : '', isText), size ? fileSize(size) : '', author ? `by @${author}` : ''].filter(Boolean).join(', ');

    const real = copies.filter((c) => c.state !== 'none');
    const names = (list2) => list2.map((c) => PLACES[c.place].name).join(' and ');
    const ok = real.filter((c) => c.state === 'ok');
    const busy = real.some((c) => ['idle', 'looking', 'finding', 'queued', 'checking'].includes(c.state));
    let tone;
    let title;
    let sub;
    if (real.some((c) => c.state === 'bad')) {
      [tone, title, sub] = ['bad', 'A copy does not match', `The ${names(real.filter((c) => c.state === 'bad'))} copy is NOT this file: its fingerprint is different.`];
    } else if (busy) {
      [tone, title, sub] = ['busy', 'Checking copies', 'Your browser downloads each copy and computes its fingerprint.'];
    } else if (ok.length && ok.length === real.length) {
      title = ok.length === 1 ? (ok[0].place === 'local' ? 'Your copy is intact' : `Intact on ${names(ok)}`) : `Intact in ${ok.length === 2 ? 'both' : `all ${ok.length}`} copies`;
      [tone, sub] = ['ok', ok.length === 1 ? 'Its bytes have exactly this fingerprint.' : 'Every copy has exactly this fingerprint, so they are the same file.'];
    } else if (ok.length) {
      [tone, title, sub] = ['ok', `Intact on ${names(ok)}`, 'The other copies could not be checked yet. Their rows say why.'];
    } else if (real.some((c) => c.state === 'waiting')) {
      [tone, title, sub] = ['neutral', 'Not checked yet', `This file is ${fileSize(size)}. Check a copy below to verify it.`];
    } else {
      [tone, title, sub] = ['warn', 'Could not check', 'No copy could be downloaded. You can still check a copy you have.'];
    }
    const mark = { ok: 'check', bad: 'x' }[tone];
    verdict.className = `verdict ${tone}`;
    fill(verdict, mark ? h('span', { class: 'verdict-icon' }, icon(mark)) : null, title);
    verdictSub.textContent = sub;
    record.dataset.state = tone;
    paintTech();
  }

  function paintTech() {
    fill(tech, techSections({ fp, cid, copies, tx, others, full: true }));
  }

  // Other S5 nodes are only asked to corroborate; none of them blocks the page.
  async function askOthers() {
    others = await Promise.all(OTHER_NODES.map(async (node) => {
      try {
        return { node, found: (await fetchLocations(node, cid.key, { signal })).length > 0 };
      } catch {
        return { node, found: null };
      }
    }));
    if (isCurrent()) paintTech();
  }

  // The S5 copy, or a row saying a post text has none.
  if (cid) {
    addCopy(createCopy({ ...base, place: 's5', cid, pasted: pasted === 's5' })).locate();
    askOthers();
  } else {
    const none = addCopy(createCopy({ ...base, place: 's5' }));
    none.about = 'Post texts are kept on Arweave only.';
    none.set('none');
  }

  // The Arweave copy: the one pasted, or found by its S5 ID.
  if (arweave) {
    addCopy(createCopy({ ...base, place: 'arweave', arweaveId: arweave.id, size: tx && tx.size, pasted: pasted === 'arweave' })).auto();
  } else {
    const looking = addCopy(createCopy({ ...base, place: 'arweave' }));
    const look = () => {
      looking.set('looking');
      findCopies([cid.forms.base58], { signal }).then((found) => {
        if (!isCurrent()) return;
        const [id] = found[cid.forms.base58] || [];
        if (!id) {
          looking.about = 'Only Forever posts are kept on Arweave.';
          looking.set('none');
          return;
        }
        looking.attach(id);
        looking.auto();
        fetchTx(id, { signal }).then((t) => { if (t && isCurrent()) { tx = t; paint(); } }).catch(() => {});
      }).catch((e) => {
        if (!isCurrent()) return;
        looking.retry = look;
        looking.set('failed', `Arweave did not answer (${e.message}).`);
      });
    };
    look();
  }

  // A copy from the visitor's device is checked against the same fingerprint.
  let local = null;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const copy = createCopy({ ...base, place: 'local', run: (task) => task() });
    copy.file = file;
    copy.host = file.name;
    copy.retry = false;
    local = addCopy(copy, local);
    copy.check();
  });

  paint();
}
