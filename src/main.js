import { parseCid } from './cid.js';
import { fetchLocations } from './nodes.js';
import { verifyUrl, verifyFile, sniffImage, sniffVideo } from './verify.js';
import { fileSize, shortDuration } from './format.js';
import { SEREY_NODE, OTHER_NODES, CONFIRM_ABOVE_BYTES, PREVIEW_MAX_BYTES, AUTO_VERIFY_MAX_BYTES } from './config.js';
import { h, fill, icon, external, mono, row, pill, copyButton, withCopy, concat } from './ui.js';
import { parsePostLink, postUrl } from './serey.js';
import { renderPost, releasePost } from './post.js';

const input = document.getElementById('cid-input');
const intro = document.getElementById('intro');
const out = document.getElementById('output');
const clear = document.getElementById('clear');

const nodeHost = new URL(SEREY_NODE.url).host;

let generation = 0;
let controller = null;
let previewUrl = null;

function problemCard(cid) {
  const extra = cid.kind === 'ipfs'
    ? h('p', null, external(`https://cid.ipfs.tech/#${encodeURIComponent(cid.ipfs)}`, 'Open it in the IPFS CID inspector'))
    : null;
  return h(
    'section',
    { class: 'card problem' },
    h('div', { class: 'problem-icon' }, icon('alert')),
    h('div', null, h('h2', null, 'Not a CID this page can check'), h('p', null, cid.message), extra),
  );
}

// One titled block of the details card: a small heading, an optional link, then rows.
function section(art, title, aside, ...body) {
  return h('section', { class: 'sect' }, h('div', { class: 'sect-head' }, h('h3', null, icon(art), title), aside), ...body);
}

function detailsCard(cid) {
  const storage = h('div', { class: 'sect-body' }, h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), `Asking the ${SEREY_NODE.name}...`));
  const others = h('div', { class: 'sect-body' }, OTHER_NODES.map((node) => row(node.name, h('span', { class: 'value' }, pill('busy', 'Asking')))));
  const check = h('div', { class: 'sect-body' });
  const checkSect = section('shield', 'Last check', null, check);
  checkSect.hidden = true;

  const el = h(
    'section',
    { class: 'card details' },
    h('header', { class: 'details-head' }, h('h2', null, 'Details')),
    section(
      'file',
      'File',
      null,
      h(
        'div',
        { class: 'sect-body' },
        row('Size', `${fileSize(cid.size)} (${cid.size.toLocaleString('en-US')} bytes)`),
        row('Type', 'File (raw bytes)'),
        row('Hash function', 'BLAKE3, 256 bit'),
        row('Hash', withCopy(cid.hashHex)),
        row('CID, base58', withCopy(cid.forms.base58)),
        row('CID, base32', withCopy(cid.forms.base32)),
        row('CID, base64url', withCopy(cid.forms.base64url)),
      ),
    ),
    section('server', 'Storage', external(SEREY_NODE.url, nodeHost, 'sect-link'), storage),
    section('network', 'Other S5 nodes', null, others),
    checkSect,
  );

  const compare = (label, expected, got) => row(label, h('span', { class: 'value cmp' }, h('span', { class: 'cmp-k' }, 'Expected'), expected, h('span', { class: 'cmp-k' }, 'Got'), got));

  return {
    el,
    storage,
    others,
    showCheck(res) {
      fill(
        check,
        compare('Hash', mono(cid.hashHex), mono(res.gotHashHex)),
        compare('Size', `${cid.size.toLocaleString('en-US')} bytes`, `${res.gotBytes.toLocaleString('en-US')} bytes`),
      );
      checkSect.hidden = false;
    },
  };
}

