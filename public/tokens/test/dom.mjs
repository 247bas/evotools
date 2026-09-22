// A DOM small enough to boot a static page and press its buttons.
//
// This exists because there is no browser here and /tokens now hides most of
// itself: a step that never becomes current, or a button wired to an id that
// was renamed, is invisible to a test that only reads the files. So page.mjs
// loads index.html, runs app.js against this, and clicks through.
//
// It is not a browser. It knows attributes, ids, classes, events and children —
// what this page uses — and nothing about layout, CSS or bubbling. A selector
// it has not been taught throws rather than quietly matching nothing.
import { readFile } from 'node:fs/promises';

class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.listeners = {};
    this.value = attrs.value ?? '';
    this.checked = 'checked' in attrs;
    this.disabled = 'disabled' in attrs;
    this.hidden = 'hidden' in attrs;
    this.textContent = '';
    this.type = attrs.type ?? '';
    this.href = attrs.href ?? '';
    const classes = new Set((attrs.class ?? '').split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => { const on = force ?? !classes.has(c); on ? classes.add(c) : classes.delete(c); return on; },
      get size() { return classes.size; },
    };
    this._classes = classes;
    this.dataset = new Proxy({}, {
      get: (_, k) => this.attrs[`data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`],
      set: (_, k, v) => { this.attrs[`data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`] = v; return true; },
      has: (_, k) => `data-${String(k)}` in this.attrs,
    });
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes.clear(); v.split(/\s+/).filter(Boolean).forEach((c) => this._classes.add(c)); }
  get childElementCount() { return this.children.length; }
  append(...kids) { for (const k of kids) this.children.push(k); }
  replaceChildren(...kids) { this.children = [...kids]; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatch(type, ev = {}) { for (const fn of this.listeners[type] ?? []) fn(ev); }
  click() { this.dispatch('click', { target: this }); }
  focus() {}
  scrollIntoView() {}
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) { return DOC.all.filter((e) => matches(e, sel)); }
  get text() { return this.textContent || this.children.map((c) => c.text ?? '').join(' '); }
}

function matches(el, sel) {
  const attr = sel.match(/^\[([a-z-]+)(?:="([^"]*)")?\]$/);
  if (attr) return attr[2] === undefined ? attr[1] in el.attrs : el.attrs[attr[1]] === attr[2];
  throw new Error(`the shim does not know the selector ${sel}`);
}

const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'path', 'circle', 'rect', 'hr']);
let DOC;

export async function loadPage(htmlPath, { search = '', storage = {} } = {}) {
  const html = (await readFile(htmlPath, 'utf8')).replace(/<!--[\s\S]*?-->/g, '');
  const all = [];
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/g)) {
    const [, tag, raw] = m;
    if (VOID.has(tag.toLowerCase()) && !raw.includes('id=')) continue;
    const attrs = {};
    for (const a of raw.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
    all.push(new El(tag, attrs));
  }
  DOC = {
    all,
    getElementById: (id) => all.find((e) => e.attrs.id === id) ?? null,
    createElement: (tag) => new El(tag),
    createTextNode: (t) => ({ text: t, textContent: t, children: [] }),
    querySelector: (s) => all.find((e) => matches(e, s)) ?? null,
    querySelectorAll: (s) => all.filter((e) => matches(e, s)),
    addEventListener: () => {},
  };
  globalThis.document = DOC;
  globalThis.window = { scrollTo: () => {}, addEventListener: () => {} };
  globalThis.location = { search };
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });
  const store = { ...storage };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  return DOC;
}
