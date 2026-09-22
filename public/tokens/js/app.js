// tokens — UI wiring. Keys are used only to sign, in this page, and are never
// stored or sent anywhere.
//
// The page asks one thing at a time (see steps.js for why the two layouts share
// a DOM). This file holds what each step does; the chain work is all in
// tokens.js, so the wizard and the everything-at-once view cannot answer
// differently.
import {
  lookupIdentity, tokenInfo, createToken, mintToken, sendToken, holdersOf,
  tokensHeldBy, formatAmount, apiHost,
} from './tokens.js';
import { shareOf } from '../../shared/token-holders.js';
import { setNetwork, getNetwork } from './sdk.js';
import { createWizard } from './steps.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const CREDITS_PER_DASH = 100_000_000_000n;
const unit = () => (getNetwork() === 'mainnet' ? 'DASH' : 'tDASH');
const toDash = (credits) => (Math.floor((Number(credits) / Number(CREDITS_PER_DASH)) * 1e5) / 1e5).toFixed(5);

// Platform charges 0.1 DASH per registered part off its own fee schedule: one
// for the contract, one for the token sitting on it. This page adds neither
// search keywords nor a distribution, so a token from here is always two parts.
// The figure below is what a publish from this builder actually cost on
// testnet, processing and storage included — the extra 63 million credits over
// the flat 20,000,100,000 is that tail.
const PUBLISH_COST = 20_063_143_440n;

let current = null;
const MODE_KEY = 'evotools.tokens.mode';

const root = $('tk');
const wizard = createWizard({
  root,
  stepper: $('stepper'),
  onEnter: (step) => {
    if (step === 'review') renderReview();
    if (step === 'pick' && current && !$('heldOut').childElementCount) loadHeld(current.identityId);
  },
});

/* ── mode ─────────────────────────────────────────────────────────────────── */

function setMode(mode) {
  wizard.setMode(mode);
  $('modeBtn').textContent = mode === 'all' ? 'Step by step' : 'Show everything';
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* private window */ }
  if (mode === 'all') renderReview();
}

$('modeBtn').addEventListener('click', () => setMode(root.dataset.mode === 'all' ? 'wizard' : 'all'));

/* ── errors and busy buttons ──────────────────────────────────────────────── */

function showError(err) {
  const box = $('globalError');
  box.textContent = err?.message || String(err);
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  console.error(err);
}
const clearError = () => { $('globalError').hidden = true; };

function withBusy(btn, label, fn) {
  return async () => {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try { await fn(); } catch (e) { showError(e); }
    finally { btn.disabled = false; btn.textContent = old; }
  };
}

const say = (host, text, cls = 'note ok') => { $(host).replaceChildren(el('div', cls, text)); };

const needIdentity = () => {
  if (!current) throw new Error('Look up an identity first — the step above asks for it.');
  return current.identityId;
};

async function copyToButton(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = old; }, 1500);
  } catch { showError('The browser would not give this page the clipboard. Select the text and copy it.'); }
}

/* ── moving between steps ─────────────────────────────────────────────────── */

for (const btn of root.querySelectorAll('[data-next]')) btn.addEventListener('click', () => wizard.next());
for (const btn of root.querySelectorAll('[data-back]')) btn.addEventListener('click', () => wizard.back());
for (const btn of root.querySelectorAll('[data-flow]')) {
  btn.addEventListener('click', () => { clearError(); wizard.setFlow(btn.dataset.flow, null); });
}

/* ── identity ─────────────────────────────────────────────────────────────── */

function renderIdentity(info) {
  const grid = el('div', 'tk-summary');
  const cell = (k, v, big, cls) => {
    const c = el('div', `tk-cell${cls ? ` ${cls}` : ''}`);
    c.append(el('span', 'k', k));
    c.append(el('span', `v${big ? ' big' : ''}`, v));
    grid.append(c);
  };
  cell('Identity', info.identityId);
  cell('Name', info.name || '— none —');
  cell('Credits', `${toDash(info.balance)} ${unit()}`, true);
  cell(
    'Keys',
    info.keys.map((k) => `#${k.keyId}  ${k.purpose} / ${k.securityLevel}${k.disabled ? '  (disabled)' : ''}`).join('\n'),
    false,
    'wide',
  );
  $('identityOut').replaceChildren(grid);

  // What can sign here, stated as a fact about this identity. Not a warning:
  // looking somebody up is not an attempt to act as them, and a red box on a
  // plain lookup reads as a broken page.
  const note = info.criticalKeys.length
    ? `Tokens are signed with key #${info.criticalKeys.join(' or #')} — AUTHENTICATION at CRITICAL.`
    : info.signingKeys.length
      ? `This identity's authentication keys are ${info.signingKeys.map((k) => `#${k.keyId} (${k.securityLevel})`).join(', ')}. `
        + 'That is enough to publish a token contract, which takes CRITICAL or HIGH, but not to move one, which takes CRITICAL. '
        + 'A missing key can be added in keygen.'
      : 'This identity has no authentication key other than MASTER, so it cannot sign token transitions.';
  $('identityOut').append(el('div', 'note info', note));
  $('idNext').disabled = false;
}

