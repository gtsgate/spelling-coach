// "How are we related?" (#/relationship/:a?/:b?): two person pickers (the first defaults to "me"), the relation
// named in a full sentence in the current language, the reverse relation, the path drawn as a chain of person chips
// with the step between each pair, a swap button and a shareable link. See docs/SPEC.md §4 (kinship) and §7.2.
// Also exports relationSentence() used by the home and "my page" views.
import { h, icon, bdi, toast, copyText } from '../dom.js';
import { t, register, lang } from '../i18n.js';
import { store } from '../store.js';
import { nameOf, lineageOf, avatar, nameLabel, personChip, yearsOf, badges, whatsappUrl } from '../ui.js';
import { personPicker } from '../forms/picker.js';
import { navigate } from '../app.js';
import { findRelationship, relationLabel, pathSteps } from '../core/kinship.js';

register({
  en: {
    'rel.title': 'How are we related?',
    'rel.lead': 'Choose two people to see how they are related, step by step.',
    'rel.you': 'You',
    'rel.first': 'First person',
    'rel.second': 'Second person',
    'rel.pickPlaceholder': 'Type a name…',
    'rel.change': 'Change',
    'rel.cancel': 'Cancel',
    'rel.swap': 'Swap the two people',
    'rel.profile': 'Open profile',
    'rel.isRel': '{name} is {rel}',
    'rel.youAre': 'and you are {rel}',
    'rel.theyAre': 'and {name} is {rel}',
    'rel.selfYou': 'This is you.',
    'rel.self': 'Both are the same person.',
    'rel.noneYou': 'No family link between you and {name} is recorded yet.',
    'rel.none': 'No family link between {a} and {b} is recorded yet.',
    'rel.noneHint': 'If they are related, adding the missing parents or spouses will reveal the link.',
    'rel.pathTitle': 'The family link, step by step',
    'rel.pathHint': 'Each step says who the next person is to the one before.',
    'rel.stepOf': '{role} of the person above',
    'rel.commonAncestor': 'Common ancestor',
    'rel.copyLink': 'Copy link',
    'rel.linkCopied': 'Link copied — it opens this comparison directly.',
    'rel.shareWhatsApp': 'Share on WhatsApp',
    'rel.shareText': '{sentence}\nSee how on our family tree: {link}',
    'rel.viewTree': 'View in the tree',
    'rel.addFamily': 'Add missing relatives',
    'rel.notFound': 'This person is no longer in the tree.',
    'rel.pickBoth': 'Choose a second person to compare.',
    'rel.meHint': 'Tip: once your own name is chosen on the home page, it is filled in here automatically.',
  },
  ar: {
    'rel.title': 'ما صلة القرابة؟',
    'rel.lead': 'اختيار شخصين لمعرفة صلة القرابة بينهما خطوةً بخطوة.',
    'rel.you': 'أنت',
    'rel.first': 'الشخص الأول',
    'rel.second': 'الشخص الثاني',
    'rel.pickPlaceholder': 'كتابة الاسم…',
    'rel.change': 'تغيير',
    'rel.cancel': 'إلغاء',
    'rel.swap': 'تبديل الشخصين',
    'rel.profile': 'فتح الصفحة',
    'rel.isRel': '{name} {pronoun} {rel}',
    'rel.youAre': 'وأنت: {rel}',
    'rel.theyAre': 'و{name}: {rel}',
    'rel.selfYou': 'هذا الاسم هو اسمك.',
    'rel.self': 'الاسمان لشخص واحد.',
    'rel.noneYou': 'لا توجد بعدُ صلة قرابة مسجّلة بينك وبين {name}.',
    'rel.none': 'لا توجد بعدُ صلة قرابة مسجّلة بين {a} و{b}.',
    'rel.noneHint': 'إن كانت بينهما قرابة، فإضافة الوالدين أو الأزواج الناقصين تكشف الصلة.',
    'rel.pathTitle': 'صلة القرابة خطوةً بخطوة',
    'rel.pathHint': 'كل خطوة تبيّن صلة الشخص التالي بالشخص الذي قبله.',
    'rel.stepOf': '{role} الشخص السابق',
    'rel.commonAncestor': 'الجدّ المشترك',
    'rel.copyLink': 'نسخ الرابط',
    'rel.linkCopied': 'نُسخ الرابط — يفتح هذه المقارنة مباشرة.',
    'rel.shareWhatsApp': 'مشاركة عبر واتساب',
    'rel.shareText': '{sentence}\nالتفاصيل في شجرة العائلة: {link}',
    'rel.viewTree': 'العرض في الشجرة',
    'rel.addFamily': 'إضافة الأقارب الناقصين',
    'rel.notFound': 'هذا الشخص لم يعد موجوداً في الشجرة.',
    'rel.pickBoth': 'اختيار شخص ثانٍ للمقارنة.',
    'rel.meHint': 'بعد اختيار اسمك في الصفحة الرئيسية، يظهر هنا تلقائياً.',
  },
});

