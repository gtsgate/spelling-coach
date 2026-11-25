// Owner tools (#/admin) — docs/SPEC.md §7.8. Static helpers for the tree keeper; the page is public, the real power
// is GitHub permissions. Tabs:
//   Requests  — paste one or more codes (or a whole WhatsApp message) → inline preview → "Create request and approve";
//               open requests from the public REST API (on demand; rate-limit friendly) → GitHub / #/preview/<n>.
//   Restore   — removed people & unions with "Restore" (adds restore-person / restore-union to the draft).
//   Health    — validateData warnings and graph.duplicatesSuspects with links.
//   Messages  — "Copy thank-you message" (a changelog entry → bilingual WhatsApp text with ?rev=N links) and
//               "Weekly family news" (last 7 days → new people grouped by family, bilingual).
//   Photos    — pick a person, choose an image → 400×400 JPEG (q 0.85) → download <pid>.jpg → GitHub upload page.
//   Data      — download family.json; links to settings, config.json and the owner guide.
import { h, icon, bdi, toast, copyText } from '../dom.js';
import { t, register, lang, fmtNumber } from '../i18n.js';
import { store } from '../store.js';
import { personChip, ownerName, spinner, nameOf, avatar, whatsappUrl } from '../ui.js';
import { personPicker } from '../forms/picker.js';
import { buildGraph } from '../core/graph.js';
import { validateData, serializeData } from '../core/schema.js';
import { displayName, lineageName } from '../core/names.js';
import { formatIssue, reasonLabel } from '../core/messages.js';
import { formatDate } from '../core/dates.js';
import { analyzeText, proposalReport, errorText } from './preview.js';

