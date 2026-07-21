// evo-onboard — step orchestration and UI wiring.

import { generateWallet } from './wallet.js';
import {
  getAddressBalance, createIdentity, checkUsername, registerUsername,
} from './platform.js';

// ── constants (credits are bigint; 1 tDASH = 100,000,000,000 credits) ───────
const CREDITS_PER_DASH = 100_000_000_000n;
const MIN_FUND = 5_000_000_000n;    // 0.05 tDASH — enough to mint + name
const RECOMMENDED = 50_000_000_000n; // 0.5 tDASH — also covers a contract publish
const RESERVE = 100_000_000n;        // fee headroom left on the funding input
const BRIDGE = 'https://bridge.thepasta.org/';
const EXPLORER = 'https://testnet.platform-explorer.com';
const POLL_MS = 4000;

// ── state ───────────────────────────────────────────────────────────────────
const state = {
  mnemonic: null,
  address: null,
  addressPrivateKeyWif: null,
  balance: 0n,
  identityId: null,
  identityObj: null,
  derived: null,
  username: null,
};
let pollTimer = null;
let usernameToken = 0;

// ── tiny DOM helpers ─────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const creditsToDash = (c) => (Number(c) / Number(CREDITS_PER_DASH)).toFixed(4);

function showError(err) {
  const box = $('globalError');
  box.textContent = typeof err === 'string' ? err : (err?.message || String(err));
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  console.error(err);
}
function clearError() { $('globalError').hidden = true; }

const PANELS = ['intro', 'wallet', 'fund', 'identity', 'username', 'done'];
function showPanel(name, step) {
  for (const p of PANELS) $(`panel-${p}`).hidden = p !== name;
  if (step) setStep(step);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function setStep(n) {
  document.querySelectorAll('#stepper li').forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle('done', s < n);
    li.classList.toggle('active', s === n);
  });
}

async function copyToButton(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = old; }, 1500);
  } catch (e) { showError('Copy failed: ' + e.message); }
}

function withBusy(btn, label, fn) {
  return async (...args) => {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try { await fn(...args); }
    catch (e) { showError(e); }
    finally { btn.disabled = false; btn.textContent = old; }
  };
}

// ── Step 1: wallet ───────────────────────────────────────────────────────────
$('startBtn').addEventListener('click', withBusy($('startBtn'), 'Loading SDK…', async () => {
  clearError();
  const w = await generateWallet();
  Object.assign(state, w);
  $('mnemonicBox').textContent = state.mnemonic;
  $('addressBox1').textContent = state.address;
  $('addressBox2').textContent = state.address;
  showPanel('wallet', 1);
}));

$('savedMnemonic').addEventListener('change', (e) => {
  $('toFundBtn').disabled = !e.target.checked;
});
$('copyMnemonic').addEventListener('click', (e) => copyToButton(e.target, state.mnemonic));
$('copyAddress1').addEventListener('click', (e) => copyToButton(e.target, state.address));
$('copyAddress2').addEventListener('click', (e) => copyToButton(e.target, state.address));

$('toFundBtn').addEventListener('click', () => {
  $('bridgeBtn').href = `${BRIDGE}?address=${encodeURIComponent(state.address)}`;
  showPanel('fund', 2);
  startPolling();
});

// ── Step 2: fund ─────────────────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  poll();
  pollTimer = setInterval(poll, POLL_MS);
}
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

async function poll() {
  try {
    const balance = await getAddressBalance(state.address);
    state.balance = balance;
    renderBalance();
  } catch (e) {
    $('balanceValue').textContent = 'connection error';
    console.warn('poll failed', e);
  }
}
function renderBalance() {
  const { balance } = state;
  $('balanceValue').textContent = `${creditsToDash(balance)} tDASH`;
  const pct = Math.min(100, Number(balance * 100n / RECOMMENDED));
  $('balanceBar').style.width = `${pct}%`;
  const enough = balance >= MIN_FUND;
  $('toIdentityBtn').disabled = !enough;
  if (balance === 0n) {
    $('balanceHint').textContent = 'Waiting for credits… keep this tab open.';
  } else if (!enough) {
    $('balanceHint').textContent = `Received some credits. Need at least ${creditsToDash(MIN_FUND)} tDASH to continue.`;
  } else if (balance < RECOMMENDED) {
    $('balanceHint').textContent = `Enough to mint. For an identity that can also publish contracts, ${creditsToDash(RECOMMENDED)} tDASH is recommended.`;
  } else {
    $('balanceHint').textContent = 'Fully funded. You can create your identity.';
  }
}

$('toIdentityBtn').addEventListener('click', () => {
  stopPolling();
  showPanel('identity', 3);
  runCreateIdentity();
});

