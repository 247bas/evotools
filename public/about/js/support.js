// The donation block: a QR for the address and a copy button.
//
// The address itself is in the markup, not here — with JavaScript off the page
// still shows something you can pay. This script reads it back out, so there is
// one address on this page and no second copy to fall out of step with it.
import { qrSvg } from '../../shared/qr.js';

const $ = (id) => document.getElementById(id);
const address = $('donateL1')?.textContent.trim();
if (address) {
  // The plain address, not a `dash:` URI: exchange withdrawal forms tend to
  // choke on the URI form, and that is where a lot of donations start.
  const svg = qrSvg(address, { scale: 4, quiet: 2, dark: '#0f1524', light: '#ffffff' });
  // Parsed rather than assigned as innerHTML — the habit is worth keeping even
  // where the input is our own constant.
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const node = doc.documentElement;
  node.setAttribute('aria-label', `Dash address ${address}`);
  $('donateQr')?.replaceChildren(document.importNode(node, true));

  const btn = $('donateCopy');
  btn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(address);
      btn.textContent = 'Copied ✓';
    } catch {
      // The clipboard API refuses when the page has lost focus, which is exactly
      // what happens after a detour to a wallet. Selecting the text lets the
      // reader copy it the ordinary way instead of leaving them stuck.
      const range = document.createRange();
      range.selectNodeContents($('donateL1'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      btn.textContent = 'Selected — press ⌘/Ctrl+C';
    }
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
}
