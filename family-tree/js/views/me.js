// My page (#/me): who I am (choose / change / forget on this device), my proposals (draft, sent — awaiting approval,
// no longer applies, approved) with a "forget" action, my close family (parents, spouses, children, siblings) and
// "help complete the tree" tasks near me. Also a small display preference (digits). See docs/SPEC.md §7.2, §7.3, §7.9.
import { h, icon, bdi, toast, confirmDialog } from '../dom.js';
import { t, register, lang, intlLocale } from '../i18n.js';
import { store } from '../store.js';
import { nameOf, lineageOf, avatar, nameLabel, personChip, yearsOf, badges, sectionTitle, ownerName } from '../ui.js';
import { personPicker } from '../forms/picker.js';
import { describeProposal } from '../core/describe.js';
import { helpList, openDialog, plural } from './home.js';

/** Element.append without the "null" text nodes it would create for skipped (null/false) children. */
const add = (el, ...kids) => el.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

register({
  en: {
    'me.title': 'My page',
    'me.lead': 'Your place in the tree, your suggestions and the relatives closest to you.',
    'me.whoTitle': 'Who are you?',
    'me.whoText': 'Choosing your name lets every page show how people are related to you. It is remembered on this device only.',
    'me.whoLabel': 'Your name in the tree',
    'me.notListed': 'Not in the tree yet?',
    'me.addSelf': 'Add yourself and your family',
    'me.thisIsMe': 'This is you',
    'me.profile': 'Open my profile',
    'me.tree': 'My branch of the tree',
    'me.change': 'Change',
    'me.cancel': 'Cancel',
    'me.forgetMe': 'Forget me on this device',
    'me.forgetMeTitle': 'Forget who you are?',
    'me.forgetMeText': 'Pages will no longer show relations from your point of view. Nothing in the tree changes.',
    'me.forgetMeDone': 'Done — this device no longer knows who you are.',
    'me.meSet': 'Welcome, {name}!',
    'me.howRelated': 'How are we related?',
    'me.proposalsTitle': 'My suggestions',
    'me.proposalsEmpty': 'No suggestions yet. Anything added or corrected in the tree appears here until it is approved.',
    'me.draftTitle': 'Not sent yet',
    'me.draftText': '{changes} waiting on this device. {owner} sees them only once they are sent.',
    'me.approvedFallback': 'Your suggestion was approved and is now on the tree.',
    'me.draftOpen': 'Review & send',
    'me.status.sent': 'Sent — awaiting approval',
    'me.status.stale': 'No longer applies',
    'me.status.approved': 'Approved',
    'me.staleHelp': 'The tree changed since this was sent, so it can no longer be applied as it is and is hidden from the tree. Perhaps {owner} has already handled it; if not, it can be suggested again.',
    'me.sentOn': 'Sent {date}',
    'me.via': 'via {via}',
    'me.via.whatsapp': 'WhatsApp',
    'me.via.github': 'GitHub',
    'me.via.email': 'email',
    'me.via.copy': 'copied code',
    'me.approvedOn': 'Approved {date}',
    'me.request': 'Request #{n}',
    'me.details': 'Show the changes',
    'me.moreLines': 'and {n} more',
    'me.forget': 'Forget',
    'me.forgetTitle': 'Forget this suggestion?',
    'me.forgetSentText': 'It is removed from this device and its changes stop showing on the tree here. If it was already sent, {owner} still has the message.',
    'me.forgetApprovedText': 'It is only removed from this list; the approved changes stay in the tree.',
    'me.forgotten': 'Removed from this device.',
    'me.familyTitle': 'My close family',
    'me.parents': 'Parents',
    'me.spouses': 'Spouses',
    'me.children': 'Children',
    'me.siblings': 'Brothers and sisters',
    'me.siblingsFather': 'Through the father',
    'me.siblingsMother': 'Through the mother',
    'me.noneYet': 'None recorded yet',
    'me.addRelative': 'Add a relative',
    'me.addFamily': 'Add my family',
    'me.helpTitle': 'Help complete the tree',
    'me.helpLead': 'Relatives close to you whose details are still missing. Anything you know helps.',
    'me.prefsTitle': 'Display',
    'me.digits': 'Numbers',
    'me.digitsLatn': '123',
    'me.digitsArab': '١٢٣',
    'me.prefsHint': 'Text size, language and dark mode are in the top bar.',
  },
  ar: {
    'me.title': 'صفحتي',
    'me.lead': 'مكانك في الشجرة، واقتراحاتك، وأقرب الناس إليك.',
    'me.whoTitle': 'من أنت؟',
    'me.whoText': 'باختيار اسمك تُظهر كل صفحة صلة القرابة بينك وبين الآخرين. ويُحفظ هذا الاختيار على هذا الجهاز فقط.',
    'me.whoLabel': 'اسمك في الشجرة',
    'me.notListed': 'لا يظهر اسمك في الشجرة؟',
    'me.addSelf': 'إضافة نفسك وعائلتك',
    'me.thisIsMe': 'هذا أنت',
    'me.profile': 'فتح صفحتي',
    'me.tree': 'فرعي في الشجرة',
    'me.change': 'تغيير',
    'me.cancel': 'إلغاء',
    'me.forgetMe': 'نسيان هويتي على هذا الجهاز',
    'me.forgetMeTitle': 'نسيان هويتك؟',
    'me.forgetMeText': 'لن تُعرض صلات القرابة بالنسبة إليك بعد الآن، ولن يتغيّر شيء في الشجرة.',
    'me.forgetMeDone': 'تمّ — لم يعد هذا الجهاز يعرف هويتك.',
    'me.meSet': 'أهلاً بك يا {name}!',
    'me.howRelated': 'ما صلة القرابة؟',
    'me.proposalsTitle': 'اقتراحاتي',
    'me.proposalsEmpty': 'لا توجد اقتراحات بعد. كل إضافة أو تصحيح في الشجرة يظهر هنا حتى تتمّ الموافقة عليه.',
    'me.draftTitle': 'لم يُرسل بعد',
    'me.draftText': 'على هذا الجهاز {changes} بانتظار الإرسال، ولن يطّلع عليها {owner} إلا بعد إرسالها.',
    'me.approvedFallback': 'تمّت الموافقة على اقتراحك، وأصبح ظاهراً في الشجرة.',
    'me.draftOpen': 'مراجعة وإرسال',
    'me.status.sent': 'أُرسل — بانتظار الموافقة',
    'me.status.stale': 'لم يعد قابلاً للتطبيق',
    'me.status.approved': 'تمّت الموافقة',
    'me.staleHelp': 'تغيّرت الشجرة منذ إرسال هذا الاقتراح، فلم يعد تطبيقه ممكناً كما هو، ولذلك أُخفي من الشجرة. ربما عالجه {owner} بالفعل، وإلا فيمكن اقتراحه من جديد.',
    'me.sentOn': 'أُرسل في {date}',
    'me.via': 'عبر {via}',
    'me.via.whatsapp': 'واتساب',
    'me.via.github': 'GitHub',
    'me.via.email': 'البريد الإلكتروني',
    'me.via.copy': 'نسخ الرمز',
    'me.approvedOn': 'تمّت الموافقة في {date}',
    'me.request': 'الطلب رقم {n}',
    'me.details': 'عرض التعديلات',
    'me.moreLines': 'و{n} غيرها',
    'me.forget': 'نسيان',
    'me.forgetTitle': 'نسيان هذا الاقتراح؟',
    'me.forgetSentText': 'سيُزال من هذا الجهاز ولن تظهر تعديلاته في الشجرة هنا. وإن كان قد أُرسل فالرسالة ما زالت لدى {owner}.',
    'me.forgetApprovedText': 'سيُزال من هذه القائمة فقط، وتبقى التعديلات المعتمدة في الشجرة.',
    'me.forgotten': 'أُزيل من هذا الجهاز.',
    'me.familyTitle': 'أقرب الناس إليّ',
    'me.parents': 'الوالدان',
    'me.spouses': 'الأزواج',
    'me.children': 'الأبناء',
    'me.siblings': 'الإخوة والأخوات',
    'me.siblingsFather': 'من جهة الأب',
    'me.siblingsMother': 'من جهة الأم',
    'me.noneYet': 'لم يُسجَّل أحد بعد',
    'me.addRelative': 'إضافة قريب',
    'me.addFamily': 'إضافة عائلتي',
    'me.helpTitle': 'المساعدة في إكمال الشجرة',
    'me.helpLead': 'أقارب قريبون منك ما زالت بعض معلوماتهم ناقصة. كل معلومة لديك تساعد.',
    'me.prefsTitle': 'طريقة العرض',
    'me.digits': 'الأرقام',
    'me.digitsLatn': '123',
    'me.digitsArab': '١٢٣',
    'me.prefsHint': 'حجم الخط واللغة والوضع الليلي في الشريط العلوي.',
  },
});

