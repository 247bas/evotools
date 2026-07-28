// keygen — UI wiring. Nothing here touches the network except the explicit
// "download offline copy" action, which reads this page's own assets.
import { generateMnemonic, isValidMnemonic, deriveAll, derivationSnippet } from './keys.js';
import { qrSvg } from '../../shared/qr.js';
// offline.js is imported on demand: the offline copy hides the download button
// and has no files to resolve a relative import against.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const isOffline = () => document.documentElement.dataset.offline === '1';

let current = null;

function showError(err) {
  const box = $('globalError');
  box.textContent = typeof err === 'string' ? err : err?.message || String(err);
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
const clearError = () => { $('globalError').hidden = true; };

function withBusy(btn, label, fn) {
  return async (...args) => {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try { await fn(...args); } catch (e) { showError(e); }
    finally { btn.disabled = false; btn.textContent = old; }
  };
}

async function copyToButton(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = old; }, 1400);
  } catch { showError('Copy failed — select the text and copy it by hand.'); }
}

// ── SDK snippet ──────────────────────────────────────────────────────────────
// The same collapsible dash-name and the explorer use: the exact evo-sdk calls
// behind the button, so the page doubles as a starting point to copy from.
function snippet(code, open) {
  const d = el('details', 'kg-snippet');
  d.open = open;
  d.append(el('summary', null, 'SDK snippet — what runs behind the scenes'));
  const body = el('div', 'kg-snippet-body');
  body.append(el('pre', 'mono', code));
  const copy = el('button', 'btn ghost sm', 'Copy');
  copy.addEventListener('click', () => copyToButton(copy, code));
  body.append(copy);
  d.append(body);
  return d;
}

function renderSnippet() {
  const host = $('introSnippet');
  const wasOpen = host.firstElementChild?.open ?? false;
  host.replaceChildren(snippet(derivationSnippet($('netsel').value), wasOpen));
}

// ── render ───────────────────────────────────────────────────────────────────
function render(result) {
  current = result;
  const unit = result.network === 'mainnet' ? 'mainnet' : 'testnet';
  $('resultTitle').textContent = `Your keys — ${unit}`;

  const words = result.mnemonic.split(/\s+/);
  $('wordList').replaceChildren(...words.map((w) => el('li', null, w)));

  $('addressBox').textContent = result.address;
  $('coreAddressBox').textContent = result.coreAddress;
  // The QR carries the Dash address: that is the one a wallet can scan and pay.
  $('qrBox').innerHTML = qrSvg(result.coreAddress, { scale: 4, quiet: 3 });

  $('keyRows').replaceChildren(...result.keys.map((k) => {
    const tr = el('tr');
    tr.append(el('td', 'mono', `#${k.keyId}`));
    const role = el('td');
    role.append(el('span', null, `${k.label} · ${k.securityLevel}`));
    role.append(el('span', 'kg-role', k.use));
    tr.append(role);
    tr.append(el('td', 'mono', k.path));
    tr.append(el('td', 'mono', k.wif));
    return tr;
  }));
  $('fundingBox').textContent = result.fundingWif;

  $('result').hidden = false;
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── actions ──────────────────────────────────────────────────────────────────
$('genBtn').addEventListener('click', withBusy($('genBtn'), 'Deriving…', async () => {
  clearError();
  const mnemonic = await generateMnemonic();
  render(await deriveAll(mnemonic, $('netsel').value));
}));

$('restoreBtn').addEventListener('click', () => {
  const block = $('restoreBlock');
  block.hidden = !block.hidden;
  if (!block.hidden) $('mnemonicInput').focus();
});

$('deriveBtn').addEventListener('click', withBusy($('deriveBtn'), 'Deriving…', async () => {
  clearError();
  const mnemonic = $('mnemonicInput').value.trim().replace(/\s+/g, ' ');
  if (!mnemonic) throw new Error('Enter your recovery phrase first.');
  if (!(await isValidMnemonic(mnemonic))) {
    throw new Error('That phrase is not a valid mnemonic — check for typos or a missing word.');
  }
  render(await deriveAll(mnemonic, $('netsel').value));
}));

$('netsel').addEventListener('change', async () => {
  renderSnippet();
  if (!current) return;
  clearError();
  try { render(await deriveAll(current.mnemonic, $('netsel').value)); } catch (e) { showError(e); }
});

$('copyMnemonic').addEventListener('click', (e) => copyToButton(e.target, current?.mnemonic ?? ''));
$('copyAddress').addEventListener('click', (e) => copyToButton(e.target, current?.address ?? ''));
$('copyCoreAddress').addEventListener('click', (e) => copyToButton(e.target, current?.coreAddress ?? ''));
$('copyFunding').addEventListener('click', (e) => copyToButton(e.target, current?.fundingWif ?? ''));

// A collapsed <details> keeps its content out of the printed page no matter what
// the stylesheet says, so open it for the duration of the print and put it back
// afterwards. beforeprint covers Ctrl+P; the media query listener covers the
// browsers that never fire it.
let openBeforePrint = null;
function revealSecrets() {
  if (openBeforePrint === null) openBeforePrint = $('secretBlock').open;
  $('secretBlock').open = true;
}
function restoreSecrets() {
  if (openBeforePrint === null) return;
  $('secretBlock').open = openBeforePrint;
  openBeforePrint = null;
}
window.addEventListener('beforeprint', revealSecrets);
window.addEventListener('afterprint', restoreSecrets);
if (window.matchMedia) {
  const printing = window.matchMedia('print');
  const onChange = (e) => (e.matches ? revealSecrets() : restoreSecrets());
  if (printing.addEventListener) printing.addEventListener('change', onChange);
  else if (printing.addListener) printing.addListener(onChange);
}
$('printBtn').addEventListener('click', () => {
  revealSecrets();
  window.print();
});

// ── offline copy ─────────────────────────────────────────────────────────────
// One HTML file with the SDK inlined and a policy that forbids every request.
// Sources go into inert <script type="text/plain"> blocks and become blob
// modules at start-up, which is the only way to import them without files.
const fetchText = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not read ${path} (${res.status}).`);
  return res.text();
};

async function buildOfflineCopy() {
  const { buildOfflineHtml } = await import('./offline.js');
  const [page, theme, css, appJs, keysJs, qrJs, sdk] = await Promise.all([
    fetchText('/keygen/index.html'),
    fetchText('/shared/theme.css'),
    fetchText('/keygen/css/keygen.css'),
    fetchText('/keygen/js/app.js'),
    fetchText('/keygen/js/keys.js'),
    fetchText('/keygen/js/qr.js'),
    fetchText('/shared/vendor/evo-sdk.module.js'),
  ]);
  const html = buildOfflineHtml({ page, theme, css, appJs, keysJs, qrJs, sdk });

  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'evo-keygen-offline.html';
  a.click();
  URL.revokeObjectURL(url);
}

$('downloadBtn').addEventListener('click', withBusy($('downloadBtn'), 'Packing…', async () => {
  clearError();
  await buildOfflineCopy();
}));

// The offline copy cannot rebuild itself: fetching its own sources is exactly
// what its policy forbids, and it has nowhere to fetch them from. Say where you
// are instead of offering a download that cannot work.
if (isOffline()) {
  $('downloadBlock').hidden = true;
  $('offlineNote').hidden = false;
}

renderSnippet();
