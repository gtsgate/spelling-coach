// Person picker: search-as-you-type over the working graph (Arabic, English, transliterations).
//
//   const el = personPicker({
//     label: t('…'),                 // visible label (optional)
//     placeholder: t('…'),
//     onPick: (person) => {…},       // called when a person is chosen (click / Enter)
//     filter: (person) => true,      // optional: exclude people (e.g. self, existing spouses)
//     near: personId,                // optional: rank people in this person's family first
//     autofocus: true,
//     limit: 8,
//   });
//   el.focus(); el.clear(); el.value (current query)
import { h, icon, debounce } from '../dom.js';
import { t, register } from '../i18n.js';
import { store } from '../store.js';
import { personRow } from '../ui.js';

register({
  en: {
    'picker.placeholder': 'Type a name in Arabic or English…',
    'picker.noResults': 'No one found with that name.',
    'picker.hint': 'Type at least 2 letters',
    'picker.results': '{n} results',
  },
  ar: {
    'picker.placeholder': 'البحث بالاسم بالعربية أو الإنجليزية…',
    'picker.noResults': 'لا يوجد أحد بهذا الاسم.',
    'picker.hint': 'يكفي حرفان أو أكثر',
    'picker.results': '{n} نتيجة',
  },
});

let pickerSeq = 0;

/** Family neighbourhood of `id` (ancestors, descendants, their spouses) for ranking. */
export function neighbourhood(graph, id) {
  const near = new Set();
  if (!id || !graph.person(id)) return near;
  const add = (pid) => {
    near.add(pid);
    for (const s of graph.spouses(pid) || []) near.add(s.person.id);
  };
  add(id);
  for (const pid of graph.ancestors(id).keys()) add(pid);
  // Descendants of the two nearest generations of ancestors (siblings, cousins, uncles…).
  const anc = [...graph.ancestors(id).entries()].filter(([, d]) => d <= 2).map(([pid]) => pid);
  for (const a of [id, ...anc]) for (const pid of graph.descendants(a).keys()) add(pid);
  return near;
}

export function personPicker({ label = '', placeholder = t('picker.placeholder'), onPick, filter = null, near = null, autofocus = false, limit = 8 } = {}) {
  const id = `picker-${++pickerSeq}`;
  const listId = `${id}-list`;
  let results = [];
  let active = -1;

  const input = h('input', {
    id,
    class: 'input picker-input',
    type: 'search',
    autocomplete: 'off',
    spellcheck: false,
    placeholder,
    attrs: { role: 'combobox', 'aria-expanded': 'false', 'aria-controls': listId, 'aria-autocomplete': 'list', enterkeyhint: 'search' },
  });
  if (autofocus) input.autofocus = true;
  const list = h('ul', { id: listId, class: 'picker-list list', attrs: { role: 'listbox' }, hidden: true });
  const status = h('div', { class: 'picker-status muted small', attrs: { 'aria-live': 'polite' } });

  function choose(i) {
    const p = results[i];
    if (!p) return;
    if (onPick) onPick(p);
  }

  function setActive(i) {
    active = i;
    [...list.children].forEach((li, idx) => {
      li.classList.toggle('active', idx === i);
      li.setAttribute('aria-selected', idx === i ? 'true' : 'false');
    });
    const el = list.children[i];
    if (el) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
  }

  function run() {
    const q = input.value.trim();
    list.replaceChildren();
    active = -1;
    input.removeAttribute('aria-activedescendant');
    if (q.length < 2) {
      results = [];
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      status.textContent = q.length ? t('picker.hint') : '';
      return;
    }
    const graph = store.working;
    let found = (graph.search(q, { limit: 60 }) || []).map((r) => ({ person: r.person, score: r.score }));
    if (filter) found = found.filter((r) => filter(r.person));
    if (near) {
      const hood = neighbourhood(graph, near);
      found.forEach((r) => { if (hood.has(r.person.id)) r.score += 1000; });
      found.sort((a, b) => b.score - a.score);
    }
    results = found.slice(0, limit).map((r) => r.person);
    if (!results.length) {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      status.textContent = t('picker.noResults');
      return;
    }
    status.textContent = t('picker.results', { n: results.length });
    results.forEach((p, i) => {
      const row = personRow(p, { href: '' });
      const li = h('li', {
        id: `${id}-opt-${i}`,
        class: 'picker-option',
        attrs: { role: 'option', 'aria-selected': 'false' },
        on: {
          mousedown: (e) => e.preventDefault(), // keep focus in the input
          click: () => choose(i),
        },
      }, row);
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  const runSoon = debounce(run, 120);
  input.addEventListener('input', runSoon);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) setActive(Math.min(results.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) setActive(Math.max(0, active - 1)); }
    else if (e.key === 'Enter') {
      if (active >= 0) { e.preventDefault(); choose(active); }
      else if (results.length === 1) { e.preventDefault(); choose(0); }
    } else if (e.key === 'Escape') { input.value = ''; run(); }
  });

  const wrap = h('div', { class: 'picker' },
    label ? h('label', { class: 'field-label', for: id }, label) : null,
    h('div', { class: 'picker-box' }, icon('search', { size: 18, className: 'picker-icon' }), input),
    status,
    list);
  wrap.focus = () => input.focus();
  wrap.clear = () => { input.value = ''; run(); };
  Object.defineProperty(wrap, 'value', { get: () => input.value, set: (v) => { input.value = v; run(); } });
  return wrap;
}