register({
  en: {
    'admin.title': 'Owner tools',
    'admin.lead': 'Helpers for reviewing and caring for the tree.',
    'admin.public': 'This page is public, like the rest of the site. Nothing here can change the tree by itself: approving, applying and undoing happen on GitHub, where only approvers have the permission.',
    'admin.tab.requests': 'Requests',
    'admin.tab.restore': 'Restore',
    'admin.tab.health': 'Data health',
    'admin.tab.messages': 'Messages',
    'admin.tab.photos': 'Photos',
    'admin.tab.data': 'Data & links',
    'admin.paste.title': 'Check a proposal',
    'admin.paste.lead': 'Paste one or more change codes — or a whole WhatsApp message. Each proposal is checked against the current tree.',
    'admin.paste.label': 'Codes or message',
    'admin.paste.btn': 'Preview',
    'admin.paste.clear': 'Clear',
    'admin.paste.none': 'No change code was found in the text.',
    'admin.paste.found': '{n} proposals found',
    'admin.open.title': 'Open requests',
    'admin.open.lead': 'Requests on GitHub waiting for a decision. Loaded on demand — GitHub allows 60 anonymous look-ups per hour.',
    'admin.open.load': 'Load open requests',
    'admin.open.reload': 'Refresh',
    'admin.open.loading': 'Asking GitHub…',
    'admin.open.empty': 'No open requests. Everything is up to date.',
    'admin.open.by': 'by {user}',
    'admin.open.preview': 'Preview',
    'admin.open.github': 'GitHub',
    'admin.open.all': 'All requests on GitHub',
    'admin.restore.title': 'Removed people and marriages',
    'admin.restore.lead': 'Removals are never final. Restoring adds the change to your draft; it applies once approved.',
    'admin.restore.people': 'People',
    'admin.restore.unions': 'Marriages and family groups',
    'admin.restore.none': 'Nothing has been removed.',
    'admin.restore.btn': 'Restore',
    'admin.restore.inDraft': 'In your draft',
    'admin.restore.added': 'Restore added to your draft.',
    'admin.restore.merged': 'Merged into {name} — undo the merge with /undo on its request.',
    'admin.restore.with': 'Removed together with {name}; it comes back when they are restored.',
    'admin.restore.auto': 'Removed automatically when it became empty.',
    'admin.restore.reason': 'Reason: {reason}',
    'admin.restore.on': 'Removed {date}',
    'admin.restore.request': 'request #{n}',
    'admin.restore.union2': '{a} and {b}',
    'admin.restore.union1': 'Family of {a}',
    'admin.restore.union0': 'Siblings with unknown parents',
    'admin.restore.children': '{n} children',
    'admin.health.title': 'Data health',
    'admin.health.lead': 'Automatic checks of the published data. Warnings are not errors — they point at things worth a look.',
    'admin.health.ok': 'No problems found.',
    'admin.health.errors': 'Errors',
    'admin.health.warnings': 'Warnings',
    'admin.health.dups': 'Possible duplicates',
    'admin.health.dupsLead': 'Pairs of people who may be the same person. Open both to compare; merging is done from a person’s page (More options).',
    'admin.health.noDups': 'No likely duplicates.',
    'admin.health.compare': 'Compare',
    'admin.health.showAll': 'Show all ({n})',
    'admin.dup.marked': 'marked as duplicate',
    'admin.dup.same-parents': 'same name, same parents',
    'admin.dup.same-father': 'same name, same father',
    'admin.dup.same-mother': 'same name, same mother',
    'admin.dup.same-spouse': 'same name, same spouse',
    'admin.dup.same-lineage': 'same name and lineage',
    'admin.dup.same-surname-year': 'same name, surname and birth year',
    'admin.thanks.title': 'Thank-you message',
    'admin.thanks.lead': 'After approving, send the relative a short bilingual note with links to their changes.',
    'admin.thanks.pick': 'Approved update',
    'admin.thanks.none': 'No approved updates yet.',
    'admin.news.title': 'Weekly family news',
    'admin.news.lead': 'The last 7 days at a glance — new people grouped by family, ready for the family WhatsApp group.',
    'admin.news.none': 'No updates in the last 7 days.',
    'admin.copy': 'Copy',
    'admin.change': 'Change',
    'admin.copied': 'Copied.',
    'admin.openWhatsapp': 'Open in WhatsApp',
    'admin.photo.title': 'Prepare a photo',
    'admin.photo.lead': 'Choose the person and an image. It is cropped to a square and resized to 400×400 on this device — nothing is uploaded.',
    'admin.photo.person': 'Person',
    'admin.photo.file': 'Image',
    'admin.photo.step1': 'Download the prepared photo ({file}).',
    'admin.photo.step2': 'Upload it on GitHub into the photos folder.',
    'admin.photo.step3': 'Then use “Correct info” on the person with the photo path {path} — or add it to your draft here.',
    'admin.photo.download': 'Download {file}',
    'admin.photo.upload': 'Open the GitHub upload page',
    'admin.photo.addPath': 'Add photo path to my draft',
    'admin.photo.correct': 'Correct info',
    'admin.photo.added': 'Photo path added to your draft.',
    'admin.photo.bad': 'This image could not be read. Please choose a JPEG or PNG photo.',
    'admin.data.title': 'Data and settings',
    'admin.data.download': 'Download family.json',
    'admin.data.downloadHint': 'The published data (revision {rev}, {n} people) as a file — handy as a personal backup.',
    'admin.data.links': 'Useful links',
    'admin.link.settings': 'Repository settings (Pages, collaborators)',
    'admin.link.config': 'Site settings (config.json)',
    'admin.link.guide': 'Owner guide',
    'admin.link.actions': 'Automation runs (Actions)',
    'admin.link.requests': 'All family-tree requests',
    'admin.link.changes': 'Approved updates on the site',
  },
  ar: {
    'admin.title': 'أدوات المشرف',
    'admin.lead': 'أدوات مساعدة لمراجعة الشجرة والعناية بها.',
    'admin.public': 'هذه الصفحة عامة مثل بقية الموقع، ولا شيء فيها يغيّر الشجرة بمفرده: الموافقة والتطبيق والتراجع تتمّ على GitHub، حيث لا يملك الصلاحية إلا المشرفون.',
    'admin.tab.requests': 'الطلبات',
    'admin.tab.restore': 'الاستعادة',
    'admin.tab.health': 'سلامة البيانات',
    'admin.tab.messages': 'الرسائل',
    'admin.tab.photos': 'الصور',
    'admin.tab.data': 'البيانات والروابط',
    'admin.paste.title': 'فحص مقترح',
    'admin.paste.lead': 'لصق رمز تعديلات أو أكثر، أو رسالة واتساب كاملة. يُفحص كل مقترح على الشجرة الحالية.',
    'admin.paste.label': 'الرموز أو الرسالة',
    'admin.paste.btn': 'معاينة',
    'admin.paste.clear': 'مسح',
    'admin.paste.none': 'لم يُعثر على رمز تعديلات في النص.',
    'admin.paste.found': 'عدد المقترحات: {n}',
    'admin.open.title': 'الطلبات المفتوحة',
    'admin.open.lead': 'طلبات على GitHub بانتظار القرار. تُجلب عند الحاجة فقط، إذ يسمح GitHub بستين استعلاماً في الساعة دون تسجيل دخول.',
    'admin.open.load': 'جلب الطلبات المفتوحة',
    'admin.open.reload': 'تحديث',
    'admin.open.loading': 'جارٍ الاستعلام من GitHub…',
    'admin.open.empty': 'لا توجد طلبات مفتوحة، وكل شيء محدَّث.',
    'admin.open.by': 'من {user}',
    'admin.open.preview': 'معاينة',
    'admin.open.github': 'GitHub',
    'admin.open.all': 'جميع الطلبات على GitHub',
    'admin.restore.title': 'الأشخاص والزيجات المحذوفة',
    'admin.restore.lead': 'الحذف ليس نهائياً أبداً. الاستعادة تُضاف إلى مسودتك، وتُطبَّق بعد الموافقة عليها.',
    'admin.restore.people': 'الأشخاص',
    'admin.restore.unions': 'الزيجات ومجموعات الأبناء',
    'admin.restore.none': 'لم يُحذف شيء.',
    'admin.restore.btn': 'استعادة',
    'admin.restore.inDraft': 'في مسودتك',
    'admin.restore.added': 'أُضيفت الاستعادة إلى مسودتك.',
    'admin.restore.merged': 'دُمج في {name} — يكون التراجع عن الدمج بالأمر ‎/undo‎ على طلبه.',
    'admin.restore.with': 'حُذف مع {name}، ويعود عند استعادته.',
    'admin.restore.auto': 'حُذف تلقائياً حين أصبح فارغاً.',
    'admin.restore.reason': 'السبب: {reason}',
    'admin.restore.on': 'حُذف في {date}',
    'admin.restore.request': 'الطلب رقم {n}',
    'admin.restore.union2': '{a} و{b}',
    'admin.restore.union1': 'عائلة {a}',
    'admin.restore.union0': 'إخوة مجهولو الوالدين',
    'admin.restore.children': 'عدد الأبناء: {n}',
    'admin.health.title': 'سلامة البيانات',
    'admin.health.lead': 'فحوص تلقائية للبيانات المنشورة. التنبيهات ليست أخطاء، بل إشارات إلى ما يستحق النظر.',
    'admin.health.ok': 'لا توجد مشكلات.',
    'admin.health.errors': 'الأخطاء',
    'admin.health.warnings': 'التنبيهات',
    'admin.health.dups': 'احتمال التكرار',
    'admin.health.dupsLead': 'أزواج من الأشخاص قد يكونون شخصاً واحداً. يمكن فتح الصفحتين للمقارنة، ويتمّ الدمج من صفحة الشخص (خيارات أخرى).',
    'admin.health.noDups': 'لا يوجد تكرار محتمل.',
    'admin.health.compare': 'مقارنة',
    'admin.health.showAll': 'عرض الكل ({n})',
    'admin.dup.marked': 'معلَّم بأنه مكرر',
    'admin.dup.same-parents': 'الاسم نفسه والوالدان أنفسهما',
    'admin.dup.same-father': 'الاسم نفسه والأب نفسه',
    'admin.dup.same-mother': 'الاسم نفسه والأم نفسها',
    'admin.dup.same-spouse': 'الاسم نفسه والزوج أو الزوجة نفسها',
    'admin.dup.same-lineage': 'الاسم والنسب نفسهما',
    'admin.dup.same-surname-year': 'الاسم واسم العائلة وسنة الميلاد متقاربة',
    'admin.thanks.title': 'رسالة شكر',
    'admin.thanks.lead': 'بعد الموافقة، رسالة قصيرة بلغتين لصاحب التعديلات مع روابط إليها.',
    'admin.thanks.pick': 'التحديث المعتمد',
    'admin.thanks.none': 'لا توجد تحديثات معتمدة بعد.',
    'admin.news.title': 'أخبار العائلة الأسبوعية',
    'admin.news.lead': 'خلاصة الأيام السبعة الماضية: الأفراد الجدد مجمّعين حسب العائلة، جاهزة لمجموعة العائلة على واتساب.',
    'admin.news.none': 'لا توجد تحديثات في الأيام السبعة الماضية.',
    'admin.copy': 'نسخ',
    'admin.change': 'تغيير',
    'admin.copied': 'تم النسخ.',
    'admin.openWhatsapp': 'فتح في واتساب',
    'admin.photo.title': 'تجهيز صورة',
    'admin.photo.lead': 'اختيار الشخص والصورة، فتُقصّ مربعةً ويُصغَّر حجمها إلى 400×400 على هذا الجهاز دون رفع أي شيء.',
    'admin.photo.person': 'الشخص',
    'admin.photo.file': 'الصورة',
    'admin.photo.step1': 'تنزيل الصورة المجهّزة ({file}).',
    'admin.photo.step2': 'رفعها على GitHub في مجلد الصور.',
    'admin.photo.step3': 'ثم «تصحيح المعلومات» في صفحة الشخص بمسار الصورة {path}، أو إضافته إلى مسودتك من هنا.',
    'admin.photo.download': 'تنزيل {file}',
    'admin.photo.upload': 'فتح صفحة الرفع على GitHub',
    'admin.photo.addPath': 'إضافة مسار الصورة إلى مسودتي',
    'admin.photo.correct': 'تصحيح المعلومات',
    'admin.photo.added': 'أُضيف مسار الصورة إلى مسودتك.',
    'admin.photo.bad': 'تعذّرت قراءة هذه الصورة. يُرجى اختيار صورة JPEG أو PNG.',
    'admin.data.title': 'البيانات والإعدادات',
    'admin.data.download': 'تنزيل family.json',
    'admin.data.downloadHint': 'البيانات المنشورة (النسخة {rev}، عدد الأفراد {n}) في ملف، وهو نسخة احتياطية شخصية مفيدة.',
    'admin.data.links': 'روابط مفيدة',
    'admin.link.settings': 'إعدادات المستودع (الصفحات والمشاركون)',
    'admin.link.config': 'إعدادات الموقع (config.json)',
    'admin.link.guide': 'دليل المشرف',
    'admin.link.actions': 'سجل العمليات التلقائية (Actions)',
    'admin.link.requests': 'جميع طلبات الشجرة',
    'admin.link.changes': 'التحديثات المعتمدة في الموقع',
  },
});

