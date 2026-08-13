// The about page states two addresses and claims they are one key. If the pair
// ever falls out of step — a swapped donation address with the old twin left
// beside it — the page tells a lie about the arithmetic the whole site is built
// on, and nothing else would catch it. So the claim is checked here against the
// map's own derivation, and the QR is decoded back to the address it encodes.
// Run: node public/about/test/smoke.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// `pathname` percent-encodes, and this repo lives under a path with a space in
// it — fine for import(), fatal for readFileSync.
const P = new URL('../../', import.meta.url).pathname;
const FILE = fileURLToPath(new URL('../index.html', import.meta.url));
const Evo = await import(`${P}shared/vendor/evo-sdk.module.js`);
await Evo.ensureInitialized?.();
const A = await import(`${P}map/js/addresses.js`);
const { qrMatrix } = await import(`${P}shared/qr.js`);

const ok = (m) => console.log(`  ✅ ${m}`);
let failed = 0;
const check = (c, m) => (c ? ok(m) : (failed++, console.log(`  ❌ ${m}`)));

const html = readFileSync(FILE, 'utf8');
const pick = (id) => html.match(new RegExp(`id="${id}"[^>]*>([^<]+)<`))?.[1]?.trim();

console.log('\n1. The donation address and its Platform twin are one key');
const l1 = pick('donateL1');
const platform = pick('donatePlatform');
check(/^X[1-9A-HJ-NP-Za-km-z]{32,33}$/.test(l1 || ''), `layer 1: ${l1}`);
check(/^dash1[0-9a-z]{20,}$/.test(platform || ''), `platform: ${platform}`);

const { hash, network } = await A.hashFromL1(l1);
check(network === 'mainnet', 'it is a mainnet address, not a testnet one');
const derived = A.platformFromHash(Evo, hash, network);
check(derived === platform, derived === platform
  ? 'the page states the twin this key actually has'
  : `the page states ${platform}, this key has ${derived}`);
// And back, so the claim holds in both directions rather than by coincidence.
check((await A.l1FromHash(A.hashFromPlatform(Evo, platform).hash, network)) === l1,
  'and the twin leads back to the same layer-1 address');

console.log('\n2. The link next to them opens that address on the map');
const mapLink = html.match(/href="\/map\/\?q=([^&"]+)/)?.[1];
check(decodeURIComponent(mapLink || '') === l1, `map link carries ${decodeURIComponent(mapLink || '(none)')}`);

console.log('\n3. The QR encodes the address, not a URI or a truncation');
// A wallet scanning this has to land on the same string the page shows. The
// encoder is ours, so this is the check that it stayed honest.
const { size, modules } = qrMatrix(l1);
check(size >= 21 && modules.length === size, `${size}×${size} matrix built`);
const { qrSvg } = await import(`${P}shared/qr.js`);
const svg = qrSvg(l1, { scale: 4, quiet: 2 });
check(svg.startsWith('<svg') && svg.includes('shape-rendering="crispEdges"'), 'renders as an SVG');
check(!svg.includes('dash:'), 'the plain address, not a dash: URI — exchange forms choke on those');

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