$('lookupBtn').addEventListener('click', withBusy($('lookupBtn'), 'Looking…', async () => {
  clearError();
  current = await lookupIdentity($('idInput').value);
  renderIdentity(current);
  renderReview();
  // The list needs an indexer and a second round trip. Nobody should wait for
  // it to press Continue, and the make flow never opens the step it lands on.
  loadHeld(current.identityId);
}));

$('idInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lookupBtn').click(); });

$('netsel').addEventListener('change', (e) => {
  setNetwork(e.target.value);
  current = null;
  $('identityOut').replaceChildren();
  $('heldOut').replaceChildren();
  $('idNext').disabled = true;
  $('mkAckWrap').hidden = e.target.value !== 'mainnet';
  $('mkAck').checked = false;
  clearError();
  renderReview();
});

/* ── what this identity holds ─────────────────────────────────────────────── */

// The list comes from the indexer because Platform cannot answer it; the
// balances next to it are read from the chain.
async function loadHeld(identityId) {
  const out = $('heldOut');
  out.replaceChildren(el('div', 'note info', 'Looking for tokens…'));
  let held;
  try {
    held = await tokensHeldBy(identityId);
  } catch (e) {
    // The indexer being down should cost the list and nothing else.
    out.replaceChildren(el('div', 'note warn', `${e?.message || String(e)} You can still paste a contract id below.`));
    return;
  }

  if (!held.length) {
    out.replaceChildren(el('div', 'note info', 'This identity holds no tokens. Paste a contract id below, or make one.'));
    return;
  }

  const list = el('div', 'tk-held');
  for (const t of held) {
    const row = el('div', 'tk-held-row');

    const left = el('div', 'tk-held-what');
    const title = el('div', 'tk-held-name', t.name);
    if (t.isIssuer) title.append(el('span', 'tag', 'you issued it'));
    left.append(title);
    left.append(el('div', 'tk-held-sub',
      t.isIssuer
        ? `${t.contractId}`
        : `${t.contractId} · issued by ${t.ownerNames?.[0] || t.ownerId}`));
    row.append(left);

    row.append(el('div', 'tk-held-amount', `${formatAmount(t.balance, t.decimals)} ${t.plural || t.name}`));

    const actions = el('div', 'tk-held-actions');
    const go = (label, fn) => {
      const b = el('button', 'btn ghost sm', label);
      b.type = 'button';
      b.addEventListener('click', fn);
      actions.append(b);
    };
    go('Send', () => useToken('send', t.contractId, t.position));
    if (t.isIssuer) go('Mint', () => useToken('mint', t.contractId, t.position));
    go('Who holds it', () => useToken('holders', t.contractId, t.position));
    row.append(actions);

    list.append(row);
  }

  const head = el('div', 'tk-held-head');
  head.append(el('span', null, `Holds ${held.length} token${held.length === 1 ? '' : 's'}`));
  head.append(el('span', 'tk-held-source', `list from ${apiHost().replace('https://', '')}, balances from the chain`));

  out.replaceChildren(head, list);
}

// One place that says "this contract, this position, now do that with it", so a
// token picked anywhere lands in the right boxes.
function useToken(what, contractId, position) {
  clearError();
  if (!contractId) { showError('Paste a contract id first.'); return; }
  const pos = String(position ?? 0);
  if (what === 'mint') { $('mnContract').value = contractId; $('mnPosition').value = pos; }
  if (what === 'send') { $('sdContract').value = contractId; $('sdPosition').value = pos; }
  if (what === 'holders') { $('hdContract').value = contractId; $('hdPosition').value = pos; }
  wizard.setFlow(what === 'holders' ? 'holders' : what, what === 'holders' ? 'holders' : what);
  if (what === 'holders') $('hdBtn').click();
  else $(what === 'mint' ? 'mnAmount' : 'sdAmount').focus();
}