// Message templates (bilingual by design: the recipient may read either language).
const MSG = {
  thanksAr: 'السلام عليكم ورحمة الله 🌿\nشكراً جزيلاً على مساهمتك في شجرة العائلة. تمّت الموافقة على التعديلات وأصبحت ظاهرة في الشجرة:',
  thanksEn: 'Thank you for your contribution to the family tree! Your changes were approved and are now on the tree:',
  seeAr: 'للاطلاع:',
  seeEn: 'Have a look:',
  delayAr: 'قد يستغرق ظهور التحديث بضع دقائق.',
  delayEn: 'It may take a few minutes to appear.',
  newsAr: (date) => `🌳 أخبار العائلة — الأسبوع المنتهي في ${date}`,
  newsEn: (date) => `🌳 Family news — week ending ${date}`,
  newPeopleAr: (n) => `انضمّ إلى الشجرة أفراد جدد (العدد: ${n}):`,
  newPeopleEn: (n) => `${n} new ${n === 1 ? 'person' : 'people'} joined the tree:`,
  familyAr: (name) => `عائلة ${name}:`,
  familyEn: (name) => `Family of ${name}:`,
  othersAr: 'أفراد آخرون:',
  othersEn: 'Others:',
  updatesAr: (n) => `وأُجريت تحديثات وتصحيحات أخرى (العدد: ${n}).`,
  updatesEn: (n) => `Plus ${n} other ${n === 1 ? 'update' : 'updates'} and corrections.`,
  invitesAr: 'شجرة العائلة — نرحّب بإضافاتكم وتصحيحاتكم:',
  invitesEn: 'The family tree — additions and corrections are welcome:',
};

const TABS = ['requests', 'restore', 'health', 'messages', 'photos', 'data'];

// ---------------------------------------------------------------------------------------------------------------
// Module state
let tab = readTab();
let pasteText = '';
let pasteResults = null;    // [{analysis}|{error}] | null
let pasteBusy = false;
let openState = { status: 'idle', items: [], error: null, at: 0 };
let showAllWarnings = false;
let showAllDups = false;
let thanksPick = 0;
let photo = { person: null, url: '', blob: null, error: '' };
let lastRoot = null;

function readTab() {
  try { const v = sessionStorage.getItem('gft.admin.tab'); return TABS.includes(v) ? v : 'requests'; } catch { return 'requests'; }
}
function setTab(v) {
  tab = v;
  try { sessionStorage.setItem('gft.admin.tab', v); } catch { /* ignore */ }
  rerender();
}
function rerender() {
  if (lastRoot && lastRoot.isConnected) render(lastRoot);
}