/** هو / هي for a person (Arabic sentences); '' when the gender is unknown. */
function pronoun(person) {
  return person?.gender === 'm' ? 'هو' : person?.gender === 'f' ? 'هي' : '';
}

/** "Ahmed is your paternal uncle" / "أحمد هو عمّك" from a relation label. */
function isSentence(bPerson, label) {
  const name = nameOf(bPerson);
  if (lang() === 'ar') {
    const pr = pronoun(bPerson);
    return pr ? t('rel.isRel', { name, pronoun: pr, rel: label }) : `${name}: ${label}`;
  }
  return t('rel.isRel', { name, rel: label, pronoun: '' });
}

/**
 * Describe what b is to a in one sentence.
 *   you: true → "Ahmed is your paternal uncle"; false → "Ahmed is Khalid's paternal uncle".
 * Returns {rel, label, text, type}.
 */
export function relationSentence(graph, aId, bId, { you = aId === store.me } = {}) {
  const a = graph.person(aId);
  const b = graph.person(bId);
  if (!a || !b) return { rel: null, label: '', text: '', type: 'none' };
  let rel = null;
  try { rel = findRelationship(graph, aId, bId); } catch { rel = null; }
  if (!rel || rel.type === 'self') {
    return { rel, label: '', type: rel ? 'self' : 'none', text: rel ? t(you ? 'rel.selfYou' : 'rel.self') : '' };
  }
  if (rel.type === 'none') {
    return { rel, label: '', type: 'none', text: you ? t('rel.noneYou', { name: nameOf(b) }) : t('rel.none', { a: nameOf(a), b: nameOf(b) }) };
  }
  const label = relationLabel(rel, graph, lang(), { you, name: nameOf(a), showDivorce: !!store.config?.showDivorce });
  return { rel, label, type: rel.type, text: isSentence(b, label) };
}

// ---------------------------------------------------------------------------------------------------------
// View

let editing = null; // 'a' | 'b' | null — which slot shows its picker although a person is chosen

const clean = (v) => (v && v !== '_' && v !== '-' ? v : null);

function hashFor(a, b) {
  const enc = encodeURIComponent;
  if (a && b) return `#/relationship/${enc(a)}/${enc(b)}`;
  if (a) return `#/relationship/${enc(a)}`;
  if (b) return `#/relationship/_/${enc(b)}`;
  return '#/relationship';
}

function go(a, b) {
  editing = null;
  navigate(hashFor(a, b));
}