$('pkMint').addEventListener('click', () => useToken('mint', $('pkContract').value.trim(), $('pkPosition').value.trim() || 0));
$('pkSend').addEventListener('click', () => useToken('send', $('pkContract').value.trim(), $('pkPosition').value.trim() || 0));

/* ── make · the read-back ─────────────────────────────────────────────────── */

const makeForm = () => ({
  name: $('mkName').value.trim(),
  plural: $('mkPlural').value.trim(),
  decimals: Number($('mkDecimals').value.trim() || '0'),
  baseSupply: $('mkSupply').value.trim(),
  maxSupply: $('mkMax').value.trim(),
  mintable: $('mkMintable').checked,
  burnable: $('mkBurnable').checked,
  freezable: $('mkFreezable').checked,
  description: $('mkDesc').value.trim(),
});

// Reading the choices back is the whole point of the step, so a field left
// empty says so in yellow rather than rendering as a blank line.
function renderReview() {
  const f = makeForm();
  const out = $('reviewOut');
  const box = el('div', 'tk-review');
  const dl = document.createElement('dl');
  // A row that is not filled in names what is missing in the words the reader
  // would use, not the label of the box it lives in.
  const missing = [];
  const row = (k, v, missingAs) => {
    dl.append(el('dt', null, k));
    dl.append(el('dd', missingAs ? 'miss' : null, v));
    if (missingAs) missing.push(missingAs);
  };

  row('Name', f.name ? `${f.name}${f.plural && f.plural !== f.name ? ` / ${f.plural}` : ''}` : 'not filled in', !f.name && 'a name');
  row('Starting supply', f.baseSupply || 'not filled in', !f.baseSupply && 'how much there is');
  row('Decimals', String(f.decimals));
  row('Ceiling', f.maxSupply || (f.mintable ? 'none' : `${f.baseSupply || 'the starting supply'} — minting is off`));
  row('Mint more later', f.mintable ? 'yes' : 'no, ever');
  row('Burn your own', f.burnable ? 'yes' : 'no, ever');
  row('Freeze holders', f.freezable ? 'yes' : 'no, ever');
  if (f.description) row('Description', f.description);
  row('Published by', current ? (current.name || current.identityId) : 'no identity looked up', !current && 'an identity to publish it');
  row('Network', getNetwork());
  box.append(dl);
  out.replaceChildren(box);

  out.append(el('div', 'note info',
    `Publishing costs about 0.2 ${unit()}: 0.1 for the contract and 0.1 for the token on it, `
    + "off Platform's own fee schedule, plus a fraction for processing and storage."));

  if (current && current.balance < PUBLISH_COST) {
    const short = el('div', 'note bad',
      `This identity holds ${toDash(current.balance)} ${unit()}, which is under the `
      + `${toDash(PUBLISH_COST)} a publish has cost. Platform will refuse it — top the identity up first: `);
    const link = el('a', null, 'credits');
    link.href = `/credits/?net=${getNetwork()}`;
    short.append(link, document.createTextNode('.'));
    out.append(short);
  }

  if (missing.length) {
    out.append(el('div', 'note warn', `Still to fill in: ${missing.join(', ')}.`));
  }
  $('mkBtn').disabled = Boolean(missing.length) || (getNetwork() === 'mainnet' && !$('mkAck').checked);
}

for (const id of ['mkName', 'mkPlural', 'mkDecimals', 'mkSupply', 'mkMax', 'mkDesc']) {
  $(id).addEventListener('input', renderReview);
}
for (const id of ['mkMintable', 'mkBurnable', 'mkFreezable']) {
  $(id).addEventListener('change', renderReview);
}
// On mainnet the money is real, so the button waits for a deliberate tick. The
// review above is the confirmation — there is no second dialog on top of it.
$('mkAck').addEventListener('change', renderReview);

/* ── make · publish ───────────────────────────────────────────────────────── */

