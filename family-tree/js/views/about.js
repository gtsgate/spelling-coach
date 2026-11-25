// How it works (#/about): the four steps from proposal to publication, who approves, WhatsApp vs GitHub, the
// public-data notice and privacy, how to ask to be hidden, the deletion policy, automatic English spellings and
// how to reach the owner. Static text + links built from config.owner. See docs/SPEC.md §0, §5, §7.2.
import { h, icon } from '../dom.js';
import { t, register } from '../i18n.js';
import { store } from '../store.js';
import { ownerName, whatsappUrl } from '../ui.js';

register({
  en: {
    'about.title': 'How it works',
    'about.eyebrow': 'A guide for the family',
    'about.lead': 'This tree is built by the whole family. Anyone can suggest additions and corrections; {owner} reviews each one before it appears.',
    'about.toc': 'On this page',
    'about.stepsTitle': 'From your phone to the tree, in four steps',
    'about.step1.title': 'Find your place',
    'about.step1.text': 'Search for your name or a close relative, or browse the tree. Choosing “This is me” lets every page show how people are related to you.',
    'about.step2.title': 'Suggest changes',
    'about.step2.text': 'Add children, spouses, parents or siblings — a whole branch at once — or correct a name or a date. Your suggestions are kept on this device and marked “not sent yet”.',
    'about.step3.title': 'Send them to {owner}',
    'about.step3.text': 'One tap prepares a WhatsApp message with a summary and a short code. Nothing else is needed — no account, no app.',
    'about.step4.title': 'Review and publish',
    'about.step4.text': 'Once {owner} has checked and approved the suggestion, the tree updates within a few minutes. Until then your changes show “sent — awaiting approval”.',
    'about.startTree': 'Explore the tree',
    'about.startAdd': 'Add my family',
    'about.approveTitle': 'Who approves changes?',
    'about.approveText': 'Only {owner} can approve. Suggestions never change the tree directly: each one is checked automatically for mistakes, then reviewed by hand.',
    'about.approveUndo': 'Every approval can be undone, so a mistake is never permanent.',
    'about.approveHistory': 'The full history of every change is kept, and the latest updates are listed on the Updates page.',
    'about.updatesLink': 'See the latest updates',
    'about.sendTitle': 'WhatsApp or GitHub?',
    'about.waTitle': 'WhatsApp — recommended',
    'about.waText': 'The easiest way for everyone. The message is prepared for you; it only needs to be sent to {owner}. Voice notes and photos are welcome too.',
    'about.ghTitle': 'GitHub — optional',
    'about.ghText': 'For relatives who already have a GitHub account. The suggestion opens as a public request that {owner} approves there. Both ways lead to exactly the same result.',
    'about.privacyTitle': 'Privacy and public data',
    'about.publicNotice': 'Everything you send will be public on the internet and stays in GitHub’s public history.',
    'about.privacy1': 'The tree is not listed by search engines, but anyone with the link can open it.',
    'about.privacy2': 'For living people only the birth year is stored and shown, never the full date.',
    'about.privacy3': 'A name can be kept private: the person then appears with a respectful label such as “wife of …” or by their kunya.',
    'about.privacy4': 'Photos, jobs and personal notes are never shown for minors.',
    'about.privacy5': 'Divorces are not displayed. Sensitive family matters are better discussed with {owner} directly.',
    'about.hideTitle': 'Asking to be hidden',
    'about.hideText': 'Anyone may ask for their own details to be hidden. A short message to {owner} is enough: the name, photo and personal details are then removed from the public tree, while the family links stay in place so the tree remains correct.',
    'about.hideAsk': 'Ask {owner} on WhatsApp',
    'about.hideMessage': 'Hello, I would like my details to be hidden on the family tree. My name in the tree: ',
    'about.deleteTitle': 'How removals work',
    'about.delete1': 'Nothing is ever erased for good: a removed person is set aside and can be restored.',
    'about.delete2': 'A removal needs a reason chosen from a short list, and the person’s name must be typed to confirm.',
    'about.delete3': 'Someone who still has children in the tree cannot be removed, so no branch is ever cut off.',
    'about.delete4': 'At most three removals per suggestion, and each needs a separate, explicit approval.',
    'about.englishTitle': 'Automatic English spellings',
    'about.englishText': 'Names are written in Arabic first. When nobody has typed an English spelling, the site writes one automatically (for example محمد → Muhammad).',
    'about.englishFix': 'Automatic spellings are marked on each person’s page. Anyone can choose the spelling they prefer with “Correct info”.',
    'about.contactTitle': 'Questions?',
    'about.contactText': 'For questions about the tree, a story worth keeping, or anything that is hard to enter here, {owner} is happy to help.',
    'about.contactWa': 'Message on WhatsApp',
    'about.contactWaChoose': 'Message on WhatsApp (choose {owner})',
    'about.contactMail': 'Send an email',
    'about.contactHello': 'Hello! I have a question about our family tree: ',
  },
  ar: {
    'about.title': 'كيف يعمل الموقع',
    'about.eyebrow': 'دليل لأفراد العائلة',
    'about.lead': 'تُبنى هذه الشجرة بمشاركة العائلة كلها. يمكن لأي فرد اقتراح الإضافات والتصحيحات، ويراجع {owner} كل اقتراح قبل ظهوره.',
    'about.toc': 'في هذه الصفحة',
    'about.stepsTitle': 'من هاتفك إلى الشجرة في أربع خطوات',
    'about.step1.title': 'الوصول إلى مكانك',
    'about.step1.text': 'البحث عن اسمك أو اسم قريب لك، أو تصفّح الشجرة. واختيار «هذا أنا» يجعل كل صفحة تُظهر صلة القرابة بينك وبين الآخرين.',
    'about.step2.title': 'اقتراح التعديلات',
    'about.step2.text': 'إضافة الأبناء أو الأزواج أو الوالدين أو الإخوة — بل فرعاً كاملاً دفعة واحدة — أو تصحيح اسم أو تاريخ. تُحفظ اقتراحاتك على هذا الجهاز مع علامة «لم يُرسل بعد».',
    'about.step3.title': 'الإرسال إلى {owner}',
    'about.step3.text': 'بلمسة واحدة تُجهَّز رسالة واتساب فيها ملخّص ورمز قصير. لا حاجة إلى حساب أو تطبيق إضافي.',
    'about.step4.title': 'المراجعة والنشر',
    'about.step4.text': 'يراجع {owner} الاقتراح ويوافق عليه، فتتحدّث الشجرة خلال دقائق. وحتى ذلك الحين تظهر تعديلاتك بعلامة «أُرسل — بانتظار الموافقة».',
    'about.startTree': 'استكشاف الشجرة',
    'about.startAdd': 'إضافة عائلتي',
    'about.approveTitle': 'من يوافق على التعديلات؟',
    'about.approveText': 'الموافقة بيد {owner} وحده. لا يغيّر أي اقتراح الشجرة مباشرة: يُفحص آلياً بحثاً عن الأخطاء، ثم يُراجَع يدوياً.',
    'about.approveUndo': 'يمكن التراجع عن أي موافقة، فلا يبقى خطأ إلى الأبد.',
    'about.approveHistory': 'يُحفظ السجلّ الكامل لكل تعديل، وتُعرض آخر التحديثات في صفحة التحديثات.',
    'about.updatesLink': 'عرض آخر التحديثات',
    'about.sendTitle': 'واتساب أم GitHub؟',
    'about.waTitle': 'واتساب — الطريقة المقترحة',
    'about.waText': 'الأسهل للجميع. تُجهَّز الرسالة تلقائياً ويبقى إرسالها إلى {owner} فقط. والرسائل الصوتية والصور مرحّب بها أيضاً.',
    'about.ghTitle': 'GitHub — اختياري',
    'about.ghText': 'لمن لديه حساب على GitHub. يُفتح الاقتراح طلباً عاماً يوافق عليه {owner} هناك. والطريقتان تؤدّيان إلى النتيجة نفسها تماماً.',
    'about.privacyTitle': 'الخصوصية والبيانات العامة',
    'about.publicNotice': 'كل ما ترسله سيكون مرئياً لأي شخص على الإنترنت ويبقى في سجل GitHub العام.',
    'about.privacy1': 'لا تظهر الشجرة في محركات البحث، لكن يمكن لأي شخص لديه الرابط فتحها.',
    'about.privacy2': 'للأحياء تُحفظ سنة الميلاد فقط وتُعرض، لا التاريخ الكامل.',
    'about.privacy3': 'يمكن عدم نشر الاسم، فيظهر الشخص بوصف لائق مثل «حرم فلان» أو بكنيته.',
    'about.privacy4': 'لا تُعرض الصور أو المهن أو النبذ الشخصية للقاصرين.',
    'about.privacy5': 'لا يُعرض الطلاق. والأمور العائلية الحساسة يُفضَّل الحديث فيها مع {owner} مباشرة.',
    'about.hideTitle': 'طلب الإخفاء',
    'about.hideText': 'لكل فرد أن يطلب إخفاء معلوماته. تكفي رسالة قصيرة إلى {owner}: يُزال الاسم والصورة والتفاصيل الشخصية من الشجرة العامة، وتبقى صلات القرابة في مكانها لتظل الشجرة صحيحة.',
    'about.hideAsk': 'مراسلة {owner} عبر واتساب',
    'about.hideMessage': 'السلام عليكم، أرغب في إخفاء معلوماتي في شجرة العائلة. اسمي في الشجرة: ',
    'about.deleteTitle': 'كيف يتمّ الحذف',
    'about.delete1': 'لا يُمحى شيء نهائياً: الشخص المحذوف يُنحّى جانباً ويمكن استعادته.',
    'about.delete2': 'يتطلّب الحذف اختيار سبب من قائمة قصيرة، وكتابة اسم الشخص للتأكيد.',
    'about.delete3': 'لا يمكن حذف من له أبناء في الشجرة، فلا ينقطع أي فرع.',
    'about.delete4': 'ثلاث عمليات حذف على الأكثر في كل اقتراح، ولكلٍّ منها موافقة مستقلة وصريحة.',
    'about.englishTitle': 'التهجئة الإنجليزية التلقائية',
    'about.englishText': 'تُكتب الأسماء بالعربية أولاً. وإن لم يُدخل أحد تهجئة إنجليزية، يكتبها الموقع تلقائياً (مثل محمد ← Muhammad).',
    'about.englishFix': 'تُميَّز التهجئة التلقائية في صفحة كل شخص، ولكلٍّ أن يختار التهجئة التي يفضّلها عبر «تصحيح المعلومات».',
    'about.contactTitle': 'هل لديك سؤال؟',
    'about.contactText': 'يسعد {owner} بالمساعدة — في الشجرة، أو في قصة تستحق أن تُحفظ، أو في أي أمر يصعب إدخاله هنا.',
    'about.contactWa': 'المراسلة عبر واتساب',
    'about.contactWaChoose': 'المراسلة عبر واتساب (باختيار {owner})',
    'about.contactMail': 'إرسال بريد إلكتروني',
    'about.contactHello': 'السلام عليكم، لديّ سؤال عن شجرة العائلة: ',
  },
});