const portal = () => store.config?.portalPath || 'family-tree';
const branch = () => store.config?.repo?.branch || 'main';
function dateText(iso) {
  if (!iso || typeof iso !== 'string') return '';
  try { return formatDate(iso.slice(0, 10), lang()) || ''; } catch { return ''; }
}

function copyBlock(text, { wa = true } = {}) {
  const area = h('textarea', { class: 'textarea admin-msg', rows: Math.min(14, Math.max(5, text.split('\n').length + 1)), readOnly: true, attrs: { 'aria-label': t('admin.copy') } });
  area.value = text;
  return h('div', { class: 'stack stack-sm' },
    area,
    h('div', { class: 'row' },
      h('button', {
        type: 'button', class: 'btn btn-primary btn-sm',
        on: { click: () => copyText(text).then((ok) => { if (ok) toast(t('admin.copied'), { type: 'success' }); else { area.select(); } }) },
      }, icon('copy', { size: 16 }), t('admin.copy')),
      wa ? h('a', { class: 'btn btn-sm', href: whatsappUrl(text, ''), target: '_blank', rel: 'noopener' }, icon('whatsapp', { size: 16 }), t('admin.openWhatsapp')) : null));
}

// ---------------------------------------------------------------------------------------------------------------
// Requests

function pasteCard() {
  const area = h('textarea', {
    id: 'admin-paste', class: 'textarea admin-paste', rows: 5, dir: 'ltr', spellcheck: false, placeholder: 'GFT1:…',
    on: { input: (e) => { pasteText = e.target.value; } },
  });
  area.value = pasteText;
  const run = async () => {
    if (!pasteText.trim() || pasteBusy) return;
    pasteBusy = true;
    rerender();
    try {
      const res = await analyzeText(pasteText);
      for (const r of res) if (r.analysis) r.analysis.onReady = rerender;
      pasteResults = res;
    } catch (e) { pasteResults = [{ error: e }]; }
    pasteBusy = false;
    rerender();
  };
  let results = null;
  if (pasteBusy) results = spinner();
  else if (pasteResults) {
    const ok = pasteResults.filter((r) => r.analysis);
    results = h('div', { class: 'stack admin-results' },
      ok.length > 1 ? h('p', { class: 'small muted' }, t('admin.paste.found', { n: ok.length })) : null,
      ...pasteResults.map((r) => (r.analysis
        ? proposalReport(r.analysis, { compact: true })
        : h('div', { class: 'notice notice-danger', attrs: { role: 'alert' } }, icon('warning'),
          h('p', null, r.error?.code === 'NO_PROPOSAL' ? t('admin.paste.none') : errorText(r.error))))));
  }
  return h('section', { class: 'card stack admin-section', attrs: { 'aria-labelledby': 'admin-paste-title' } },
    h('h2', { id: 'admin-paste-title' }, t('admin.paste.title')),
    h('p', { class: 'muted small' }, t('admin.paste.lead')),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'admin-paste' }, t('admin.paste.label')), area),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-primary', disabled: pasteBusy, on: { click: run } }, icon('eye', { size: 18 }), t('admin.paste.btn')),
      pasteResults || pasteText ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => { pasteText = ''; pasteResults = null; rerender(); } } }, t('admin.paste.clear')) : null),
    results);
}

async function loadOpen() {
  openState = { ...openState, status: 'loading', error: null };
  rerender();
  const { owner, name } = store.config.repo;
  try {
    let res;
    try {
      res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?labels=family-tree&state=open&per_page=50`, { headers: { Accept: 'application/vnd.github+json' } });
    } catch { throw Object.assign(new Error('network'), { kind: 'network' }); }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      throw Object.assign(new Error('limit'), { kind: res.status === 429 || remaining === '0' ? 'rateLimit' : 'forbidden', reset: Number(res.headers.get('x-ratelimit-reset')) || 0 });
    }
    if (!res.ok) throw Object.assign(new Error('http'), { kind: 'http', status: res.status });
    const list = await res.json();
    const items = (Array.isArray(list) ? list : []).filter((i) => !i.pull_request).map((i) => ({
      number: i.number,
      title: String(i.title || ''),
      url: String(i.html_url || ''),
      user: String(i.user?.login || ''),
      createdAt: String(i.created_at || ''),
      labels: (i.labels || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean),
    }));
    openState = { status: 'ready', items, error: null, at: Date.now() };
  } catch (e) {
    openState = { ...openState, status: 'error', error: e };
  }
  rerender();
}

const LABEL_CLASS = { approve: 'badge-verified', 'approve-deletion': 'badge-danger', 'needs-changes': 'badge-needs-info', 'deletion-request': 'badge-danger', applied: 'badge-verified' };

function openCard() {
  let body;
  if (openState.status === 'idle') {
    body = h('button', { type: 'button', class: 'btn', on: { click: loadOpen } }, icon('github', { size: 18 }), t('admin.open.load'));
  } else if (openState.status === 'loading') {
    body = spinner(t('admin.open.loading'));
  } else if (openState.status === 'error') {
    body = h('div', { class: 'notice notice-danger', attrs: { role: 'alert' } }, icon('warning'),
      h('div', null, h('p', null, errorText(openState.error)), h('button', { type: 'button', class: 'btn btn-sm', on: { click: loadOpen } }, t('pv.retry'))));
  } else if (!openState.items.length) {
    body = h('p', { class: 'admin-ok' }, icon('check', { size: 18 }), h('span', null, t('admin.open.empty')));
  } else {
    body = h('ul', { class: 'list admin-open-list' }, openState.items.map((it) => h('li', { class: 'list-item admin-open-item' },
      h('div', { class: 'admin-open-main' },
        h('p', { class: 'admin-open-title' }, h('span', { class: 'admin-open-num', dir: 'ltr' }, `#${it.number}`), ' ', bdi(it.title)),
        h('p', { class: 'small muted' }, [t('admin.open.by', { user: it.user }), dateText(it.createdAt)].filter(Boolean).join(' · ')),
        it.labels.filter((l) => l !== 'family-tree').length
          ? h('div', { class: 'chips' }, it.labels.filter((l) => l !== 'family-tree').map((l) => h('span', { class: `badge ${LABEL_CLASS[l] || ''}`.trim(), dir: 'ltr' }, l)))
          : null),
      h('div', { class: 'row admin-open-actions' },
        h('a', { class: 'btn btn-sm btn-primary', href: `#/preview/${it.number}` }, icon('eye', { size: 16 }), t('admin.open.preview')),
        h('a', { class: 'btn btn-sm', href: it.url, target: '_blank', rel: 'noopener' }, icon('github', { size: 16 }), t('admin.open.github'))))));
  }
  return h('section', { class: 'card stack admin-section', attrs: { 'aria-labelledby': 'admin-open-title' } },
    h('div', { class: 'card-header' },
      h('h2', { id: 'admin-open-title' }, t('admin.open.title')),
      openState.status === 'ready' ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: loadOpen } }, icon('restore', { size: 16 }), t('admin.open.reload')) : null),
    h('p', { class: 'muted small' }, t('admin.open.lead')),
    body,
    h('p', { class: 'small' }, h('a', { href: store.repoUrl('/issues?q=label%3Afamily-tree'), target: '_blank', rel: 'noopener' }, t('admin.open.all'))));
}

