// dash-name — check a .dash name and claim it for an existing identity.
// All looked-up data + keys stay client-side; the key is used only to sign.
import { checkName, registerName } from './name.js';
import { setNetwork, getNetwork } from './sdk.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const explorerLink = (label, id) => {
  const a = el('a', 'dn-link', label);
  a.href = `/explorer/?kind=identity&q=${id}${getNetwork() === 'mainnet' ? '&net=mainnet' : ''}`;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
};

// ── SDK snippet dropdown ─────────────────────────────────────────────────────
// Mirrors the explorer: a collapsible showing the exact evo-sdk calls behind the
// UI, so it doubles as a copy-paste starting point. Reflects the current network.
const factory = () => `${getNetwork()}Trusted`;
function copyBtn(text) {
  const b = el('button', 'btn ghost sm dn-copy', 'Copy');
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copied ✓'; }
    catch { b.textContent = 'Copy failed'; }
    setTimeout(() => { b.textContent = 'Copy'; }, 1200);
  });
  return b;
}
function snippet(code) {
  const d = el('details', 'dn-snippet');
  d.append(el('summary', null, 'SDK snippet — what runs behind the scenes'));
  const body = el('div', 'dn-snippet-body');
  body.append(el('pre', 'mono', code));
  body.append(copyBtn(code));
  d.append(body);
  return d;
}
const checkCode = (label) => `import { EvoSDK } from '@dashevo/evo-sdk';

const sdk = EvoSDK.${factory()}();
await sdk.connect();

// is it a usable name? is it a contested (premium) name?
const valid     = await sdk.dpns.isValidUsername('${label}');
const contested = await sdk.dpns.isContestedUsername('${label}');

// who owns it? (undefined when nobody has registered it yet)
const owner     = await sdk.dpns.resolveName('${label}');

// if it's unregistered, is it free to claim?
const available = await sdk.dpns.isNameAvailable('${label}');`;
const registerCode = (label) => `import { EvoSDK, IdentitySigner } from '@dashevo/evo-sdk';

const sdk = EvoSDK.${factory()}();
await sdk.connect();

// your identity + its CRITICAL authentication key
const identity = await sdk.identities.fetch(IDENTITY_ID);
const keys = await sdk.identities.getKeys({ identityId: IDENTITY_ID, request: { type: 'all' } });
const identityKey = keys.find(
  (k) => k.purpose === 'AUTHENTICATION' && k.securityLevel === 'CRITICAL',
);

// sign locally with your private key (WIF) — it never leaves your browser
const signer = new IdentitySigner();
signer.addKeyFromWif(WIF);

// preorder + register the name (this is the on-chain write)
await sdk.dpns.registerName({ label: '${label}', identity, identityKey, signer });`;

let debounce = null;
let token = 0;
let last = null;

// ── live check ───────────────────────────────────────────────────────────────
function check() {
  const label = $('name').value.trim().toLowerCase();
  $('name').value = label;
  clearTimeout(debounce);
  const s = $('status');
  $('claim').hidden = true;
  last = null;
  if (!label) { s.className = 'dn-status'; s.replaceChildren(); return; }
  if (label.length < 3) { s.className = 'dn-status muted'; s.replaceChildren(el('span', null, 'At least 3 characters.')); return; }
  s.className = 'dn-status muted';
  s.replaceChildren(el('span', null, 'Checking…'));
  const my = ++token;
  debounce = setTimeout(async () => {
    try {
      const r = await checkName(label);
      if (my !== token) return;
      last = r;
      renderStatus(r);
    } catch (e) {
      if (my !== token) return;
      s.className = 'dn-status bad';
      s.replaceChildren(el('span', null, `Check failed: ${e?.message || e}`));
    }
  }, 400);
}

