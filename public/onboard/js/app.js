// evo-onboard — step orchestration and UI wiring.

import {
  generateWallet, generateIdentityMnemonic, platformAddressFromWif, isValidMnemonic,
  deriveFundingAddress,
} from './wallet.js';
import {
  getAddressBalance, createIdentity, checkUsername, registerUsername,
  fundAddressFromIdentity,
} from './platform.js';
import { setNetwork, getNetwork, isMainnet, getSdk, loadEvo } from './sdk.js';
import {
  loadDashcore, fetchUtxos, spendable, totalDuffs, convertToCredits,
  findAssetLocks, resumeAssetLock, MIN_LOCK_DUFFS, FEE_DUFFS,
} from '../../shared/assetlock.js';

// ── constants (credits are bigint; 1 DASH = 100,000,000,000 credits) ────────
const CREDITS_PER_DASH = 100_000_000_000n;
// The identity creation fee is ~236,900,000 credits (~0.0024 DASH). Keep back
// well more than that so the funding input always covers the fee; the identity
// is funded with (balance - RESERVE).
const RESERVE = 1_000_000_000n;      // 0.01 DASH kept back for the creation fee
const NET = {
  testnet: {
    unit: 'tDASH',
    minFund: 5_000_000_000n,    // 0.05 tDASH — enough to mint + name
    recommended: 50_000_000_000n, // 0.5 tDASH — also covers a contract publish
    explorer: 'https://testnet.platform-explorer.com',
  },
  mainnet: {
    unit: 'DASH',
    minFund: 2_000_000_000n,     // 0.02 DASH — mint plus a little headroom
    // 0.25 DASH also covers a contested name (0.2) and its fees.
    recommended: 25_000_000_000n,
    explorer: 'https://platform-explorer.com',
  },
};
const cfg = () => NET[getNetwork()];
const BRIDGE = 'https://bridge.thepasta.org/';
const POLL_MS = 4000;

