// keygen — UI wiring. Nothing here touches the network except the explicit
// "download offline copy" action, which reads this page's own assets.
import {
  generateMnemonic, isValidMnemonic, deriveAll, derivationSnippet,
  buildAddKeyTransition, missingRoles, loadEvo, KEY_ROLES,
} from './keys.js';
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
    fetchText('/shared/qr.js'),
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


/* ── adding a key to an identity that already exists ──────────────────────── */

// The only place on this page that wants a network, and it is optional: the
// three numbers it fetches can be typed in by hand, which is what the offline
// copy does. Connected lazily so the page still costs nothing to open.
let _sdk = null;
async function connected() {
  if (isOffline()) throw new Error('This copy has no network. Type the identity\'s revision, nonce and master key id in yourself — the explorer shows all three.');
  if (_sdk) return _sdk;
  const { EvoSDK } = await loadEvo();
  _sdk = $('netsel').value === 'mainnet' ? EvoSDK.mainnetTrusted() : EvoSDK.testnetTrusted();
  await _sdk.connect();
  return _sdk;
}

// MASTER is not offered. An identity update is the only way to add a key and
// it can only be signed by a master key, so an identity without one can never
// be changed at all, and one with a master key does not need a second.
const addable = (roles) => {
  const list = roles.filter((r) => r.securityLevel !== 'MASTER');
  // The five standard roles carry an ENCRYPTION key but no DECRYPTION one, and
  // a DashPay contact request needs both. Offered here rather than added to
  // KEY_ROLES, which describes what keygen creates, not everything that can be
  // added later.
  if (!list.some((r) => r.purpose === 'DECRYPTION')) {
    list.push({
      keyId: 5, purpose: 'DECRYPTION', securityLevel: 'MEDIUM',
      label: 'Decryption', use: 'decrypts messages — DashPay needs one, bound to its contract',
    });
  }
  return list;
};

const DASHPAY_CONTRACT = 'Bwr4WHCPz5rFVAD87RqTs3izo4zpzwsEdKPWUT1NS1C7';
$('akDashpayBtn').addEventListener('click', () => {
  $('akBoundContract').value = DASHPAY_CONTRACT;
  if (!$('akBoundType').value.trim()) $('akBoundType').value = 'contactRequest';
});

function fillRoles(missing) {
  const select = $('akRole');
  const roles = addable(missing?.length ? missing : KEY_ROLES);
  select.replaceChildren();
  for (const role of roles) {
    // Short label: the whole sentence truncates inside a select, and what the
    // key is for belongs under it where it can be read.
    const option = el('option', null, `${role.purpose} / ${role.securityLevel}`);
    option.value = `${role.purpose}|${role.securityLevel}|${role.keyId}`;
    option.dataset.use = role.use;
    select.append(option);
  }
  describeRole();
  if (!$('akNewId').value.trim() && roles[0]) $('akNewId').value = String(roles[0].keyId);
}

function describeRole() {
  const option = $('akRole').selectedOptions[0];
  $('akRoleUse').textContent = option ? option.dataset.use ?? '' : '';
}
$('akRole').addEventListener('change', describeRole);

$('akLookupBtn').addEventListener('click', withBusy($('akLookupBtn'), 'Looking…', async () => {
  clearError();
  const identityId = $('akIdentity').value.trim();
  if (!identityId) throw new Error('Paste the identity id first.');
  const sdk = await connected();

  const identity = await sdk.identities.fetch(identityId);
  if (!identity) throw new Error('No identity with that id on this network.');
  const keys = await sdk.identities.getKeys({ identityId, request: { type: 'all' } });
  const nonce = (await sdk.identities.nonce(identityId)) ?? 0n;

  $('akRevision').value = String((identity.revision ?? 0n) + 1n);
  $('akNonce').value = String(nonce + 1n);
  const master = keys.find((k) => k.securityLevel === 'MASTER' && !k.disabledAt);
  if (master) $('akMasterId').value = String(master.keyId);

  const shaped = keys.map((k) => ({ keyId: k.keyId, purpose: k.purpose, securityLevel: k.securityLevel, disabled: Boolean(k.disabledAt) }));
  const missing = missingRoles(shaped);

  const box = el('div', 'box small mono');
  box.style.whiteSpace = 'pre-line';
  box.textContent = shaped
    .map((k) => `#${k.keyId}  ${k.purpose} / ${k.securityLevel}${k.disabled ? '  (disabled)' : ''}`)
    .join('\n');
  const summary = el('div', missing.length ? 'note warn' : 'note ok',
    missing.length
      ? `Missing: ${missing.map((m) => `${m.purpose}/${m.securityLevel}`).join(', ')}.`
      : 'This identity has all five standard keys.');
  $('akKeys').replaceChildren(box, summary);

  // The next free slot, which is what a new key has to use — the role's own
  // number is often taken by something else on an identity like this.
  const taken = new Set(shaped.map((k) => k.keyId));
  let free = 0;
  while (taken.has(free)) free++;
  $('akNewId').value = String(free);

  fillRoles(missing);
  if (!master) {
    throw new Error('This identity has no master key, so nothing can be added to it. That is permanent.');
  }
}));

