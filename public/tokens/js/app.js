// tokens — UI wiring. Keys are used only to sign, in this page, and are never
// stored or sent anywhere.
import {
  lookupIdentity, tokenInfo, createToken, mintToken, sendToken, holdersOf,
  formatAmount,
} from './tokens.js';
import { shareOf } from '../../shared/token-holders.js';
import { setNetwork, getNetwork } from './sdk.js';

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

let current = null;

function showError(err) {
  const box = $('globalError');
  box.textContent = err?.message || String(err);
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  if (!current) throw new Error('Look up an identity first.');
  return current.identityId;
};

// ── look up ──────────────────────────────────────────────────────────────────
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

  // Everything on this page needs the same key, so say now whether it exists
  // rather than after a form has been filled in.
  if (!info.signingKeys.length) {
    $('identityOut').append(el('div', 'note bad',
      'This identity has no AUTHENTICATION key at CRITICAL, so it cannot make or move tokens. '
      + 'That is key #2 on a standard identity.'));
  } else {
    $('identityOut').append(el('div', 'note info',
      `Tokens are signed with key #${info.signingKeys.join(' or #')} — AUTHENTICATION at CRITICAL.`));
  }
  $('actions').hidden = false;
}

$('lookupBtn').addEventListener('click', withBusy($('lookupBtn'), 'Looking…', async () => {
  clearError();
  current = await lookupIdentity($('idInput').value);
  renderIdentity(current);
}));

$('idInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lookupBtn').click(); });

$('netsel').addEventListener('change', (e) => {
  setNetwork(e.target.value);
  current = null;
  $('identityOut').replaceChildren();
  $('actions').hidden = true;
  clearError();
});

// ── make ─────────────────────────────────────────────────────────────────────
$('mkBtn').addEventListener('click', withBusy($('mkBtn'), 'Publishing…', async () => {
  clearError();
  const identityId = needIdentity();
  const form = {
    name: $('mkName').value,
    plural: $('mkPlural').value,
    decimals: Number($('mkDecimals').value.trim() || '0'),
    baseSupply: $('mkSupply').value,
    maxSupply: $('mkMax').value.trim(),
    mintable: $('mkMintable').checked,
    burnable: $('mkBurnable').checked,
    freezable: $('mkFreezable').checked,
    description: $('mkDesc').value,
  };

  const supply = form.maxSupply ? `${form.baseSupply} now, ${form.maxSupply} at most` : form.baseSupply;
  const agreed = confirm(
    `Publish "${form.name}" on ${getNetwork()}?\n\n`
    + `Supply: ${supply}\nDecimals: ${form.decimals}\n`
    + `Mint more later: ${form.mintable ? 'yes' : 'no, ever'}\n`
    + `Freeze holders: ${form.freezable ? 'yes' : 'no, ever'}\n\n`
    + 'A published contract cannot be changed or withdrawn.',
  );
  if (!agreed) return;

  const result = await createToken({ identityId, wif: $('mkWif').value, ...form });
  $('mkWif').value = '';
  say('mkOut', `Published, signed with key #${result.keyId}.\nContract ${result.contractId}\nToken ${result.tokenId}`);
  // The next thing anyone does is mint or send this, so fill it in.
  for (const id of ['mnContract', 'sdContract', 'hdContract']) $(id).value = result.contractId;
  current = await lookupIdentity(identityId);
  renderIdentity(current);
}));

// ── mint ─────────────────────────────────────────────────────────────────────
$('mnBtn').addEventListener('click', withBusy($('mnBtn'), 'Minting…', async () => {
  clearError();
  const identityId = needIdentity();
  const result = await mintToken({
    identityId,
    wif: $('mnWif').value,
    contractId: $('mnContract').value,
    position: $('mnPosition').value.trim() || 0,
    amount: $('mnAmount').value,
    recipient: $('mnTo').value.trim(),
  });
  $('mnWif').value = '';
  $('mnAmount').value = '';
  say('mnOut', `Minted, signed with key #${result.keyId}. It went to ${result.recipientId}.`);
}));

// ── send ─────────────────────────────────────────────────────────────────────
$('sdBtn').addEventListener('click', withBusy($('sdBtn'), 'Sending…', async () => {
  clearError();
  const identityId = needIdentity();
  const result = await sendToken({
    identityId,
    wif: $('sdWif').value,
    contractId: $('sdContract').value,
    position: $('sdPosition').value.trim() || 0,
    amount: $('sdAmount').value,
    recipient: $('sdTo').value.trim(),
    note: $('sdNote').value,
  });
  $('sdWif').value = '';
  $('sdAmount').value = '';
  $('sdNote').value = '';
  say('sdOut', `Sent ${formatAmount(result.sent, result.decimals)} to ${result.recipientId}, signed with key #${result.keyId}.`);
}));

// ── holders ──────────────────────────────────────────────────────────────────
function renderHolders(result) {
  const out = $('hdOut');
  out.replaceChildren();

  if (!result.holders.length) {
    out.append(el('div', 'note info',
      `Nobody holds any ${result.name || 'of it'}. ${result.events} history event${result.events === 1 ? '' : 's'} were read.`));
    return;
  }

  const wrap = el('div', 'tk-holders');
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const [label, cls] of [['Holder', ''], ['Name', ''], ['Balance', 'num'], ['Share', 'share']]) {
    const th = el('th', cls, label);
    hr.append(th);
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
  wrap.append(table);
  out.append(wrap);

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

// Filling in one contract box and then hunting for the others is the kind of
// friction that makes a tool feel unfinished.
for (const [from, to] of [['mnContract', 'sdContract'], ['sdContract', 'hdContract']]) {
  $(from).addEventListener('change', () => { if (!$(to).value.trim()) $(to).value = $(from).value.trim(); });
}

// A contract id in the address bar opens straight onto it: /tokens/?contract=…
const params = new URLSearchParams(location.search);
if (params.get('net') === 'mainnet') { $('netsel').value = 'mainnet'; setNetwork('mainnet'); }
const preset = params.get('contract');
if (preset) for (const id of ['mnContract', 'sdContract', 'hdContract']) $(id).value = preset;
const presetIdentity = params.get('identity');
if (presetIdentity) { $('idInput').value = presetIdentity; $('lookupBtn').click(); }

// Look up the token behind a contract box as soon as one is pasted, so the
// amount field can be filled in knowing the decimals rather than guessing.
$('hdContract').addEventListener('change', async () => {
  const value = $('hdContract').value.trim();
  if (!value) return;
  try {
    const info = await tokenInfo(value, $('hdPosition').value.trim() || 0);
    say('hdOut', `${info.name}${info.plural && info.plural !== info.name ? ` / ${info.plural}` : ''} — `
      + `${formatAmount(info.baseSupply, info.decimals)} issued, ${info.decimals} decimals.`, 'note info');
  } catch { /* the button will say what is wrong */ }
});