// ── state ───────────────────────────────────────────────────────────────────
const state = {
  mnemonic: null,
  ownPhrase: false, // true once the user supplied a phrase made elsewhere
  address: null,
  coreAddress: null,
  addressPrivateKeyWif: null,
  generated: null, // the wallet onboard made itself, on testnet
  sameKey: null,   // does the phrase on screen also control the funding key?
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

// ── Step 0: network ──────────────────────────────────────────────────────────
// Switching only matters before the flow starts; after that the wizard carries
// per-network state (address, keys, balances), so the selector is intro-only.
$('netsel').addEventListener('change', () => {
  setNetwork($('netsel').value);
  const main = isMainnet();
  $('testnetNote').hidden = main;
  $('mainnetNote').hidden = !main;
  // On mainnet the risk is the user's, so make them say so before starting.
  $('mainnetAckWrap').hidden = !main;
  $('mainnetAck').checked = false;
  $('startBtn').disabled = main;
  $('introStep1').textContent = main
    ? 'Bring a funding key you already control (WIF)'
    : 'Generate a testnet wallet (offline, in your browser)';
  $('introStep2').textContent = main
    ? 'Move credits onto its platform address'
    : 'Fund its address via the Dash Bridge';
});

$('mainnetAck').addEventListener('change', (e) => {
  $('startBtn').disabled = isMainnet() && !e.target.checked;
});

// ── Step 1: wallet ───────────────────────────────────────────────────────────
$('startBtn').addEventListener('click', withBusy($('startBtn'), 'Loading SDK…', async () => {
  if (isMainnet() && !$('mainnetAck').checked) throw new Error('Confirm that you understand the risk first.');
  clearError();
  const main = isMainnet();
  if (main) {
    // Nothing that holds money is generated here — only the keys of the identity
    // that is about to be created. The funding key comes from the user.
    state.mnemonic = await generateIdentityMnemonic();
    state.address = null;
    state.addressPrivateKeyWif = null;
    $('addressBox1').textContent = 'paste your funding key above';
  } else {
    Object.assign(state, await generateWallet());
    Object.assign(state, await platformAddressFromWif(state.addressPrivateKeyWif));
    // Keep it aside: emptying the WIF field below falls back to this one.
    state.generated = {
      address: state.address, coreAddress: state.coreAddress, addressPrivateKeyWif: state.addressPrivateKeyWif,
    };
    $('addressBox1').textContent = state.address;
    $('addressBox2').textContent = state.address;
  }
  $('mnemonicBox').textContent = state.mnemonic;
  $('ownPhraseBlock').hidden = !main;
  // Keys made elsewhere are worth using on either network — keygen makes both.
  $('fundingWifLabel').textContent = main
    ? 'Funding key (WIF) — a key you already control'
    : 'Funding key (WIF) — optional, to use your own instead of the generated one';
  $('byoKeyHint').textContent = main
    ? 'Used only in this page: to derive the address and to sign the funding input. Any credits left over stay on that address, under your key.'
    : 'Onboard already made one for you. Paste a key from keygen to use that instead; empty the field to go back.';
  $('ownPhraseOut').replaceChildren();
  updateContinue();
  updatePhraseScope();
  showPanel('wallet', 1);
}));

// Does the phrase on screen also control the money? Derive the funding address
// the phrase would produce and compare it with the one actually in use. This
// never shows the phrase or the key — it only says how many things to keep.
async function updatePhraseScope() {
  const line = $('phraseScope');
  if (!state.mnemonic || !state.address) {
    line.hidden = true;
    // Nothing to compare against yet — say what the user still has to supply.
    $('walletIntro').textContent = 'The phrase below holds the keys of the identity you are about to create. Save it now — it is shown only here, and without it the identity is unrecoverable.';
    $('walletTitle').textContent = 'Your funding key and identity keys';
    $('mnemonicLabel').textContent = 'Identity recovery phrase (mnemonic)';
    $('savedMnemonicText').textContent = "I've saved the identity phrase somewhere safe.";
    return;
  }
  let sameKey = false;
  try {
    const fromPhrase = await deriveFundingAddress(state.mnemonic);
    sameKey = fromPhrase.address === state.address;
  } catch { sameKey = false; }
  state.sameKey = sameKey;

  // Every line about the phrase follows the same answer, so the page cannot
  // claim "this controls everything" while the funding key sits elsewhere.
  line.textContent = sameKey
    ? 'One phrase covers everything here: the identity keys and the funding key are both derived from it.'
    : 'Two things to keep: this phrase holds the identity keys only, and the funding key you supplied is separate. Losing either one loses that half.';
  line.hidden = false;
  $('walletIntro').textContent = sameKey
    ? 'This phrase controls everything below — the identity keys and the funding key alike. Save it now, it is shown only here.'
    : 'The phrase below holds the identity keys. The funding key you supplied is not part of it and stays yours.';
  $('walletTitle').textContent = sameKey
    ? (isMainnet() ? 'Your wallet' : 'Your testnet wallet')
    : 'Your funding key and identity keys';
  $('mnemonicLabel').textContent = sameKey ? 'Recovery phrase (mnemonic)' : 'Identity recovery phrase (mnemonic)';
  $('savedMnemonicText').textContent = sameKey
    ? "I've saved my recovery phrase somewhere safe."
    : "I've saved the identity phrase, and I still have the funding key.";
  updateContinue();
}

// Continue is allowed once the phrase is confirmed and — on mainnet — a funding
// address has actually been derived from the pasted key. A disabled button with
// no explanation is a dead end, so say which of the two is missing.
function updateContinue() {
  const noAddress = !state.address;
  const noTick = !$('savedMnemonic').checked;
  $('toFundBtn').disabled = noAddress || noTick;
  const hint = $('continueHint');
  hint.textContent = noAddress
    ? 'Paste the funding key above — its platform address has to be derived first.'
    : noTick
      ? (state.sameKey === false
        ? 'Confirm that you saved the identity phrase.'
        : 'Confirm that you saved the recovery phrase.')
      : '';
  hint.hidden = !hint.textContent;
}
$('savedMnemonic').addEventListener('change', updateContinue);

// Derive while typing so the address appears on its own; the button below stays
// as the explicit way to do it.
let wifDebounce = null;
$('fundingWif').addEventListener('input', () => {
  clearTimeout(wifDebounce);
  const wif = $('fundingWif').value.trim();
  if (!wif) {
    Object.assign(state, state.generated ?? { address: null, coreAddress: null, addressPrivateKeyWif: null });
    $('addressBox1').textContent = state.address ?? 'paste your funding key above';
    $('addressBox2').textContent = state.address ?? '…';
    updateContinue();
    updatePhraseScope();
    return;
  }
  state.address = null;
  state.addressPrivateKeyWif = null;
  $('addressBox1').textContent = 'checking…';
  updateContinue();
  wifDebounce = setTimeout(async () => {
    try {
      Object.assign(state, await platformAddressFromWif(wif));
      $('addressBox1').textContent = state.address;
      $('addressBox2').textContent = state.address;
      clearError();
    } catch {
      $('addressBox1').textContent = 'not a usable key yet — check the WIF';
    }
    updateContinue();
    updatePhraseScope();
  }, 400);
});

// Keys made offline should win over the ones this tab just made, so let the
// user swap in their own phrase before anything is broadcast.
$('useOwnPhraseBtn').addEventListener('click', withBusy($('useOwnPhraseBtn'), 'Checking…', async () => {
  clearError();
  const phrase = $('ownPhrase').value.trim().replace(/\s+/g, ' ');
  if (!phrase) throw new Error('Paste your recovery phrase first.');
  if (!(await isValidMnemonic(phrase))) {
    throw new Error('That phrase is not a valid mnemonic — check for typos or a missing word.');
  }
  state.mnemonic = phrase;
  state.ownPhrase = true;
  $('mnemonicBox').textContent = phrase;
  $('ownPhrase').value = '';
  updatePhraseScope();
  const ok = document.createElement('div');
  ok.className = 'note ok';
  ok.textContent = 'Using your phrase. The identity will carry the five keys derived from it.';
  $('ownPhraseOut').replaceChildren(ok);
}));

$('deriveAddrBtn').addEventListener('click', withBusy($('deriveAddrBtn'), 'Deriving…', async () => {
  clearError();
  const wif = $('fundingWif').value.trim();
  if (!wif) throw new Error('Paste the WIF of the key you want to fund from.');
  const derived = await platformAddressFromWif(wif);
  Object.assign(state, derived);
  $('addressBox1').textContent = state.address;
  $('addressBox2').textContent = state.address;
  updateContinue();
  updatePhraseScope();
}));
$('copyMnemonic').addEventListener('click', (e) => copyToButton(e.target, state.mnemonic));
$('copyAddress1').addEventListener('click', (e) => copyToButton(e.target, state.address));
$('copyAddress2').addEventListener('click', (e) => copyToButton(e.target, state.address));

$('toFundBtn').addEventListener('click', () => {
  const main = isMainnet();
  $('bridgeBtn').hidden = main;
  $('mainnetFundBlock').hidden = !main;
  $('coreAddressBox').textContent = state.coreAddress ?? '—';

  // Mainnet has no faucet, so converting your own DASH is the whole story there
  // and leads. On testnet the Bridge is one click, but the same conversion sits
  // right below it: rehearsing it while the coins are free is what testnet is for.
  const convert = $('convertBlock');
  if (main) {
    $('fundIntro').textContent = "No faucet exists on mainnet. Send DASH to this key's own Dash address and convert it here, or move credits from an identity you already own.";
    convert.parentNode.insertBefore(convert, $('bridgeBtn'));
  } else {
    $('fundIntro').textContent = 'The Dash Bridge hands out testnet credits in one click. Below it is the same conversion mainnet uses — worth walking through once while the coins are free.';
    $('bridgeBtn').href = `${BRIDGE}?address=${encodeURIComponent(state.address)}`;
  }
  convert.open = true;
  showPanel('fund', 2);
  startPolling();
});

// ── funding route: convert plain DASH from the key's own layer-1 address ─────
let coreUtxos = [];
async function pollCoreBalance() {
  if (!state.coreAddress) return;
  try {
    coreUtxos = spendable(await fetchUtxos(state.coreAddress, getNetwork()));
    const duffs = totalDuffs(coreUtxos);
    const { unit } = cfg();
    // Round DOWN everywhere: showing 0.9900 for 0.98998 duffs would prefill an
    // amount larger than the address holds, and the build would refuse it.
    const floor4 = (d) => (Math.floor(d / 1e4) / 1e4).toFixed(4);
    $('coreBalance').textContent = `${floor4(duffs)} ${unit}`;
    const enough = duffs >= MIN_LOCK_DUFFS + FEE_DUFFS;
    $('convertBtn').disabled = !enough;
    $('coreHint').textContent = enough
      ? `Ready to convert. Leave a little behind: ${FEE_DUFFS} duffs pay the layer-1 fee.`
      : duffs > 0
        ? `Below the ${MIN_LOCK_DUFFS / 1e8} ${unit} minimum for an asset lock.`
        : 'Waiting for a payment. InstantSend counts, so this usually takes seconds.';
    if (enough && !$('lockAmount').value) {
      $('lockAmount').value = floor4(duffs - FEE_DUFFS);
    }
  } catch {
    $('coreBalance').textContent = 'connection error';
  }
}

$('convertBtn').addEventListener('click', withBusy($('convertBtn'), 'Converting…', async () => {
  clearError();
  const out = $('convertOut');
  const say = (text, cls = 'dn-sub') => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    out.append(d);
  };
  out.replaceChildren();
  const dash = Number($('lockAmount').value.trim());
  if (!Number.isFinite(dash) || dash <= 0) throw new Error('Enter an amount in DASH, e.g. 0.05');
  const lockDuffs = Math.round(dash * 1e8);
  const [dc, sdk, Evo] = await Promise.all([loadDashcore(), getSdk(), loadEvo()]);
  const steps = {
    build: 'Building the asset lock…',
    broadcast: 'Sending it to the Dash network…',
    mining: 'Waiting for a block. This takes a couple of minutes.',
    chainlock: 'Waiting for the block to be chain-locked…',
    crediting: 'Handing the lock to Platform…',
    done: 'Converted. The credits are on your platform address.',
  };
  let last = null;
  await convertToCredits({
    sdk, Evo, dc,
    wif: state.addressPrivateKeyWif,
    utxos: coreUtxos,
    lockDuffs,
    network: getNetwork(),
    platformAddress: state.address,
    onProgress: ({ step }) => { if (step !== last) { last = step; say(steps[step] ?? step); } },
  });
  say('Converted.', 'note ok');
  poll();
}));