// ---------------------------------------------------------------------------------------------------------------
// Restore

let allGraphCache = { data: null, graph: null };
function allGraph() {
  if (allGraphCache.data !== store.data) allGraphCache = { data: store.data, graph: buildGraph(store.data, { includeRemoved: true }) };
  return allGraphCache.graph;
}
function anyName(id) {
  const ga = allGraph();
  const p = ga.person(id);
  if (!p) return id;
  return displayName(p, lang(), ga) || t('common.unknown');
}

function restoreOp(op) {
  const res = store.addOps([op]);
  if (res.ok) toast(t('admin.restore.added'), { type: 'success', action: { label: t('common.viewDraft'), href: '#/draft' } });
  else toast((res.errors || []).map((e) => formatIssue(e, lang(), { graph: allGraph(), withOp: false })).join(' · ') || t('common.error'), { type: 'error', timeout: 9000 });
}

function inDraft(kind, id) {
  return store.draft.ops.some((o) => (kind === 'person' ? o.op === 'restore-person' && o.id === id : o.op === 'restore-union' && o.union === id));
}

function removedMeta(r) {
  const bits = [];
  if (r?.at) bits.push(t('admin.restore.on', { date: dateText(r.at) }));
  if (r?.reasonCode) bits.push(t('admin.restore.reason', { reason: reasonLabel(r.reasonCode, lang()) }));
  if (r?.issue) bits.push(t('admin.restore.request', { n: r.issue }));
  return bits.join(' · ');
}

function restoreCard() {
  const people = store.base.removedPeople();
  const unions = store.base.removedUnions();
  const ga = allGraph();
  const personItem = (p) => {
    const r = p.removed || {};
    const merged = r.mergedInto ? ga.person(r.mergedInto) : null;
    const queued = inDraft('person', p.id);
    return h('li', { class: 'list-item admin-removed' },
      avatar(p, { size: 'sm' }),
      h('div', { class: 'admin-removed-main' },
        h('p', { class: 'admin-removed-name' }, bdi(anyName(p.id))),
        h('p', { class: 'small muted' }, removedMeta(r)),
        merged ? h('p', { class: 'small' }, t('admin.restore.merged', { name: anyName(merged.id) })) : null),
      queued ? h('span', { class: 'badge badge-pending' }, t('admin.restore.inDraft'))
        : merged ? null
          : h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => restoreOp({ op: 'restore-person', id: p.id }) } }, icon('restore', { size: 16 }), t('admin.restore.btn')));
  };
  const unionItem = (u) => {
    const r = u.removed || {};
    const parts = (u.partners || []).map(anyName);
    const label = parts.length === 2 ? t('admin.restore.union2', { a: parts[0], b: parts[1] }) : parts.length === 1 ? t('admin.restore.union1', { a: parts[0] }) : t('admin.restore.union0');
    const queued = inDraft('union', u.id);
    const withPerson = r.with ? anyName(r.with) : '';
    return h('li', { class: 'list-item admin-removed' },
      h('span', { class: 'admin-removed-icon', attrs: { 'aria-hidden': 'true' } }, icon('heart', { size: 18 })),
      h('div', { class: 'admin-removed-main' },
        h('p', { class: 'admin-removed-name' }, bdi(label)),
        h('p', { class: 'small muted' }, [removedMeta(r), (u.children || []).length ? t('admin.restore.children', { n: u.children.length }) : ''].filter(Boolean).join(' · ')),
        withPerson ? h('p', { class: 'small' }, t('admin.restore.with', { name: withPerson })) : null,
        r.auto ? h('p', { class: 'small muted' }, t('admin.restore.auto')) : null),
      queued ? h('span', { class: 'badge badge-pending' }, t('admin.restore.inDraft'))
        : h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => restoreOp({ op: 'restore-union', union: u.id }) } }, icon('restore', { size: 16 }), t('admin.restore.btn')));
  };
  return h('section', { class: 'card stack admin-section', attrs: { 'aria-labelledby': 'admin-restore-title' } },
    h('h2', { id: 'admin-restore-title' }, t('admin.restore.title')),
    h('p', { class: 'muted small' }, t('admin.restore.lead')),
    !people.length && !unions.length ? h('p', { class: 'admin-ok' }, icon('check', { size: 18 }), h('span', null, t('admin.restore.none'))) : null,
    people.length ? h('h3', { class: 'admin-sub' }, t('admin.restore.people'), ` (${fmtNumber(people.length)})`) : null,
    people.length ? h('ul', { class: 'list' }, people.map(personItem)) : null,
    unions.length ? h('h3', { class: 'admin-sub' }, t('admin.restore.unions'), ` (${fmtNumber(unions.length)})`) : null,
    unions.length ? h('ul', { class: 'list' }, unions.map(unionItem)) : null);
}

