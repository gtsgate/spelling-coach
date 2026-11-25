// Search (#/search?q=): live search over the working graph (Arabic, English, automatic English spellings,
// nicknames, lineage, fuzzy "skeleton" matches). The query is kept in the hash with replaceState so the page can be
// shared and survives re-renders. Results are person rows with lineage and years (plus "your cousin" when the
// visitor has said who they are). See docs/SPEC.md §4 (graph.search) and §7.2.
import { h, icon, bdi, debounce } from '../dom.js';
import { t, register, lang } from '../i18n.js';
import { store } from '../store.js';
import { personRow, nameOf } from '../ui.js';
import { findRelationship, relationLabel } from '../core/kinship.js';
import { plural } from './home.js';

/** Element.append without the "null" text nodes it would create for skipped (null/false) children. */
const add = (el, ...kids) => el.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

register({
  en: {
    'search.title': 'Search',
    'search.heading': 'Search the family',
    'search.lead': 'Find anyone in the tree by name — in Arabic or English.',
    'search.label': 'Name to search for',
    'search.placeholder': 'Name in Arabic or English…',
    'search.clear': 'Clear the search',
    'search.tipsTitle': 'Search tips',
    'search.tip1': 'The first name alone is enough; adding the father’s name narrows the results (for example “Muhammad Hassan”).',
    'search.tip2': 'Arabic and English both work, whatever the spelling: Mohamed, Muhammad and محمد find the same people.',
    'search.tip3': 'Nicknames and family names work too (for example “Umm Khalid”).',
    'search.examples': 'Try',
    'search.noneTitle': 'No one found for',
    'search.noneText': 'Check the spelling, or try the first name only. If the person is not in the tree yet, they can be added.',
    'search.addNew': 'Add someone new',
    'search.capped': 'Showing the first {n} results — adding the father’s name narrows the search.',
    'search.short': 'Type at least 2 letters.',
  },
  ar: {
    'search.title': 'بحث',
    'search.heading': 'البحث في العائلة',
    'search.lead': 'الوصول إلى أي فرد في الشجرة باسمه، بالعربية أو بالإنجليزية.',
    'search.label': 'الاسم المطلوب',
    'search.placeholder': 'الاسم بالعربية أو الإنجليزية…',
    'search.clear': 'مسح البحث',
    'search.tipsTitle': 'تلميحات للبحث',
    'search.tip1': 'يكفي الاسم الأول، وإضافة اسم الأب تضيّق النتائج (مثل «محمد حسن»).',
    'search.tip2': 'يعمل البحث بالعربية والإنجليزية مهما اختلف الإملاء: Mohamed وMuhammad ومحمد تصل إلى الأشخاص أنفسهم.',
    'search.tip3': 'يمكن البحث بالكنية أو باسم العائلة أيضاً (مثل «أم خالد»).',
    'search.examples': 'أمثلة',
    'search.noneTitle': 'لا توجد نتائج لـ',
    'search.noneText': 'يُرجى التحقق من الإملاء أو الاكتفاء بالاسم الأول. وإن لم يكن الشخص في الشجرة بعد، فيمكن إضافته.',
    'search.addNew': 'إضافة شخص جديد',
    'search.capped': 'تُعرض أول {n} نتيجة — إضافة اسم الأب تضيّق البحث.',
    'search.short': 'يكفي حرفان أو أكثر.',
  },
});

register({
  en: Object.fromEntries(['zero', 'one', 'two', 'few', 'many', 'other'].map((c) => [`search.n.${c}`, c === 'one' ? '{n} result' : '{n} results'])),
  ar: {
    'search.n.zero': 'لا نتائج',
    'search.n.one': 'نتيجة واحدة',
    'search.n.two': 'نتيجتان',
    'search.n.few': '{n} نتائج',
    'search.n.many': '{n} نتيجة',
    'search.n.other': '{n} نتيجة',
  },
});

const LIMIT = 50;
let hadFocus = false; // keep focus in the box across re-renders (language switch, store events)

function relationMeta(graph, p) {
  if (!store.me || store.me === p.id || !graph.person(store.me)) return null;
  try {
    const rel = findRelationship(graph, store.me, p.id);
    if (!rel || rel.type === 'none' || rel.type === 'self') return null;
    return relationLabel(rel, graph, lang(), { you: true, showDivorce: !!store.config?.showDivorce });
  } catch { return null; }
}

/** A few example queries taken from the data itself (root's name, its English spelling, the family name). */
function examples(graph) {
  const out = [];
  const root = graph.person(graph.meta?.rootPersonId) || graph.people()[0];
  if (!root) return out;
  const kids = graph.children(root.id) || [];
  const child = kids.find((k) => k.nameStatus !== 'withheld' && k.nameStatus !== 'unknown');
  if (child) {
    out.push(`${nameOf(child, 'ar')} ${nameOf(root, 'ar')}`.trim());
    out.push(nameOf(child, 'en'));
  } else {
    out.push(nameOf(root, 'ar'));
  }
  const sur = root.surname?.ar || root.surname?.en;
  if (sur) out.push(sur);
  return [...new Set(out.filter(Boolean))].slice(0, 3);
}