// Pick up a conversion that was interrupted. Everything needed is on the chain
// already, so this asks the chain rather than remembering anything.
$('resumeBtn').addEventListener('click', withBusy($('resumeBtn'), 'Looking…', async () => {
  clearError();
  const out = $('resumeOut');
  out.replaceChildren();
  const say = (text, cls = 'dn-sub') => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    out.append(d);
  };
  const [dc, sdk, Evo] = await Promise.all([loadDashcore(), getSdk(), loadEvo()]);
  const locks = await findAssetLocks({ dc, address: state.coreAddress, network: getNetwork() });
  if (!locks.length) { say('No conversions found for this key — nothing is waiting.'); return; }
  say(`Found ${locks.length} conversion${locks.length === 1 ? '' : 's'} on the chain. Checking which still need finishing…`);
  let credited = 0;
  for (const lock of locks) {
    const dash = (lock.duffs / 1e8).toFixed(4);
    try {
      const res = await resumeAssetLock({
        sdk, Evo, wif: state.addressPrivateKeyWif, lock, platformAddress: state.address,
        onProgress: ({ step, at }) => {
          if (step === 'chainlock' && at) say(`${dash} ${cfg().unit}: waiting for the block to be chain-locked…`);
        },
      });
      if (res.state === 'credited') { credited++; say(`${dash} ${cfg().unit} recovered.`, 'note ok'); }
      else if (res.state === 'already-done') say(`${dash} ${cfg().unit}: already credited earlier.`);
      else say(`${dash} ${cfg().unit}: not mined yet, try again in a few minutes.`);
    } catch (e) {
      say(`${dash} ${cfg().unit}: ${e?.message || e}`, 'error');
    }
  }
  if (credited) poll();
}));