const SECTIONS = [
  { id: 'about-steps', key: 'about.stepsTitle', icon: 'tree' },
  { id: 'about-approve', key: 'about.approveTitle', icon: 'check' },
  { id: 'about-send', key: 'about.sendTitle', icon: 'send' },
  { id: 'about-privacy', key: 'about.privacyTitle', icon: 'eye' },
  { id: 'about-hide', key: 'about.hideTitle', icon: 'user' },
  { id: 'about-delete', key: 'about.deleteTitle', icon: 'restore' },
  { id: 'about-english', key: 'about.englishTitle', icon: 'globe' },
  { id: 'about-contact', key: 'about.contactTitle', icon: 'mail' },
];

function sectionHead(id, ic) {
  const s = SECTIONS.find((x) => x.id === id);
  return h('h2', { id: `${id}-title`, class: 'about-h' },
    h('span', { class: 'about-h-icon', attrs: { 'aria-hidden': 'true' } }, icon(ic || s.icon, { size: 20 })),
    h('span', null, t(s.key)));
}

function bullets(keys, vars) {
  return h('ul', { class: 'about-bullets' }, keys.map((k) => h('li', null, t(k, vars))));
}

function steps(owner) {
  const items = [1, 2, 3, 4].map((n) => h('li', { class: 'about-step' },
    h('span', { class: 'about-step-num', attrs: { 'aria-hidden': 'true' } }, String(n)),
    h('h3', { class: 'about-step-title' }, t(`about.step${n}.title`, { owner })),
    h('p', { class: 'about-step-text muted' }, t(`about.step${n}.text`, { owner }))));
  return h('section', { id: 'about-steps', class: 'about-section about-steps-section', attrs: { 'aria-labelledby': 'about-steps-title' } },
    h('div', { class: 'section-title' }, h('h2', { id: 'about-steps-title' }, t('about.stepsTitle'))),
    h('ol', { class: 'about-steps' }, items),
    h('div', { class: 'about-start row' },
      h('a', { class: 'btn btn-primary', href: '#/tree' }, icon('tree'), t('about.startTree')),
      h('a', { class: 'btn', href: '#/add-family' }, icon('plus'), t('about.startAdd'))));
}

