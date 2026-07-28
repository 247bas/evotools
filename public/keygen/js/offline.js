// Assembling the offline single-file copy. Kept free of DOM and fetch so the
// smoke test can build the exact same file from disk and check its invariants.

// The guarantee this file makes: `connect-src 'none'` means the browser refuses
// every request the page could attempt, and `default-src 'none'` covers the rest.
// The eval allowances are there because the SDK's bundle needs them for WASM;
// neither of them can reach the network.
export const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// Import specifiers that get rewritten to blob URLs inside the offline copy.
// They must appear verbatim in the sources — the smoke test asserts that.
export const SDK_SPECIFIER = "'../../shared/vendor/evo-sdk.module.js'";
export const KEYS_SPECIFIER = "'./keys.js'";
export const QR_SPECIFIER = "'../../shared/qr.js'";

export const BOOTSTRAP = `
document.documentElement.dataset.offline = '1';
const src = (id) => document.getElementById(id).textContent;
const blob = (s) => URL.createObjectURL(new Blob([s], { type: 'text/javascript' }));
const sdkUrl = blob(src('src-sdk'));
const qrUrl = blob(src('src-qr'));
const keysUrl = blob(src('src-keys').replace(${JSON.stringify(SDK_SPECIFIER)}, JSON.stringify(sdkUrl)));
const appUrl = blob(src('src-app')
  .replace(${JSON.stringify(KEYS_SPECIFIER)}, JSON.stringify(keysUrl))
  .replace(${JSON.stringify(QR_SPECIFIER)}, JSON.stringify(qrUrl)));
await import(appUrl);
`;

// Take the markup from the pristine page source, never from the live DOM — the
// live one holds the keys that were just generated.
export function extractMarkup(pageHtml) {
  const match = pageHtml.match(/<div class="wrap" id="kgWrap">[\s\S]*?<\/div>\s*(?=<script)/);
  if (!match) throw new Error('Could not find the page markup to copy.');
  return match[0].trimEnd();
}

export function buildOfflineHtml({ page, theme, css, appJs, keysJs, qrJs, sdk }) {
  for (const [name, source] of Object.entries({ appJs, keysJs, qrJs, sdk })) {
    // An inert block ends at the first closing script tag, so a source that
    // contained one would silently truncate the file.
    if (source.includes('</script')) throw new Error(`${name} contains a closing script tag and cannot be inlined.`);
  }
  const inert = (id, text) => `<script type="text/plain" id="${id}">${text}</script>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<title>evo keygen — offline copy</title>
<style>${theme}</style>
<style>${css}</style>
</head>
<body>
${extractMarkup(page)}
${inert('src-sdk', sdk)}
${inert('src-qr', qrJs)}
${inert('src-keys', keysJs)}
${inert('src-app', appJs)}
<script type="module">${BOOTSTRAP}</script>
</body>
</html>
`;
}
