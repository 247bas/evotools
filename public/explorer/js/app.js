// evo-explorer — look up identities, DPNS names, contracts and documents on
// testnet. All external/looked-up data is rendered via textContent (never
// innerHTML), so document contents can't inject markup.

import { lookupIdentity, lookupName, lookupContract, queryDocuments, creditsToDash } from './explorer.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const jsonPretty = (o) => JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? `${v}` : v), 2);
const EXPLORER = 'https://testnet.platform-explorer.com';

const PLACEHOLDER = {
  identity: 'Identity ID (base58, e.g. 3pdTAJ…)',
  name: 'DPNS name (e.g. alice or alice.dash)',
  contract: 'Data contract ID (base58)',
};

// ── small building blocks ────────────────────────────────────────────────────
function field(label, value, mono = true) {
  const f = el('div', 'ex-field');
  f.append(el('div', 'ex-label', label));
  const row = el('div', 'ex-value-row');
  const v = el('div', `ex-value${mono ? ' mono' : ''}`, value);
  row.append(v);
  row.append(copyBtn(value));
  f.append(row);
  return f;
}
function copyBtn(text) {
  const b = el('button', 'btn ghost sm', 'Copy');
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1200); }
    catch { /* ignore */ }
  });
  return b;
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
function rawBlock(obj) {
  const d = el('details', 'ex-raw');
  d.append(el('summary', null, 'Raw JSON'));
  d.append(el('pre', 'box mono', jsonPretty(obj)));
  return d;
}
function snippet(code) {
  const d = el('details', 'ex-raw');
  d.append(el('summary', null, 'SDK snippet'));
  const pre = el('pre', 'box mono', code);
  const wrap = el('div');
  wrap.append(pre);
  wrap.append(copyBtn(code));
  d.append(wrap);
  return d;
}
function explorerLink(path, label) {
  const a = el('a', 'ex-extlink', `${label} ↗`);
  a.href = `${EXPLORER}${path}`;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

// ── renderers ────────────────────────────────────────────────────────────────
function renderIdentity(data) {
  const card = el('div', 'ex-card panel');
  card.append(el('h2', null, data.name ? data.name : 'Identity'));
  card.append(field('Identity ID', data.id));
  card.append(stats([
    ['Balance', `${creditsToDash(data.balance)} tDASH`],
    ['Revision', String(data.revision)],
    ['Public keys', String(data.keys.length)],
  ]));

  const keys = el('div', 'ex-keys');
  keys.append(el('div', 'ex-label', 'Public keys'));
  for (const k of data.keys) {
    const row = el('div', 'ex-key');
    row.append(el('span', 'ex-key-id', `#${k.id}`));
    row.append(el('span', null, `${k.purpose} · ${k.securityLevel} · ${k.type}`));
    keys.append(row);
  }
  card.append(keys);

  card.append(explorerLink(`/identity/${data.id}`, 'View on Platform Explorer'));
  card.append(snippet(
    `const sdk = EvoSDK.testnetTrusted();\nawait sdk.connect();\nconst identity = await sdk.identities.fetch('${data.id}');\nconsole.log(identity.balance, identity.revision, identity.publicKeys);`,
  ));
  card.append(rawBlock(data.raw));
  return card;
}

function renderName(data) {
  const card = el('div', 'ex-card panel');
  card.append(el('h2', null, `${data.username}.dash`));
  card.append(el('p', 'ex-sub', 'This name resolves to the identity below.'));
  card.append(field('Owner identity', data.identityId));
  const btn = el('button', 'btn primary', 'View this identity →');
  btn.addEventListener('click', () => { $('kind').value = 'identity'; $('q').value = data.identityId; search(); });
  card.append(btn);
  card.append(snippet(`const owner = await sdk.dpns.resolveName('${data.username}');`));
  return card;
}

function renderContract(data) {
  const card = el('div', 'ex-card panel');
  card.append(el('h2', null, 'Data contract'));
  card.append(field('Contract ID', data.id));
  card.append(field('Owner identity', data.ownerId));

  const types = el('div', 'ex-types');
  types.append(el('div', 'ex-label', `Document types (${data.documentTypes.length})`));
  for (const t of data.documentTypes) {
    const row = el('div', 'ex-type');
    row.append(el('span', 'ex-type-name mono', t));
    const q = el('button', 'btn ghost sm', 'Query documents');
    q.addEventListener('click', () => runDocs(data.id, t, card));
    row.append(q);
    types.append(row);
  }
  card.append(types);
  card.append(el('div', 'ex-docs'));

  card.append(explorerLink(`/dataContract/${data.id}`, 'View on Platform Explorer'));
  card.append(snippet(
    `const contract = await sdk.contracts.fetch('${data.id}');\nconsole.log(Object.keys(contract.schemas)); // document types`,
  ));
  card.append(rawBlock(data.schemas));
  return card;
}

async function runDocs(contractId, type, card) {
  const box = card.querySelector('.ex-docs');
  box.replaceChildren(el('div', 'ex-sub', `Querying ${type}…`));
  try {
    const docs = await queryDocuments(contractId, type, 10);
    box.replaceChildren();
    box.append(el('div', 'ex-label', `${docs.length} ${type} document(s)`));
    if (!docs.length) box.append(el('div', 'ex-sub', 'None found.'));
    for (const d of docs) box.append(el('pre', 'box mono ex-doc', jsonPretty(d)));
    box.append(snippet(
      `const docs = await sdk.documents.query({\n  dataContractId: '${contractId}',\n  documentTypeName: '${type}',\n  limit: 10,\n});`,
    ));
  } catch (e) {
    box.replaceChildren(el('div', 'error', `Query failed: ${e?.message || e}`));
  }
}

// ── search ───────────────────────────────────────────────────────────────────
async function search() {
  const kind = $('kind').value;
  const q = $('q').value.trim();
  $('err').hidden = true;
  if (!q) return;
  const results = $('results');
  results.replaceChildren(el('div', 'ex-loading', 'Looking up…'));
  const btn = $('searchBtn');
  btn.disabled = true;
  try {
    let node;
    if (kind === 'identity') {
      const d = await lookupIdentity(q);
      node = d ? renderIdentity(d) : notFound('No identity with that ID.');
    } else if (kind === 'name') {
      const d = await lookupName(q);
      node = d ? renderName(d) : notFound('That name is not registered.');
    } else {
      const d = await lookupContract(q);
      node = d ? renderContract(d) : notFound('No contract with that ID.');
    }
    results.replaceChildren(node);
  } catch (e) {
    results.replaceChildren();
    showError(e?.message || String(e));
  } finally {
    btn.disabled = false;
  }
}
function notFound(msg) { return el('div', 'note warn', msg); }
function showError(msg) { const b = $('err'); b.textContent = msg; b.hidden = false; }

// ── wiring ───────────────────────────────────────────────────────────────────
$('kind').addEventListener('change', () => { $('q').placeholder = PLACEHOLDER[$('kind').value]; });
$('searchBtn').addEventListener('click', search);
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
document.querySelectorAll('.ex-examples a').forEach((a) => {
  a.addEventListener('click', (e) => { e.preventDefault(); $('kind').value = a.dataset.kind; $('q').value = a.dataset.q; $('q').placeholder = PLACEHOLDER[a.dataset.kind]; search(); });
});
$('q').placeholder = PLACEHOLDER.identity;