function contactLinks(owner, text, { primary = true } = {}) {
  const cfg = store.config?.owner || {};
  const number = String(cfg.whatsapp || '').replace(/[^0-9]/g, '');
  const links = [
    h('a', {
      class: ['btn', primary ? 'btn-primary' : '', 'about-wa'], href: whatsappUrl(text, number), target: '_blank', rel: 'noopener',
    }, icon('whatsapp'), number ? t('about.contactWa') : t('about.contactWaChoose', { owner })),
  ];
  if (cfg.email) {
    const subject = t('app.title');
    links.push(h('a', {
      class: 'btn', href: `mailto:${encodeURIComponent(cfg.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
    }, icon('mail'), t('about.contactMail')));
  }
  return h('div', { class: 'row about-contact-links' }, links);
}

function render(root) {
  const owner = ownerName();
  const cfg = store.config?.owner || {};
  const number = String(cfg.whatsapp || '').replace(/[^0-9]/g, '');

  const toc = h('nav', { class: 'about-toc', attrs: { 'aria-label': t('about.toc') } },
    h('p', { class: 'about-toc-title small muted' }, t('about.toc')),
    h('ul', null, SECTIONS.map((s) => h('li', null,
      h('a', {
        href: `#${s.id}`,
        on: {
          click: (e) => {
            // Hash routing owns location.hash: scroll to the section without navigating.
            e.preventDefault();
            const el = document.getElementById(s.id);
            if (!el) return;
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
            el.querySelector('h2')?.setAttribute('tabindex', '-1');
            el.querySelector('h2')?.focus({ preventScroll: true });
          },
        },
      }, icon(s.icon, { size: 16 }), h('span', null, t(s.key)))))));

  const approve = h('section', { id: 'about-approve', class: 'card about-section', attrs: { 'aria-labelledby': 'about-approve-title' } },
    sectionHead('about-approve'),
    h('p', null, t('about.approveText', { owner })),
    bullets(['about.approveUndo', 'about.approveHistory']),
    h('a', { class: 'about-more', href: '#/changes' }, t('about.updatesLink'), icon('chevronEnd', { size: 16, className: 'flip-rtl' })));

  const send = h('section', { id: 'about-send', class: 'card about-section', attrs: { 'aria-labelledby': 'about-send-title' } },
    sectionHead('about-send'),
    h('div', { class: 'about-ways' },
      h('div', { class: 'about-way about-way-wa' },
        h('span', { class: 'about-way-icon', attrs: { 'aria-hidden': 'true' } }, icon('whatsapp', { size: 22 })),
        h('div', null, h('h3', null, t('about.waTitle')), h('p', { class: 'muted' }, t('about.waText', { owner })))),
      h('div', { class: 'about-way about-way-gh' },
        h('span', { class: 'about-way-icon', attrs: { 'aria-hidden': 'true' } }, icon('github', { size: 22 })),
        h('div', null, h('h3', null, t('about.ghTitle')), h('p', { class: 'muted' }, t('about.ghText', { owner }))))));

  const privacy = h('section', { id: 'about-privacy', class: 'card about-section', attrs: { 'aria-labelledby': 'about-privacy-title' } },
    sectionHead('about-privacy'),
    h('div', { class: 'notice notice-warning about-public', attrs: { role: 'note' } },
      icon('warning'), h('p', null, h('strong', null, t('about.publicNotice')))),
    bullets(['about.privacy1', 'about.privacy2', 'about.privacy3', 'about.privacy4', 'about.privacy5'], { owner }));

  const meName = store.me && store.working.person(store.me) ? store.siteLink(`#/p/${encodeURIComponent(store.me)}`) : '';
  const hide = h('section', { id: 'about-hide', class: 'card about-section', attrs: { 'aria-labelledby': 'about-hide-title' } },
    sectionHead('about-hide'),
    h('p', null, t('about.hideText', { owner })),
    h('a', {
      class: 'btn about-wa', href: whatsappUrl(t('about.hideMessage') + meName, number), target: '_blank', rel: 'noopener',
    }, icon('whatsapp'), t('about.hideAsk', { owner })));

  const del = h('section', { id: 'about-delete', class: 'card about-section', attrs: { 'aria-labelledby': 'about-delete-title' } },
    sectionHead('about-delete'),
    bullets(['about.delete1', 'about.delete2', 'about.delete3', 'about.delete4']));

  const english = h('section', { id: 'about-english', class: 'card about-section', attrs: { 'aria-labelledby': 'about-english-title' } },
    sectionHead('about-english'),
    h('p', null, t('about.englishText')),
    h('p', { class: 'muted' }, t('about.englishFix')));

  const contact = h('section', { id: 'about-contact', class: 'card card-accent about-section about-contact', attrs: { 'aria-labelledby': 'about-contact-title' } },
    sectionHead('about-contact'),
    h('p', null, t('about.contactText', { owner })),
    contactLinks(owner, t('about.contactHello')));

  root.append(
    h('header', { class: 'page-head about-head' },
      h('p', { class: 'about-eyebrow' }, t('about.eyebrow')),
      h('h1', null, t('about.title')),
      h('p', { class: 'lead' }, t('about.lead', { owner }))),
    steps(owner),
    h('div', { class: 'ornament', attrs: { 'aria-hidden': 'true' } }),
    h('div', { class: 'about-layout' },
      toc,
      h('div', { class: 'about-cards' }, approve, send, privacy, hide, del, english, contact)));
}

export default {
  title: () => t('about.title'),
  render(root) {
    render(root);
  },
};
