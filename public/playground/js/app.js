// evo-playground — pick a recipe, edit it, run it live against testnet.

import { RECIPES, fetchRecipe, githubUrl } from './recipes.js';
import { runCode, applyNetwork } from './run.js';

const $ = (id) => document.getElementById(id);
const state = { recipe: null, original: '', running: false, network: 'testnet' };

// Put source in the editor pointed at the current network.
const setEditor = (src) => { $('codeEditor').value = applyNetwork(src, state.network); };

// ── recipe list ──────────────────────────────────────────────────────────────
function renderList() {
  $('recipeList').innerHTML = RECIPES.map((r) => `
    <button class="pg-item" data-id="${r.id}">
      <span class="pg-item-id">${r.id}</span>
      <span class="pg-item-title">${r.title}</span>
      ${r.funds ? '<span class="pg-item-tag" title="Needs a funded identity to fully run">$</span>' : ''}
    </button>`).join('');
  $('recipeList').querySelectorAll('.pg-item').forEach((el) =>
    el.addEventListener('click', () => selectRecipe(el.dataset.id)));
}

async function selectRecipe(id) {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) return;
  state.recipe = r;
  $('recipeList').querySelectorAll('.pg-item').forEach((el) =>
    el.classList.toggle('active', el.dataset.id === id));
  $('recipeTitle').textContent = `${r.id} — ${r.title}`;
  $('recipeBlurb').textContent = r.blurb;
  $('viewSource').href = githubUrl(r.file);
  $('codeEditor').value = 'Loading…';
  clearOutput();
  try {
    const src = await fetchRecipe(r.file);
    state.original = src;
    setEditor(src);
  } catch (e) {
    $('codeEditor').value = `// ${e.message}`;
  }
}

// ── output console ───────────────────────────────────────────────────────────
function clearOutput() {
  $('output').innerHTML = '<div class="pg-output-empty">Output appears here.</div>';
}
function appendOutput(level, text) {
  const empty = $('output').querySelector('.pg-output-empty');
  if (empty) empty.remove();
  const line = document.createElement('div');
  line.className = `pg-line ${level}`;
  line.textContent = text;
  $('output').appendChild(line);
  $('output').scrollTop = $('output').scrollHeight;
}

// ── environment (optional) ───────────────────────────────────────────────────
function parseEnv() {
  const env = {};
  for (const raw of $('envInput').value.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[line.slice(0, eq).trim()] = val;
  }
  return env;
}

// ── run ──────────────────────────────────────────────────────────────────────
async function run() {
  if (state.running) return;
  state.running = true;
  const btn = $('runBtn');
  btn.disabled = true;
  btn.classList.add('busy');
  btn.textContent = 'Running…';
  clearOutput();
  const started = performance.now();
  try {
    await runCode($('codeEditor').value, { env: parseEnv(), onLog: appendOutput });
    appendOutput('meta', `— done in ${((performance.now() - started) / 1000).toFixed(1)}s —`);
  } catch (e) {
    appendOutput('error', e?.message || String(e));
  } finally {
    state.running = false;
    btn.disabled = false;
    btn.classList.remove('busy');
    btn.textContent = '▶ Run';
  }
}

// ── network toggle ───────────────────────────────────────────────────────────
function setNetwork(net) {
  if (net === state.network) return;
  // Re-point the current editor content (keeps any edits) instead of reloading.
  $('codeEditor').value = applyNetwork($('codeEditor').value, net);
  state.network = net;
  $('netToggle').querySelectorAll('.pg-net-btn').forEach((el) =>
    el.classList.toggle('active', el.dataset.net === net));
  $('mainnetWarn').hidden = net !== 'mainnet';
}
$('netToggle').querySelectorAll('.pg-net-btn').forEach((el) =>
  el.addEventListener('click', () => setNetwork(el.dataset.net)));

// ── wiring ───────────────────────────────────────────────────────────────────
$('runBtn').addEventListener('click', run);
$('resetBtn').addEventListener('click', () => { setEditor(state.original); });
$('envToggle').addEventListener('click', () => {
  const box = $('envBox');
  box.hidden = !box.hidden;
  $('envToggle').classList.toggle('active', !box.hidden);
});
// Ctrl/Cmd+Enter runs.
$('codeEditor').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
});

renderList();
selectRecipe('01');