function render(root, query) {
  const graph = store.working;
  let q = typeof query.q === 'string' ? query.q : '';

  const results = h('div', { class: 'search-results', attrs: { 'aria-live': 'polite' } });

  const input = h('input', {
    class: 'input input-lg search-input',
    type: 'search',
    value: q,
    placeholder: t('search.placeholder'),
    autocomplete: 'off',
    spellcheck: false,
    attrs: { 'aria-label': t('search.label'), enterkeyhint: 'search' },
    on: {
      focus: () => { hadFocus = true; },
      blur: () => { hadFocus = false; },
    },
  });

  const clearBtn = h('button', {
    type: 'button', class: 'btn-icon search-clear', hidden: !q,
    attrs: { 'aria-label': t('search.clear'), title: t('search.clear') },
    on: { click: () => { input.value = ''; update(); input.focus(); } },
  }, icon('close', { size: 18 }));

  function setHash(text) {
    const next = text ? `#/search?q=${encodeURIComponent(text)}` : '#/search';
    if (location.hash !== next) history.replaceState(null, '', next);
  }

  function showResults() {
    const text = q.trim();
    results.replaceChildren();
    if (!text) {
      const ex = examples(graph);
      add(results, h('section', { class: 'card search-tips', attrs: { 'aria-labelledby': 'search-tips-title' } },
        h('h2', { id: 'search-tips-title', class: 'search-tips-title' }, icon('info', { size: 20 }), t('search.tipsTitle')),
        h('ul', { class: 'search-tips-list' },
          h('li', null, t('search.tip1')),
          h('li', null, t('search.tip2')),
          h('li', null, t('search.tip3'))),
        ex.length ? h('div', { class: 'search-examples' },
          h('span', { class: 'muted small' }, t('search.examples')),
          ex.map((x) => h('button', {
            type: 'button', class: 'chip',
            on: { click: () => { input.value = x; update(); input.focus(); } },
          }, bdi(x)))) : null));
      return;
    }
    if (text.length < 2 && !graph.person(text)) {
      add(results, h('p', { class: 'muted search-short' }, t('search.short')));
      return;
    }
    let found = [];
    try { found = graph.search(text, { limit: LIMIT }) || []; } catch { found = []; }
    if (!found.length) {
      add(results, h('div', { class: 'card search-none' },
        h('div', { class: 'empty-state' },
          h('h2', null, t('search.noneTitle'), lang() === 'ar' ? '' : ' ', h('bdi', null, lang() === 'ar' ? `«${text}»` : `“${text}”`)),
          h('p', { class: 'muted' }, t('search.noneText')),
          h('a', { class: 'btn btn-primary', href: '#/add-family' }, icon('plus'), t('search.addNew')))));
      return;
    }
    const withRel = found.length <= 30;
    add(results, 
      h('p', { class: 'search-count muted small' }, plural('search.n', found.length)),
      h('ul', { class: 'list search-list' }, found.map(({ person }) => h('li', null,
        personRow(person, {
          meta: withRel ? relationMeta(graph, person) : null,
          trailing: h('span', { class: 'search-go', attrs: { 'aria-hidden': 'true' } }, icon('chevronEnd', { size: 18, className: 'flip-rtl' })),
        })))),
      found.length >= LIMIT ? h('p', { class: 'muted small search-capped' }, t('search.capped', { n: LIMIT })) : null,
      h('p', { class: 'search-add small' },
        h('a', { href: '#/add-family' }, icon('plus', { size: 16 }), t('search.addNew'))));
  }

  const runSoon = debounce(() => showResults(), 140);
  function update() {
    q = input.value;
    clearBtn.hidden = !q;
    setHash(q.trim() ? q : '');
    runSoon();
  }
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = results.querySelector('.search-list a');
      if (first && results.querySelectorAll('.search-list > li').length === 1) first.click();
    } else if (e.key === 'Escape' && input.value) {
      input.value = '';
      update();
    }
  });

  add(root, 
    h('header', { class: 'page-head search-head' },
      h('h1', null, t('search.heading')),
      h('p', { class: 'lead' }, t('search.lead'))),
    h('form', {
      class: 'search-box', role: 'search',
      on: { submit: (e) => e.preventDefault() },
    }, h('span', { class: 'search-box-icon', attrs: { 'aria-hidden': 'true' } }, icon('search', { size: 22 })), input, clearBtn),
    results);

  showResults();
  // Focus the box on arrival (desktop) or when it had focus before a re-render.
  const wide = window.matchMedia?.('(min-width: 761px)').matches;
  if (hadFocus || (wide && !q)) {
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* ignore */ }
    });
  }
}

export default {
  title: (params, query) => (query?.q ? `${t('search.title')}: ${query.q}` : t('search.title')),
  render(root, params, query = {}) {
    render(root, query || {});
  },
};
