// The page itself: does it boot, and does clicking through it end up where the
// step machine says it should. Offline — nothing here touches the network.
// Run: node public/tokens/test/page.mjs
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPage } from './dom.mjs';
import { FLOWS, LABELS, STEPS } from '../js/steps.js';

const here = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(here, '..');
const PUBLIC = join(TOKENS, '..');

let failed = 0;
const check = (cond, m) => (cond ? console.log(`  ✅ ${m}`) : (failed++, console.log(`  ❌ ${m}`)));
const is = (got, want, label) => check(got === want, `${label} — ${got === want ? got : `got "${got}", wanted "${want}"`}`);

// Booting the page means running app.js against a fresh document. The cache
// buster is what makes a second scenario a second run rather than a no-op.
async function open(search = '', storage = {}) {
  const doc = await loadPage(join(TOKENS, 'index.html'), { search, storage });
  await import(`${join(TOKENS, 'js', 'app.js')}?${Math.random()}`);
  return doc;
}
const at = (doc) => doc.all.filter((e) => e.attrs['data-step'] && e.classList.contains('current')).map((e) => e.attrs['data-step']).join(',');
const stepper = (doc) => doc.getElementById('stepper').children
  .map((li) => `${li.classList.contains('active') ? '*' : li.classList.contains('done') ? '+' : ' '}${li.text.trim()}`).join('');
const flowCard = (doc, flow) => doc.all.find((e) => e.attrs['data-flow'] === flow);
const reviewText = (doc) => doc.getElementById('reviewOut').children.map((c) => c.text).join(' ');

console.log('\n1. The step machine and the page agree');
{
  const html = await readFile(join(TOKENS, 'index.html'), 'utf8');
  const app = await readFile(join(TOKENS, 'js', 'app.js'), 'utf8');
  const css = await readFile(join(TOKENS, 'css', 'tokens.css'), 'utf8');
  const hub = await readFile(join(PUBLIC, 'index.html'), 'utf8');

  const sections = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
  const missing = STEPS.filter((id) => !sections.includes(id));
  const spare = sections.filter((id) => !STEPS.includes(id));
  check(missing.length === 0, `every step has a section${missing.length ? `, except ${missing.join(', ')}` : ` (${STEPS.length})`}`);
  check(spare.length === 0, `and no section is orphaned${spare.length ? `: ${spare.join(', ')}` : ''}`);
  check(new Set(sections).size === sections.length, 'each one appears once');
  for (const [name, steps] of Object.entries(FLOWS)) {
    check(steps.length > 0 && steps.every((id) => sections.includes(id)), `flow ${name}: ${steps.join(' → ')}`);
  }
  check(Object.values(FLOWS).every((s) => s.every((id) => LABELS[id])), 'every step has a stepper label');

  // $('x') is how this page reaches the DOM, so a renamed id fails here rather
  // than silently doing nothing in front of a visitor.
  const wanted = [...new Set([...app.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]))];
  const absent = wanted.filter((id) => !html.includes(`id="${id}"`));
  check(absent.length === 0, `app.js reaches ${wanted.length} ids, all of them in the page${absent.length ? ` — except ${absent.join(', ')}` : ''}`);

  // The two layouts are a contract between what the wizard sets and what the
  // stylesheet hides. Drop one of these rules and the wizard shows everything.
  for (const rule of ['[data-mode="wizard"]', '[data-mode="all"]', '.current', '.wizard-only']) {
    check(css.includes(rule), `tokens.css acts on ${rule}`);
  }

  // The front page sends people straight into a flow; a typo there drops them
  // on the chooser with no sign anything went wrong.
  const deep = [...hub.matchAll(/\/tokens\/\?do=([a-z]+)/g)].map((m) => m[1]);
  check(deep.length > 0, `the hub links into ${deep.length} flow(s): ${deep.join(', ')}`);
  check(deep.every((d) => Object.keys(FLOWS).includes(d)), 'and every one is a flow this page has');
}

console.log('\n2. The chooser');
{
  const doc = await open();
  is(at(doc), 'start', 'the page opens on the chooser');
  is(doc.getElementById('stepper').hidden, true, 'with no stepper, because no flow has been chosen');
  flowCard(doc, 'make').click();
  is(at(doc), 'identity', 'Make a token asks who publishes it first');
  is(stepper(doc), '*1 Identity 2 Name 3 Supply 4 Rules 5 Publish 6 Done', 'and the stepper appears, numbered');
}