$('mkBtn').addEventListener('click', withBusy($('mkBtn'), 'Publishing…', async () => {
  clearError();
  const identityId = needIdentity();
  if (getNetwork() === 'mainnet' && !$('mkAck').checked) {
    throw new Error('Tick the box to confirm this spends real DASH.');
  }
  const form = makeForm();
  const result = await createToken({ identityId, wif: $('mkWif').value, ...form });
  $('mkWif').value = '';

  // The next thing anyone does is mint or send this, so fill it in.
  for (const id of ['mnContract', 'sdContract', 'hdContract', 'pkContract']) $(id).value = result.contractId;

  renderDone({
    title: `${form.name} is on ${getNetwork()}.`,
    lines: [`Signed with key #${result.keyId}. The whole starting supply is on this identity.`],
    ids: [['Contract', result.contractId], ['Token', result.tokenId]],
    tokenId: result.tokenId,
    next: [
      form.mintable ? ['Mint more', () => useToken('mint', result.contractId, 0)] : null,
      ['Send some', () => useToken('send', result.contractId, 0)],
      ['Who holds it', () => useToken('holders', result.contractId, 0)],
      ['Make another', () => { wizard.setFlow('make', 'name'); }],
    ],
  });

  current = await lookupIdentity(identityId);
  renderIdentity(current);
}));

/* ── mint ─────────────────────────────────────────────────────────────────── */

$('mnBtn').addEventListener('click', withBusy($('mnBtn'), 'Minting…', async () => {
  clearError();
  const identityId = needIdentity();
  const amount = $('mnAmount').value.trim();
  const result = await mintToken({
    identityId,
    wif: $('mnWif').value,
    contractId: $('mnContract').value,
    position: $('mnPosition').value.trim() || 0,
    amount,
    recipient: $('mnTo').value.trim(),
  });
  $('mnWif').value = '';
  $('mnAmount').value = '';
  renderDone({
    title: `Minted ${amount}.`,
    lines: [`Signed with key #${result.keyId}. It went to ${result.recipientId}.`],
    ids: [['Token', result.tokenId]],
    tokenId: result.tokenId,
    next: [
      ['Mint again', () => useToken('mint', $('mnContract').value.trim(), $('mnPosition').value.trim() || 0)],
      ['Send some', () => useToken('send', $('mnContract').value.trim(), $('mnPosition').value.trim() || 0)],
      ['Who holds it', () => useToken('holders', $('mnContract').value.trim(), $('mnPosition').value.trim() || 0)],
    ],
  });
}));

/* ── send ─────────────────────────────────────────────────────────────────── */

$('sdBtn').addEventListener('click', withBusy($('sdBtn'), 'Sending…', async () => {
  clearError();
  const identityId = needIdentity();
  const to = $('sdTo').value.trim();
  const result = await sendToken({
    identityId,
    wif: $('sdWif').value,
    contractId: $('sdContract').value,
    position: $('sdPosition').value.trim() || 0,
    amount: $('sdAmount').value,
    recipient: to,
    note: $('sdNote').value,
  });
  $('sdWif').value = '';
  $('sdAmount').value = '';
  $('sdNote').value = '';
  renderDone({
    title: `Sent ${formatAmount(result.sent, result.decimals)} to ${to}.`,
    lines: [`Signed with key #${result.keyId}. It landed on ${result.recipientId}.`],
    ids: [['Token', result.tokenId]],
    tokenId: result.tokenId,
    next: [
      ['Send more', () => useToken('send', $('sdContract').value.trim(), $('sdPosition').value.trim() || 0)],
      ['Who holds it', () => useToken('holders', $('sdContract').value.trim(), $('sdPosition').value.trim() || 0)],
    ],
  });
}));

/* ── the last screen ──────────────────────────────────────────────────────── */

