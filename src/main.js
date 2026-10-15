import { parseCid } from './cid.js';
import { fetchLocations } from './nodes.js';
import { verifyUrl, verifyFile, sniffImage } from './verify.js';
import { fileSize, relativeTime } from './format.js';
import { SEREY_NODE, OTHER_NODES, CONFIRM_ABOVE_BYTES, PREVIEW_MAX_BYTES, AUTO_VERIFY_MAX_BYTES } from './config.js';

const input = document.getElementById('cid-input');
const intro = document.getElementById('intro');
const out = document.getElementById('output');
const clear = document.getElementById('clear');

// Nothing from a node or a file is ever put into the page as HTML: only text and https links.
function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

// replaceChildren/append turn an array into text, so lists are flattened first.
const fill = (parent, ...kids) => parent.replaceChildren(...kids.flat(Infinity).filter(Boolean));
const add = (parent, ...kids) => parent.append(...kids.flat(Infinity).filter(Boolean));

// Stroke icons, drawn from fixed paths in this file.
const ICONS = {
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  file: ['M14 3H6v18h12V7z', 'M14 3v4h4'],
  shield: ['M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'],
  alert: ['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'],
  out: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  upload: ['M12 20V9', 'M7 14l5-5 5 5', 'M5 4h14'],
};
const SVG = 'http://www.w3.org/2000/svg';
function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon icon-${name}`);
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const external = (url, text, cls) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: cls }, text);
const mono = (text) => h('code', { class: 'mono' }, text);
const row = (label, value) => h('div', { class: 'row' }, h('span', { class: 'label' }, label), value instanceof Node ? value : h('span', { class: 'value' }, value));
const pill = (tone, text) => h('span', { class: `pill ${tone}` }, h('span', { class: 'pill-dot' }), text);
const nodeHost = new URL(SEREY_NODE.url).host;

function copyButton(text) {
  const button = h('button', { type: 'button', class: 'copy', title: 'Copy', 'aria-label': 'Copy' }, icon('copy'), icon('check'));
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.classList.add('done');
      button.setAttribute('title', 'Copied');
      setTimeout(() => { button.classList.remove('done'); button.setAttribute('title', 'Copy'); }, 1400);
    } catch { /* the text is selectable by hand */ }
  });
  return button;
}

const withCopy = (text) => h('span', { class: 'value copyable' }, mono(text), copyButton(text));
const concat = (chunks) => {
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  chunks.forEach((c) => { all.set(c, at); at += c.length; });
  return all;
};

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
function section(title, aside, ...body) {
  return h('section', { class: 'sect' }, h('div', { class: 'sect-head' }, h('h3', null, title), aside), ...body);
}

function detailsCard(cid) {
  const storage = h('div', { class: 'sect-body' }, h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), `Asking the ${SEREY_NODE.name}...`));
  const others = h('div', { class: 'sect-body' }, OTHER_NODES.map((node) => row(node.name, h('span', { class: 'value' }, pill('busy', 'Asking')))));
  const check = h('div', { class: 'sect-body' });
  const checkSect = section('Last check', null, check);
  checkSect.hidden = true;

  const el = h(
    'section',
    { class: 'card details' },
    h('header', { class: 'card-head' }, h('h2', null, 'Details')),
    section(
      'Content ID',
      null,
      h(
        'div',
        { class: 'sect-body' },
        row('Hash', withCopy(cid.hashHex)),
        h(
          'details',
          { class: 'more' },
          h('summary', null, 'Other formats'),
          row('Base58', withCopy(cid.forms.base58)),
          row('Base32', withCopy(cid.forms.base32)),
          row('Base64url', withCopy(cid.forms.base64url)),
        ),
      ),
    ),
    section('Storage', external(SEREY_NODE.url, nodeHost, 'sect-link'), storage),
    section('Other S5 nodes', null, others),
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

function resultCard(cid, text, signal, details) {
  let source = null;
  let host = '';
  let looked = false;
  let checked = false;

  const frame = h('div', { class: 'frame' });
  const status = h('div', { class: 'status' });
  const barFill = h('div', { class: 'bar-fill' });
  const pct = h('span', { class: 'bar-pct' }, '0%');
  const bar = h('div', { class: 'progress' }, h('div', { class: 'bar' }, barFill), pct);
  const download = h('button', { type: 'button', class: 'btn primary', disabled: true }, icon('download'), h('span', null, 'Download and verify'));
  const fileInput = h('input', { type: 'file', hidden: true });
  const pick = h('label', { class: 'btn' }, icon('upload'), 'Check my own copy', fileInput);
  const open = h('a', { class: 'btn', target: '_blank', rel: 'noopener noreferrer', hidden: true }, icon('out'), 'Open file');

  const buttons = (on) => {
    download.disabled = !on || !source;
    fileInput.disabled = !on;
    pick.classList.toggle('disabled', !on);
  };

  const progress = (done) => {
    const p = Math.min(100, (done / Math.max(cid.size, 1)) * 100);
    barFill.style.width = `${p}%`;
    pct.textContent = `${Math.floor(p)}%`;
  };

  // The picture frame: the verified image itself, or an icon for every other state.
  function showFrame(kind, kept) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    frame.className = `frame is-${kind}`;
    if (kind === 'ok' && kept) {
      const bytes = concat(kept);
      const type = sniffImage(bytes);
      if (type) {
        previewUrl = URL.createObjectURL(new Blob([bytes], { type }));
        fill(frame, h('div', { class: 'preview' }, h('img', { src: previewUrl, alt: 'The verified file' })));
        return;
      }
    }
    const art = { ok: 'shield', bad: 'x', failed: 'alert' }[kind] || 'file';
    fill(frame, h('span', { class: 'frame-icon' }, icon(art)), h('span', { class: 'frame-note' }, kind === 'ok' ? 'Verified file' : fileSize(cid.size)));
  }

  function setStatus(tone, title, sub, extra) {
    const art = { ok: 'shield', bad: 'x', warn: 'alert', busy: 'download', neutral: 'file' }[tone];
    fill(
      status,
      h(
        'div',
        { class: `state-line ${tone}` },
        h('span', { class: 'state-icon' }, icon(art)),
        h('div', { class: 'state-text' }, h('div', { class: `badge ${tone}` }, title), sub ? h('p', { class: 'state-sub' }, sub) : null),
      ),
      extra,
    );
  }

  function idle() {
    if (!looked) setStatus('busy', 'Finding the file', `Asking the ${SEREY_NODE.name} where it is kept.`);
    else if (source) setStatus('neutral', 'Not verified yet', `This file is ${fileSize(cid.size)}. Download it to check its bytes against the ID.`);
    else setStatus('neutral', 'Not verified yet', 'The file was not found online. You can still check a copy you have.');
  }

  function finish(res, origin) {
    checked = true;
    download.lastChild.textContent = 'Check again';
    download.classList.remove('primary');
    if (res.ok) setStatus('ok', 'Verified', `These bytes are exactly the file this ID names. Checked ${origin}.`);
    else setStatus('bad', 'Does not match', `These bytes do NOT match this ID. Checked ${origin}.`);
    showFrame(res.ok ? 'ok' : 'bad', res.ok ? res.kept : null);
    details.showCheck(res);
  }

  async function run(label, task) {
    buttons(false);
    progress(0);
    setStatus('busy', 'Checking', label, bar);
    showFrame('busy');
    try {
      await task();
    } catch (e) {
      if (!signal.aborted) {
        setStatus('warn', 'Could not finish the check', e.message || String(e));
        showFrame('failed');
      }
    } finally {
      buttons(true);
    }
  }

  const keep = cid.size <= PREVIEW_MAX_BYTES ? PREVIEW_MAX_BYTES : 0;

  const downloadAndCheck = () => run(`Downloading the file from ${host} and hashing it in your browser.`, async () => {
    const res = await verifyUrl(source, cid, { signal, keep, onProgress: progress });
    finish(res, `the copy at ${host}`);
  });

  download.addEventListener('click', () => {
    if (cid.size > CONFIRM_ABOVE_BYTES && !window.confirm(`This file is ${fileSize(cid.size)}. Download it to check it?`)) return;
    downloadAndCheck();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    run(`Hashing ${file.name} in your browser.`, async () => {
      const res = await verifyFile(file, cid, { signal, keep, onProgress: progress });
      finish(res, `your file, ${file.name}`);
    });
    fileInput.value = '';
  });

  const fact = (label, value, sub) => h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, label), h('span', { class: 'fact-value' }, value, sub ? h('span', { class: 'fact-sub' }, ` (${sub})`) : null));

  const el = h(
    'section',
    { class: 'card result' },
    frame,
    h(
      'div',
      { class: 'result-main' },
      h('span', { class: 'eyebrow' }, 'Content ID'),
      h('div', { class: 'result-cid copyable' }, mono(text), copyButton(text)),
      status,
      h(
        'div',
        { class: 'facts' },
        fact('Size', fileSize(cid.size), `${cid.size.toLocaleString('en-US')} bytes`),
        fact('Type', 'File (raw bytes)'),
        fact('Algorithm', 'BLAKE3-256'),
      ),
      h('div', { class: 'actions' }, download, pick, open),
    ),
  );

  showFrame('idle');
  idle();
  buttons(true);

  return {
    el,
    // Called once the node has answered; a small file is checked straight away.
    located(url) {
      looked = true;
      source = url;
      if (url) {
        host = new URL(url).host;
        open.href = url;
        open.hidden = false;
      }
      buttons(true);
      if (checked) return;
      if (url && cid.size <= AUTO_VERIFY_MAX_BYTES) downloadAndCheck();
      else idle();
    },
  };
}

function locationRows(locations) {
  return locations.map((loc) => h(
    'div',
    { class: 'loc' },
    row('Location', h(
      'span',
      { class: 'value loc-line' },
      h('strong', null, loc.parts[0] ? new URL(loc.parts[0]).host : 'S5 node'),
      h('span', { class: 'tag' }, loc.type),
      loc.expiry ? h('span', { class: 'muted', title: new Date(loc.expiry * 1000).toLocaleString() }, `offer expires ${relativeTime(loc.expiry)}`) : null,
    )),
    loc.parts.length
      ? loc.parts.map((url) => row('Address', h('span', { class: 'value copyable' }, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'addr' }, url), copyButton(url))))
      : row('Address', 'The node has no https address for it'),
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
        ? [h('p', { class: 'muted sect-lede' }, `Reported by the ${SEREY_NODE.name}`), locationRows(locations)]
        : h('p', { class: 'note' }, `The ${SEREY_NODE.name} does not know this file. It may have been deleted, or it was never stored here.`),
  );
  result.located(locations.flatMap((l) => l.parts)[0] || null);

  const answers = await Promise.all(OTHER_NODES.map(async (node) => {
    try {
      return { node, found: (await fetchLocations(node, cid.key, { signal })).length > 0 };
    } catch {
      return { node, found: null };
    }
  }));
  if (gen !== generation) return;

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
  out.replaceChildren();

  const text = value.trim();
  intro.hidden = Boolean(text);
  clear.hidden = !text;
  document.body.classList.toggle('has-result', Boolean(text));
  if (!text) return;

  const cid = parseCid(text);
  if (!cid.ok) {
    out.append(problemCard(cid));
    return;
  }

  const details = detailsCard(cid);
  const result = resultCard(cid, text, controller.signal, details);
  out.append(result.el, details.el);
  lookUp(cid, result, details, gen, controller.signal);
}

// A CID arrives as cid.serey.io/<cid> (the link from the Serey Explorer) or, from older links, #<cid>.
function fromUrl() {
  const raw = window.location.hash.slice(1) || window.location.pathname.slice(1);
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return ''; // an unreadable address is just empty
  }
}

function show(value) {
  const text = value.trim();
  window.history.replaceState(null, '', `/${text ? encodeURIComponent(text) : ''}`);
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