// ---------------------------------------------------------------------------------------------------------------
// Health

let healthCache = { data: null, value: null };
function health() {
  if (healthCache.data === store.data) return healthCache.value;
  let v;
  try { v = validateData(store.data); } catch (e) { v = { ok: false, errors: [{ code: 'UNEXPECTED', params: { message: String(e.message || e) } }], warnings: [] }; }
  let dups = [];
  try { dups = store.base.duplicatesSuspects(); } catch { dups = []; }
  healthCache = { data: store.data, value: { ...v, dups } };
  return healthCache.value;
}

function healthCard() {
  const hv = health();
  const ctx = { graph: store.base };
  const warnings = hv.warnings || [];
  const shownW = showAllWarnings ? warnings : warnings.slice(0, 12);
  const dups = hv.dups || [];
  const shownD = showAllDups ? dups : dups.slice(0, 12);
  return h('section', { class: 'card stack admin-section', attrs: { 'aria-labelledby': 'admin-health-title' } },
    h('h2', { id: 'admin-health-title' }, t('admin.health.title')),
    h('p', { class: 'muted small' }, t('admin.health.lead')),
    !hv.errors.length && !warnings.length ? h('p', { class: 'admin-ok' }, icon('check', { size: 18 }), h('span', null, t('admin.health.ok'))) : null,
    hv.errors.length ? h('div', { class: 'notice notice-danger' }, icon('warning'),
      h('div', null, h('p', null, h('strong', null, t('admin.health.errors')), ` (${fmtNumber(hv.errors.length)})`),
        h('ul', null, hv.errors.slice(0, 30).map((e) => h('li', null, bdi(formatIssue(e, lang(), ctx))))))) : null,
    warnings.length ? h('div', { class: 'admin-health-block' },
      h('h3', { class: 'admin-sub' }, t('admin.health.warnings'), ` (${fmtNumber(warnings.length)})`),
      h('ul', { class: 'admin-issue-list' }, shownW.map((w) => h('li', null, icon('info', { size: 16 }), bdi(formatIssue(w, lang(), ctx))))),
      warnings.length > shownW.length ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => { showAllWarnings = true; rerender(); } } }, t('admin.health.showAll', { n: warnings.length })) : null) : null,
    h('div', { class: 'admin-health-block' },
      h('h3', { class: 'admin-sub' }, t('admin.health.dups'), dups.length ? ` (${fmtNumber(dups.length)})` : ''),
      h('p', { class: 'small muted' }, t('admin.health.dupsLead')),
      dups.length
        ? h('ul', { class: 'list admin-dups' }, shownD.map(([a, b, reason]) => h('li', { class: 'list-item admin-dup' },
          h('div', { class: 'admin-dup-pair' }, personChip(a, { years: true }), h('span', { class: 'admin-dup-amp', attrs: { 'aria-hidden': 'true' } }, '≈'), personChip(b, { years: true })),
          h('span', { class: 'small muted admin-dup-reason' }, t(`admin.dup.${reason}`)),
          h('a', { class: 'btn btn-ghost btn-sm', href: `#/relationship/${encodeURIComponent(a.id)}/${encodeURIComponent(b.id)}` }, t('admin.health.compare')))))
        : h('p', { class: 'admin-ok' }, icon('check', { size: 18 }), h('span', null, t('admin.health.noDups'))),
      dups.length > shownD.length ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => { showAllDups = true; rerender(); } } }, t('admin.health.showAll', { n: dups.length })) : null));
}

// ---------------------------------------------------------------------------------------------------------------
// Messages