register({
  en: Object.fromEntries(['zero', 'one', 'two', 'few', 'many', 'other'].map((c) => [`me.n.changes.${c}`, c === 'one' ? '{n} change' : '{n} changes'])),
  ar: {
    'me.n.changes.zero': 'لا تعديلات',
    'me.n.changes.one': 'تعديل واحد',
    'me.n.changes.two': 'تعديلان',
    'me.n.changes.few': '{n} تعديلات',
    'me.n.changes.many': '{n} تعديلاً',
    'me.n.changes.other': '{n} تعديل',
  },
});

let choosing = false; // the "change who I am" picker is open (module state survives re-renders)

const enc = encodeURIComponent;

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  try { return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(d); } catch { return iso.slice(0, 10); }
}

function viaLabel(via) {
  const k = `me.via.${via}`;
  const s = t(k);
  return s === k ? String(via || '') : s;
}

// ---------------------------------------------------------------------------------------------------------
// Who I am

function whoSection(graph) {
  const me = store.me ? graph.person(store.me) : null;
  const picker = () => personPicker({
    label: t('me.whoLabel'),
    near: store.me || null,
    onPick: (p) => {
      choosing = false;
      store.setMe(p.id);
      toast(t('me.meSet', { name: nameOf(p) }), { type: 'success' });
    },
  });

  if (!me || choosing) {
    const pk = picker();
    if (choosing) requestAnimationFrame(() => pk.focus());
    return h('section', { class: 'card card-accent me-who', attrs: { 'aria-labelledby': 'me-who-title' } },
      h('div', { class: 'me-who-intro' },
        h('span', { class: 'me-who-icon', attrs: { 'aria-hidden': 'true' } }, icon('user', { size: 26 })),
        h('div', null,
          h('h2', { id: 'me-who-title' }, t('me.whoTitle')),
          h('p', { class: 'muted' }, t('me.whoText')))),
      pk,
      h('div', { class: 'row me-who-foot' },
        h('p', { class: 'small' }, h('span', { class: 'muted' }, t('me.notListed')), ' ', h('a', { href: '#/add-family' }, t('me.addSelf'))),
        me ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => { choosing = false; rerender(); } } }, t('me.cancel')) : null));
  }

  const lin = lineageOf(me);
  const years = yearsOf(me);
  return h('section', { class: 'card card-accent me-who is-set', attrs: { 'aria-labelledby': 'me-who-title' } },
    h('div', { class: 'me-id' },
      avatar(me, { size: 'lg' }),
      h('div', { class: 'me-id-text' },
        h('p', { class: 'me-id-eyebrow small' }, t('me.thisIsMe')),
        h('h2', { id: 'me-who-title', class: 'me-id-name' }, nameLabel(me, { other: true })),
        lin !== nameOf(me) ? bdi(lin, { class: 'me-id-lineage muted' }) : null,
        years ? h('span', { class: 'me-id-years muted small' }, years) : null,
        h('div', { class: 'me-id-badges' }, ...badges(me).filter((b) => !b.classList.contains('badge-me'))))),
    h('div', { class: 'me-id-actions' },
      h('a', { class: 'btn btn-primary btn-sm', href: `#/p/${enc(me.id)}` }, icon('user', { size: 16 }), t('me.profile')),
      h('a', { class: 'btn btn-sm', href: `#/tree/${enc(me.id)}` }, icon('tree', { size: 16 }), t('me.tree')),
      h('a', { class: 'btn btn-sm', href: `#/relationship/${enc(me.id)}` }, icon('users', { size: 16 }), t('me.howRelated')),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => { choosing = true; rerender(); } } }, icon('edit', { size: 16 }), t('me.change')),
      h('button', {
        type: 'button', class: 'btn btn-sm btn-ghost me-forget-me',
        on: {
          click: async () => {
            const ok = await confirmDialog({ title: t('me.forgetMeTitle'), message: t('me.forgetMeText'), confirmLabel: t('me.forgetMe') });
            if (!ok) return;
            choosing = false;
            store.setMe(null);
            toast(t('me.forgetMeDone'));
          },
        },
      }, t('me.forgetMe'))));
}

