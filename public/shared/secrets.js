// One rule for "what somebody just pasted is a secret", shared by every tool that
// takes an identifier in a text field.
//
// Why this needs saying out loud: a tool that asks for an identity ID and gets a
// WIF hands it straight to the SDK, which fails on the length ("byte length not
// 32 bytes"). That error arrives *after* the value has been passed on, and reads
// like a typo rather than "you just pasted your key in the wrong box". Catching
// it here keeps a secret in the field it was meant for — or out of the page.
//
// The message stays with the caller: /map never wants a key at all, while
// /name and /credits do want one, just not in this field.

const words = (s) => s.trim().split(/\s+/).filter(Boolean);

export function looksLikeSecret(raw) {
  const s = (raw || '').trim();
  if (!s) return false;
  // A recovery phrase: 12 words or more.
  if (words(s).length >= 12) return true;
  // A WIF. Length separates the two things that both start with an X on mainnet:
  // an address is 34 characters, a private key 51-52. Identity IDs are 43-44, so
  // no real ID can land in here.
  if (/^[X7c][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(s)) return true;
  // A raw key or a fragment of one is hex and long. Without this a 62-character
  // hex string reads as a DPNS label and gets sent to a node as a name lookup.
  if (/^[0-9a-f]{32,}$/i.test(s)) return true;
  // An extended key, private or public — the private one is the dangerous one and
  // they are a character apart.
  if (/^([xt]prv|[xt]pub)[1-9A-HJ-NP-Za-km-z]{50,}$/.test(s)) return true;
  return false;
}