function changelogList() {
  const list = Array.isArray(store.changelog?.entries) ? store.changelog.entries.filter((e) => e && typeof e === 'object' && e.action !== 'undo') : [];
  return list.slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

function personLink(id, rev) {
  return store.siteLink(`#/p/${encodeURIComponent(id)}${rev ? `?rev=${rev}` : ''}`);
}

/** Bilingual thank-you text for a changelog entry. */
export function thanksText(entry) {
  const lines = (l) => {
    const arr = Array.isArray(entry.summary?.[l]) ? entry.summary[l].filter((x) => typeof x === 'string' && x.trim()) : [];
    const shown = arr.slice(0, 5).map((x) => `• ${x}`);
    if (arr.length > 5) shown.push(l === 'ar' ? `• …و${arr.length - 5} أخرى` : `• …and ${arr.length - 5} more`);
    if (!shown.length && entry.title) shown.push(`• ${String(entry.title).replace(/^[^\p{L}\p{N}]+/u, '')}`);
    return shown;
  };
  const people = (Array.isArray(entry.people) ? entry.people : []).filter((id) => typeof id === 'string').slice(0, 5);
  const links = people.length ? people.map((id) => personLink(id, entry.rev)) : [store.siteLink(`#/changes${entry.rev ? `?rev=${entry.rev}` : ''}`)];
  return [
    MSG.thanksAr, ...lines('ar'), '', MSG.seeAr, ...links, MSG.delayAr,
    '', '———', '',
    MSG.thanksEn, ...lines('en'), '', MSG.seeEn, ...links, MSG.delayEn,
  ].join('\n');
}

/** New people of the last `days` days grouped by family, from the published data's history. */
export function weeklyNews(days = 7, now = Date.now()) {
  const since = now - days * 864e5;
  const graph = store.base;
  const isRecent = (at) => { const ts = Date.parse(at || ''); return Number.isFinite(ts) && ts >= since && ts <= now + 864e5; };
  const fresh = graph.people().filter((p) => (p.history || []).some((e) => e && e.action === 'add-person' && isRecent(e.at)));
  const groupsMap = new Map();
  for (const p of fresh) {
    const parent = graph.father(p.id) || graph.mother(p.id) || graph.parents(p.id)[0] || null;
    const spouse = !parent ? (graph.spouses(p.id) || []).map((s) => s.person).find((s) => !fresh.includes(s)) : null;
    const anchor = parent || spouse || null;
    const key = anchor ? anchor.id : '';
    if (!groupsMap.has(key)) groupsMap.set(key, { anchor, people: [] });
    groupsMap.get(key).people.push({ person: p, rel: parent ? 'child' : spouse ? 'spouse' : '' });
  }
  const entries = changelogList().filter((e) => isRecent(e.at));
  return { fresh, groups: [...groupsMap.values()].sort((a, b) => (a.anchor ? 0 : 1) - (b.anchor ? 0 : 1)), entries };
}

const REL_WORD = {
  ar: { child: { m: 'ابن', f: 'ابنة', '': 'من الأبناء' }, spouse: { m: 'زوج', f: 'زوجة', '': 'زوج' } },
  en: { child: { m: 'son', f: 'daughter', '': 'child' }, spouse: { m: 'husband', f: 'wife', '': 'spouse' } },
};

export function newsText(news, now = Date.now()) {
  const date = (l) => { try { return formatDate(new Date(now).toISOString().slice(0, 10), l); } catch { return ''; } };
  const graph = store.base;
  const block = (l) => {
    const out = [l === 'ar' ? MSG.newsAr(date('ar')) : MSG.newsEn(date('en')), ''];
    if (news.fresh.length) {
      out.push(l === 'ar' ? MSG.newPeopleAr(news.fresh.length) : MSG.newPeopleEn(news.fresh.length));
      for (const gr of news.groups) {
        out.push('');
        const anchorName = gr.anchor ? (lineageName(graph, gr.anchor.id, l) || displayName(gr.anchor, l, graph)) : '';
        out.push(gr.anchor ? (l === 'ar' ? MSG.familyAr(anchorName) : MSG.familyEn(anchorName)) : (l === 'ar' ? MSG.othersAr : MSG.othersEn));
        for (const { person, rel } of gr.people) {
          const word = rel ? REL_WORD[l][rel][person.gender || ''] : '';
          out.push(`• ${displayName(person, l, graph)}${word ? ` (${word})` : ''}`);
        }
      }
    }
    const other = news.entries.length;
    if (other) { out.push(''); out.push(l === 'ar' ? MSG.updatesAr(other) : MSG.updatesEn(other)); }
    out.push('');
    out.push(l === 'ar' ? MSG.invitesAr : MSG.invitesEn);
    out.push(store.siteLink('#/changes'));
    return out;
  };
  return [...block('ar'), '', '———', '', ...block('en')].join('\n');
}

function messagesCard() {
  const entries = changelogList().slice(0, 20);
  if (thanksPick >= entries.length) thanksPick = 0;
  const select = h('select', {
    id: 'admin-thanks-pick', class: 'select',
    on: { change: (e) => { thanksPick = Number(e.target.value) || 0; rerender(); } },
  }, entries.map((e, i) => h('option', { value: String(i), selected: i === thanksPick },
    `${e.issue ? `#${e.issue} · ` : ''}${dateText(e.at)} · ${String(e.title || '').replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 70)}`)));
  const news = weeklyNews();
  const hasNews = news.fresh.length || news.entries.length;
  return h('div', { class: 'stack' },
    h('section', { class: 'card stack admin-section', attrs: { 'aria-labelledby': 'admin-thanks-title' } },
      h('h2', { id: 'admin-thanks-title' }, t('admin.thanks.title')),
      h('p', { class: 'muted small' }, t('admin.thanks.lead')),
      entries.length
        ? h('div', { class: 'stack stack-sm' },
          h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'admin-thanks-pick' }, t('admin.thanks.pick')), select),
          copyBlock(thanksText(entries[thanksPick])))
        : h('p', { class: 'muted' }, t('admin.thanks.none'))),
    h('section', { class: 'card stack admin-section', attrs: { 'aria-labelledby': 'admin-news-title' } },
      h('h2', { id: 'admin-news-title' }, t('admin.news.title')),
      h('p', { class: 'muted small' }, t('admin.news.lead')),
      hasNews ? copyBlock(newsText(news)) : h('p', { class: 'muted' }, t('admin.news.none'))));
}

// ---------------------------------------------------------------------------------------------------------------
// Photos

const PHOTO_SIZE = 400;

async function preparePhoto(file) {
  if (photo.url) { try { URL.revokeObjectURL(photo.url); } catch { /* ignore */ } }
  photo = { ...photo, url: '', blob: null, error: '' };
  try {
    let src;
    let w;
    let hgt;
    if (globalThis.createImageBitmap) {
      src = await createImageBitmap(file);
      w = src.width; hgt = src.height;
    } else {
      const url = URL.createObjectURL(file);
      src = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
      w = src.naturalWidth; hgt = src.naturalHeight;
    }
    if (!w || !hgt) throw new Error('empty');
    const side = Math.min(w, hgt);
    const sx = (w - side) / 2;
    const sy = (hgt - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('encode');
    photo = { ...photo, blob, url: URL.createObjectURL(blob), error: '' };
  } catch {
    photo = { ...photo, url: '', blob: null, error: t('admin.photo.bad') };
  }
  rerender();
}

async function openCorrectInfo(id) {
  try {
    const mod = await import('../forms/dialogs.js');
    if (typeof mod.openEditPerson === 'function') { await mod.openEditPerson(id); return; }
  } catch { /* dialogs not available yet */ }
  location.hash = `#/p/${encodeURIComponent(id)}`;
}

function photosCard() {
  const p = photo.person ? store.working.person(photo.person) : null;
  const file = p ? `${p.id}.jpg` : '<id>.jpg';
  const path = `photos/${file}`;
  const uploadUrl = store.repoUrl(`/upload/${branch()}/${portal()}/data/photos`);
  const fileInput = h('input', {
    id: 'admin-photo-file', class: 'input admin-file', type: 'file', accept: 'image/*', disabled: !p,
    on: { change: (e) => { const f = e.target.files && e.target.files[0]; if (f) preparePhoto(f); } },
  });
  return h('section', { class: 'card stack admin-section', attrs: { 'aria-labelledby': 'admin-photo-title' } },
    h('h2', { id: 'admin-photo-title' }, t('admin.photo.title')),
    h('p', { class: 'muted small' }, t('admin.photo.lead')),
    h('div', { class: 'field' },
      h('span', { class: 'field-label' }, t('admin.photo.person')),
      p ? h('div', { class: 'row' }, personChip(p), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => { photo = { person: null, url: '', blob: null, error: '' }; rerender(); } } }, t('admin.change')))
        : personPicker({ onPick: (x) => { photo = { ...photo, person: x.id }; rerender(); } })),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'admin-photo-file' }, t('admin.photo.file')), fileInput),
    photo.error ? h('p', { class: 'field-error' }, photo.error) : null,
    p && photo.url ? h('div', { class: 'admin-photo-result' },
      h('img', { class: 'admin-photo-preview', src: photo.url, alt: t('ui.photoOf', { name: nameOf(p) }), width: 160, height: 160 }),
      h('ol', { class: 'admin-steps' },
        h('li', null, t('admin.photo.step1', { file }), h('div', null, h('a', { class: 'btn btn-primary btn-sm', href: photo.url, download: file }, icon('download', { size: 16 }), t('admin.photo.download', { file })))),
        h('li', null, t('admin.photo.step2'), h('div', null, h('a', { class: 'btn btn-sm', href: uploadUrl, target: '_blank', rel: 'noopener' }, icon('github', { size: 16 }), t('admin.photo.upload')))),
        h('li', null, t('admin.photo.step3', { path }),
          h('div', { class: 'row' },
            h('button', {
              type: 'button', class: 'btn btn-sm',
              on: {
                click: () => {
                  const res = store.addOps([{ op: 'edit-person', id: p.id, set: { photo: path }, before: { photo: p.photo || '' } }]);
                  if (res.ok) toast(t('admin.photo.added'), { type: 'success', action: { label: t('common.viewDraft'), href: '#/draft' } });
                  else toast((res.errors || []).map((e) => formatIssue(e, lang(), { graph: store.working, withOp: false })).join(' · '), { type: 'error' });
                },
              },
            }, icon('plus', { size: 16 }), t('admin.photo.addPath')),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => openCorrectInfo(p.id) } }, icon('edit', { size: 16 }), t('admin.photo.correct')))))) : null);
}

