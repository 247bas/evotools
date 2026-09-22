// The step machine behind /tokens.
//
// The page has one set of inputs and two layouts. In wizard mode a single step
// is on screen at a time; in "everything" mode the same sections are all
// visible and the stepper is gone. That is why this file moves a class around
// instead of building panels: two layouts over one DOM cannot drift apart the
// way two implementations would.
//
// A step is a `<section data-step="…">`. A flow is the order they come in.
// `identity` and `pick` are shared between mint and send on purpose, so the
// stepper does not renumber when you decide which of the two you are doing.

export const FLOWS = {
  make: ['identity', 'name', 'supply', 'rules', 'review', 'done'],
  mint: ['identity', 'pick', 'mint', 'done'],
  send: ['identity', 'pick', 'send', 'done'],
  holders: ['holders'],
};

export const LABELS = {
  identity: 'Identity',
  name: 'Name',
  supply: 'Supply',
  rules: 'Rules',
  review: 'Publish',
  pick: 'Token',
  mint: 'Mint',
  send: 'Send',
  holders: 'Holders',
  done: 'Done',
};

// Every section the page must carry. `start` is the chooser, which belongs to
// no flow. The smoke test reads this and the HTML and checks they agree.
export const STEPS = ['start', ...new Set(Object.values(FLOWS).flat())];

export function createWizard({ root, stepper, onEnter }) {
  const sections = new Map();
  for (const el of root.querySelectorAll('[data-step]')) sections.set(el.dataset.step, el);

  let flow = null;
  let at = 0;
  let quiet = true;

  const mode = () => root.dataset.mode;
  const current = () => (flow ? FLOWS[flow][at] : 'start');

  function renderStepper() {
    const steps = flow ? FLOWS[flow] : [];
    stepper.hidden = mode() !== 'wizard' || steps.length < 2;
    if (stepper.hidden) { stepper.replaceChildren(); return; }
    stepper.replaceChildren(...steps.map((id, i) => {
      const li = document.createElement('li');
      if (i < at) li.classList.add('done', 'clickable');
      if (i === at) li.classList.add('active');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.textContent = i < at ? '✓' : String(i + 1);
      li.append(dot, document.createTextNode(LABELS[id] ?? id));
      // Only backwards: a step ahead has not been filled in yet.
      if (i < at) li.addEventListener('click', () => { at = i; paint(); });
      return li;
    }));
  }

  function paint() {
    const id = current();
    for (const [name, el] of sections) el.classList.toggle('current', name === id);
    renderStepper();
    if (!quiet) {
      if (mode() === 'wizard') window.scrollTo({ top: 0, behavior: 'smooth' });
      else sections.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    quiet = false;
    onEnter?.(id, flow);
  }

  return {
    get flow() { return flow; },
    get step() { return current(); },
    has: (id) => sections.has(id),

    go(id) {
      if (id === 'start') { flow = null; at = 0; paint(); return; }
      if (!flow || !FLOWS[flow].includes(id)) {
        flow = Object.keys(FLOWS).find((f) => FLOWS[f].includes(id)) ?? flow;
      }
      at = Math.max(0, FLOWS[flow].indexOf(id));
      paint();
    },

    // Mint and send share their first two steps, so switching between them
    // keeps the position instead of restarting.
    setFlow(f, id) {
      flow = f;
      at = id ? Math.max(0, FLOWS[f].indexOf(id)) : Math.min(at, FLOWS[f].length - 1);
      paint();
    },

    next() {
      if (!flow) return;
      at = Math.min(at + 1, FLOWS[flow].length - 1);
      paint();
    },

    back() {
      if (!flow || at === 0) { flow = null; at = 0; }
      else at -= 1;
      paint();
    },

    setMode(m) {
      root.dataset.mode = m;
      if (m === 'wizard' && !flow) { at = 0; }
      paint();
    },
  };
}
