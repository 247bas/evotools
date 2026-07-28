// contests — the open and decided .dash name votes, from the public indexer.
import {
  stats, contests, contestDetail, chainTally, setNetwork, getNetwork, apiHost,
} from './api.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmtDate = (d) => (d ? d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const num = (n) => n.toLocaleString();

// "in 6 days" / "3 weeks ago" — the distance is what people read a contest list
// for; the exact stamp is one hover away.
function relative(date) {
  if (!date) return '';
  const ms = date.getTime() - Date.now();
  const abs = Math.abs(ms);
  const units = [['year', 31536e6], ['month', 2592e6], ['week', 6048e5], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]];
  for (const [unit, size] of units) {
    if (abs >= size || unit === 'minute') {
      return new Intl.RelativeTimeFormat([], { numeric: 'auto' }).format(Math.round(ms / size), unit);
    }
  }
  return '';
}

const DONE_PER_PAGE = 25;
let donePage = 1;

function showError(e) {
  const box = $('error');
  box.textContent = typeof e === 'string' ? e : (e?.message || String(e));
  box.hidden = false;
}
const clearError = () => { $('error').hidden = true; };

// ── one row ──────────────────────────────────────────────────────────────────
function explorerLink(kind, q) {
  const a = el('a', 'ct-link', kind === 'identity' ? 'identity ↗' : 'check on chain ↗');
  a.href = `/explorer/?kind=${kind}&q=${encodeURIComponent(q)}${getNetwork() === 'mainnet' ? '&net=mainnet' : ''}`;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function outcomeBadge(c) {
  if (c.outcome === 'open') return el('span', 'ct-badge open', 'voting');
  if (c.outcome === 'won') return el('span', 'ct-badge won', 'won');
  if (c.outcome === 'locked') return el('span', 'ct-badge locked', 'locked');
  return el('span', 'ct-badge', 'no winner');
}

function tallies(c) {
  const d = el('div', 'ct-tallies');
  const add = (cls, n, label) => {
    const s = el('span', `ct-tally ${cls}`);
    s.append(el('b', null, num(n)));
    s.append(el('span', null, ` ${label}`));
    d.append(s);
  };
  add('for', c.votesFor, 'for');
  add('lock', c.votesLock, 'lock');
  add('abstain', c.votesAbstain, 'abstain');
  return d;
}

function row(c) {
  const wrap = el('div', 'ct-row');

  const head = el('button', 'ct-head');
  head.setAttribute('aria-expanded', 'false');
  const name = el('span', 'ct-name');
  name.append(el('span', 'ct-label', `${c.label}.dash`));
  head.append(name);
  head.append(outcomeBadge(c));
  head.append(tallies(c));

  const dates = el('div', 'ct-dates');
  const when = (label, date) => {
    const s = el('span', 'ct-date');
    s.append(el('span', 'ct-date-k', label));
    const v = el('span', 'ct-date-v', fmtDate(date));
    v.title = date ? date.toISOString() : '';
    s.append(v);
    s.append(el('span', 'ct-date-rel', relative(date)));
    return s;
  };
  dates.append(when('claimed', c.startedAt));
  dates.append(when(c.finished ? 'decided' : 'ends', c.endsAt));
  head.append(dates);

  const body = el('div', 'ct-body');
  body.hidden = true;
  wrap.append(head, body);

  let loaded = false;
  head.addEventListener('click', async () => {
    const open = body.hidden;
    body.hidden = !open;
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open || loaded) return;
    loaded = true;
    body.replaceChildren(el('div', 'ct-sub', 'Loading contenders…'));
    try {
      body.replaceChildren(detail(await contestDetail(c.indexValues), c));
    } catch (e) {
      loaded = false;
      body.replaceChildren(el('div', 'ct-sub', `Could not load the contenders: ${e?.message || e}`));
    }
  });
  return wrap;
}

