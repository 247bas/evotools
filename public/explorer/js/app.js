// evo-explorer — look up identities, DPNS names, contracts and documents on
// testnet, with proofs, richer queries and network info. All external/looked-up
// data is rendered via textContent (never innerHTML) so document contents can't
// inject markup.

import {
  lookupIdentity, lookupName, lookupContract, queryDocuments,
  countDocuments, networkInfo, lookupToken, creditsToDash,
} from './explorer.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const jsonPretty = (o) => JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? `${v}` : v), 2);
const EXPLORER = 'https://testnet.platform-explorer.com';
const KINDS = ['identity', 'name', 'contract', 'token'];
const PLACEHOLDER = {
  identity: 'Identity ID (base58, e.g. 3pdTAJ…)',
  name: 'DPNS name (e.g. alice or alice.dash)',
  contract: 'Data contract ID (base58)',
  token: 'Token ID (base58)',
};
let networkShown = false;

// ── building blocks ──────────────────────────────────────────────────────────
function copyBtn(text, label = 'Copy') {
  const b = el('button', 'btn ghost sm', label);
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; setTimeout(() => (b.textContent = label), 1200); } catch { /* ignore */ }
  });
  return b;
}
function field(label, value) {
  const f = el('div', 'ex-field');
  f.append(el('div', 'ex-label', label));
  const row = el('div', 'ex-value-row');
  row.append(el('div', 'ex-value mono', value));
  row.append(copyBtn(value));
  f.append(row);
  return f;
}
function stats(pairs) {
  const s = el('div', 'ex-stats');
  for (const [k, v] of pairs) {
    const item = el('div', 'ex-stat');
    item.append(el('div', 'ex-stat-k', k));
    item.append(el('div', 'ex-stat-v', v));
    s.append(item);
  }
  return s;
}
function rawBlock(obj, label = 'Raw JSON') {
  const d = el('details', 'ex-raw');
  d.append(el('summary', null, label));
  d.append(el('pre', 'box mono', jsonPretty(obj)));
  return d;
}
function snippet(code) {
  const d = el('details', 'ex-raw');
  d.append(el('summary', null, 'SDK snippet'));
  const wrap = el('div');
  wrap.append(el('pre', 'box mono', code));
  wrap.append(copyBtn(code));
  d.append(wrap);
  return d;
}
function extLink(path, label) {
  const a = el('a', 'ex-extlink', `${label} ↗`);
  a.href = `${EXPLORER}${path}`;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}
function proofPanel(p) {
  if (!p) return null;
  const d = el('div', 'ex-proof-panel');
  d.append(el('div', 'ex-proof-head', '✓ Verified against a quorum-signed state root'));
  d.append(stats([
    ['Block height', String(p.height)],
    ['Epoch', String(p.epoch)],
    ['Time (UTC)', new Date(Number(p.timeMs)).toISOString().replace('T', ' ').slice(0, 19)],
    ['Protocol', `v${p.protocolVersion}`],
  ]));
  d.append(el('div', 'ex-proof-sub', `Quorum type ${p.quorumType}, round ${p.round}, ${p.signatureBytes}-byte BLS signature · quorum ${p.quorumHash.slice(0, 16)}…`));
  return d;
}
function cardHeader(card) {
  const h = el('div', 'ex-card-top');
  h.append(copyBtn(location.href, 'Copy link'));
  card.prepend(h);
}