$('akBuildBtn').addEventListener('click', withBusy($('akBuildBtn'), 'Building…', async () => {
  clearError();
  const mnemonic = ($('mnemonicInput').value || '').trim();
  if (!mnemonic) throw new Error('Generate or restore a phrase first — the new key comes from it.');
  if (!(await isValidMnemonic(mnemonic))) throw new Error('That phrase is not valid.');

  const [purpose, securityLevel] = ($('akRole').value || 'AUTHENTICATION|CRITICAL|2').split('|');
  const built = await buildAddKeyTransition({
    mnemonic,
    network: $('netsel').value,
    identityId: $('akIdentity').value.trim(),
    revision: $('akRevision').value.trim(),
    nonce: $('akNonce').value.trim(),
    masterKeyId: Number($('akMasterId').value.trim() || '0'),
    newKeyId: Number($('akNewId').value.trim()),
    purpose,
    securityLevel,
    boundContractId: $('akBoundContract').value.trim() || undefined,
    boundDocumentType: $('akBoundType').value.trim() || undefined,
  });

  const out = $('akOut');
  out.replaceChildren();

  out.append(el('div', 'note ok',
    `Signed. Adds key #${built.added.keyId} — ${built.added.purpose} / ${built.added.securityLevel}, `
    + `derived at ${built.added.path}.`
    + (built.added.boundTo ? ` Bound to ${built.added.boundTo}, and usable nowhere else.` : '')));

  for (const [label, value] of [
    ['New key, public', built.added.publicKeyHex],
    ['New key, private (WIF) — write this down', built.added.wif],
    ['Signed transition (hex)', built.hex],
  ]) {
    const field = el('div', 'field');
    const head = el('div', 'field-head');
    head.append(el('label', null, label));
    const copy = el('button', 'btn ghost sm kg-noprint', 'Copy');
    copy.addEventListener('click', () => copyToButton(copy, value));
    head.append(copy);
    field.append(head);
    const box = el('div', 'mono box small', value);
    field.append(box);
    out.append(field);
  }

  out.append(el('div', 'fineprint',
    isOffline()
      ? 'Carry the hex to a machine with a network and broadcast it there — the explorer\'s developer tools take a raw state transition. Nothing else has to travel, and the phrase stays here.'
      : 'Broadcast it below, or paste the hex into the explorer\'s developer tools.'));

  $('akBroadcastBtn').hidden = isOffline();
  $('akBroadcastBtn').dataset.hex = built.hex;
}));

$('akBroadcastBtn').addEventListener('click', withBusy($('akBroadcastBtn'), 'Broadcasting…', async () => {
  clearError();
  const hex = $('akBroadcastBtn').dataset.hex;
  if (!hex) throw new Error('Build the transition first.');
  const sdk = await connected();
  await sdk.stateTransitions.broadcastAndWait(hex);
  $('akOut').append(el('div', 'note ok', 'Accepted. Look the identity up again to see the key on it.'));
  $('akBroadcastBtn').hidden = true;
}));

// The offline copy cannot look anything up or broadcast, so it says what to do
// instead rather than showing dead buttons.
if (isOffline()) {
  $('akLookupBtn').hidden = true;
  $('akBroadcastBtn').hidden = true;
  $('akOfflineHint').hidden = false;
}
fillRoles();
