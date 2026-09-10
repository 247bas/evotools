// keygen — UI wiring. Nothing here touches the network except the explicit
// "download offline copy" action, which reads this page's own assets.
import {
  generateMnemonic, isValidMnemonic, deriveAll, derivationSnippet, addKeySnippet,
  buildAddKeyTransition, missingRoles, loadEvo, KEY_ROLES,
} from './keys.js';
import { qrSvg } from '../../shared/qr.js';
import { looksLikeSecret } from '../../shared/secrets.js';
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
  // The add-key section derives from whatever phrase is loaded, so it has to
  // hear about this one. Defined below; this runs long after load.
  renderPhraseState();
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
  const [page, theme, css, appJs, keysJs, qrJs, secretsJs, sdk] = await Promise.all([
    fetchText('/keygen/index.html'),
    fetchText('/shared/theme.css'),
    fetchText('/keygen/css/keygen.css'),
    fetchText('/keygen/js/app.js'),
    fetchText('/keygen/js/keys.js'),
    fetchText('/shared/qr.js'),
    fetchText('/shared/secrets.js'),
    fetchText('/shared/vendor/evo-sdk.module.js'),
  ]);
  const html = buildOfflineHtml({ page, theme, css, appJs, keysJs, qrJs, secretsJs, sdk });

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
// One connected SDK per network, not one full stop. Caching without the
// network in the key meant switching the selector kept querying the old chain,
// so a mainnet identity came back "not found" from a testnet node.
const _sdks = {};
async function connected() {
  if (isOffline()) throw new Error('This copy has no network. Type the identity\'s revision, nonce and master key id in yourself — the explorer shows all three.');
  const net = $('netsel').value;
  if (_sdks[net]) return _sdks[net];
  const { EvoSDK } = await loadEvo();
  const sdk = net === 'mainnet' ? EvoSDK.mainnetTrusted() : EvoSDK.testnetTrusted();
  await sdk.connect();
  _sdks[net] = sdk;
  return sdk;
}

// The network lives at the top of the page, next to generating a phrase, and
// this section is a long way below it. Rather than a second setting that can
// disagree with the first, this one mirrors it both ways.
const netMirrors = () => [$('netsel'), $('akNet')];
function syncNetwork(from) {
  for (const select of netMirrors()) if (select !== from) select.value = from.value;
}
for (const select of netMirrors()) select.addEventListener('change', () => {
  syncNetwork(select);
  renderAddKeySnippet();
});

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

// The phrase lives in a collapsed block in the section above this one, so from
// down here there is no field to see and nothing to fill in. Rather than an
// error that says "restore a phrase first" and leaves you hunting, this shows
// whether one is loaded and opens the block for you.
function openPhraseBlock() {
  $('restoreBlock').hidden = false;
  $('mnemonicInput').focus();
  $('restoreBlock').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// A generated phrase never lands in the restore box — it goes to `current` and
// is rendered into the result panel. Reading only the box would refuse to build
// while the phrase is sitting on screen a section above.
const loadedPhrase = () =>
  (current?.mnemonic || $('mnemonicInput').value || '').trim().replace(/\s+/g, ' ');

function renderPhraseState() {
  const loaded = Boolean(loadedPhrase());
  const host = $('akPhraseState');
  if (loaded) {
    host.replaceChildren(el('div', 'note ok',
      `A phrase is loaded${current ? ' — the one showing above' : ''}. The new key is derived from it.`));
    return;
  }
  const note = el('div', 'note warn');
  note.append(el('span', null, 'No phrase loaded yet — the new key has to come from one. '));
  const open = el('button', 'btn ghost sm kg-noprint', 'Enter the phrase');
  open.addEventListener('click', openPhraseBlock);
  note.append(open);
  host.replaceChildren(note);
}

$('mnemonicInput').addEventListener('input', renderPhraseState);

// Two routes to the same transition. The phrase one reproduces both keys
// forever; the pasted one works for an identity that never came from a phrase.
function renderSource() {
  const wif = $('akSource').value === 'wif';
  $('akWifBlock').hidden = !wif;
  $('akPhraseState').hidden = wif;
  // The key id drives the derivation path, which a pasted key does not have.
  $('akNewId').closest('.field').hidden = false;
}
$('akSource').addEventListener('change', renderSource);

// What the lookup found, so a pasted master key can be checked against the
// identity before anything is broadcast.
let identityMasterHash = null;

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
  renderAddKeySnippet();
}
$('akRole').addEventListener('change', describeRole);

// The same promise the page above makes: what is written here is what runs.
// It follows the form as you change it, so the code matches the key you are
// about to add rather than a generic example.
function renderAddKeySnippet() {
  const host = $('akSnippet');
  const wasOpen = host.querySelector('details')?.open ?? false;
  const [purpose, securityLevel] = ($('akRole').value || 'AUTHENTICATION|CRITICAL|2').split('|');
  host.replaceChildren(snippet(
    addKeySnippet($('netsel').value, {
      purpose,
      securityLevel,
      bound: Boolean($('akBoundContract').value.trim()),
    }),
    wasOpen,
  ));
}
$('akBoundContract').addEventListener('input', renderAddKeySnippet);