// ---------------------------------------------------------------------------------------------------------
// My suggestions

function linesBlock(lines) {
  if (!lines.length) return null;
  const max = 10;
  return h('details', { class: 'me-prop-details' },
    h('summary', null, icon('chevronDown', { size: 16, className: 'me-prop-chev' }), h('span', null, t('me.details'))),
    h('ol', { class: 'me-prop-lines' }, lines.slice(0, max).map((l) => h('li', null, bdi(l)))),
    lines.length > max ? h('p', { class: 'muted small' }, t('me.moreLines', { n: lines.length - max })) : null);
}

function proposalItem({ status, title, lines = [], meta = [], onForget, help = '' }) {
  const badgeClass = status === 'sent' ? 'badge-sent' : status === 'stale' ? 'badge-needs-info' : 'badge-verified';
  return h('li', { class: ['me-prop', `me-prop-${status}`] },
    h('span', { class: 'me-prop-mark', attrs: { 'aria-hidden': 'true' } }, icon(status === 'sent' ? 'send' : status === 'stale' ? 'warning' : 'check', { size: 18 })),
    h('div', { class: 'me-prop-body' },
      h('div', { class: 'me-prop-head' },
        h('span', { class: `badge ${badgeClass}` }, t(`me.status.${status}`)),
        meta.filter(Boolean).length ? h('span', { class: 'me-prop-meta muted small' }, meta.filter(Boolean).join(' · ')) : null),
      title ? h('p', { class: 'me-prop-title' }, bdi(title)) : null,
      help ? h('p', { class: 'me-prop-help small' }, help) : null,
      linesBlock(lines)),
    h('button', {
      type: 'button', class: 'btn btn-sm btn-ghost me-prop-forget',
      on: { click: onForget },
    }, icon('trash', { size: 16 }), t('me.forget')));
}