function resultCard(cid, signal, details) {
  let source = null;
  let host = '';
  let looked = false;
  let checked = false;
  let verified = false;
  let streaming = null; // a video playing straight from storage before it is checked
  let streamTag = null;

  const frame = h('div', { class: 'frame' });
  const status = h('div', { class: 'status' });
  const barFill = h('div', { class: 'bar-fill' });
  const bar = h('div', { class: 'progress', hidden: true }, h('div', { class: 'bar' }, barFill));
  const download = h('button', { type: 'button', class: 'btn primary', disabled: true }, icon('download'), h('span', null, 'Download and verify'));
  const open = h('a', { class: 'btn', target: '_blank', rel: 'noopener noreferrer', hidden: true }, icon('out'), 'Open file');
  const fileInput = h('input', { type: 'file', hidden: true });
  const pick = h('label', { class: 'link' }, 'Check my own copy', fileInput);
  const actions = h('div', { class: 'actions' });
  const links = h('div', { class: 'links' });

  const buttons = (on) => {
    download.disabled = !on || !source;
    fileInput.disabled = !on;
    pick.classList.toggle('disabled', !on);
  };

  const progress = (done) => {
    barFill.style.width = `${Math.min(100, (done / Math.max(cid.size, 1)) * 100)}%`;
  };

  // Before a check, downloading is the main action; after one, opening the file is,
  // and checking again becomes a quiet link beside "Check my own copy".
  function arrange() {
    download.classList.toggle('primary', !checked);
    download.classList.toggle('link', checked);
    download.classList.toggle('btn', !checked);
    open.classList.toggle('primary', verified);
    fill(actions, checked ? open : [source ? download : null, open]);
    fill(links, checked ? [download, h('span', { class: 'sep' }, '·')] : null, pick);
  }

  // The verified picture at its own shape, or an icon for every other state.
  function stopStream() {
    if (!streaming) return;
    streaming.pause();
    streaming.removeAttribute('src');
    streaming = null;
  }

  // A large video plays straight from storage, labelled as not verified, while it waits for a check.
  function tryStream(url) {
    const video = h('video', { src: url, controls: true, playsinline: true, preload: 'metadata' });
    video.addEventListener('loadedmetadata', () => {
      if (checked || !video.videoWidth || source !== url) return;
      streaming = video;
      streamTag = h('span', { class: 'preview-tag' }, 'Preview · not verified yet');
      frame.className = 'frame is-idle has-picture';
      fill(frame, h('div', { class: 'preview' }, video, streamTag));
      setStatus('neutral', 'Not verified yet', `This preview streams from ${host}. Download and verify it to check its bytes.`);
    }, { once: true });
  }

  function showFrame(kind, kept) {
    stopStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    frame.className = `frame is-${kind}`;
    if (kind === 'ok' && kept) {
      const bytes = concat(kept);
      const image = sniffImage(bytes);
      const video = image ? null : sniffVideo(bytes);
      if (image || video) {
        previewUrl = URL.createObjectURL(new Blob([bytes], { type: image || video }));
        frame.classList.add('has-picture');
        fill(frame, h('div', { class: 'preview' }, image
          ? h('img', { src: previewUrl, alt: 'The verified file' })
          : h('video', { src: previewUrl, controls: true, playsinline: true, preload: 'metadata' })));
        return;
      }
    }
    const art = { ok: 'shield', bad: 'x', failed: 'alert', busy: 'download' }[kind] || 'file';
    fill(frame, h('span', { class: 'frame-icon' }, icon(art)));
  }

  function setStatus(tone, title, sub, meta) {
    const mark = { ok: 'check', bad: 'x' }[tone];
    fill(
      status,
      h('div', { class: `badge ${tone}` }, mark ? h('span', { class: 'badge-icon' }, icon(mark)) : null, title),
      sub ? h('p', { class: 'state-sub' }, sub) : null,
      meta ? h('p', { class: 'state-meta' }, meta) : null,
    );
  }

  const size = fileSize(cid.size);

  function idle() {
    if (!looked) setStatus('busy', 'Finding the file', `Asking the ${SEREY_NODE.name} where it is kept.`);
    else if (source) setStatus('neutral', 'Not verified yet', `This file is ${size}. Download and verify it to check it and see a preview.`);
    else setStatus('neutral', 'Not verified yet', 'The file was not found online. You can still check a copy you have.');
  }

  function finish(res, where) {
    checked = true;
    verified = res.ok;
    download.lastChild.textContent = 'Check again';
    el.classList.remove('is-verified', 'is-mismatch');
    void el.offsetWidth; // restart the one-off animation on a second check
    el.classList.add(res.ok ? 'is-verified' : 'is-mismatch');
    if (res.ok) setStatus('ok', 'Verified', 'The bytes are exactly the file this ID names.', `Checked ${where}`);
    else {
      setStatus('bad', 'Does not match', 'These bytes do NOT match this ID.', `Checked ${where}`);
    }
    if (res.ok && streaming) {
      streamTag.textContent = 'Verified';
      streamTag.classList.add('ok');
    } else {
      showFrame(res.ok ? 'ok' : 'bad', res.ok ? res.kept : null);
    }
    details.showCheck(res);
    arrange();
  }

  async function run(task) {
    buttons(false);
    progress(0);
    bar.hidden = false;
    setStatus('busy', 'Checking', 'Hashing the file in your browser.');
    if (!streaming) showFrame('busy');
    try {
      await task();
    } catch (e) {
      if (!signal.aborted) {
        setStatus('warn', 'Could not finish the check', e.message || String(e));
        if (!streaming) showFrame('failed');
        }
    } finally {
      bar.hidden = true;
      buttons(true);
    }
  }

  const keep = cid.size <= PREVIEW_MAX_BYTES ? PREVIEW_MAX_BYTES : 0;

  const downloadAndCheck = () => run(async () => {
    const res = await verifyUrl(source, cid, { signal, keep, onProgress: progress });
    finish(res, host);
  });

  download.addEventListener('click', () => {
    if (cid.size > CONFIRM_ABOVE_BYTES && !window.confirm(`This file is ${size}. Download it to check it?`)) return;
    downloadAndCheck();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    run(async () => {
      const res = await verifyFile(file, cid, { signal, keep, onProgress: progress });
      finish(res, 'your copy');
    });
    fileInput.value = '';
  });

  // Hovering (or tapping) a cell's icon shows one plain sentence about it.
  const cell = (art, label, value, tip) => {
    const v = h('span', { class: 'cell-value' }, value);
    const help = h('span', { class: 'cell-icon', tabindex: '0', 'aria-label': `${label}: ${tip}` }, icon(art), h('span', { class: 'tip', role: 'tooltip' }, tip));
    return { el: h('div', { class: 'cell' }, help, h('div', { class: 'cell-text' }, h('span', { class: 'cell-label' }, label), v)), v };
  };
  const nodeNames = ["Serey's node", ...OTHER_NODES.map((node) => node.name)].join(' and ');
  const cells = {
    size: cell('database', 'Size', size, 'How big the file is. The size is part of the ID.'),
    stored: cell('server', 'Stored at', '...', "The server where Serey's S5 node keeps this file."),
    nodes: cell('network', 'S5 nodes', '...', `How many of the S5 nodes asked (${nodeNames}) have this file.`),
    hash: cell('hash', 'Hash', 'BLAKE3-256', 'The method used to fingerprint the file. Change one byte and the fingerprint changes.'),
  };
  const strip = h('div', { class: 'strip' }, Object.values(cells).map((c) => c.el));

  const el = h('section', { class: 'card result' }, frame, status, bar, strip, actions, links);

  showFrame('idle');
  idle();
  arrange();
  buttons(true);

  return {
    el,
    // Called once the node has answered; a small file is checked straight away.
    // How many of the S5 nodes asked know the file, as answers come in.
    nodes(found, asked) {
      cells.nodes.v.textContent = `${found} of ${asked}`;
    },
    located(url) {
      looked = true;
      source = url;
      cells.stored.v.textContent = url ? new URL(url).host : 'Not found';
      cells.stored.v.title = cells.stored.v.textContent;
      if (url) {
        host = new URL(url).host;
        open.href = url;
        open.hidden = false;
      }
      arrange();
      buttons(true);
      if (checked) return;
      if (url && cid.size <= AUTO_VERIFY_MAX_BYTES) downloadAndCheck();
      else {
        idle();
        if (url) tryStream(url);
      }
    },
  };
}