console.log('\n3. Walking the make flow');
{
  const doc = await open();
  flowCard(doc, 'make').click();
  const nexts = doc.querySelectorAll('[data-next]');
  is(nexts.length, 4, 'four Continue buttons — identity, name, supply, rules; review ends in Publish');
  is(doc.getElementById('idNext').disabled, true, 'Continue is out of reach until an identity is looked up');

  doc.getElementById('idNext').disabled = false;
  doc.getElementById('idNext').click();
  is(at(doc), 'name', 'identity → name');
  is(stepper(doc), '+✓ Identity*2 Name 3 Supply 4 Rules 5 Publish 6 Done', 'and the step behind is ticked off');
  nexts[1].click();
  is(at(doc), 'supply', 'name → supply');
  nexts[2].click();
  is(at(doc), 'rules', 'supply → rules');
  nexts[3].click();
  is(at(doc), 'review', 'rules → review');
  doc.querySelectorAll('[data-back]')[4].click();
  is(at(doc), 'rules', 'Back from review returns to rules');
  doc.getElementById('stepper').children[0].dispatch('click');
  is(at(doc), 'identity', 'a finished step in the stepper is a way back to it');
  is(doc.getElementById('stepper').children[5].listeners.click, undefined, 'a step ahead is not clickable');
}

console.log('\n4. Landing straight in a flow');
for (const [search, want, label] of [
  ['?do=make', 'identity', '?do=make — what the front page links to'],
  ['?do=holders', 'holders', '?do=holders skips the identity, since it signs nothing'],
  ['?do=send', 'identity', '?do=send asks who signs first'],
  ['?do=mint', 'identity', '?do=mint does too'],
  ['?do=nonsense', 'start', 'an unknown flow falls back to the chooser'],
]) is(at(await open(search)), want, label);
{
  const doc = await open('?contract=EGcCV27PcJq5RoEVe3nPrh9ipsXw1VnppezrawQeYkvo');
  is(at(doc), 'holders', 'a shared ?contract= link opens the holder lookup');
  is(doc.getElementById('hdContract').value, 'EGcCV27PcJq5RoEVe3nPrh9ipsXw1VnppezrawQeYkvo', 'with the contract filled in');
  is(doc.getElementById('mnContract').value, 'EGcCV27PcJq5RoEVe3nPrh9ipsXw1VnppezrawQeYkvo', 'and the other boxes too');
}

console.log('\n5. Everything at once');
{
  const doc = await open('?view=all');
  is(doc.getElementById('tk').dataset.mode, 'all', '?view=all opens the flat page');
  is(doc.getElementById('stepper').hidden, true, 'no stepper there');
  is(doc.getElementById('modeBtn').textContent, 'Step by step', 'and the button offers the way back');
  doc.getElementById('modeBtn').click();
  is(doc.getElementById('tk').dataset.mode, 'wizard', 'pressing it returns to the wizard');
}
is((await open('', { 'evotools.tokens.mode': 'all' })).getElementById('tk').dataset.mode, 'all',
  'and the choice is remembered for the next visit');

console.log('\n6. The read-back before signing');
{
  const doc = await open('?do=make');
  const set = (id, v) => { doc.getElementById(id).value = v; doc.getElementById(id).dispatch('input'); };
  set('mkName', 'Waffle');
  set('mkPlural', 'Waffles');
  set('mkSupply', '1000');
  const text = reviewText(doc);
  check(text.includes('Waffle / Waffles'), 'both spellings are read back');
  check(text.includes('1000'), 'and the starting supply');
  check(text.includes('Mint more later yes'), 'and what can still happen to it');
  check(text.includes('no identity looked up'), 'it says the identity is still missing');
  is(doc.getElementById('mkBtn').disabled, true, 'so Publish stays disabled');

  doc.getElementById('mkFreezable').checked = true;
  doc.getElementById('mkFreezable').dispatch('change');
  check(reviewText(doc).includes('Freeze holders yes'), 'ticking freeze shows up in the read-back');
}

console.log('\n7. Real money asks twice');
{
  const doc = await open();
  is(doc.getElementById('mkAckWrap').hidden, true, 'no confirmation tickbox on testnet');
  const sel = doc.getElementById('netsel');
  sel.value = 'mainnet';
  sel.dispatch('change', { target: sel });
  is(doc.getElementById('mkAckWrap').hidden, false, 'mainnet asks for one');
  is(doc.getElementById('idNext').disabled, true, 'and switching network drops the identity that was looked up');
}
is((await open('?net=mainnet')).getElementById('mkAckWrap').hidden, false, 'arriving on mainnet by link asks too');

console.log(failed ? `\n${failed} failed\n` : '\nAll good\n');
process.exit(failed ? 1 : 0);