// Mainnet funding: move credits from an identity you already own onto the
// address, signed with that identity's TRANSFER key.
$('fundFromIdentityBtn').addEventListener('click', withBusy($('fundFromIdentityBtn'), 'Sending…', async () => {
  clearError();
  const out = $('fundOut');
  out.replaceChildren();
  const identityId = $('srcIdentity').value.trim();
  const transferWif = $('srcTransferWif').value.trim();
  const dash = Number($('srcAmount').value.trim());
  if (!identityId || !transferWif) throw new Error('Enter the identity ID and its TRANSFER key.');
  if (!Number.isFinite(dash) || dash <= 0) throw new Error('Enter an amount in DASH, e.g. 0.25');
  const amount = BigInt(Math.round(dash * Number(CREDITS_PER_DASH)));
  await fundAddressFromIdentity({ identityId, transferWif, address: state.address, amount });
  const ok = document.createElement('div');
  ok.className = 'note ok';
  ok.textContent = `Sent ${dash} DASH worth of credits. The balance below updates within a few seconds.`;
  out.append(ok);
  poll();
}));

// ── Step 2: fund ─────────────────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  poll();
  pollTimer = setInterval(poll, POLL_MS);
}
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

async function poll() {
  pollCoreBalance();
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
  const { unit, minFund, recommended } = cfg();
  $('balanceValue').textContent = `${creditsToDash(balance)} ${unit}`;
  const pct = Math.min(100, Number(balance * 100n / recommended));
  $('balanceBar').style.width = `${pct}%`;
  const enough = balance >= minFund;
  $('toIdentityBtn').disabled = !enough;
  if (balance === 0n) {
    $('balanceHint').textContent = 'Waiting for credits… keep this tab open.';
  } else if (!enough) {
    $('balanceHint').textContent = `Received some credits. Need at least ${creditsToDash(minFund)} ${unit} to continue.`;
  } else if (balance < recommended) {
    $('balanceHint').textContent = isMainnet()
      ? `Enough to mint. For a contested name (0.2 DASH) plus fees, ${creditsToDash(recommended)} ${unit} is recommended.`
      : `Enough to mint. For an identity that can also publish contracts, ${creditsToDash(recommended)} ${unit} is recommended.`;
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
    $('explorerIdentity').href = `${cfg().explorer}/identity/${state.identityId}`;
    $('identityProgress').hidden = true;
    $('identityResult').hidden = false;
  } catch (e) {
    $('identityProgress').hidden = true;
    showError(e);
    // Most failures here are "not enough credits" — drop back to funding so the
    // user can top up via the Bridge and try again with the same wallet.
    showPanel('fund', 2);
    startPolling();
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
        status.textContent = isMainnet()
          ? `${label}.dash is a contested name — it costs 0.2 DASH extra and goes to a 2-week masternode vote.`
          : `${label}.dash is a premium/contested name — registering starts a masternode vote.`;
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
  rows.push(['Network', getNetwork()]);
  rows.push(['Explorer', cfg().explorer.replace('https://', '')]);
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
