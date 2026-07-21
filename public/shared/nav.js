// Shared top nav + footer for every evotools page. One source of truth so the
// suite reads as one product. Import as a module: <script type="module" src="/shared/nav.js">.
// Paths are absolute, so this works whether served locally (root = evotools/)
// or on Cloudflare Pages (root = evotools/).

const TOOLS = [
  { href: '/onboard/', label: 'Onboard' },
  { href: '/playground/', label: 'Playground' },
  // add tools here as they ship: explorer, name
];

const EXTERNAL = [
  { href: 'https://github.com/247bas/evo-cookbook', label: 'Cookbook' },
  { href: 'https://github.com/247bas', label: 'GitHub', hideSm: true },
];

const here = location.pathname;
const isActive = (href) => here === href || (href !== '/' && here.startsWith(href));

const nav = document.createElement('nav');
nav.className = 'evo-nav';
nav.innerHTML = `
  <a class="brand" href="/"><span class="logo">◈</span> evotools</a>
  <div class="links">
    ${TOOLS.map((t) => `<a href="${t.href}"${isActive(t.href) ? ' style="color:var(--text)"' : ''}>${t.label}</a>`).join('')}
    ${EXTERNAL.map((t) => `<a href="${t.href}" target="_blank" rel="noopener"${t.hideSm ? ' class="hide-sm"' : ''}>${t.label} ↗</a>`).join('')}
    <span class="net-badge">testnet</span>
  </div>`;

const footer = document.createElement('footer');
footer.className = 'evo-footer';
footer.innerHTML = `
  Tools for building on the Dash Evolution chain · by
  <a href="https://github.com/247bas" target="_blank" rel="noopener">247bas</a> ·
  <a href="https://github.com/247bas" target="_blank" rel="noopener">source</a>`;

document.body.prepend(nav);
document.body.append(footer);
