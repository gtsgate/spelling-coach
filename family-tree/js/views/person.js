// Person page — the family card (#/p/:id), docs/SPEC.md §7.5.
// Header: large avatar, display name (other language small), lineage name (4 names), nickname, badges, "رحمه الله /
// رحمها الله" for the deceased, relation to "me". Sections: parents, spouses (status per config.showDivorce, widow/er
// derived), children grouped per union, siblings (full / via father / via mother / unspecified), milk & foster ties,
// details (dates in both calendars honouring privacy, places, work, bio, needs-info, last update).
// Exactly three primary buttons (Add a relative · Correct info · This is me) + "More options".
// Merged ids redirect to their record; unknown ids get a friendly not-found page with search.
import { h, icon, bdi, toast } from '../dom.js';
import { t, register, lang, otherLang, intlLocale } from '../i18n.js';
import { store } from '../store.js';
import { nameOf, lineageOf, avatar, badges, personChip, yearsOf, spinner } from '../ui.js';
import { navigate } from '../app.js';
import { personPicker } from '../forms/picker.js';
import {
  openAddRelativeSheet, openAddRelative, openEditPerson, openMoreOptions, openMerge, openMarriageDetails,
} from '../forms/dialogs.js';
import { formatDate } from '../core/dates.js';
import { isAutoEnglish } from '../core/translit.js';
import { personName, displayName } from '../core/names.js';
import { findRelationship, relationLabel } from '../core/kinship.js';
import { isPersonId, isUnionId } from '../core/schema.js';

