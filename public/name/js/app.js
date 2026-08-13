// dash-name — check a .dash name and claim it for an existing identity.
// All looked-up data + keys stay client-side; the key is used only to sign.
import { checkName, registerName, topUpIdentity, DPNS_CONTRACT, SECRET_IN_ID_FIELD } from './name.js';
import { setNetwork, getNetwork } from './sdk.js';
import { looksLikeSecret } from '../../shared/secrets.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmtDate = (d) => d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
const checkCode = (label, contested) => `import { EvoSDK } from '@dashevo/evo-sdk';

const sdk = EvoSDK.${factory()}();
await sdk.connect();

// is it a usable name? is it a contested (premium) name?
const valid     = await sdk.dpns.isValidUsername('${label}');
const contested = await sdk.dpns.isContestedUsername('${label}');

// who owns it? (undefined when nobody has registered it yet)
const owner     = await sdk.dpns.resolveName('${label}');

// if it's unregistered, is it free to claim?
const available = await sdk.dpns.isNameAvailable('${label}');` + (contested ? `

// Careful: a contested name whose vote ended in a lock has no owner, so
// isNameAvailable() returns true while nobody can ever claim it. Ask the vote.
const norm  = await sdk.dpns.convertToHomographSafe('${label}');
const state = await sdk.voting.contestedResourceVoteState({
  dataContractId: '${DPNS_CONTRACT}',
  documentTypeName: 'domain',
  indexName: 'parentNameAndLabel',
  indexValues: ['dash', norm],
  resultType: 'documentsAndVoteTally',
  allowIncludeLockedAndAbstainingVoteTally: true,
});
const locked = state.winner?.kind === 'Locked';` : '');
const registerCode = (label) => `import { EvoSDK, IdentitySigner, PrivateKey } from '@dashevo/evo-sdk';

const sdk = EvoSDK.${factory()}();
await sdk.connect();

// Documents may be signed by an AUTHENTICATION key at CRITICAL, HIGH or MEDIUM
// level — a MASTER key cannot sign documents. Pick the one your WIF belongs to.
const identity = await sdk.identities.fetch(IDENTITY_ID);
const keys = await sdk.identities.getKeys({ identityId: IDENTITY_ID, request: { type: 'all' } });
const privateKeyBytes = PrivateKey.fromWIF(WIF).toBytes();
const identityKey = keys
  .filter((k) => k.purpose === 'AUTHENTICATION'
    && ['CRITICAL', 'HIGH', 'MEDIUM'].includes(k.securityLevel))
  .find((k) => k.validatePrivateKey(privateKeyBytes, '${getNetwork()}'));

// sign locally with your private key (WIF) — it never leaves your browser
const signer = new IdentitySigner();
signer.addKeyFromWif(WIF);

// The SDK's one-liner does preorder + domain but keeps the salt to itself, so a
// failure in between strands the preorder — and its fee, 0.2 DASH for a
// contested name. This tool derives the salt instead, which makes a second run
// finish the job against the preorder already paid for:
//
//   secret = HMAC(privateKey, 'evotools/dpns-salt/v1')
//   salt   = HMAC(secret, network + '/' + normalizedLabel + '/0')
//   hash   = doubleSHA256(salt ++ 'name.dash')
//   -> documents.create(preorder { saltedDomainHash: hash })
//   -> documents.create(domain   { label, normalizedLabel, preorderSalt: salt,
//                                  records: { identity: id.toBytes() }, … })
//
// See public/shared/dpns-register.js. The simple version, if you never expect to
// be interrupted:
await sdk.dpns.registerName({ label: '${label}', identity, identityKey, signer });`;

let debounce = null;
let token = 0;
let last = null;

// A pasted secret has to be caught in this field before anything else happens.
// A 52-character WIF is a *valid* DPNS label, so the live check would send it to
// a Platform node as a name lookup — lowercased, but a WIF carries its own
// checksum, so the casing can be recovered from it offline. This is the one field
// on the page where a slip actually leaves the browser.
const SECRET_IN_NAME_FIELD =
  'That looks like a private key or a recovery phrase, not a name. Nothing was sent and the field has been emptied — '
  + 'checking a name asks a Platform node, so this is the one field where a pasted key would leave your browser. '
  + 'Your key belongs in the key field of the claim panel, which never goes anywhere.';