// A storage location is an offer that lasts a while; the node hands out a fresh one when asked again.
const EXPIRY_SOON_MS = 5 * 60 * 1000;

function paintExpiry(el) {
  const left = Number(el.dataset.expiry) * 1000 - Date.now();
  const at = new Date(Number(el.dataset.expiry) * 1000).toLocaleString();
  if (left > 0) {
    const tone = left < EXPIRY_SOON_MS ? 'warn' : 'ok';
    fill(el, h('span', { class: `pill ${tone}`, title: `Until ${at}` }, h('span', { class: 'pill-dot' }), tone === 'warn' ? `Expires in ${shortDuration(left)}` : `Valid for ${shortDuration(left)}`));
    return;
  }
  fill(
    el,
    h('span', { class: 'pill neutral', title: `Ended ${at}` }, h('span', { class: 'pill-dot' }), `Expired ${shortDuration(left)} ago`),
    h('span', { class: 'expiry-note' }, 'This address may stop working. ', h('button', { type: 'button', class: 'link', onclick: () => el.refresh() }, 'Ask again')),
  );
}

// Offers count down while the page is open.
setInterval(() => document.querySelectorAll('.expiry').forEach(paintExpiry), 30000);

function locationRows(locations, refresh) {
  return locations.map((loc) => h(
    'div',
    { class: 'loc' },
    loc.parts.length
      ? loc.parts.map((url) => row('Address', h('span', { class: 'value copyable' }, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'addr' }, url), copyButton(url))))
      : row('Address', 'The node has no https address for it'),
    row('Kind', loc.type),
    loc.expiry ? row('Offer', (() => {
      const el = h('span', { class: 'value expiry', 'data-expiry': String(loc.expiry) });
      el.refresh = refresh;
      paintExpiry(el);
      return el;
    })()) : null,
    loc.nodeId ? row('Node ID', mono(loc.nodeId)) : null,
  ));
}