register({
  en: {
    'person.notFoundTitle': 'This person is not in the tree',
    'person.notFoundText': 'The link may be old, or the record was merged or removed. Search for them by name:',
    'person.search': 'Search the family tree',
    'person.knownAs': 'Known as {nick}',
    'person.rip.m': 'May God have mercy on him',
    'person.rip.f': 'May God have mercy on her',
    'person.rip.u': 'May God have mercy on them',
    'person.relHe': 'He is {rel}',
    'person.relShe': 'She is {rel}',
    'person.relThey': '{name} is {rel}',
    'person.howRelated': 'See how',
    'person.autoSpelling': 'Automatic English spelling — correct it',
    'person.autoSpellingFix': 'Correct the spelling',
    'person.addRelative': 'Add a relative',
    'person.correct': 'Correct info',
    'person.thisIsMe': 'This is me',
    'person.notMe': 'This is not me',
    'person.meSet': 'Saved on this device: you are {name}.',
    'person.meCleared': 'This device no longer treats you as {name}.',
    'person.more': 'More options',
    'person.parents': 'Parents',
    'person.spouses': 'Husband / wife',
    'person.spousesMany': 'Spouses',
    'person.children': 'Children',
    'person.siblings': 'Brothers and sisters',
    'person.ties': 'Milk and foster family',
    'person.details': 'Details',
    'person.noneYet': 'Not recorded yet.',
    'person.addParent': 'Add a parent',
    'person.addSpouse': 'Add a husband or wife',
    'person.addChild': 'Add a son or daughter',
    'person.addSibling': 'Add a brother or sister',
    'person.father': 'Father',
    'person.mother': 'Mother',
    'person.parent': 'Parent',
    'person.husband': 'Husband',
    'person.wife': 'Wife',
    'person.spouse': 'Spouse',
    'person.lateHusband': 'Late husband',
    'person.lateWife': 'Late wife',
    'person.lateSpouse': 'Late spouse',
    'person.formerHusband': 'Former husband',
    'person.formerWife': 'Former wife',
    'person.formerSpouse': 'Former spouse',
    'person.widow': 'Widow',
    'person.widower': 'Widower',
    'person.married': 'Married {date}',
    'person.marriedIn': 'in {place}',
    'person.with': 'With {name}',
    'person.otherParentUnknown': 'Other parent not recorded',
    'person.nChildren': '{n} children',
    'person.oneChild': '1 child',
    'person.sib.full': 'Full brothers and sisters',
    'person.sib.father': 'Through the father',
    'person.sib.mother': 'Through the mother',
    'person.sib.unspecified': 'Brothers and sisters',
    'person.sib.unspecifiedMixed': 'Other brothers and sisters (shared parents not recorded)',
    'person.tie.milkParentOf': 'Milk mother or father (rada’a)',
    'person.tie.fosterParentOf': 'Raised them under kafala',
    'person.tie.milkChild': 'Milk son or daughter',
    'person.tie.fosterChild': 'Foster child (kafala)',
    'person.tie.milkSiblings': 'Milk brothers and sisters',
    'person.born': 'Born',
    'person.died': 'Passed away',
    'person.place': 'Place',
    'person.birthPlace': 'Place of birth',
    'person.deathPlace': 'Place of death',
    'person.occupation': 'Work',
    'person.bio': 'About',
    'person.dateHidden': 'Not published (privacy)',
    'person.noDetails': 'No details have been added yet.',
    'person.addDetails': 'Add details',
    'person.needsInfo': 'Information needed',
    'person.marriageDetails': 'Marriage details',
    'person.iKnow': 'I know this',
    'person.duplicateOf': 'This record may be the same person as:',
    'person.merge': 'Merge the two records',
    'person.lastUpdated': 'Last updated {date}',
    'person.inIssue': 'proposal #{n}',
    'person.pending.draftNew': '{name} is new in your proposal and has not been sent yet.',
    'person.pending.draft': 'You have changes to {name} that have not been sent yet.',
    'person.pending.sentNew': '{name} was sent and is waiting for approval. Everyone will see it once approved.',
    'person.pending.sent': 'Your changes to {name} were sent and are waiting for approval.',
    'person.pending.review': 'Review & send',
    'person.pending.mine': 'My page',
  },
  ar: {
    'person.notFoundTitle': 'هذا الشخص غير موجود في الشجرة',
    'person.notFoundText': 'ربما الرابط قديم، أو دُمج السجل مع سجل آخر أو أُزيل. يمكن البحث بالاسم:',
    'person.search': 'البحث في شجرة العائلة',
    'person.knownAs': 'يُعرف بـ{nick}',
    'person.rip.m': 'رحمه الله',
    'person.rip.f': 'رحمها الله',
    'person.rip.u': 'رحمه الله',
    'person.relHe': 'هو {rel}',
    'person.relShe': 'هي {rel}',
    'person.relThey': '{name}: {rel}',
    'person.howRelated': 'التفاصيل',
    'person.autoSpelling': 'الكتابة الإنجليزية تلقائية — يمكن تصحيحها',
    'person.autoSpellingFix': 'تصحيح الكتابة',
    'person.addRelative': 'إضافة قريب',
    'person.correct': 'تصحيح المعلومات',
    'person.thisIsMe': 'هذا أنا',
    'person.notMe': 'هذا ليس أنا',
    'person.meSet': 'حُفظ على هذا الجهاز: أنت {name}.',
    'person.meCleared': 'لم يعد هذا الجهاز يعرّفك بـ{name}.',
    'person.more': 'خيارات أخرى',
    'person.parents': 'الوالدان',
    'person.spouses': 'الزوج / الزوجة',
    'person.spousesMany': 'الأزواج والزوجات',
    'person.children': 'الأبناء',
    'person.siblings': 'الإخوة والأخوات',
    'person.ties': 'الرضاعة والكفالة',
    'person.details': 'التفاصيل',
    'person.noneYet': 'لم يُسجَّل بعد.',
    'person.addParent': 'إضافة والد أو والدة',
    'person.addSpouse': 'إضافة زوج أو زوجة',
    'person.addChild': 'إضافة ابن أو ابنة',
    'person.addSibling': 'إضافة أخ أو أخت',
    'person.father': 'الأب',
    'person.mother': 'الأم',
    'person.parent': 'أحد الوالدين',
    'person.husband': 'الزوج',
    'person.wife': 'الزوجة',
    'person.spouse': 'الزوج أو الزوجة',
    'person.lateHusband': 'الزوج الراحل',
    'person.lateWife': 'الزوجة الراحلة',
    'person.lateSpouse': 'الزوج الراحل',
    'person.formerHusband': 'الزوج السابق',
    'person.formerWife': 'الزوجة السابقة',
    'person.formerSpouse': 'زواج سابق',
    'person.widow': 'أرملة',
    'person.widower': 'أرمل',
    'person.married': 'الزواج: {date}',
    'person.marriedIn': 'في {place}',
    'person.with': 'من {name}',
    'person.otherParentUnknown': 'الوالد الآخر غير مسجّل',
    'person.nChildren': 'الأبناء: {n}',
    'person.oneChild': 'ابن واحد',
    'person.sib.full': 'الإخوة الأشقاء',
    'person.sib.father': 'إخوة لأب',
    'person.sib.mother': 'إخوة لأم',
    'person.sib.unspecified': 'الإخوة والأخوات',
    'person.sib.unspecifiedMixed': 'إخوة آخرون (لم يُسجَّل الوالدان المشتركان)',
    'person.tie.milkParentOf': 'من الرضاعة (أمّ أو أب)',
    'person.tie.fosterParentOf': 'الكافل',
    'person.tie.milkChild': 'أبناء من الرضاعة',
    'person.tie.fosterChild': 'المكفولون',
    'person.tie.milkSiblings': 'إخوة من الرضاعة',
    'person.born': 'الميلاد',
    'person.died': 'الوفاة',
    'person.place': 'المكان',
    'person.birthPlace': 'مكان الميلاد',
    'person.deathPlace': 'مكان الوفاة',
    'person.occupation': 'العمل',
    'person.bio': 'نبذة',
    'person.dateHidden': 'غير منشور (خصوصية)',
    'person.noDetails': 'لم تُضف تفاصيل بعد.',
    'person.addDetails': 'إضافة تفاصيل',
    'person.needsInfo': 'معلومات مطلوبة',
    'person.marriageDetails': 'تفاصيل الزواج',
    'person.iKnow': 'لديّ هذه المعلومة',
    'person.duplicateOf': 'قد يكون هذا السجل للشخص نفسه في:',
    'person.merge': 'دمج السجلين',
    'person.lastUpdated': 'آخر تحديث: {date}',
    'person.inIssue': 'المقترح رقم {n}',
    'person.pending.draftNew': '{name} جديد في مقترحك ولم يُرسل بعد.',
    'person.pending.draft': 'لديك تعديلات على {name} لم تُرسل بعد.',
    'person.pending.sentNew': 'أُرسل {name} وينتظر الموافقة، وسيظهر للجميع بعدها.',
    'person.pending.sent': 'أُرسلت تعديلاتك على {name} وهي بانتظار الموافقة.',
    'person.pending.review': 'مراجعة وإرسال',
    'person.pending.mine': 'صفحتي',
  },
});