function proposalsSection(graph) {
  const ownerLabel = ownerName();
  const items = [];

  for (const s of [...store.sent].reverse()) {
    const stale = store.sentStale.has(s.id);
    let d = { title: '', lines: [] };
    try { d = describeProposal(s.proposal, graph, lang()); } catch { /* keep empty */ }
    const n = s.proposal?.ops?.length || 0;
    items.push(proposalItem({
      status: stale ? 'stale' : 'sent',
      title: d.title,
      lines: d.lines || [],
      meta: [s.at ? t('me.sentOn', { date: shortDate(s.at) }) : '', s.via ? t('me.via', { via: viaLabel(s.via) }) : '', plural('me.n.changes', n)],
      help: stale ? t('me.staleHelp', { owner: ownerLabel }) : '',
      onForget: async () => {
        const ok = await confirmDialog({ title: t('me.forgetTitle'), message: t('me.forgetSentText', { owner: ownerLabel }), confirmLabel: t('me.forget'), danger: true });
        if (!ok) return;
        store.forgetSent(s.id);
        toast(t('me.forgotten'));
      },
    }));
  }

  for (const a of store.approved || []) {
    const entry = (store.changelog?.entries || []).find((e) => e && e.proposalId === a.id) || null;
    const sum = entry?.summary?.[lang()];
    const lines = Array.isArray(sum) ? sum.filter((x) => typeof x === 'string') : [];
    const issue = Number(a.issue ?? entry?.issue);
    items.push(proposalItem({
      status: 'approved',
      title: lines[0] || (typeof entry?.title === 'string' ? entry.title.replace(/^[^\p{L}\p{N}]+/u, '') : '') || t('me.approvedFallback'),
      lines: lines.length > 1 ? lines : [],
      meta: [a.approvedAt ? t('me.approvedOn', { date: shortDate(a.approvedAt) }) : '', a.ops ? plural('me.n.changes', a.ops) : '', Number.isFinite(issue) && issue > 0 ? t('me.request', { n: issue }) : ''],
      onForget: async () => {
        const ok = await confirmDialog({ title: t('me.forgetTitle'), message: t('me.forgetApprovedText'), confirmLabel: t('me.forget') });
        if (!ok) return;
        store.forgetApproved(a.id);
        toast(t('me.forgotten'));
      },
    }));
  }

  const n = store.draft.ops.length;
  const draft = n ? h('div', { class: 'me-draft' },
    h('span', { class: 'me-draft-icon', attrs: { 'aria-hidden': 'true' } }, icon('edit', { size: 18 })),
    h('div', { class: 'me-draft-text' },
      h('strong', null, t('me.draftTitle')),
      h('span', { class: 'small' }, t('me.draftText', { changes: plural('me.n.changes', n), owner: ownerLabel }))),
    h('a', { class: 'btn btn-primary btn-sm', href: '#/draft' }, icon('send', { size: 16 }), t('me.draftOpen'))) : null;

  return h('section', { class: 'me-section me-proposals', attrs: { 'aria-labelledby': 'me-proposals-title' } },
    titled(sectionTitle(t('me.proposalsTitle')), 'me-proposals-title'),
    draft,
    items.length
      ? h('ul', { class: 'me-prop-list' }, items)
      : (draft ? null : h('div', { class: 'card me-empty' }, h('p', { class: 'muted' }, icon('send', { size: 18 }), h('span', null, t('me.proposalsEmpty'))))));
}