// ---------------------------------------------------------------------------------------------------------------
// Data & links

function downloadData() {
  const blob = new Blob([serializeData(store.data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: 'family.json', style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function dataCard() {
  const link = (href, key, ic, external = true) => h('li', null, h('a', { class: 'sheet-item', href, target: external ? '_blank' : null, rel: external ? 'noopener' : null }, icon(ic), h('span', null, t(key))));
  return h('section', { class: 'card stack admin-section', attrs: { 'aria-labelledby': 'admin-data-title' } },
    h('h2', { id: 'admin-data-title' }, t('admin.data.title')),
    h('div', { class: 'admin-download' },
      h('button', { type: 'button', class: 'btn btn-primary', on: { click: downloadData } }, icon('download', { size: 18 }), t('admin.data.download')),
      h('p', { class: 'small muted' }, t('admin.data.downloadHint', { rev: store.data?.meta?.revision ?? 0, n: Object.keys(store.data?.people || {}).length }))),
    h('h3', { class: 'admin-sub' }, t('admin.data.links')),
    h('ul', { class: 'sheet-list admin-links' },
      link(store.repoUrl(`/blob/${branch()}/${portal()}/docs/OWNER-GUIDE.md`), 'admin.link.guide', 'info'),
      link(store.repoUrl(`/edit/${branch()}/${portal()}/config.json`), 'admin.link.config', 'edit'),
      link(store.repoUrl('/settings'), 'admin.link.settings', 'star'),
      link(store.repoUrl('/issues?q=label%3Afamily-tree'), 'admin.link.requests', 'github'),
      link(store.repoUrl('/actions'), 'admin.link.actions', 'restore'),
      link('#/changes', 'admin.link.changes', 'list', false)));
}

// ---------------------------------------------------------------------------------------------------------------

function render(root) {
  lastRoot = root;
  root.replaceChildren();
  const tabs = h('div', { class: 'tabs admin-tabs', attrs: { role: 'tablist', 'aria-label': t('admin.title') } }, TABS.map((k) => h('button', {
    type: 'button', id: `admin-tab-${k}`, attrs: { role: 'tab', 'aria-selected': String(tab === k), 'aria-controls': 'admin-panel', tabindex: tab === k ? '0' : '-1' },
    on: {
      click: () => setTab(k),
      keydown: (e) => {
        const i = TABS.indexOf(k);
        const rtl = document.documentElement.dir === 'rtl';
        let j = -1;
        if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) j = (i + 1) % TABS.length;
        else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) j = (i - 1 + TABS.length) % TABS.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = TABS.length - 1;
        if (j >= 0) { e.preventDefault(); setTab(TABS[j]); requestAnimationFrame(() => document.getElementById(`admin-tab-${TABS[j]}`)?.focus()); }
      },
    },
  }, t(`admin.tab.${k}`))));
  let panel;
  if (tab === 'requests') panel = h('div', { class: 'stack' }, pasteCard(), openCard());
  else if (tab === 'restore') panel = restoreCard();
  else if (tab === 'health') panel = healthCard();
  else if (tab === 'messages') panel = messagesCard();
  else if (tab === 'photos') panel = photosCard();
  else panel = dataCard();
  root.append(
    h('header', { class: 'page-head' }, h('h1', null, t('admin.title')), h('p', { class: 'lead' }, t('admin.lead'))),
    h('div', { class: 'notice notice-info admin-public' }, icon('info'), h('p', null, t('admin.public'))),
    tabs,
    h('div', { id: 'admin-panel', class: 'admin-panel', attrs: { role: 'tabpanel', 'aria-labelledby': `admin-tab-${tab}` } }, panel));
}

export default {
  title: () => t('admin.title'),
  render: (root) => render(root),
};