// Who claimed the name, what each of them collected, and — for a decided
// contest — which of them walked away with it.
function detail(full, brief) {
  const d = el('div');
  const real = full.contenders.find((x) => x.name)?.name;
  if (real && real.toLowerCase() !== `${brief.label}.dash`) {
    d.append(el('div', 'ct-sub', `Registered as ${real} — DPNS stores the homograph-safe form, which turns o into 0 and l into 1.`));
  }
  if (!full.contenders.length) {
    d.append(el('div', 'ct-sub', 'The indexer lists no contenders for this one.'));
    return d;
  }
  for (const c of full.contenders) {
    const r = el('div', 'ct-contender');
    // While a contest runs the API still names an identity here. That is who is
    // ahead, not who won — the vote can still turn, or be locked.
    if (full.winner && c.identityId === full.winner) {
      r.append(el('span', `ct-badge ${full.finished ? 'won' : 'open'}`, full.finished ? 'winner' : 'leading'));
    }
    const id = el('span', 'ct-cid mono', c.identityId);
    r.append(id);
    r.append(tallies({ votesFor: c.votesFor, votesLock: c.votesLock, votesAbstain: c.votesAbstain }));
    if (c.claimedAt) {
      const t = el('span', 'ct-claimed', `claimed ${fmtDate(c.claimedAt)}`);
      t.title = c.claimedAt.toISOString();
      r.append(t);
    }
    r.append(explorerLink('identity', c.identityId));
    d.append(r);
  }
  const links = el('div', 'ct-detail-links');
  links.append(explorerLink('name', brief.label));
  d.append(links);

  // The list above is the index's word. Once a row is open, ask the chain — it
  // is the tally that decided the outcome, and on finished contests the two do
  // not always agree.
  const verify = el('div', 'ct-sub', 'Checking the tally against the chain…');
  d.append(verify);
  chainTally(brief.label).then((chain) => {
    const same = chain.votesFor === brief.votesFor
      && chain.votesLock === brief.votesLock
      && chain.votesAbstain === brief.votesAbstain;
    verify.replaceChildren();
    verify.append(el('span', null, `Chain tally: ${num(chain.votesFor)} for · ${num(chain.votesLock)} lock · ${num(chain.votesAbstain)} abstain`));
    if (!same) {
      verify.append(el('span', 'ct-drift', ` — the index above lists ${num(brief.votesFor)} / ${num(brief.votesLock)} / ${num(brief.votesAbstain)} for this one. The chain is what counted.`));
    }
    // Per-contender numbers come from the index too; correct them where the
    // chain knows better.
    for (const [id, votes] of Object.entries(chain.perContender)) {
      const row = [...d.querySelectorAll('.ct-contender')].find((r) => r.textContent.includes(id));
      const tally = row?.querySelector('.ct-tally.for b');
      if (tally && tally.textContent !== num(votes)) tally.textContent = num(votes);
    }
  }).catch((e) => {
    verify.textContent = `Could not reach the chain for a second opinion: ${e?.message || e}`;
  });
  return d;
}

// ── the two lists ────────────────────────────────────────────────────────────
async function loadOpen() {
  const list = $('openList');
  list.replaceChildren(el('div', 'ct-sub', 'Loading…'));
  const { rows, total } = await contests({ finished: false, limit: 100 });
  $('openCount').textContent = total ? `(${num(total)})` : '';
  if (!rows.length) {
    list.replaceChildren(el('div', 'ct-empty', `No contest is open on ${getNetwork()} right now.`));
    return;
  }
  // Ending soonest first: that is the one worth watching.
  rows.sort((a, b) => (a.endsAt?.getTime() ?? 0) - (b.endsAt?.getTime() ?? 0));
  list.replaceChildren(...rows.map(row));
}

async function loadDone() {
  const list = $('doneList');
  list.replaceChildren(el('div', 'ct-sub', 'Loading…'));
  const { rows, total } = await contests({ finished: true, page: donePage, limit: DONE_PER_PAGE });
  $('doneCount').textContent = total ? `(${num(total)})` : '';
  list.replaceChildren(...(rows.length ? rows.map(row) : [el('div', 'ct-empty', 'Nothing decided yet.')]));

  const pages = Math.max(1, Math.ceil(total / DONE_PER_PAGE));
  $('pager').hidden = pages <= 1;
  $('pageLabel').textContent = `page ${donePage} of ${num(pages)}`;
  $('prevBtn').disabled = donePage <= 1;
  $('nextBtn').disabled = donePage >= pages;
}

async function loadStats() {
  const box = $('stats');
  box.replaceChildren();
  const s = await stats();
  const bit = (n, label) => {
    const e = el('span', 'ct-stat');
    e.append(el('b', null, num(n)));
    e.append(el('span', null, ` ${label}`));
    return e;
  };
  box.append(bit(s.totalPendingContestedResources ?? 0, 'open'));
  box.append(bit(s.totalContestedResources ?? 0, 'contests in total'));
  box.append(bit(s.totalVotesCount ?? 0, 'votes cast'));
  const next = s.expiringContestedResource;
  if (next?.resourceValue?.[1] && next.endTimestamp) {
    const d = new Date(next.endTimestamp);
    box.append(el('span', 'ct-stat next', `next to end: ${next.resourceValue[1]}.dash ${relative(d)}`));
  }
}

async function loadAll() {
  clearError();
  $('source').textContent = `Lists come from the public platform-explorer API (${apiHost().replace('https://', '')}); each row links to our own explorer, which re-reads that name from the chain.`;
  try {
    await Promise.all([loadStats(), loadOpen(), loadDone()]);
  } catch (e) {
    showError(e);
  }
}

// ── wiring ───────────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
if (params.get('net') === 'testnet') { setNetwork('testnet'); $('netsel').value = 'testnet'; }

$('netsel').addEventListener('change', () => {
  setNetwork($('netsel').value);
  donePage = 1;
  const url = new URL(location.href);
  if (getNetwork() === 'mainnet') url.searchParams.delete('net');
  else url.searchParams.set('net', 'testnet');
  history.replaceState(null, '', url);
  loadAll();
});

$('prevBtn').addEventListener('click', () => { if (donePage > 1) { donePage--; loadDone().catch(showError); } });
$('nextBtn').addEventListener('click', () => { donePage++; loadDone().catch(showError); });

loadAll();