// UI state kept across re-renders (none needed beyond the current id).
let currentId = null;

const enc = encodeURIComponent;
const gkey = (p) => (p?.gender === 'm' ? 'm' : p?.gender === 'f' ? 'f' : 'u');

function call(fn, ...args) {
  Promise.resolve(fn(...args)).catch((e) => console.error(e));
}

// ---------------------------------------------------------------------------------------------------------
// Pieces

/**
 * Free text written in both languages in one string ("… التفاصيل. Added from the full name …") → one paragraph per
 * language, the current language first, so mixed-direction text never wraps into a jumbled bidi line.
 */
function bilingualParts(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const m = /^([\s\S]*[\u0600-\u06FF][^A-Za-z]*?)(?:\s+[—–-]\s+|\s+)([A-Za-z][^\u0600-\u06FF]*)$/.exec(s);
  if (!m) return [s];
  const ar = m[1].trim();
  const en = m[2].trim();
  return lang() === 'ar' ? [ar, en] : [en, ar];
}

function sectionCard(key, iconName, title, count, ...content) {
  return h('section', { class: ['card', 'person-sec', `person-sec-${key}`], attrs: { 'aria-labelledby': `psec-${key}` } },
    h('h2', { class: 'person-sec-title', id: `psec-${key}` },
      h('span', { class: 'person-sec-icon', attrs: { 'aria-hidden': 'true' } }, icon(iconName, { size: 18 })),
      h('span', null, title),
      count ? h('span', { class: 'person-sec-count' }, String(count)) : null),
    ...content);
}