// An id or a .dash name. The name is the thing people actually know, and this
// box sits a few fields above two that want private keys — so a key pasted in
// the wrong one must not become a DPNS lookup, which is a request to a node.
async function resolveIdentityInput(sdk, raw) {
  const input = (raw || '').trim();
  if (!input) throw new Error('Give the identity id or its .dash name.');
  if (looksLikeSecret(input)) {
    throw new Error('That looks like a private key or a recovery phrase, not an identity id or a name. '
      + 'Nothing was sent. The key fields are further down.');
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(input)) return { identityId: input, name: '' };

  const label = input.replace(/\.dash$/i, '').toLowerCase();
  const owner = await sdk.dpns.resolveName(label);
  if (!owner) throw new Error(`No identity owns the name "${input}" on ${$('netsel').value}.`);
  return { identityId: String(owner), name: `${label}.dash` };
}

$('akLookupBtn').addEventListener('click', withBusy($('akLookupBtn'), 'Looking…', async () => {
  clearError();
  const sdk = await connected();
  const resolved = await resolveIdentityInput(sdk, $('akIdentity').value);
  const identityId = resolved.identityId;
  // Put the id in the box: everything below works from it, and it is what you
  // want on screen once the name has done its job.
  $('akIdentity').value = identityId;

  const net = $('netsel').value;
  let identity;
  try {
    identity = await sdk.identities.fetch(identityId);
  } catch {
    // The SDK's own complaint here is "byte length not 32 bytes", which reads
    // like something broke rather than like a typo in the box.
    throw new Error('That is not a valid identity id — it should be 43 or 44 base58 characters.');
  }
  if (!identity) {
    throw new Error(`No identity with that id on ${net}. `
      + `The network selector sits at the top of this page and beside this field, and it is on ${net} now.`);
  }
  const keys = await sdk.identities.getKeys({ identityId, request: { type: 'all' } });
  const nonce = (await sdk.identities.nonce(identityId)) ?? 0n;

  $('akRevision').value = String((identity.revision ?? 0n) + 1n);
  $('akNonce').value = String(nonce + 1n);
  const master = keys.find((k) => k.securityLevel === 'MASTER' && !k.disabledAt);
  if (master) $('akMasterId').value = String(master.keyId);
  identityMasterHash = master ? master.getPublicKeyHash() : null;

  const shaped = keys.map((k) => ({ keyId: k.keyId, purpose: k.purpose, securityLevel: k.securityLevel, disabled: Boolean(k.disabledAt) }));
  const missing = missingRoles(shaped);

  const box = el('div', 'box small mono');
  box.style.whiteSpace = 'pre-line';
  box.textContent = shaped
    .map((k) => `#${k.keyId}  ${k.purpose} / ${k.securityLevel}${k.disabled ? '  (disabled)' : ''}`)
    .join('\n');
  const summary = el('div', missing.length ? 'note warn' : 'note ok',
    (resolved.name ? `${resolved.name} is ${identityId}. ` : '')
    + (missing.length
      ? `Missing: ${missing.map((m) => `${m.purpose}/${m.securityLevel}`).join(', ')}.`
      : 'This identity has all five standard keys.'));
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
  const usingWif = $('akSource').value === 'wif';
  const mnemonic = loadedPhrase();
  if (!usingWif && !mnemonic) {
    openPhraseBlock();
    throw new Error('The new key is derived from your recovery phrase, and none is loaded yet. '
      + 'The field is open now, in the section above — paste the phrase of this identity there and try again. '
      + 'No phrase? Switch "Where the keys come from" to pasting your master key.');
  }
  if (usingWif && !$('akMasterWif').value.trim()) {
    throw new Error('Paste the master key of this identity, or switch back to deriving from a phrase.');
  }
  // Only when the phrase is the thing being used. Left unconditional, this
  // rejected an empty phrase on the pasted-key route, where there is no phrase
  // by design and the message pointed at a field that was not even on screen.
  if (!usingWif && !(await isValidMnemonic(mnemonic))) {
    throw new Error('That phrase is not a valid mnemonic — check for typos or a missing word.');
  }

  const [purpose, securityLevel] = ($('akRole').value || 'AUTHENTICATION|CRITICAL|2').split('|');
  const built = await buildAddKeyTransition({
    mnemonic: usingWif ? undefined : mnemonic,
    masterWif: usingWif ? $('akMasterWif').value : undefined,
    newKeyWif: usingWif ? ($('akNewWif').value.trim() || undefined) : undefined,
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

  // The signature is made by whatever key was given; whether that key is on the
  // identity is a different question, and the lookup already knows the answer.
  // Catching it here costs nothing and saves a broadcast that could only fail.
  if (identityMasterHash && built.masterKeyHash !== identityMasterHash) {
    throw new Error(
      'That is not the master key of this identity. The key given hashes to '
      + `${built.masterKeyHash}, and the identity's master key is ${identityMasterHash}. `
      + (usingWif ? 'Check the WIF.' : 'This phrase is probably from a different identity.'),
    );
  }

  const out = $('akOut');
  out.replaceChildren();

  out.append(el('div', 'note ok',
    `Signed. Adds key #${built.added.keyId} — ${built.added.purpose} / ${built.added.securityLevel}, `
    + `derived at ${built.added.path}.`
    + (built.added.boundTo ? ` Bound to ${built.added.boundTo}, and usable nowhere else.` : '')));

  for (const [label, value] of [
    ['New key, public', built.added.publicKeyHex],
    [built.generated
      ? 'New key, private (WIF) — the only copy there is, write it down now'
      : 'New key, private (WIF) — write this down',
    built.added.wif],
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
renderPhraseState();
renderSource();
renderAddKeySnippet();