function refuseSecret(input, message) {
  input.value = '';
  const s = $('status');
  s.className = 'dn-status bad';
  s.replaceChildren(el('span', null, message));
  $('claim').hidden = true;
  last = null;
  clearTimeout(debounce);
  token++; // cancel anything already in flight
}

// ── live check ───────────────────────────────────────────────────────────────
function check() {
  // Before the value is touched: lowercasing a WIF hides the capital X the
  // detector recognises it by.
  if (looksLikeSecret($('name').value)) { refuseSecret($('name'), SECRET_IN_NAME_FIELD); return; }
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
  } else if (r.locked) {
    s.className = 'dn-status bad';
    s.append(el('span', null, `${r.label}.dash is locked — masternodes voted the contest down, so nobody can claim it.`));
  } else if (r.available && r.contest?.pending) {
    // Claimed by somebody, but a contested name only resolves once the vote ends,
    // so "available" would be true and useless. Joining is still allowed.
    s.className = 'dn-status warn';
    const n = r.contest.contenders.length;
    s.append(el('span', null, `${r.label}.dash has an open contest: ${
      n === 1 ? 'one identity has claimed it' : `${n} identities are competing for it`}, and masternodes decide${
      r.contest.endsAt ? ` on ${fmtDate(r.contest.endsAt)}` : ' within two weeks'}. Registering now joins the contest.`));
    showClaim(r);
  } else if (r.available) {
    s.className = 'dn-status ok';
    s.append(el('span', null, `${r.label}.dash is available${r.contested ? " — but it's a contested (premium) name" : ''}.`));
    s.append(priceLine(r.contested));
    showClaim(r);
  } else {
    s.className = 'dn-status warn';
    s.append(el('span', null, `${r.label}.dash is not available.`));
  }
  if (r.contest && (r.contest.contenders?.length || r.contest.lock || r.contest.abstain)) s.append(contestPanel(r.contest));
  if (r.valid) s.append(snippet(checkCode(r.label, r.contested)));
}

// What a registration actually costs, measured on mainnet 2026-07-28 from three
// registrations by one identity (preorder + domain, in credits):
//   pizza2go  23,469,080 + 32,690,980 = 0.00056160 DASH
//   pizza247  23,520,440 + 40,285,160 = 0.00063806 DASH
//   pizza     35,098,140 + 80,423,140 = 0.00115521 DASH — contested, so its two
//             transitions cost more, and the preorder also carries the 0.2 DASH
//             voting balance (20,000,000,000 credits) that pays for the vote.
// The fee follows the size of the transition, so it moves a little per name.
const FEE_HINT = 'about 0.0006 DASH';
const CONTESTED_FEE_HINT = 'about 0.0012 DASH';

function priceLine(contested) {
  const unit = getNetwork() === 'mainnet' ? 'DASH' : 'tDASH';
  const text = contested
    ? `Costs 0.2 ${unit} for the vote plus ${CONTESTED_FEE_HINT.replace('DASH', unit)} in network fees, and takes two weeks.`
    : `Costs ${FEE_HINT.replace('DASH', unit)} in network fees, and is yours the moment it lands.`;
  return el('div', 'dn-price', text);
}

function contestPanel(c) {
  const locked = c.outcome === 'Locked';
  const d = el('div', 'dn-contest' + (locked ? ' locked' : ''));
  d.append(el('div', 'dn-contest-head', locked ? '⚖ Contested — locked by masternode vote' : '⚖ Contested — decided by masternode vote'));
  d.append(el('div', 'dn-sub', locked
    ? 'The lock votes beat every contender, which ends the contest with nobody as the owner. Registering it again is not possible.'
    : `Short/premium names go through a vote instead of first-come-first-served, and cost 0.2 DASH more (it prefunds the vote). Registering one joins the contest.${
      c.pending && c.endsAt ? ` This one is decided on ${fmtDate(c.endsAt)}.` : ''}`));
  for (const ct of c.contenders) {
    const row = el('div', 'dn-contender');
    if (!locked && c.winner && ct.identityId === c.winner) row.append(el('span', 'dn-badge', 'winner'));
    row.append(el('span', 'dn-cid mono', ct.identityId));
    row.append(el('span', 'dn-votes', `${ct.votes} vote${ct.votes === 1 ? '' : 's'}`));
    d.append(row);
  }
  const tally = el('div', 'dn-contender');
  if (locked) tally.append(el('span', 'dn-badge lock', 'locked'));
  tally.append(el('span', 'dn-cid', 'lock / abstain'));
  tally.append(el('span', 'dn-votes', `${c.lock} / ${c.abstain} votes`));
  d.append(tally);
  const all = el('a', 'dn-link', 'Every contest, open and decided →');
  all.href = `/contests/${getNetwork() === 'testnet' ? '?net=testnet' : ''}`;
  d.append(all);
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
    showSuccess(res.name, id, res.contestPending ? res.contest : null);
  } catch (e) {
    out.replaceChildren(el('div', 'error', `Registration failed: ${e?.message || e}`));
  } finally {
    $('claimBtn').disabled = false;
  }
}