// ── renderers ────────────────────────────────────────────────────────────────
function renderIdentity(data) {
  const card = el('div', 'ex-card panel');
  card.append(el('h2', null, data.name || 'Identity'));
  card.append(field('Identity ID', data.id));
  card.append(stats([
    ['Balance', `${creditsToDash(data.balance)} tDASH`],
    ['Revision', String(data.revision)],
    ['Public keys', String(data.keys.length)],
  ]));

  if (data.names && data.names.length) {
    const n = el('div', 'ex-field');
    n.append(el('div', 'ex-label', `DPNS names (${data.names.length})`));
    const list = el('div', 'ex-names');
    for (const nm of data.names) list.append(el('span', 'ex-name-chip mono', nm));
    n.append(list);
    card.append(n);
  }

  const keys = el('div', 'ex-keys');
  keys.append(el('div', 'ex-label', 'Public keys'));
  for (const k of data.keys) {
    const row = el('div', 'ex-key');
    row.append(el('span', 'ex-key-id', `#${k.id}`));
    row.append(el('span', null, `${k.purpose} · ${k.securityLevel} · ${k.type}`));
    keys.append(row);
  }
  card.append(keys);

  const pp = proofPanel(data.proof);
  if (pp) card.append(pp);
  card.append(extLink(`/identity/${data.id}`, 'View on Platform Explorer'));
  card.append(snippet(
    `const sdk = EvoSDK.testnetTrusted();\nawait sdk.connect();\nconst identity = await sdk.identities.${data.proof ? 'fetchWithProof' : 'fetch'}('${data.id}');\nconst names = await sdk.dpns.usernames({ identityId: '${data.id}' });`,
  ));
  card.append(rawBlock(data.raw));
  return card;
}

function renderName(data) {
  const card = el('div', 'ex-card panel');
  card.append(el('h2', null, `${data.username}.dash`));
  if (data.registered) {
    card.append(el('p', 'ex-sub', 'Registered. Resolves to the identity below.'));
    card.append(field('Owner identity', data.identityId));
    const btn = el('button', 'btn primary', 'View this identity →');
    btn.addEventListener('click', () => { $('kind').value = 'identity'; $('q').value = data.identityId; search(); });
    card.append(btn);
    card.append(snippet(`const owner = await sdk.dpns.resolveName('${data.username}');`));
  } else if (!data.valid) {
    card.append(el('div', 'note warn', 'Not a valid DPNS name (use a-z, 0-9 and hyphens, 3–63 chars).'));
  } else if (data.available) {
    card.append(el('div', 'note ok', `${data.username}.dash is available${data.contested ? ' (contested — premium name, goes through masternode voting)' : ''}.`));
    const a = el('a', 'btn primary', 'Claim it in Onboard →');
    a.href = '/onboard/';
    card.append(a);
    card.append(snippet(`const available = await sdk.dpns.isNameAvailable('${data.username}');`));
  } else {
    card.append(el('div', 'note warn', `${data.username}.dash is taken or not available.`));
  }
  const cp = contestPanel(data);
  if (cp) card.append(cp);
  return card;
}

function contestPanel(data) {
  const c = data.contest;
  if (!c || !c.contenders?.length) return null;
  const d = el('div', 'ex-contest');
  d.append(el('div', 'ex-contest-head', '⚖ Contested name — decided by masternode vote'));
  d.append(el('div', 'ex-sub', 'Short or premium names go through a masternode vote instead of first-come-first-served. Contenders and vote tallies:'));
  const list = el('div', 'ex-contenders');
  for (const ct of c.contenders) {
    const row = el('div', 'ex-contender');
    if (c.winner && ct.identityId === c.winner) row.append(el('span', 'ex-badge win', 'winner'));
    row.append(el('span', 'ex-contender-id mono', ct.identityId));
    row.append(el('span', 'ex-votes', `${ct.votes} vote${ct.votes === 1 ? '' : 's'}`));
    const b = el('button', 'btn ghost sm', 'View');
    b.addEventListener('click', () => { $('kind').value = 'identity'; $('q').value = ct.identityId; search(); });
    row.append(b);
    list.append(row);
  }
  d.append(list);
  d.append(stats([['Abstain', String(c.abstain)], ['Lock', String(c.lock)]]));
  return d;
}