// ── Step 3: identity ─────────────────────────────────────────────────────────
async function runCreateIdentity() {
  $('identityProgress').hidden = false;
  $('identityResult').hidden = true;
  try {
    const amount = state.balance - RESERVE;
    if (amount <= 0n) throw new Error('Balance too low to fund an identity.');
    $('identityStatus').textContent = 'Building keys and broadcasting…';
    const res = await createIdentity({
      mnemonic: state.mnemonic,
      address: state.address,
      addressPrivateKeyWif: state.addressPrivateKeyWif,
      amount,
    });
    Object.assign(state, res);
    $('identityIdBox').textContent = state.identityId;
    $('explorerIdentity').href = `${EXPLORER}/identity/${state.identityId}`;
    $('identityProgress').hidden = true;
    $('identityResult').hidden = false;
  } catch (e) {
    $('identityProgress').hidden = true;
    showError(e);
  }
}
$('copyIdentityId').addEventListener('click', (e) => copyToButton(e.target, state.identityId));
$('toUsernameBtn').addEventListener('click', () => showPanel('username', 4));

// ── Step 4: username ─────────────────────────────────────────────────────────
const usernameInput = $('usernameInput');
usernameInput.addEventListener('input', () => {
  const label = usernameInput.value.trim().toLowerCase();
  usernameInput.value = label;
  scheduleUsernameCheck(label);
});

let usernameDebounce = null;
function scheduleUsernameCheck(label) {
  clearTimeout(usernameDebounce);
  const status = $('usernameStatus');
  $('registerBtn').disabled = true;
  if (label.length < 3) {
    status.className = 'username-status';
    status.textContent = label.length === 0 ? '' : 'At least 3 characters.';
    return;
  }
  status.className = 'username-status checking';
  status.textContent = 'Checking…';
  const token = ++usernameToken;
  usernameDebounce = setTimeout(async () => {
    try {
      const { valid, contested, available } = await checkUsername(label);
      if (token !== usernameToken) return; // stale
      if (!valid) {
        status.className = 'username-status bad';
        status.textContent = 'Not a valid DPNS name (use a-z, 0-9, hyphens).';
      } else if (!available) {
        status.className = 'username-status bad';
        status.textContent = `${label}.dash is already taken.`;
      } else if (contested) {
        status.className = 'username-status warn';
        status.textContent = `${label}.dash is a premium/contested name — registering starts a masternode vote.`;
        $('registerBtn').disabled = false;
      } else {
        status.className = 'username-status ok';
        status.textContent = `${label}.dash is available.`;
        $('registerBtn').disabled = false;
      }
    } catch (e) {
      if (token !== usernameToken) return;
      status.className = 'username-status bad';
      status.textContent = 'Check failed: ' + e.message;
    }
  }, 450);
}

$('registerBtn').addEventListener('click', async () => {
  const label = usernameInput.value.trim().toLowerCase();
  clearError();
  $('usernameRegistering').hidden = false;
  $('registerBtn').disabled = true;
  $('skipUsernameBtn').disabled = true;
  try {
    await registerUsername({
      label,
      identityId: state.identityId,
      identityObj: state.identityObj,
      derived: state.derived,
    });
    state.username = `${label}.dash`;
    finish();
  } catch (e) {
    $('usernameRegistering').hidden = true;
    $('registerBtn').disabled = false;
    $('skipUsernameBtn').disabled = false;
    showError(e);
  }
});
$('skipUsernameBtn').addEventListener('click', () => { state.username = null; finish(); });

// ── Step 5: done / handoff ───────────────────────────────────────────────────
function envText() {
  const criticalWif = state.derived.find((d) => d.spec.keyId === 2)?.privateKeyWif ?? '';
  return [
    `EVO_MNEMONIC="${state.mnemonic}"`,
    `EVO_IDENTITY_ID=${state.identityId}`,
    `EVO_PRIVATE_WIF=${criticalWif}`,
  ].join('\n');
}

function finish() {
  const summary = $('doneSummary');
  const rows = [];
  if (state.username) rows.push(['Username', state.username]);
  rows.push(['Identity', state.identityId]);
  rows.push(['Explorer', 'testnet.platform-explorer.com']);
  summary.innerHTML = rows.map(([k, v]) => `<div class="item"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

  $('envBox').textContent = envText();

  $('allKeys').innerHTML = state.derived.map((d) => `
    <div class="key-card">
      <div class="key-name">Key #${d.spec.keyId} — ${d.spec.label}</div>
      <div class="key-wif">${d.privateKeyWif}</div>
    </div>`).join('');

  showPanel('done', 5);
}

$('copyEnv').addEventListener('click', (e) => copyToButton(e.target, envText()));
$('downloadEnv').addEventListener('click', () => {
  const blob = new Blob([envText() + '\n'], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '.env';
  a.click();
  URL.revokeObjectURL(a.href);
});
$('restartBtn').addEventListener('click', () => location.reload());
