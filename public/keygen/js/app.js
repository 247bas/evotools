// keygen — UI wiring. Nothing here touches the network except the explicit
// "download offline copy" action, which reads this page's own assets.
import {
  generateMnemonic, isValidMnemonic, deriveAll, derivationSnippet, addKeySnippet,
  buildAddKeyTransition, buildDisableKeyTransition, canDisable, whyNotDisable,
  missingRoles, loadEvo, KEY_ROLES,
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
}

// ── which job you came for ───────────────────────────────────────────────────
//
// Two things live on this page and they share only a subject. Stacked, the
// second read as a continuation of the first — you scrolled past making keys to
// reach adding one, and the add panel spoke about "the phrase above" whether or
// not there was one. One at a time, chosen rather than scrolled to.

function setFlow(flow) {
  const adding = flow === 'add';
  $('flowNew').hidden = adding;
  $('addKeyPanel').hidden = !adding;
  // The result panel belongs to making keys, and only exists once some were.
  $('result').hidden = adding || !current;
  $('flowNewBtn').setAttribute('aria-pressed', String(!adding));
  $('flowAddBtn').setAttribute('aria-pressed', String(adding));
  // A link can point straight at the job, which is what you want when telling
  // somebody how to fix their identity.
  history.replaceState(null, '', adding ? '#add' : location.pathname);
}

$('flowNewBtn').addEventListener('click', () => setFlow('new'));
$('flowAddBtn').addEventListener('click', () => setFlow('add'));

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

const loadedPhrase = () => ($('akMnemonic').value || '').trim().replace(/\s+/g, ' ');

// Each flow has its own phrase field. This one used to reach into the other
// flow's restore box, which stopped being reachable the moment the two were
// split — the button here opened a field inside a hidden section.
function renderPhraseState() {
  $('akPhraseState').replaceChildren(loadedPhrase()
    ? el('div', 'note ok', 'That is a phrase. Both keys come from it, and nothing is sent anywhere.')
    : el('div', 'fineprint', 'This has to be the phrase the identity was made from — the key being '
      + 'added is derived from it, and so is the master key that signs the change. '
      + 'No phrase? Switch the line above to pasting your master key.'));
}

$('akMnemonic').addEventListener('input', renderPhraseState);

// Two routes to the same transition. The phrase one reproduces both keys
// forever; the pasted one works for an identity that never came from a phrase.
function renderSource() {
  const wif = $('akSource').value === 'wif';
  $('akWifBlock').hidden = !wif;
  $('akPhraseBlock').hidden = wif;
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

// A lookup fills in everything the two transitions below need: the revision,
// the nonce, which key is the master, and the keys the identity has now. It is
// also what runs after a broadcast, because by then all four have moved on.
// `minRevision` is the revision the change just made — see the wait below.
let identityLabel = { id: '', name: '' };
async function lookupIdentity({ minRevision } = {}) {
  clearError();
  const sdk = await connected();
  const resolved = await resolveIdentityInput(sdk, $('akIdentity').value);
  const identityId = resolved.identityId;
  // A refresh gets the id back, not the name that was typed the first time, and
  // dropping the name from the summary reads like it stopped resolving.
  if (resolved.name) identityLabel = { id: identityId, name: resolved.name };
  else if (identityLabel.id !== identityId) identityLabel = { id: identityId, name: '' };
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
  // Straight after a broadcast the node can still be serving the identity as it
  // was a block ago. Reading those numbers back would fill the form with a
  // revision and a nonce that are already spent — exactly the failure this
  // refresh exists to prevent — so wait for it rather than hand them out again.
  const behind = () => minRevision != null && (identity.revision ?? 0n) < BigInt(minRevision);
  for (let tries = 0; behind() && tries < 5; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    identity = await sdk.identities.fetch(identityId);
  }
  if (behind()) {
    $('akRevision').value = '';
    $('akNonce').value = '';
    $('akKeys').replaceChildren();
    throw new Error('The change went through, but this node is still reading the identity as it was before it. '
      + 'Press "Look it up" again in a moment. The revision and nonce are empty until then, '
      + 'so the spent ones cannot be signed with by accident.');
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

  // Each key is a row you can act on, not a line of text. Which ones can be
  // switched off is a rule worth showing rather than explaining: the powerful
  // three are permanent, and seeing that beside them is the clearest way to say
  // it before somebody adds a fourth.
  const box = el('div', 'kg-keylist');
  for (const k of shaped) {
    const row = el('div', 'kg-keyrow');
    row.append(el('span', 'kg-keyid mono', `#${k.keyId}`));
    row.append(el('span', 'kg-keywhat mono', `${k.purpose} / ${k.securityLevel}`));

    if (k.disabled) {
      row.append(el('span', 'kg-keynote', 'switched off'));
    } else if (canDisable(k)) {
      const off = el('button', 'btn ghost sm kg-noprint', 'Switch off');
      off.addEventListener('click', () => disableKey(k, identityId));
      row.append(off);
    } else {
      // Just the word. Which three are permanent and why is in the box above,
      // and repeating it on every row wrapped the line and said it three times.
      const tag = el('span', 'kg-keynote', 'permanent');
      tag.title = whyNotDisable(k);
      row.append(tag);
    }
    box.append(row);
  }
  const live = shaped.filter((k) => !k.disabled).length;
  const summary = el('div', missing.length ? 'note warn' : 'note ok',
    (identityLabel.name ? `${identityLabel.name} is ${identityId}. ` : '')
    + `${live} key${live === 1 ? '' : 's'} in use. `
    + (missing.length
      ? `Missing: ${missing.map((m) => `${m.purpose}/${m.securityLevel}`).join(', ')}.`
      : 'None of the five standard roles is missing.'));
  $('akKeys').replaceChildren(summary, box);
  $('akKeysMsg').replaceChildren();

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
}
$('akLookupBtn').addEventListener('click', withBusy($('akLookupBtn'), 'Looking…', () => lookupIdentity()));

// Both numbers are one-shot: every change to an identity spends the pair, and a
// transition signed with a spent pair is refused by the node. Empty is worse
// than stale, because `BigInt('')` is 0n and signs without complaining.
function chainNumber(id, what) {
  const value = $(id).value.trim();
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`No ${what} to sign with. Press "Look it up" to read it off the identity, `
      + 'or type it in from the explorer.');
  }
  return value;
}