function renderToken(data) {
  const card = el('div', 'ex-card panel');
  card.append(el('h2', null, data.name || 'Token'));
  card.append(field('Token ID', data.id));

  const pairs = [];
  if (data.decimals != null) pairs.push(['Decimals', String(data.decimals)]);
  if (data.supply?.totalSupply != null) pairs.push(['Total supply', String(data.supply.totalSupply)]);
  pairs.push(['Status', data.paused ? 'Paused' : 'Active']);
  card.append(stats(pairs));

  const cf = el('div', 'ex-field');
  cf.append(el('div', 'ex-label', `Contract (token #${data.position})`));
  const row = el('div', 'ex-value-row');
  row.append(el('div', 'ex-value mono', data.contractId));
  const b = el('button', 'btn ghost sm', 'View contract');
  b.addEventListener('click', () => { $('kind').value = 'contract'; $('q').value = data.contractId; search(); });
  row.append(b);
  cf.append(row);
  card.append(cf);

  card.append(snippet(
    `const info = await sdk.tokens.contractInfo('${data.id}');\nconst supply = await sdk.tokens.totalSupply('${data.id}');`,
  ));
  if (data.config) card.append(rawBlock(data.config, 'Token config (JSON)'));
  if (data.supply) card.append(rawBlock(data.supply, 'Supply (JSON)'));
  return card;
}

function renderContract(data) {
  const card = el('div', 'ex-card panel');
  card.append(el('h2', null, 'Data contract'));
  card.append(field('Contract ID', data.id));
  card.append(field('Owner identity', data.ownerId));

  const types = el('div', 'ex-types');
  types.append(el('div', 'ex-label', `Document types (${data.documentTypes.length})`));
  for (const t of data.documentTypes) types.append(docType(data.id, t));
  card.append(types);

  const pp = proofPanel(data.proof);
  if (pp) card.append(pp);
  card.append(extLink(`/dataContract/${data.id}`, 'View on Platform Explorer'));
  card.append(snippet(
    `const contract = await sdk.contracts.${data.proof ? 'fetchWithProof' : 'fetch'}('${data.id}');\nconsole.log(Object.keys(contract.schemas)); // document types`,
  ));
  card.append(rawBlock(data.schemas, 'Schemas (JSON)'));
  return card;
}

// A collapsible query form per document type.
function docType(contractId, type) {
  const wrap = el('details', 'ex-type');
  wrap.append(el('summary', 'ex-type-name mono', type));

  const form = el('div', 'ex-qform');
  const whereField = input('field');
  const whereOp = select(['==', '>', '>=', '<', '<=', 'startsWith', 'in']);
  const whereVal = input('value');
  const orderField = input('order by');
  const orderDir = select(['asc', 'desc']);
  const limit = input('limit', '10', 'number');
  limit.classList.add('ex-limit');

  form.append(labeled('where', row(whereField, whereOp, whereVal)));
  form.append(labeled('order by', row(orderField, orderDir)));
  form.append(labeled('limit', limit));

  const btns = el('div', 'ex-qbtns');
  const queryBtn = el('button', 'btn primary sm', 'Query');
  const countBtn = el('button', 'btn ghost sm', 'Count');
  btns.append(queryBtn, countBtn);
  form.append(btns);

  const out = el('div', 'ex-docs');
  form.append(out);
  wrap.append(form);

  const buildWhere = () => (whereField.value.trim() ? [[whereField.value.trim(), whereOp.value, coerce(whereVal.value)]] : undefined);
  const buildOrder = () => (orderField.value.trim() ? [[orderField.value.trim(), orderDir.value]] : undefined);

  queryBtn.addEventListener('click', () => runDocs(contractId, type, { where: buildWhere(), orderBy: buildOrder(), limit: Number(limit.value) || 10 }, out));
  countBtn.addEventListener('click', () => runCount(contractId, type, buildWhere(), out));
  return wrap;
}

async function runDocs(contractId, type, opts, out) {
  out.replaceChildren(el('div', 'ex-sub', 'Querying…'));
  try {
    const { docs, proof } = await queryDocuments(contractId, type, { ...opts, proof: $('proof').checked });
    out.replaceChildren(el('div', 'ex-label', `${docs.length} ${type} document(s)`));
    if (!docs.length) out.append(el('div', 'ex-sub', 'None found.'));
    for (const d of docs) out.append(el('pre', 'box mono ex-doc', jsonPretty(d)));
    const pp = proofPanel(proof);
    if (pp) out.append(pp);
  } catch (e) {
    out.replaceChildren(el('div', 'error', e?.message || String(e)));
  }
}