function showSuccess(name, id, contest) {
  $('claim').hidden = true;
  token++; // cancel any in-flight check so it can't overwrite this
  const s = $('status');
  s.className = 'dn-status dn-success';
  s.replaceChildren();
  // A contested claim is on chain but not won: the name stays unresolvable until
  // the vote ends, and claiming it again is refused. Both are worth saying, or
  // the next check ("still not registered?") looks like a failure.
  s.append(el('div', 'dn-success-title', contest ? `✅ ${name} is claimed — now it goes to a vote` : `🎉 ${name} is yours!`));
  s.append(el('div', 'dn-sub', contest
    ? `Your claim is on chain on ${getNetwork()}. Masternodes vote until ${
      contest.endsAt ? fmtDate(contest.endsAt) : 'two weeks from now'}${
      contest.endsAtExact === false ? ' (about)' : ''}, and ${
      contest.contenders > 1 ? `${contest.contenders} identities are competing` : 'you are the only contender'}. Until then the name does not resolve, and registering it again is not needed.`
    : `Registered on ${getNetwork()} — it now resolves to your identity.`));
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

// The ID field sits one field above the key field, so the key lands in it sooner
// or later. Nothing goes out over the wire when it does — the SDK rejects the
// length locally — but a key sitting in a visible text input is the part that
// costs something: it stays on screen, in the DOM and in any screenshot. So the
// field empties itself and says which box the key belongs in.
function guardIdField() {
  const input = $('idInput');
  const warn = $('idWarn');
  if (!looksLikeSecret(input.value)) { warn.replaceChildren(); return; }
  input.value = '';
  warn.replaceChildren(el('div', 'error', SECRET_IN_ID_FIELD));
}

// ── wiring ───────────────────────────────────────────────────────────────────
$('name').addEventListener('input', check);
$('idInput').addEventListener('input', guardIdField);
$('claimBtn').addEventListener('click', claim);
$('netsel').addEventListener('change', () => {
  setNetwork($('netsel').value);
  $('claim').hidden = true;
  check();
});

// Topping up the identity you are claiming for — an identity out of credits is
// otherwise a dead end halfway through a list of names.
$('topUpBtn').addEventListener('click', async () => {
  const out = $('topUpOut');
  out.replaceChildren();
  const identityId = $('idInput').value.trim();
  const addressWif = $('topUpWif').value.trim();
  const raw = $('topUpAmount').value.trim();
  const btn = $('topUpBtn');
  const say = (text, cls) => { out.replaceChildren(el('div', cls, text)); };
  if (!identityId) { say('Fill in the identity ID above first.', 'error'); return; }
  if (!addressWif) { say('Paste the key of the address holding the credits.', 'error'); return; }
  let amount;
  if (raw) {
    const dash = Number(raw);
    if (!Number.isFinite(dash) || dash <= 0) { say('Enter an amount in DASH, or leave it empty to move everything.', 'error'); return; }
    amount = BigInt(Math.round(dash * 1e11));
  }
  btn.disabled = true;
  btn.textContent = 'Moving…';
  try {
    const res = await topUpIdentity({ identityId, addressWif, amount });
    say(`Moved ${(Number(res.moved) / 1e11).toFixed(5)} from ${res.address}. The identity now holds ${res.newBalance ?? '—'} credits.`, 'note ok');
  } catch (e) {
    say(e?.message || String(e), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Top up this identity';
  }
});