// Switching a key off is the same transition as adding one, signed by the same
// master key, so it reuses the form that is already filled in — revision, nonce
// and where the master key comes from.
async function disableKey(key, identityId) {
  clearError();
  const usingWif = $('akSource').value === 'wif';
  const agreed = confirm(
    `Switch off key #${key.keyId}, ${key.purpose} / ${key.securityLevel}?\n\n`
    + 'It stays on the identity marked as switched off, and anything it signed before now still stands. '
    + 'It cannot sign again afterwards, and it cannot be switched back on.',
  );
  if (!agreed) return;

  try {
    const built = await buildDisableKeyTransition({
      mnemonic: usingWif ? undefined : loadedPhrase(),
      masterWif: usingWif ? $('akMasterWif').value : undefined,
      network: $('netsel').value,
      identityId,
      revision: chainNumber('akRevision', 'revision'),
      nonce: chainNumber('akNonce', 'identity nonce'),
      masterKeyId: Number($('akMasterId').value.trim() || '0'),
      disableKeyIds: [key.keyId],
    });

    if (identityMasterHash && built.masterKeyHash !== identityMasterHash) {
      throw new Error('That is not the master key of this identity, so this would be refused. '
        + `The key given hashes to ${built.masterKeyHash}, the identity's master key to ${identityMasterHash}.`);
    }

    const out = $('akOut');
    out.replaceChildren(el('div', 'note ok',
      `Signed. Switches off key #${key.keyId} — ${key.purpose} / ${key.securityLevel}.`));
    const field = el('div', 'field kg-spent');
    const head = el('div', 'field-head');
    head.append(el('label', null, 'Signed transition (hex)'));
    const copy = el('button', 'btn ghost sm kg-noprint', 'Copy');
    copy.addEventListener('click', () => copyToButton(copy, built.hex));
    head.append(copy);
    field.append(head, el('div', 'mono box small', built.hex));
    out.append(field);
    out.append(el('div', 'fineprint', isOffline()
      ? 'Carry the hex to a machine with a network and broadcast it there.'
      : 'Broadcast it below, or paste the hex into the explorer\'s developer tools.'));

    $('akBroadcastBtn').hidden = isOffline();
    $('akBroadcastBtn').dataset.hex = built.hex;
    $('akBroadcastBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    // Under the list that was clicked, not at the top of the page — the global
    // box scrolls you away from the button you just pressed.
    $('akKeysMsg').replaceChildren(el('div', 'note bad', e?.message || String(e)));
    $('akKeysMsg').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

$('akBuildBtn').addEventListener('click', withBusy($('akBuildBtn'), 'Building…', async () => {
  clearError();
  const usingWif = $('akSource').value === 'wif';
  const mnemonic = loadedPhrase();
  if (!usingWif && !mnemonic) {
    $('akMnemonic').focus();
    throw new Error('Paste the recovery phrase of this identity — the key being added is derived from it. '
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
    revision: chainNumber('akRevision', 'revision'),
    nonce: chainNumber('akNonce', 'identity nonce'),
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
    const field = el('div', value === built.hex ? 'field kg-spent' : 'field');
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
  // broadcastAndWait takes a StateTransition, not the hex it serialises to.
  // Handing it the string gets "expected instance of StateTransition", which
  // names the type and not the mistake.
  const { StateTransition } = await loadEvo();
  // What the identity's revision must be once this lands, so the read-back below
  // can tell a node that has caught up from one that has not. Only if the field
  // still holds a number: it can be edited after the signing, and BigInt throws
  // on anything else.
  const revisionField = $('akRevision').value.trim();
  const spent = /^[0-9]+$/.test(revisionField) ? revisionField : null;
  await sdk.stateTransitions.broadcastAndWait(StateTransition.fromHex(hex));

  // The transition is spent and so are the revision and nonce that were in the
  // form. Leaving them there is what made a second change in a row fail: the
  // signing succeeds, the node refuses it, and the message is about a revision
  // rather than about having to look the identity up again. So read it back.
  $('akBroadcastBtn').hidden = true;
  delete $('akBroadcastBtn').dataset.hex;
  // The hex is the one thing on screen that is now misleading, so it goes and
  // the rest stays: on the add-key route this panel holds the new private key,
  // and a broadcast is no reason to take that off the screen.
  for (const field of $('akOut').querySelectorAll('.kg-spent')) field.remove();
  $('akOut').append(el('div', 'note ok',
    'Accepted. Reading the identity back, so the key list above and the numbers '
    + 'for the next change are what it is now.'));
  await lookupIdentity({ minRevision: spent });
  $('akOut').append(el('div', 'fineprint', 'Up to date. Another key can be switched off or added straight away.'));
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
setFlow(location.hash === '#add' ? 'add' : 'new');
