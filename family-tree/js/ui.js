// Shared UI building blocks used by many views (avatars, name labels, chips, badges, rows, WhatsApp links).
import { h, icon, bdi } from './dom.js';
import { t, register, lang, otherLang } from './i18n.js';
import { store } from './store.js';
import { displayName, lineageName, initials } from './core/names.js';
import { yearsLabel, isMinor } from './core/dates.js';

register({
  en: {
    'ui.pendingDraft': 'Not sent yet',
    'ui.pendingSent': 'Sent — awaiting approval',
    'ui.needsInfo': 'Needs info',
    'ui.verified': 'Verified',
    'ui.deceased': 'Deceased',
    'ui.me': 'You',
    'ui.photoOf': 'Photo of {name}',
  },
  ar: {
    'ui.pendingDraft': 'لم يُرسل بعد',
    'ui.pendingSent': 'أُرسل — بانتظار الموافقة',
    'ui.needsInfo': 'تنقصه معلومات',
    'ui.verified': 'موثّق',
    'ui.deceased': 'متوفّى',
    'ui.me': 'أنت',
    'ui.photoOf': 'صورة {name}',
  },
});

/** The graph views should read (data + sent + draft). */
export function g() { return store.working; }

/** Display name in the current language (handles withheld/unknown names). */
export function nameOf(person, l = lang()) {
  if (!person) return '';
  return displayName(person, l, store.working) || t('common.unknown');
}

/** Name in the other language, only when it differs and exists. */
export function otherNameOf(person) {
  if (!person) return '';
  const a = displayName(person, lang(), store.working);
  const b = displayName(person, otherLang(), store.working);
  return b && b !== a ? b : '';
}

export function lineageOf(person, opts = {}) {
  if (!person) return '';
  try { return lineageName(store.working, person.id, lang(), opts) || nameOf(person); } catch { return nameOf(person); }
}

export function yearsOf(person) {
  try { return yearsLabel(person, lang()) || ''; } catch { return ''; }
}

/** May this person's photo be shown under the owner's privacy defaults? */
export function photoAllowed(person) {
  if (!person || !person.photo) return false;
  const policy = store.config?.privacyDefaults?.photos || 'all';
  if (policy === 'none') return false;
  if (policy === 'men-only' && person.gender !== 'm') return false;
  try { if (isMinor(person, new Date())) return false; } catch { /* ignore */ }
  if (person.nameStatus === 'withheld') return false;
  return true;
}

/** Circular avatar: photo when allowed, else initials with a subtle gender tint. size: 'sm' | 'md' | 'lg' */
export function avatar(person, { size = 'md' } = {}) {
  const genderClass = person?.gender === 'm' ? 'avatar-m' : person?.gender === 'f' ? 'avatar-f' : 'avatar-u';
  const cls = ['avatar', size !== 'md' ? `avatar-${size}` : '', genderClass];
  if (photoAllowed(person)) {
    return h('span', { class: cls },
      h('img', { src: person.photo, alt: t('ui.photoOf', { name: nameOf(person) }), loading: 'lazy', referrerPolicy: 'no-referrer' }));
  }
  let txt = '';
  try { txt = initials(person, lang()) || ''; } catch { txt = ''; }
  if (!txt) txt = person?.nameStatus === 'known' || !person?.nameStatus ? '؟' : '·';
  return h('span', { class: cls, attrs: { 'aria-hidden': 'true' } }, txt);
}

/** Status badges for a person: pending (draft/sent), needs-info, verified. */
export function badges(person, { compact = false } = {}) {
  if (!person) return [];
  const out = [];
  const kind = store.pendingKind(person.id);
  if (kind === 'draft') out.push(h('span', { class: 'badge badge-pending', title: t('ui.pendingDraft') }, compact ? '•' : t('ui.pendingDraft')));
  if (kind === 'sent') out.push(h('span', { class: 'badge badge-sent', title: t('ui.pendingSent') }, compact ? '•' : t('ui.pendingSent')));
  if (store.me && store.me === person.id) out.push(h('span', { class: 'badge badge-me' }, t('ui.me')));
  if ((person.tags || []).includes('needs-info')) out.push(h('span', { class: 'badge badge-needs-info', title: person.needsInfo || t('ui.needsInfo') }, compact ? '?' : t('ui.needsInfo')));
  if ((person.tags || []).includes('verified')) out.push(h('span', { class: 'badge badge-verified', title: t('ui.verified') }, compact ? '✓' : t('ui.verified')));
  return out;
}

/** Name label: primary-language name with optional other-language name in small text. */
export function nameLabel(person, { other = true, tag = 'span' } = {}) {
  const o = other ? otherNameOf(person) : '';
  return h(tag, { class: 'pname' },
    bdi(nameOf(person), { class: 'pname-main' }),
    o ? h('small', { class: 'pname-other', lang: otherLang(), dir: otherLang() === 'ar' ? 'rtl' : 'ltr' }, o) : null);
}

/** Compact clickable chip: avatar + name (+ years). */
export function personChip(person, { href = null, years = true, other = false, onClick = null } = {}) {
  if (!person) return null;
  const link = href === null ? `#/p/${encodeURIComponent(person.id)}` : href;
  const y = years ? yearsOf(person) : '';
  const kind = store.pendingKind(person.id);
  return h(link ? 'a' : 'button', {
    class: ['chip', 'chip-person', link ? 'chip-link' : '', kind ? `is-${kind}` : ''],
    href: link || undefined,
    type: link ? undefined : 'button',
    on: onClick ? { click: onClick } : undefined,
  },
  avatar(person, { size: 'sm' }),
  nameLabel(person, { other }),
  y ? h('span', { class: 'chip-years muted small' }, y) : null);
}

/** List row: avatar, name, lineage, years, badges. */
export function personRow(person, { href = null, meta = null, trailing = null } = {}) {
  if (!person) return null;
  const link = href === null ? `#/p/${encodeURIComponent(person.id)}` : href;
  const lin = lineageOf(person);
  const y = yearsOf(person);
  return h(link ? 'a' : 'div', { class: 'list-item person-row', href: link || undefined },
    avatar(person),
    h('span', { class: 'person-row-main' },
      h('span', { class: 'person-row-title' }, nameLabel(person, { other: true }), ...badges(person, { compact: true })),
      lin && lin !== nameOf(person) ? bdi(lin, { class: 'person-row-lineage muted small' }) : null,
      (y || meta) ? h('span', { class: 'person-row-meta muted small' }, y, y && meta ? ' · ' : '', meta) : null),
    trailing);
}

/** wa.me link. `number` digits only (may be empty → WhatsApp asks for the recipient). */
export function whatsappUrl(text, number = '') {
  const n = String(number || '').replace(/[^0-9]/g, '');
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

/** Owner's display name for the current language. */
export function ownerName() {
  const n = store.config?.owner?.name;
  return (n && (n[lang()] || n.en || n.ar)) || t('app.title');
}

/** Section header with optional trailing actions. */
export function sectionTitle(text, ...actions) {
  return h('div', { class: 'section-title' }, h('h2', null, text), actions.length ? h('div', { class: 'section-actions' }, actions) : null);
}

export function emptyState(title, text = '', action = null) {
  return h('div', { class: 'empty-state' }, h('h2', null, title), text ? h('p', { class: 'muted' }, text) : null, action);
}

export function spinner(label = t('common.loading')) {
  return h('div', { class: 'loading-row', attrs: { role: 'status' } }, h('span', { class: 'spinner', attrs: { 'aria-hidden': 'true' } }), h('span', null, label));
}

export { icon };
