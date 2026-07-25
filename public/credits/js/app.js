// credits — UI wiring. Keys are used only to sign, in this page, and are never
// stored or sent anywhere.
import {
  lookupIdentity, addressFromWif, topUpIdentity, sendFromIdentity,
  sendBetweenAddresses, withdrawToCore, MIN_WITHDRAW_CREDITS,
  fundingAddresses, convertDash, unfinishedConversions, finishConversion,
  MIN_LOCK_DUFFS, FEE_DUFFS,
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
// Always round DOWN. Showing 0.0041 for 0.00407 invites an amount larger than
// the balance, and the refusal that follows looks like a bug in the tool.
const floorTo = (value, decimals) => {
  const scale = 10 ** decimals;
  return (Math.floor(value * scale) / scale).toFixed(decimals);
};
const toDash = (credits) => floorTo(Number(credits) / Number(CREDITS_PER_DASH), 5);
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
  const cell = (k, v, big, cls) => {
    const c = el('div', `cr-cell${cls ? ` ${cls}` : ''}`);
    c.append(el('span', 'k', k));
    c.append(el('span', `v${big ? ' big' : ''}`, v));
    return c;
  };
  grid.append(cell('Balance', `${toDash(info.balance)} ${unit()}`, true));
  grid.append(cell('Identity', info.identityId));
  if (info.name) grid.append(cell('Name', info.name));
  grid.append(cell('Keys', info.keys.map((k) => `#${k.keyId}  ${k.purpose} · ${k.securityLevel}`).join('\n'), false, 'keys-cell'));
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

// ── turning DASH into credits ────────────────────────────────────────────────
const duffsToDash = (duffs) => floorTo(duffs / 1e8, 4);

let convertTimer = null;
$('convertWif').addEventListener('input', () => {
  clearTimeout(convertTimer);
  const wif = $('convertWif').value.trim();
  const host = $('convertAddresses');
  if (!wif) { host.replaceChildren(); return; }
  convertTimer = setTimeout(async () => {
    try {
      const info = await fundingAddresses(wif);
      const box = el('div', 'cr-summary');
      const cell = (k, v) => {
        const c = el('div', 'cr-cell');
        c.append(el('span', 'k', k));
        c.append(el('span', 'v', v));
        return c;
      };
      box.append(cell('Pay this address', `${info.core}\n${duffsToDash(info.duffs)} ${unit()} confirmed`));
      box.append(cell('Credits land here', `${info.platform}\n${toDash(info.credits)} ${unit()}`));
      host.replaceChildren(box);
      if (info.duffs > 0 && info.duffs < MIN_LOCK_DUFFS) {
        host.append(el('div', 'note warn', `An asset lock needs at least ${MIN_LOCK_DUFFS / 1e8} ${unit()}; send a little more to that address.`));
      }
      if (!$('convertAmount').value && info.duffs > MIN_LOCK_DUFFS + FEE_DUFFS) {
        $('convertAmount').value = duffsToDash(info.duffs - FEE_DUFFS);
      }
    } catch { host.replaceChildren(); }
  }, 400);
});

const CONVERT_STEPS = {
  build: 'Building the asset lock…',
  broadcast: 'Sending it to the Dash network…',
  mining: 'Waiting for a block. A couple of minutes.',
  chainlock: 'Waiting for the block to be chain-locked…',
  crediting: 'Handing the lock to Platform…',
  done: 'Converted.',
};

$('convertBtn').addEventListener('click', withBusy($('convertBtn'), 'Converting…', async () => {
  clearError();
  const out = $('convertOut');
  out.replaceChildren();
  const wif = $('convertWif').value.trim();
  if (!wif) throw new Error('Paste the funding key first.');
  const raw = $('convertAmount').value.trim();
  // Duffs are plain numbers here — credits are the bigint side of the house, and
  // mixing the two throws before anything reaches the chain.
  const lockDuffs = raw ? Math.round(Number(raw) * 1e8) : undefined;
  if (raw && (!Number.isFinite(lockDuffs) || lockDuffs <= 0)) throw new Error('Enter an amount in DASH, or leave it empty.');
  // Offering the recovery button mid-conversion invites racing the run in front
  // of you, over the very lock it is busy with.
  $('resumeWrap').hidden = true;
  try {
    let last = null;
    await convertDash({
      wif,
      lockDuffs,
      onProgress: ({ step }) => {
        if (step === last) return;
        last = step;
        out.append(el('div', 'dn-sub', CONVERT_STEPS[step] ?? step));
      },
    });
    out.append(el('div', 'note ok', 'Converted. The credits are on the platform address above.'));
    await refresh();
  } finally {
    $('resumeWrap').hidden = false;
  }
}));

$('resumeBtn').addEventListener('click', withBusy($('resumeBtn'), 'Looking…', async () => {
  clearError();
  const out = $('resumeOut');
  out.replaceChildren();
  const wif = $('convertWif').value.trim();
  if (!wif) throw new Error('Paste the funding key first.');
  const locks = await unfinishedConversions(wif);
  if (!locks.length) { out.append(el('div', 'dn-sub', 'Nothing waiting for this key.')); return; }
  out.append(el('div', 'dn-sub', `Found ${locks.length} conversion${locks.length === 1 ? '' : 's'} on the chain.`));
  for (const lock of locks) {
    const label = `${duffsToDash(lock.duffs)} ${unit()}`;
    try {
      const res = await finishConversion({ wif, lock });
      if (res.state === 'credited') out.append(el('div', 'note ok', `${label} recovered.`));
      else if (res.state === 'already-done') out.append(el('div', 'dn-sub', `${label}: already credited earlier.`));
      else out.append(el('div', 'dn-sub', `${label}: not mined yet, try again shortly.`));
    } catch (e) {
      out.append(el('div', 'error', `${label}: ${e?.message || e}`));
    }
  }
}));