function emptyLine(label, onAdd) {
  return h('div', { class: 'person-empty' },
    h('span', { class: 'muted' }, t('person.noneYet')),
    onAdd ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost person-add-inline', on: { click: onAdd } }, icon('plus', { size: 16 }), label) : null);
}

/** A relative chip with a small role caption above it. */
function relChip(person, role = '', meta = null) {
  return h('div', { class: 'person-rel' },
    role ? h('span', { class: 'person-rel-role small' }, role) : null,
    personChip(person, { years: true }),
    meta ? h('span', { class: 'person-rel-meta small muted' }, meta) : null);
}

function marriageText(u) {
  const bits = [];
  const d = u?.marriage ? formatDate(u.marriage, lang(), { calendar: 'hijri' }) : '';
  if (d) bits.push(t('person.married', { date: d }));
  const place = u?.marriage?.place?.[lang()] || u?.marriage?.place?.[otherLang()] || '';
  if (place) bits.push(d ? t('person.marriedIn', { place }) : place);
  if (u?.note?.[lang()] || u?.note?.[otherLang()]) bits.push(u.note[lang()] || u.note[otherLang()]);
  return bits.join(' ');
}

function spouseRole(P, S, u) {
  const showDivorce = !!store.config?.showDivorce;
  const sg = gkey(S);
  const word = (base) => t(`person.${base}${sg === 'm' ? 'Husband' : sg === 'f' ? 'Wife' : 'Spouse'}`);
  if (showDivorce && u?.status === 'divorced') return word('former');
  if (S.deceased && !P.deceased) return word('late');
  if (P.deceased && !S.deceased && (u?.status === 'married' || u?.status === 'widowed' || !u?.status || u?.status === 'unknown')) {
    return sg === 'f' ? t('person.widow') : sg === 'm' ? t('person.widower') : word('');
  }
  return sg === 'm' ? t('person.husband') : sg === 'f' ? t('person.wife') : t('person.spouse');
}

function relationLine(P) {
  const graph = store.working;
  const me = store.me;
  if (!me || me === P.id || !graph.person(me)) return null;
  let rel = null;
  try { rel = findRelationship(graph, me, P.id); } catch { rel = null; }
  if (!rel || rel.type === 'none' || rel.type === 'self') return null;
  let label = '';
  try { label = relationLabel(rel, graph, lang(), { you: true, showDivorce: !!store.config?.showDivorce }); } catch { label = ''; }
  if (!label) return null;
  const key = P.gender === 'm' ? 'person.relHe' : P.gender === 'f' ? 'person.relShe' : 'person.relThey';
  return h('p', { class: 'person-relation' },
    icon('heart', { size: 16 }),
    h('span', null, t(key, { rel: label, name: nameOf(P) })),
    h('a', { href: `#/relationship/${enc(me)}/${enc(P.id)}`, class: 'person-relation-link' }, t('person.howRelated')));
}

function pendingBanner(P) {
  const kind = store.pendingKind(P.id);
  if (!kind) return null;
  const created = store.isCreated(P.id);
  const name = nameOf(P);
  const key = kind === 'draft' ? (created ? 'person.pending.draftNew' : 'person.pending.draft') : (created ? 'person.pending.sentNew' : 'person.pending.sent');
  return h('div', { class: ['notice', kind === 'draft' ? 'notice-warning' : 'notice-info', 'person-pending', `person-pending-${kind}`], attrs: { role: 'status' } },
    icon(kind === 'draft' ? 'send' : 'info'),
    h('div', { class: 'person-pending-body' },
      h('p', null, t(key, { name })),
      kind === 'draft'
        ? h('a', { class: 'btn btn-sm btn-primary', href: '#/draft' }, icon('send', { size: 16 }), t('person.pending.review'))
        : (store.me ? h('a', { class: 'btn btn-sm', href: '#/me' }, t('person.pending.mine')) : null)));
}

// ---------------------------------------------------------------------------------------------------------
// Header card

function header(P) {
  const L = lang();
  const known = (P.nameStatus || 'known') === 'known';
  const given = known ? personName(P, L) : '';
  const main = given || nameOf(P);
  const otherGiven = known ? personName(P, otherLang()) : '';
  const other = otherGiven || displayName(P, otherLang(), store.working);
  const nick = known && given ? (P.nickname?.[L] || P.nickname?.[otherLang()] || '') : '';
  const lineage = lineageOf(P, { depth: 4 });
  const years = yearsOf(P);
  const isMe = store.me === P.id;
  const auto = L === 'en' && ((known && isAutoEnglish(P.name)) || isAutoEnglish(P.surname) || isAutoEnglish(P.nickname));

  const meBtn = h('button', {
    type: 'button', class: ['btn', 'btn-lg', 'person-btn-me', isMe ? 'is-me' : ''],
    attrs: { 'aria-pressed': isMe ? 'true' : 'false' },
    on: {
      click: () => {
        if (isMe) { store.setMe(null); toast(t('person.meCleared', { name: nameOf(P) })); }
        else { store.setMe(P.id); toast(t('person.meSet', { name: nameOf(P) }), { type: 'success' }); }
      },
    },
  }, icon(isMe ? 'close' : 'user'), h('span', null, t(isMe ? 'person.notMe' : 'person.thisIsMe')));

  return h('article', { class: ['card', 'person-hero', P.deceased ? 'is-deceased' : '', `person-g-${gkey(P)}`] },
    h('div', { class: 'person-hero-top' },
      h('div', { class: 'person-hero-avatar' }, avatar(P, { size: 'lg' })),
      h('div', { class: 'person-hero-id' },
        h('h1', { class: 'person-name' }, bdi(main)),
        other && other !== main ? h('p', { class: 'person-name-other', lang: otherLang(), dir: otherLang() === 'ar' ? 'rtl' : 'ltr' }, other) : null,
        lineage && lineage !== main ? h('p', { class: 'person-lineage' }, bdi(lineage)) : null,
        nick ? h('p', { class: 'person-nick' }, t('person.knownAs', { nick: '' }), bdi(nick)) : null,
        h('div', { class: 'person-badges' },
          years ? h('span', { class: 'person-years' }, years) : null,
          ...badges(P),
          P.deceased ? h('span', { class: 'person-rip' }, t(`person.rip.${gkey(P)}`)) : null),
        relationLine(P))),
    auto ? h('p', { class: 'person-auto small' },
      icon('star', { size: 14 }),
      h('span', null, t('person.autoSpelling')),
      h('button', { type: 'button', class: 'person-link-btn', on: { click: () => call(openEditPerson, P.id) } }, t('person.autoSpellingFix'))) : null,
    h('div', { class: 'person-actions' },
      h('button', { type: 'button', class: 'btn btn-primary btn-lg person-btn-add', on: { click: () => call(openAddRelativeSheet, P.id) } }, icon('plus'), h('span', null, t('person.addRelative'))),
      h('button', { type: 'button', class: 'btn btn-lg person-btn-edit', on: { click: () => call(openEditPerson, P.id) } }, icon('edit'), h('span', null, t('person.correct'))),
      meBtn,
      h('button', { type: 'button', class: 'btn btn-ghost person-btn-more', on: { click: () => call(openMoreOptions, P.id) } }, icon('more'), h('span', null, t('person.more')))));
}

// ---------------------------------------------------------------------------------------------------------
// Family sections

function parentsSection(P) {
  const graph = store.working;
  const parents = graph.parents(P.id);
  const role = (x) => (x.gender === 'm' ? t('person.father') : x.gender === 'f' ? t('person.mother') : t('person.parent'));
  return sectionCard('parents', 'arrowUp', t('person.parents'), 0,
    parents.length
      ? h('div', { class: 'person-rel-grid' }, parents.map((x) => relChip(x, role(x))))
      : emptyLine(t('person.addParent'), () => call(openAddRelative, P.id, 'parent')),
    parents.length === 1 ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost person-add-inline', on: { click: () => call(openAddRelative, P.id, 'parent') } }, icon('plus', { size: 16 }), t('person.addParent')) : null);
}

function spousesSection(P) {
  const graph = store.working;
  const spouses = graph.spouses(P.id);
  return sectionCard('spouses', 'heart', spouses.length > 1 ? t('person.spousesMany') : t('person.spouses'), spouses.length > 1 ? spouses.length : 0,
    spouses.length
      ? h('div', { class: 'person-rel-grid' }, spouses.map((s) => {
        const chip = relChip(s.person, spouseRole(P, s.person, s.union), marriageText(s.union) || null);
        if (isUnionId(s.union?.id) || /^newu\d+$/.test(s.union?.id || '')) {
          chip.append(h('button', {
            type: 'button', class: 'btn btn-sm btn-ghost person-marriage-btn',
            attrs: { 'aria-label': `${t('person.marriageDetails')} — ${nameOf(s.person)}` },
            on: { click: () => call(openMarriageDetails, P.id, s.union.id) },
          }, icon('edit', { size: 14 }), h('span', null, t('person.marriageDetails'))));
        }
        return chip;
      }))
      : emptyLine(t('person.addSpouse'), () => call(openAddRelative, P.id, 'spouse')));
}

function childrenSection(P) {
  const graph = store.working;
  const groups = graph.unionsOf(P.id)
    .map((u) => ({ u, kids: graph.childrenOfUnion(u.id) }))
    .filter((x) => x.kids.length);
  const total = groups.reduce((n, x) => n + x.kids.length, 0);
  const many = groups.length > 1 || graph.spouses(P.id).length > 1;
  const body = groups.length
    ? groups.map(({ u, kids }) => {
      const other = (u.partners || []).filter((x) => x !== P.id).map((x) => graph.person(x)).filter(Boolean)[0];
      const info = marriageText(u);
      const head = many || other
        ? h('div', { class: 'person-group-head' },
          other ? avatar(other, { size: 'sm' }) : h('span', { class: 'avatar avatar-sm avatar-u', attrs: { 'aria-hidden': 'true' } }, '؟'),
          h('div', { class: 'person-group-title' },
            other
              ? h('span', null, t('person.with', { name: '' }), h('a', { href: `#/p/${enc(other.id)}` }, bdi(nameOf(other))))
              : h('span', null, t('person.otherParentUnknown')),
            h('span', { class: 'small muted' }, kids.length === 1 ? t('person.oneChild') : t('person.nChildren', { n: kids.length }), info ? ` · ${info}` : '')))
        : null;
      return h('div', { class: 'person-group' }, head, h('div', { class: 'chips person-children' }, kids.map((c) => personChip(c, { years: true }))));
    })
    : [emptyLine(t('person.addChild'), () => call(openAddRelative, P.id, 'child'))];
  return sectionCard('children', 'arrowDown', t('person.children'), total,
    ...body,
    groups.length ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost person-add-inline', on: { click: () => call(openAddRelative, P.id, 'child') } }, icon('plus', { size: 16 }), t('person.addChild')) : null);
}

function siblingsSection(P) {
  const graph = store.working;
  const s = graph.siblings(P.id);
  const viaFather = s.half.filter((x) => x.via === 'father').map((x) => x.person);
  const viaMother = s.half.filter((x) => x.via === 'mother').map((x) => x.person);
  const groups = [];
  if (s.full.length) groups.push(['full', s.full]);
  if (viaFather.length) groups.push(['father', viaFather]);
  if (viaMother.length) groups.push(['mother', viaMother]);
  if (s.unspecified.length) groups.push([groups.length ? 'unspecifiedMixed' : 'unspecified', s.unspecified]);
  const total = s.full.length + s.half.length + s.unspecified.length;
  const single = groups.length === 1 && (groups[0][0] === 'unspecified' || groups[0][0] === 'full');
  return sectionCard('siblings', 'users', t('person.siblings'), total,
    groups.length
      ? groups.map(([key, list]) => h('div', { class: 'person-group' },
        single ? null : h('h3', { class: 'person-group-label' }, t(`person.sib.${key}`)),
        h('div', { class: 'chips' }, list.map((x) => personChip(x, { years: true })))))
      : emptyLine(t('person.addSibling'), () => call(openAddRelative, P.id, 'sibling')),
    groups.length ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost person-add-inline', on: { click: () => call(openAddRelative, P.id, 'sibling') } }, icon('plus', { size: 16 }), t('person.addSibling')) : null);
}

function tiesSection(P) {
  const graph = store.working;
  const ties = graph.ties(P.id);
  let milkSibs = [];
  try { milkSibs = graph.milkSiblings(P.id); } catch { milkSibs = []; }
  if (!ties.length && !milkSibs.length) return null;
  const groups = [
    ['milkParentOf', ties.filter((x) => x.type === 'milk-child-of' && x.direction === 'to')],
    ['fosterParentOf', ties.filter((x) => x.type === 'foster-child-of' && x.direction === 'to')],
    ['milkChild', ties.filter((x) => x.type === 'milk-child-of' && x.direction === 'from')],
    ['fosterChild', ties.filter((x) => x.type === 'foster-child-of' && x.direction === 'from')],
  ].filter(([, list]) => list.length);
  return sectionCard('ties', 'heart', t('person.ties'), 0,
    groups.map(([key, list]) => h('div', { class: 'person-group' },
      h('h3', { class: 'person-group-label' }, t(`person.tie.${key}`)),
      h('div', { class: 'chips' }, list.map((x) => personChip(x.person, { years: true }))))),
    milkSibs.length ? h('div', { class: 'person-group' },
      h('h3', { class: 'person-group-label' }, t('person.tie.milkSiblings')),
      h('div', { class: 'chips' }, milkSibs.map((x) => personChip(x, { years: true })))) : null);
}

function detailsSection(P) {
  const graph = store.working;
  const L = lang();
  const O = otherLang();
  const rows = [];
  const pick = (bi) => (bi?.[L] || bi?.[O] || '');
  const row = (label, value, cls = '') => rows.push(h('div', { class: ['person-dl-row', cls] }, h('dt', null, label), h('dd', null, value)));

  const privacy = P.privacy || 'full';
  const hasBirth = !!(P.birth?.date || P.birth?.hijri);
  if (hasBirth) {
    const txt = privacy === 'hidden' ? '' : formatDate(P.birth, L, { precision: privacy, calendar: 'hijri' });
    row(t('person.born'), txt ? bdi(txt) : h('span', { class: 'muted' }, t('person.dateHidden')));
  }
  if (pick(P.birth?.place)) row(t('person.birthPlace'), bdi(pick(P.birth.place)));
  if (P.deceased) {
    const dtxt = formatDate(P.death, L, { calendar: 'hijri' });
    if (dtxt) row(t('person.died'), bdi(dtxt));
    if (pick(P.death?.place)) row(t('person.deathPlace'), bdi(pick(P.death.place)));
  }
  if (pick(P.occupation)) row(t('person.occupation'), bdi(pick(P.occupation)));
  if (pick(P.bio)) row(t('person.bio'), h('p', { class: 'person-bio', dir: 'auto' }, pick(P.bio)), 'person-dl-bio');

  const extras = [];
  if ((P.tags || []).includes('needs-info')) {
    extras.push(h('div', { class: 'notice notice-warning person-needs' }, icon('info'),
      h('div', null,
        h('p', { class: 'person-needs-title' }, t('person.needsInfo')),
        ...bilingualParts(P.needsInfo).map((part, i) => h('p', { class: ['small', i ? 'muted' : ''], dir: 'auto' }, part)),
        h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => call(openEditPerson, P.id) } }, icon('edit', { size: 16 }), t('person.iKnow')))));
  }
  const dup = P.duplicateOf ? graph.person(P.duplicateOf) : null;
  if (dup) {
    extras.push(h('div', { class: 'notice notice-info person-dup' }, icon('merge'),
      h('div', null,
        h('p', null, t('person.duplicateOf')),
        h('div', { class: 'chips' }, personChip(dup, { years: true })),
        isPersonId(P.id) ? h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => call(openMerge, P.id) } }, t('person.merge')) : null)));
  }
  const hist = Array.isArray(P.history) && P.history.length ? P.history[P.history.length - 1] : null;
  let updated = null;
  if (hist && hist.at) {
    let d = '';
    try { d = new Intl.DateTimeFormat(intlLocale(), { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(hist.at)); } catch { d = ''; }
    if (d) {
      updated = h('p', { class: 'person-updated small muted' }, icon('calendar', { size: 14 }), h('span', null, t('person.lastUpdated', { date: d })),
        Number.isInteger(hist.issue) && store.config?.repo
          ? [' · ', h('a', { href: store.repoUrl(`/issues/${hist.issue}`), target: '_blank', rel: 'noopener' }, t('person.inIssue', { n: hist.issue }))]
          : null);
    }
  }
  return sectionCard('details', 'info', t('person.details'), 0,
    ...extras,
    rows.length
      ? h('dl', { class: 'person-dl' }, rows)
      : h('div', { class: 'person-empty' }, h('span', { class: 'muted' }, t('person.noDetails')),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost person-add-inline', on: { click: () => call(openEditPerson, P.id) } }, icon('edit', { size: 16 }), t('person.addDetails'))),
    updated);
}

// ---------------------------------------------------------------------------------------------------------
// Not found

function notFound(root) {
  const picker = personPicker({
    label: t('person.search'),
    onPick: (p) => navigate(`#/p/${enc(p.id)}`),
  });
  root.append(h('div', { class: 'empty-state person-notfound' },
    h('h1', null, t('person.notFoundTitle')),
    h('p', { class: 'muted' }, t('person.notFoundText')),
    h('div', { class: 'person-notfound-search' }, picker),
    h('a', { class: 'btn btn-ghost', href: '#/' }, icon('home'), t('common.goHome'))));
  setTimeout(() => picker.focus(), 50);
}

// ---------------------------------------------------------------------------------------------------------

function findPerson(id) {
  const graph = store.working;
  if (!graph || !id) return { person: null, redirect: null };
  const p = graph.person(id);
  if (p) return { person: p, redirect: null };
  let r = null;
  try { r = graph.resolve(id); } catch { r = null; }
  if (!r) { try { r = store.base?.resolve(id); } catch { r = null; } }
  if (r && r.id !== id && graph.person(r.id)) return { person: null, redirect: r.id };
  return { person: null, redirect: null };
}

export default {
  title(params) {
    const { person } = findPerson(params.id);
    return person ? nameOf(person) : t('common.notFound');
  },

  render(root, params) {
    const id = params.id;
    const { person: P, redirect } = findPerson(id);
    if (redirect) {
      root.append(spinner());
      setTimeout(() => navigate(`#/p/${enc(redirect)}`, { replace: true }), 0);
      return;
    }
    if (!P) { notFound(root); return; }
    if (currentId !== id) currentId = id;
    root.classList.add('person-view');
    root.append(...[
      pendingBanner(P),
      header(P),
      h('div', { class: 'person-grid' },
        h('div', { class: 'person-col' }, parentsSection(P), spousesSection(P), childrenSection(P)),
        h('div', { class: 'person-col' }, siblingsSection(P), tiesSection(P), detailsSection(P))),
    ].filter(Boolean));
  },
};