function renderDone({ title, lines, ids, tokenId, next }) {
  const out = $('doneOut');
  out.replaceChildren(el('h2', null, title));
  for (const line of lines) out.append(el('p', null, line));

  for (const [label, value] of ids ?? []) {
    const wrapRow = el('div', 'tk-done-id');
    wrapRow.append(el('span', 'fineprint', label));
    wrapRow.append(el('code', null, value));
    const copy = el('button', 'btn ghost sm', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', () => copyToButton(copy, value));
    wrapRow.append(copy);
    out.append(wrapRow);
  }

  const row = el('div', 'tk-next');
  for (const entry of next ?? []) {
    if (!entry) continue;
    const [label, fn] = entry;
    const b = el('button', 'btn ghost', label);
    b.type = 'button';
    b.addEventListener('click', fn);
    row.append(b);
  }
  if (tokenId) {
    const a = el('a', 'btn ghost', 'Open in the explorer');
    a.href = `/explorer/?kind=token&q=${encodeURIComponent(tokenId)}&net=${getNetwork()}`;
    row.append(a);
  }
  out.append(row);

  root.querySelector('[data-step="done"]').classList.add('filled');
  wizard.go('done');
}

/* ── who holds it ─────────────────────────────────────────────────────────── */

function renderHolders(result) {
  const out = $('hdOut');
  out.replaceChildren();

  if (!result.holders.length) {
    out.append(el('div', 'note info',
      `Nobody holds any ${result.name || 'of it'}. ${result.events} history event${result.events === 1 ? '' : 's'} were read.`));
    return;
  }

  const wrapper = el('div', 'tk-holders');
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const [label, cls] of [['Holder', ''], ['Name', ''], ['Balance', 'num'], ['Share', 'share']]) {
    hr.append(el('th', cls, label));
  }
  thead.append(hr);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const h of result.holders) {
    const tr = document.createElement('tr');

    const who = el('td', 'who', h.identityId);
    if (h.identityId === result.ownerId) who.append(el('span', 'tag', 'issuer'));
    tr.append(who);

    tr.append(el('td', null, h.names?.length ? h.names.join(', ') : '—'));
    tr.append(el('td', 'num', formatAmount(h.balance, result.decimals)));
    tr.append(el('td', 'share', shareOf(h.balance, result.held)));
    tbody.append(tr);
  }
  table.append(tbody);
  wrapper.append(table);
  out.append(wrapper);

  out.append(el('div', 'fineprint',
    `${result.holders.length} holder${result.holders.length === 1 ? '' : 's'}, `
    + `${formatAmount(result.held, result.decimals)} ${result.plural || result.name} between them, `
    + `from ${result.events} history event${result.events === 1 ? '' : 's'}.`));

  if (!result.complete) {
    out.append(el('div', 'note warn',
      'This token was published without history, so there is no trail to walk. '
      + 'What is above is whatever could be worked out, and it is probably not everyone.'));
  }
}

$('hdBtn').addEventListener('click', withBusy($('hdBtn'), 'Reading history…', async () => {
  clearError();
  say('hdOut', 'Reading the token history…', 'note info');
  const result = await holdersOf(
    $('hdContract').value,
    $('hdPosition').value.trim() || 0,
    (type, seen) => say('hdOut', `Reading the token history — ${type}, ${seen} events so far…`, 'note info'),
  );
  renderHolders(result);
}));

// Look up the token behind the holders box as soon as one is pasted, so the
// reader knows what they are about to walk.
$('hdContract').addEventListener('change', async () => {
  const value = $('hdContract').value.trim();
  if (!value) return;
  try {
    const info = await tokenInfo(value, $('hdPosition').value.trim() || 0);
    say('hdOut', `${info.name}${info.plural && info.plural !== info.name ? ` / ${info.plural}` : ''} — `
      + `${formatAmount(info.baseSupply, info.decimals)} issued, ${info.decimals} decimals.`, 'note info');
  } catch { /* the button will say what is wrong */ }
});

// Filling in one contract box and then hunting for the others is the kind of
// friction that makes a tool feel unfinished.
for (const [from, to] of [['pkContract', 'mnContract'], ['mnContract', 'sdContract'], ['sdContract', 'hdContract']]) {
  $(from).addEventListener('change', () => { if (!$(to).value.trim()) $(to).value = $(from).value.trim(); });
}

/* ── opening state ────────────────────────────────────────────────────────── */

const params = new URLSearchParams(location.search);
if (params.get('net') === 'mainnet') { $('netsel').value = 'mainnet'; setNetwork('mainnet'); }
$('mkAckWrap').hidden = getNetwork() !== 'mainnet';

let mode = params.get('view') === 'all' ? 'all' : null;
if (!mode) { try { mode = localStorage.getItem(MODE_KEY); } catch { /* private window */ } }
setMode(mode === 'all' ? 'all' : 'wizard');
renderReview();

const preset = params.get('contract');
if (preset) for (const id of ['mnContract', 'sdContract', 'hdContract', 'pkContract']) $(id).value = preset;

// /tokens/?do=make lands straight on the first question — that is what the
// front page links to.
const DEEP = { make: 'identity', mint: 'identity', send: 'identity', holders: 'holders' };
const doing = params.get('do');
if (doing && DEEP[doing]) wizard.setFlow(doing, DEEP[doing]);
else if (preset) wizard.setFlow('holders', 'holders');

const presetIdentity = params.get('identity');
if (presetIdentity) {
  $('idInput').value = presetIdentity;
  if (!doing) wizard.setFlow('send', 'identity');
  $('lookupBtn').click();
}