function slot({ which, person, missing, label, other, onPick }) {
  const showPicker = !person || editing === which;
  const head = h('div', { class: 'rel-slot-label' },
    h('span', { class: 'rel-slot-letter', attrs: { 'aria-hidden': 'true' } }, which === 'a' ? '1' : '2'),
    h('span', null, label));
  let body;
  if (showPicker) {
    const picker = personPicker({
      label: '',
      placeholder: t('rel.pickPlaceholder'),
      near: other || store.me || null,
      autofocus: editing === which,
      onPick: (p) => onPick(p.id),
    });
    picker.querySelector('input')?.setAttribute('aria-label', label);
    body = h('div', { class: 'rel-slot-picker' },
      missing ? h('p', { class: 'notice notice-warning small' }, icon('warning'), h('span', null, t('rel.notFound'))) : null,
      picker,
      person ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => { editing = null; navigate(location.hash); } } }, t('rel.cancel')) : null);
  } else {
    body = h('div', { class: 'rel-person' },
      avatar(person, { size: 'lg' }),
      h('div', { class: 'rel-person-text' },
        h('a', { class: 'rel-person-name', href: `#/p/${encodeURIComponent(person.id)}` }, nameLabel(person, { other: true })),
        lineageOf(person) !== nameOf(person) ? bdi(lineageOf(person), { class: 'rel-person-lineage muted small' }) : null,
        yearsOf(person) ? h('span', { class: 'muted small' }, yearsOf(person)) : null,
        h('span', { class: 'rel-person-badges' }, ...badges(person))),
      h('button', { type: 'button', class: 'btn btn-sm rel-change', on: { click: () => { editing = which; navigate(location.hash); } } }, icon('edit', { size: 16 }), t('rel.change')));
  }
  return h('section', { class: ['rel-slot', `rel-slot-${which}`, person ? 'is-set' : ''], attrs: { 'aria-label': label } }, head, body);
}

function chain(rel, graph) {
  let steps = [];
  try { steps = pathSteps(rel, graph, lang()); } catch { steps = []; }
  if (!steps.length) return null;
  return h('ol', { class: 'rel-chain' }, steps.map((s, i) => {
    const p = s.person || graph.person(s.id);
    return h('li', { class: 'rel-chain-step' },
      i > 0 ? h('div', { class: 'rel-chain-link' },
        h('span', { class: 'rel-chain-line', attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'rel-chain-role' }, h('span', { class: 'sr-only' }, t('rel.stepOf', { role: s.role })), h('span', { attrs: { 'aria-hidden': 'true' } }, s.role)),
        h('span', { class: 'rel-chain-line', attrs: { 'aria-hidden': 'true' } })) : null,
      p ? personChip(p, { years: false, other: false }) : null);
  }));
}