async function lookUp(cid, result, details, gen, signal) {
  let locations = [];
  let failure = null;
  try {
    locations = await fetchLocations(SEREY_NODE, cid.key, { signal });
  } catch (e) {
    failure = e;
  }
  if (gen !== generation) return;

  fill(
    details.storage,
    failure
      ? h('p', { class: 'note' }, `The ${SEREY_NODE.name} did not answer (${failure.message}). Try again in a moment.`)
      : locations.length
        ? locationRows(locations, () => {
          fill(details.storage, h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), `Asking the ${SEREY_NODE.name} again...`));
          lookUp(cid, result, details, gen, signal);
        })
        : h('p', { class: 'note' }, `The ${SEREY_NODE.name} does not know this file. It may have been deleted, or it was never stored here.`),
  );
  result.located(locations.flatMap((l) => l.parts)[0] || null);
  const asked = 1 + OTHER_NODES.length;
  result.nodes(locations.length ? 1 : 0, asked);

  const answers = await Promise.all(OTHER_NODES.map(async (node) => {
    try {
      return { node, found: (await fetchLocations(node, cid.key, { signal })).length > 0 };
    } catch {
      return { node, found: null };
    }
  }));
  if (gen !== generation) return;

  result.nodes((locations.length ? 1 : 0) + answers.filter((a) => a.found).length, asked);
  fill(details.others, answers.map(({ node, found }) => row(
    node.name,
    h('span', { class: 'value' }, found === null ? pill('warn', 'No answer') : found ? pill('ok', 'Also reports this file') : pill('neutral', 'Does not know this file')),
  )));
}

function render(value) {
  generation += 1;
  const gen = generation;
  if (controller) controller.abort();
  controller = new AbortController();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  releasePost();
  out.replaceChildren();

  const text = value.trim();
  intro.hidden = Boolean(text);
  clear.hidden = !text;
  document.body.classList.toggle('has-result', Boolean(text));
  if (!text) return;

  // A Serey post link opens the page that checks every file of the post.
  const post = parsePostLink(text);
  if (post) {
    renderPost(out, post, { signal: controller.signal, isCurrent: () => gen === generation });
    return;
  }

  const cid = parseCid(text);
  if (!cid.ok) {
    out.append(problemCard(cid));
    return;
  }

  const details = detailsCard(cid);
  const result = resultCard(cid, controller.signal, details);
  out.append(result.el, details.el);
  lookUp(cid, result, details, gen, controller.signal);
}

// The header gets a shadow once the page scrolls under it.
const top = document.querySelector('.top');
const onScroll = () => top.classList.toggle('scrolled', window.scrollY > 4);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// A soft light follows the pointer across the step cards.
document.querySelectorAll('.step').forEach((step) => {
  step.addEventListener('pointermove', (e) => {
    const r = step.getBoundingClientRect();
    step.style.setProperty('--mx', `${e.clientX - r.left}px`);
    step.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
});

// A CID arrives as cid.serey.io/<cid> (the link from the Serey Explorer) or, from older links, #<cid>.
// A post opens as cid.serey.io/post/<account>/<permlink>; the box then shows the post's Serey link.
function fromUrl() {
  const raw = window.location.hash.slice(1) || window.location.pathname.slice(1);
  if (raw.startsWith('post/')) {
    const post = parsePostLink(`/${raw}`);
    return post ? postUrl(post) : '';
  }
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return ''; // an unreadable address is just empty
  }
}

function show(value) {
  const text = value.trim();
  const post = text && parsePostLink(text);
  const path = post ? `/post/${encodeURIComponent(post.author)}/${encodeURIComponent(post.permlink)}` : `/${text ? encodeURIComponent(text) : ''}`;
  window.history.replaceState(null, '', path);
  render(value);
}

input.addEventListener('input', () => show(input.value));

clear.addEventListener('click', () => {
  input.value = '';
  show('');
  input.focus();
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
