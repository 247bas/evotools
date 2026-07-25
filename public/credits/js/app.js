// credits — UI wiring. Keys are used only to sign, in this page, and are never
// stored or sent anywhere.
import {
  lookupIdentity, addressFromWif, topUpIdentity, sendFromIdentity,
  sendBetweenAddresses, withdrawToCore, MIN_WITHDRAW_CREDITS,
} from './credits.js';
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
const toDash = (credits) => (Number(credits) / Number(CREDITS_PER_DASH)).toFixed(5);
const toCredits = (dash) => BigInt(Math.round(Number(dash) * Number(CREDITS_PER_DASH)));

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

// Amount field: empty means "everything the source holds", where that is allowed.
function optionalAmount(id) {
  const raw = $(id).value.trim();
  if (!raw) return undefined;
  const dash = Number(raw);
  if (!Number.isFinite(dash) || dash <= 0) throw new Error('Enter an amount in DASH, or leave it empty.');
  return toCredits(dash);
}
function requiredAmount(id) {
  const amount = optionalAmount(id);
  if (amount === undefined) throw new Error('Enter an amount in DASH.');
  return amount;
}
const needIdentity = () => {
  if (!current) throw new Error('Look up an identity first.');
  return current.identityId;
};

// ── look up ──────────────────────────────────────────────────────────────────
function renderIdentity(info) {
  const out = $('identityOut');
  const grid = el('div', 'cr-summary');
  const cell = (k, v, big) => {
    const c = el('div', 'cr-cell');
    c.append(el('span', 'k', k));
    c.append(el('span', `v${big ? ' big' : ''}`, v));
    return c;
  };
  grid.append(cell('Balance', `${toDash(info.balance)} ${unit()}`, true));
  grid.append(cell('Identity', info.identityId));
  if (info.name) grid.append(cell('Name', info.name));
  grid.append(cell('Keys', info.keys.map((k) => `#${k.keyId} ${k.purpose}/${k.securityLevel}`).join('\n')));
  out.replaceChildren(grid);
  if (!info.hasTransferKey) {
    out.append(el('div', 'note warn', 'No TRANSFER key on this identity, so credits can go in but never out.'));
  }
  $('actions').hidden = false;
}

$('lookupBtn').addEventListener('click', withBusy($('lookupBtn'), 'Looking…', async () => {
  clearError();
  const input = $('idInput').value.trim();
  if (!input) throw new Error('Enter an identity id or a .dash name.');
  current = await lookupIdentity(input);
  renderIdentity(current);
}));
$('idInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lookupBtn').click(); });

$('netsel').addEventListener('change', () => {
  setNetwork($('netsel').value);
  current = null;
  $('actions').hidden = true;
  $('identityOut').replaceChildren();
  clearError();
});

const refresh = async () => {
  if (!current) return;
  current = await lookupIdentity(current.identityId);
  renderIdentity(current);
};

// ── moving credits ───────────────────────────────────────────────────────────
$('topUpBtn').addEventListener('click', withBusy($('topUpBtn'), 'Moving…', async () => {
  clearError();
  const identityId = needIdentity();
  const res = await topUpIdentity({
    identityId,
    addressWif: $('topUpWif').value.trim(),
    amount: optionalAmount('topUpAmount'),
  });
  say('topUpOut', `Moved ${toDash(res.moved)} ${unit()} from ${res.from} into the identity.`);
  await refresh();
}));

$('payBtn').addEventListener('click', withBusy($('payBtn'), 'Sending…', async () => {
  clearError();
  const identityId = needIdentity();
  const toAddress = $('payTo').value.trim();
  if (!toAddress) throw new Error('Enter the platform address to send to.');
  const res = await sendFromIdentity({
    identityId,
    transferWif: $('payWif').value.trim(),
    toAddress,
    amount: requiredAmount('payAmount'),
  });
  say('payOut', `Sent ${toDash(res.moved)} ${unit()} to ${res.to}.`);
  await refresh();
}));

$('moveBtn').addEventListener('click', withBusy($('moveBtn'), 'Moving…', async () => {
  clearError();
  const toAddress = $('moveTo').value.trim();
  if (!toAddress) throw new Error('Enter the platform address to move to.');
  const res = await sendBetweenAddresses({ fromWif: $('moveWif').value.trim(), toAddress });
  say('moveOut', `Moved ${toDash(res.moved)} ${unit()} from ${res.from} to ${res.to}.`);
}));

$('wdBtn').addEventListener('click', withBusy($('wdBtn'), 'Withdrawing…', async () => {
  clearError();
  const coreAddress = $('wdTo').value.trim();
  if (!coreAddress) throw new Error('Enter the Dash address that should receive it.');
  const res = await withdrawToCore({
    fromWif: $('wdWif').value.trim(),
    coreAddress,
    amount: optionalAmount('wdAmount'),
  });
  say('wdOut', `Withdrawing ${toDash(res.moved)} ${unit()} to ${res.to}. Masternodes sign withdrawals in batches, so it takes a while to appear.`);
}));

// Show what the key holds as soon as one is pasted — cheaper than a failed move.
for (const [wifId, outId] of [['topUpWif', 'topUpOut'], ['moveWif', 'moveOut'], ['wdWif', 'wdOut']]) {
  let timer = null;
  $(wifId).addEventListener('input', () => {
    clearTimeout(timer);
    const wif = $(wifId).value.trim();
    if (!wif) { $(outId).replaceChildren(); return; }
    timer = setTimeout(async () => {
      try {
        const { address, balance } = await addressFromWif(wif);
        const enough = wifId !== 'wdWif' || balance >= MIN_WITHDRAW_CREDITS;
        say(outId, `${address} holds ${toDash(balance)} ${unit()}.${enough ? '' : ' Below the 0.004 withdrawal minimum.'}`, enough ? 'dn-sub' : 'note warn');
      } catch { $(outId).replaceChildren(); }
    }, 400);
  });
}