async function runCount(contractId, type, where, out) {
  out.replaceChildren(el('div', 'ex-sub', 'Counting…'));
  try {
    const n = await countDocuments(contractId, type, where);
    out.replaceChildren(el('div', 'ex-count', `Count: ${n}`));
  } catch (e) {
    out.replaceChildren(el('div', 'note warn', `Count needs a countable index on this type. (${e?.message || e})`));
  }
}

// small form helpers
function input(ph, val = '', type = 'text') { const i = el('input'); i.type = type; i.placeholder = ph; if (val) i.value = val; i.spellcheck = false; return i; }
function select(opts) { const s = el('select'); for (const o of opts) s.append(new Option(o, o)); return s; }
function row(...nodes) { const r = el('div', 'ex-qrow'); r.append(...nodes); return r; }
function labeled(label, node) { const w = el('div', 'ex-qgroup'); w.append(el('span', 'ex-qlabel', label)); w.append(node); return w; }
function coerce(v) { const t = v.trim(); if (t === 'true') return true; if (t === 'false') return false; if (t !== '' && !isNaN(Number(t))) return Number(t); return t; }

function notFound(msg) { return el('div', 'note warn', msg); }
function showError(msg) { const b = $('err'); b.textContent = msg; b.hidden = false; }

// ── network info (lazy: only after the SDK is up) ────────────────────────────
async function showNetwork() {
  if (networkShown) return;
  networkShown = true;
  try {
    const n = await networkInfo();
    $('net').textContent = `testnet · epoch ${n.epoch} · protocol v${n.protocolVersion}`;
  } catch { networkShown = false; }
}

// ── permalinks ───────────────────────────────────────────────────────────────
function syncUrl(kind, q) {
  const proof = $('proof').checked ? '&proof=1' : '';
  history.replaceState(null, '', `?kind=${kind}&q=${encodeURIComponent(q)}${proof}`);
}
function loadFromUrl() {
  const p = new URLSearchParams(location.search);
  const kind = p.get('kind');
  const q = p.get('q');
  if (p.get('proof') === '1') $('proof').checked = true;
  if (KINDS.includes(kind) && q) {
    $('kind').value = kind;
    $('q').value = q;
    $('q').placeholder = PLACEHOLDER[kind];
    search();
  }
}

// ── search ───────────────────────────────────────────────────────────────────
async function search() {
  const kind = $('kind').value;
  const q = $('q').value.trim();
  $('err').hidden = true;
  if (!q) return;
  syncUrl(kind, q);
  const results = $('results');
  results.replaceChildren(el('div', 'ex-loading', 'Looking up…'));
  const btn = $('searchBtn');
  btn.disabled = true;
  try {
    const opts = { proof: $('proof').checked };
    let node;
    if (kind === 'identity') {
      const d = await lookupIdentity(q, opts);
      node = d ? renderIdentity(d) : notFound('No identity with that ID.');
    } else if (kind === 'name') {
      const d = await lookupName(q);
      node = d ? renderName(d) : notFound('Could not look up that name.');
    } else if (kind === 'token') {
      const d = await lookupToken(q);
      node = d ? renderToken(d) : notFound('No token with that ID (it may not exist on the current testnet).');
    } else {
      const d = await lookupContract(q, opts);
      node = d ? renderContract(d) : notFound('No contract with that ID.');
    }
    if (node.classList?.contains('ex-card')) cardHeader(node);
    results.replaceChildren(node);
    showNetwork();
  } catch (e) {
    results.replaceChildren();
    showError(e?.message || String(e));
  } finally {
    btn.disabled = false;
  }
}

// ── wiring ───────────────────────────────────────────────────────────────────
$('kind').addEventListener('change', () => { $('q').placeholder = PLACEHOLDER[$('kind').value]; });
$('searchBtn').addEventListener('click', search);
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
document.querySelectorAll('.ex-examples a').forEach((a) => {
  a.addEventListener('click', (e) => { e.preventDefault(); $('kind').value = a.dataset.kind; $('q').value = a.dataset.q; $('q').placeholder = PLACEHOLDER[a.dataset.kind]; search(); });
});
$('q').placeholder = PLACEHOLDER.identity;
loadFromUrl();