// ---------------------------------------------------------------------------------------------------------
// Close family

function group(label, people, { extra = null } = {}) {
  return h('div', { class: 'me-fam-group' },
    h('h3', { class: 'me-fam-label' }, label),
    people.length
      ? h('div', { class: 'chips' }, people.map((p) => personChip(p)))
      : h('p', { class: 'muted small me-fam-none' }, t('me.noneYet')),
    extra);
}

function familySection(graph, me) {
  const parents = graph.parents(me.id) || [];
  const spouses = (graph.spouses(me.id) || []).map((s) => s.person).filter(Boolean);
  const children = graph.children(me.id) || [];
  const sib = graph.siblings(me.id) || { full: [], half: [], unspecified: [] };
  const full = [...(sib.full || []), ...(sib.unspecified || [])];
  const viaF = (sib.half || []).filter((x) => x.via === 'father').map((x) => x.person);
  const viaM = (sib.half || []).filter((x) => x.via !== 'father').map((x) => x.person);

  const halfBlock = (viaF.length || viaM.length) ? h('div', { class: 'me-fam-half' },
    viaF.length ? h('div', null, h('p', { class: 'me-fam-sub small muted' }, t('me.siblingsFather')), h('div', { class: 'chips' }, viaF.map((p) => personChip(p)))) : null,
    viaM.length ? h('div', null, h('p', { class: 'me-fam-sub small muted' }, t('me.siblingsMother')), h('div', { class: 'chips' }, viaM.map((p) => personChip(p)))) : null) : null;

  return h('section', { class: 'card me-section me-family', attrs: { 'aria-labelledby': 'me-family-title' } },
    h('div', { class: 'card-header' },
      h('h2', { id: 'me-family-title' }, t('me.familyTitle')),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => openDialog('openAddRelativeSheet', me.id) } }, icon('plus', { size: 16 }), t('me.addRelative')),
        h('a', { class: 'btn btn-sm btn-ghost', href: `#/add-family?near=${enc(me.id)}` }, t('me.addFamily')))),
    h('div', { class: 'me-fam-grid' },
      group(t('me.parents'), parents),
      group(t('me.spouses'), spouses),
      group(t('me.children'), children),
      group(t('me.siblings'), full, { extra: halfBlock })));
}

function helpSection(graph, me) {
  return h('section', { class: 'card me-section me-help home-help', attrs: { 'aria-labelledby': 'me-help-title' } },
    h('div', { class: 'card-header' }, h('h2', { id: 'me-help-title' }, t('me.helpTitle'))),
    h('p', { class: 'muted small home-help-lead' }, t('me.helpLead')),
    helpList(graph, me.id));
}

function prefsSection() {
  const opt = (val, label) => h('button', {
    type: 'button',
    attrs: { 'aria-pressed': store.digits === val ? 'true' : 'false', lang: val === 'arab' ? 'ar' : 'en' },
    on: { click: () => { if (store.digits !== val) store.setDigitsPref(val); } },
  }, label);
  return h('section', { class: 'me-section me-prefs', attrs: { 'aria-labelledby': 'me-prefs-title' } },
    h('h2', { id: 'me-prefs-title', class: 'me-prefs-title' }, t('me.prefsTitle')),
    h('div', { class: 'me-prefs-row' },
      h('span', { class: 'me-prefs-label', id: 'me-digits-label' }, t('me.digits')),
      h('div', { class: 'segmented', attrs: { role: 'group', 'aria-labelledby': 'me-digits-label' } },
        opt('latn', t('me.digitsLatn')), opt('arab', t('me.digitsArab')))),
    h('p', { class: 'muted small' }, t('me.prefsHint')));
}

function titled(el, id) {
  el.querySelector('h2')?.setAttribute('id', id);
  return el;
}

// ---------------------------------------------------------------------------------------------------------

let current = null;
function rerender() {
  if (!current || !current.isConnected) return;
  current.replaceChildren();
  render(current);
}

function render(root) {
  current = root;
  const graph = store.working;
  const me = store.me ? graph.person(store.me) : null;

  add(root, 
    h('header', { class: 'page-head me-head' },
      h('h1', null, t('me.title')),
      h('p', { class: 'lead' }, t('me.lead'))),
    h('div', { class: 'me-layout' },
      h('div', { class: 'me-main' },
        whoSection(graph),
        me ? familySection(graph, me) : null,
        proposalsSection(graph)),
      h('aside', { class: 'me-side' },
        me ? helpSection(graph, me) : null,
        prefsSection())));
}

export default {
  title: () => t('me.title'),
  render(root) {
    render(root);
  },
};