function result(graph, aP, bP) {
  const you = aP.id === store.me;
  const main = relationSentence(graph, aP.id, bP.id, { you });
  const back = main.type !== 'none' && main.type !== 'self' ? relationSentence(graph, bP.id, aP.id, { you: false }) : null;
  const link = store.siteLink(hashFor(aP.id, bP.id));

  let reverse = null;
  if (back && back.label) {
    reverse = you ? t('rel.youAre', { rel: back.label }) : t('rel.theyAre', { name: nameOf(aP), rel: back.label });
  }

  const lca = main.rel && main.type === 'blood' && main.rel.lca && main.rel.up > 0 && main.rel.down > 0 && main.rel.lca !== aP.id && main.rel.lca !== bP.id
    ? graph.person(main.rel.lca) : null;

  const headline = h('div', { class: ['card', 'rel-result', `rel-result-${main.type}`], attrs: { 'aria-live': 'polite' } },
    h('div', { class: 'rel-result-avatars', attrs: { 'aria-hidden': 'true' } }, avatar(bP, { size: 'lg' }), avatar(aP, { size: 'lg' })),
    h('p', { class: 'rel-headline' }, bdi(main.text)),
    reverse ? h('p', { class: 'rel-reverse muted' }, bdi(reverse)) : null,
    main.type === 'none' ? h('p', { class: 'muted small rel-none-hint' }, t('rel.noneHint')) : null,
    lca ? h('div', { class: 'rel-lca' }, h('span', { class: 'muted small' }, t('rel.commonAncestor')), personChip(lca, { years: false })) : null,
    h('div', { class: 'rel-actions row' },
      h('button', {
        type: 'button', class: 'btn btn-sm',
        on: { click: async () => { const ok = await copyText(link); toast(ok ? t('rel.linkCopied') : link, { type: ok ? 'success' : 'info' }); } },
      }, icon('link', { size: 16 }), t('rel.copyLink')),
      main.text && main.type !== 'self'
        ? h('a', { class: 'btn btn-sm', href: whatsappUrl(t('rel.shareText', { sentence: main.text, link })), target: '_blank', rel: 'noopener' }, icon('whatsapp', { size: 16 }), t('rel.shareWhatsApp'))
        : null,
      main.type === 'none'
        ? h('a', { class: 'btn btn-sm btn-ghost', href: `#/add-family?near=${encodeURIComponent(bP.id)}` }, icon('plus', { size: 16 }), t('rel.addFamily'))
        : h('a', { class: 'btn btn-sm btn-ghost', href: `#/tree/${encodeURIComponent((lca || aP).id)}` }, icon('tree', { size: 16 }), t('rel.viewTree'))));

  const path = main.rel && (main.type !== 'none' && main.type !== 'self') ? chain(main.rel, graph) : null;
  const pathCard = path ? h('section', { class: 'card rel-path', attrs: { 'aria-labelledby': 'rel-path-title' } },
    h('h2', { id: 'rel-path-title', class: 'rel-path-title' }, t('rel.pathTitle')),
    h('p', { class: 'muted small' }, t('rel.pathHint')),
    path) : null;

  return h('div', { class: ['rel-results', pathCard ? 'has-path' : ''] }, headline, pathCard);
}

function render(root, params) {
  const graph = store.working;
  const rawA = clean(params.a);
  const rawB = clean(params.b);
  const aId = rawA || (store.me && graph.person(store.me) ? store.me : null);
  const resolveP = (id) => {
    if (!id) return null;
    let p = graph.person(id);
    if (!p && graph.resolve) { try { p = graph.resolve(id); } catch { p = null; } if (p && p.removed) p = null; }
    return p;
  };
  const aP = resolveP(aId);
  const bP = resolveP(rawB);
  if (editing === 'a' && !aP) editing = null;
  if (editing === 'b' && !bP) editing = null;

  const aLabel = aP && aP.id === store.me ? t('rel.you') : t('rel.first');

  const pickers = h('div', { class: 'rel-pickers' },
    slot({ which: 'a', person: aP, missing: !!aId && !aP, label: aLabel, other: bP?.id, onPick: (id) => go(id, bP?.id || null) }),
    h('div', { class: 'rel-swap-wrap' },
      h('button', {
        type: 'button', class: 'btn btn-icon rel-swap', disabled: !(aP || bP),
        attrs: { 'aria-label': t('rel.swap'), title: t('rel.swap') },
        on: { click: () => go(bP?.id || null, aP?.id || null) },
      }, icon('move', { size: 20 }))),
    slot({ which: 'b', person: bP, missing: !!rawB && !bP, label: t('rel.second'), other: aP?.id, onPick: (id) => go(aP?.id || null, id) }));

  root.append(
    h('header', { class: 'page-head rel-head' },
      h('h1', null, t('rel.title')),
      h('p', { class: 'lead' }, t('rel.lead'))),
    pickers);

  if (aP && bP) root.append(result(graph, aP, bP));
  else {
    root.append(h('p', { class: 'rel-waiting muted' },
      icon('info', { size: 18 }), h('span', null, aP ? t('rel.pickBoth') : (store.me ? t('rel.lead') : t('rel.meHint')))));
  }
}

export default {
  title: () => t('rel.title'),
  render(root, params = {}) {
    render(root, params);
  },
};