function renderStatus(r) {
  const s = $('status');
  s.replaceChildren();
  if (!r.valid) {
    s.className = 'dn-status bad';
    s.append(el('span', null, `${r.label}.dash is not a valid name (a–z, 0–9 and hyphens, 3–63 chars).`));
    return;
  }
  if (r.registered) {
    s.className = 'dn-status bad';
    s.append(el('span', null, `${r.label}.dash is taken. `));
    s.append(explorerLink('View owner ↗', r.ownerId));
  } else if (r.available) {
    s.className = 'dn-status ok';
    s.append(el('span', null, `${r.label}.dash is available${r.contested ? " — but it's a contested (premium) name" : ''}.`));
    showClaim(r);
  } else {
    s.className = 'dn-status warn';
    s.append(el('span', null, `${r.label}.dash is not available.`));
  }
  if (r.contest && r.contest.contenders?.length) s.append(contestPanel(r.contest));
  if (r.valid) s.append(snippet(checkCode(r.label)));
}

function contestPanel(c) {
  const d = el('div', 'dn-contest');
  d.append(el('div', 'dn-contest-head', '⚖ Contested — decided by masternode vote'));
  d.append(el('div', 'dn-sub', 'Short/premium names go through a vote instead of first-come-first-served, and cost ~1 DASH more. Registering one joins the contest.'));
  for (const ct of c.contenders) {
    const row = el('div', 'dn-contender');
    if (c.winner && ct.identityId === c.winner) row.append(el('span', 'dn-badge', 'winner'));
    row.append(el('span', 'dn-cid mono', ct.identityId));
    row.append(el('span', 'dn-votes', `${ct.votes} vote${ct.votes === 1 ? '' : 's'}`));
    d.append(row);
  }
  return d;
}

// ── claim ────────────────────────────────────────────────────────────────────
function showClaim(r) {
  $('claim').hidden = false;
  $('claimTitle').textContent = `Claim ${r.label}.dash`;
  $('claimBtn').textContent = `Register ${r.label}.dash`;
  const hint = $('claimHint');
  hint.replaceChildren();
  if (getNetwork() === 'testnet') {
    hint.append(document.createTextNode('Need an identity? Get one (with these exact values in a '));
    const code = el('code', null, '.env'); hint.append(code);
    hint.append(document.createTextNode(') at '));
    const a = el('a', null, 'Onboard'); a.href = '/onboard/'; hint.append(a);
    hint.append(document.createTextNode('. Your key is used only here to sign — it never leaves this page.'));
  } else {
    hint.append(el('span', 'dn-warn', 'Mainnet: this signs with your real identity key and costs real DASH. Your key is used only in your browser to sign the registration — it never leaves this page.'));
  }
  $('claimOut').replaceChildren();
  $('claimSnippet').replaceChildren(snippet(registerCode(r.label)));
}

async function claim() {
  const r = last;
  if (!r || !r.available) return;
  const id = $('idInput').value.trim();
  const wif = $('wifInput').value.trim();
  const out = $('claimOut');
  if (!id || !wif) { out.replaceChildren(el('div', 'error', 'Enter your identity ID and private key.')); return; }
  $('claimBtn').disabled = true;
  out.replaceChildren(el('div', 'dn-sub', 'Registering (preorder + domain)…'));
  try {
    const res = await registerName(r.label, id, wif);
    showSuccess(res.name, id);
  } catch (e) {
    out.replaceChildren(el('div', 'error', `Registration failed: ${e?.message || e}`));
  } finally {
    $('claimBtn').disabled = false;
  }
}

function showSuccess(name, id) {
  $('claim').hidden = true;
  token++; // cancel any in-flight check so it can't overwrite this
  const s = $('status');
  s.className = 'dn-status dn-success';
  s.replaceChildren();
  s.append(el('div', 'dn-success-title', `🎉 ${name} is yours!`));
  s.append(el('div', 'dn-sub', `Registered on ${getNetwork()} — it now resolves to your identity.`));
  const actions = el('div', 'dn-success-actions');
  actions.append(explorerLink('View it on the explorer ↗', id));
  const again = el('button', 'btn ghost sm', 'Register another');
  again.addEventListener('click', () => {
    s.replaceChildren();
    s.className = 'dn-status';
    $('name').value = '';
    $('name').focus();
  });
  actions.append(again);
  s.append(actions);
}

// ── wiring ───────────────────────────────────────────────────────────────────
$('name').addEventListener('input', check);
$('claimBtn').addEventListener('click', claim);
$('netsel').addEventListener('change', () => {
  setNetwork($('netsel').value);
  $('claim').hidden = true;
  check();
});
