// Generate branded OG/social-preview PNGs (1200x630) + an apple-touch icon from
// SVG, using @resvg/resvg-js. Run once: npm run og. Output is committed.
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const card = (title, subtitle) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Lato, 'Noto Sans', sans-serif">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f1524"/><stop offset="1" stop-color="#16213e"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="10" fill="#008de4"/>
  <g transform="translate(80,64)">
    <path d="M22 0 L44 22 L22 44 L0 22 Z" fill="#008de4"/>
    <path d="M22 13 L31 22 L22 31 L13 22 Z" fill="#0f1524"/>
    <text x="60" y="34" font-size="40" font-weight="700" fill="#e6e9ef">evotools</text>
  </g>
  <text x="80" y="342" font-size="92" font-weight="700" fill="#ffffff">${esc(title)}</text>
  <text x="80" y="410" font-size="36" fill="#9aa4b8">${esc(subtitle)}</text>
  <text x="80" y="566" font-size="26" fill="#9aa4b8">Built on Dash Evolution   ·   by 247bas   ·   evotools.dev</text>
</svg>`;

const CARDS = {
  home: ['evotools', 'Tools to build on the Dash Evolution chain'],
  onboard: ['Onboard', 'From nothing to a funded testnet identity + a .dash name'],
  playground: ['Playground', 'Run the evo-cookbook recipes live in your browser'],
  explorer: ['Explorer', 'Browse identities, names, contracts & tokens on Dash Platform'],
};

mkdirSync('public/og', { recursive: true });
for (const [name, [title, sub]] of Object.entries(CARDS)) {
  const png = new Resvg(card(title, sub), { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true } }).render().asPng();
  writeFileSync(`public/og/${name}.png`, png);
  console.log(`public/og/${name}.png  ${(png.length / 1024).toFixed(0)}KB`);
}

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0f1524"/><path d="M16 5 L27 16 L16 27 L5 16 Z" fill="#008de4"/><path d="M16 11 L21 16 L16 21 L11 16 Z" fill="#0f1524"/></svg>`;
const iconPng = new Resvg(icon, { fitTo: { mode: 'width', value: 180 } }).render().asPng();
writeFileSync('public/apple-touch-icon.png', iconPng);
console.log(`public/apple-touch-icon.png  ${(iconPng.length / 1024).toFixed(0)}KB`);
