// Dialogs for proposing changes (docs/SPEC.md §3.3, §3.4, §7.4, §7.5). Every export takes a person id and resolves
// to true when operations were added to the visitor's draft proposal (false when cancelled):
//
//   openEditPerson(id)            "Correct info"
//   openAddRelative(id, as)       as: 'child' | 'spouse' | 'parent' | 'sibling'
//   openAddRelativeSheet(id)      4 big tiles → the specific add dialog
//   openMarkAs(id)                deceased / living / verified / needs-info / duplicate / private …
//   openReorderChildren(id)       picks the union when there are several
//   openReorderSpouses(id)
//   openChangeParents(id)         move-person (REPARENT needs a separate approval)
//   openLinkExisting(id)          link someone already in the tree as spouse / child / parent
//   openMerge(id)                 merge a duplicate record
//   openRequestRemoval(id)        soft removal with reason code + typed-name confirmation
//   openMoreOptions(id)           sheet listing the secondary actions of the person page
//
// Each dialog builds ops, trial-applies them on top of the draft (errors stay inline and the dialog stays open;
// warnings such as POSSIBLE_DUPLICATE / NAME_LOOKS_FULL / MINOR_DETAIL / STALE_EDIT / REPARENT are shown for
// confirmation), then store.addOps() and a toast linking to #/draft. Before adding a person, a quick duplicate check
// asks "Is it one of these?" so an existing record can be linked instead. Never inserts user data as HTML.
import { h, icon, bdi, toast, copyText } from '../dom.js';
import { t, register, lang } from '../i18n.js';
import { store } from '../store.js';
import { nameOf, lineageOf, avatar, nameLabel, yearsOf, whatsappUrl, ownerName } from '../ui.js';
import { personPicker, neighbourhood } from './picker.js';
import { personForm, dateInput, field, bilingualInputs } from './person-form.js';
import { formatIssue } from '../core/messages.js';
import { refNames } from '../core/describe.js';
import { opRefs } from '../core/ops.js';
import { REASON_CODES, LIMITS, isPersonId, isUnionId, isTempUnionRef } from '../core/schema.js';
import { normalizeArabic, skeletonKey, personName } from '../core/names.js';
import { englishOf } from '../core/translit.js';

register({
  en: {
    'dlg.saveToDraft': 'Save to my proposal',
    'dlg.addToDraft': 'Add to my proposal',
    'dlg.addAnyway': 'Yes, add it anyway',
    'dlg.confirmWarnings': 'Please check these points before continuing:',
    'dlg.fixErrors': 'This cannot be added yet:',
    'dlg.nothingChanged': 'Nothing was changed.',
    'dlg.cancel': 'Cancel',
    'dlg.back': 'Back',
    'dlg.next': 'Next',
    'dlg.close': 'Close',
    'dlg.of': 'of {name}',
    'dlg.pendingOnly': '{name} is only in your proposal so far. To undo it, remove that change on the proposal page.',
    'dlg.openDraft': 'Open my proposal',
    'dlg.reviewNote': 'Nothing changes on the tree until {owner} reviews and approves your proposal.',
    // add relative
    'dlg.add.child': 'Add a son or daughter',
    'dlg.add.spouse': 'Add a husband or wife',
    'dlg.add.parent': 'Add a father or mother',
    'dlg.add.sibling': 'Add a brother or sister',
    'dlg.addRelative': 'Add a relative',
    'dlg.addRelativeOf': 'Add a relative of {name}',
    'dlg.tile.child': 'Son or daughter',
    'dlg.tile.spouse': 'Husband or wife',
    'dlg.tile.parent': 'Father or mother',
    'dlg.tile.sibling': 'Brother or sister',
    'dlg.tile.parentsFull': 'Both are recorded',
    'dlg.wizardHint': 'Adding a whole family at once?',
    'dlg.wizardLink': 'Use the family wizard',
    'dlg.otherParent.f': 'Who is the mother?',
    'dlg.otherParent.m': 'Who is the father?',
    'dlg.otherParent.u': 'Who is the other parent?',
    'dlg.withSpouse': '{name}',
    'dlg.anotherMother': 'Another mother (not listed)',
    'dlg.anotherFather': 'Another father (not listed)',
    'dlg.anotherParent': 'Another parent (not listed)',
    'dlg.anotherHint': 'Will be added as a spouse of {name} too.',
    'dlg.parentUnknown': 'Not known',
    'dlg.parentUnknownHint': 'It can be added later.',
    'dlg.otherName': 'Her or his first name',
    'dlg.otherNameRequired': 'Please write the name, or choose “Not known”.',
    'dlg.chooseOne': 'Please choose one of the options.',
    'dlg.kind': 'This child is…',
    'dlg.kindToggle': 'A child by kafala or nursing?',
    'dlg.kind.bio': 'Their own child',
    'dlg.kind.foster': 'Raised under kafala (foster child)',
    'dlg.kind.milk': 'A milk child (nursed — rada’a)',
    'dlg.kind.tieHint': 'This records a kafala or nursing bond, not parentage.',
    'dlg.spouseSearch': 'Is the husband or wife already in the tree?',
    'dlg.spouseSearchHint': 'Spouses from another branch may already be listed — linking keeps one record per person.',
    'dlg.spouseNew': 'Not in the tree — add a new person',
    'dlg.spouseStatus': 'Marriage',
    'dlg.current': 'Current marriage',
    'dlg.former': 'Former (ended)',
    'dlg.linkThem': 'Link them',
    'dlg.chosen': 'Chosen:',
    'dlg.change': 'Change',
    'dlg.parentsFull': 'Both parents of {name} are already in the tree. To replace one of them, use “Change parents”.',
    'dlg.changeParents': 'Change parents',
    'dlg.scope': 'Is this also the {role} of {siblings}?',
    'dlg.scope.union': 'Yes, of all of them',
    'dlg.scope.only': 'No, only of {name}',
    'dlg.role.m': 'father',
    'dlg.role.f': 'mother',
    'dlg.role.u': 'parent',
    'dlg.share': 'Which parents do they share?',
    'dlg.share.both': 'Same father and mother',
    'dlg.share.father': 'Same father only',
    'dlg.share.mother': 'Same mother only',
    'dlg.share.noFather': 'The father is not recorded yet.',
    'dlg.share.noMother': 'The mother is not recorded yet.',
    'dlg.share.noParents': 'Parents are not recorded yet — they will be grouped as siblings.',
    'dlg.siblingOther.m': 'Their mother',
    'dlg.siblingOther.f': 'Their father',
    // duplicates
    'dlg.dupTitle': 'Is it one of these?',
    'dlg.dupLead': 'These people in the tree have a similar name. If one of them is the same person, linking avoids a duplicate.',
    'dlg.dupYes': 'Yes, link them',
    'dlg.dupNo': 'No, add a new person',
    'dlg.dupNoParents': 'No parents recorded',
    // edit
    'dlg.edit': 'Correct the information',
    'dlg.editLead': 'Change only what needs correcting. Empty fields can be filled in.',
    // mark
    'dlg.mark': 'Mark as…',
    'dlg.mark.deceased': 'Passed away',
    'dlg.mark.deceasedHint': 'The date of death can be added if known.',
    'dlg.mark.living': 'Living (not deceased)',
    'dlg.mark.livingHint': 'Removes the recorded death.',
    'dlg.mark.verified': 'Verified',
    'dlg.mark.verifiedHint': 'The details were confirmed with the family.',
    'dlg.mark.unverified': 'Not verified',
    'dlg.mark.unverifiedHint': 'Removes the “verified” mark.',
    'dlg.mark.needs-info': 'Needs information',
    'dlg.mark.needsInfoHint': 'Asks relatives to help complete this person’s details.',
    'dlg.mark.needsInfoNote': 'What is missing?',
    'dlg.mark.needsInfoPh': 'e.g. the mother’s name, the year of birth',
    'dlg.mark.info-complete': 'Information complete',
    'dlg.mark.infoCompleteHint': 'Removes the “needs information” request.',
    'dlg.mark.duplicate': 'Duplicate of another record',
    'dlg.mark.duplicateHint': 'Flags it for the owner. To combine the two records, use “Merge a duplicate”.',
    'dlg.mark.duplicateOf': 'Which record is the same person?',
    'dlg.mark.duplicateRequired': 'Please choose the other record.',
    'dlg.mark.not-duplicate': 'Not a duplicate',
    'dlg.mark.notDuplicateHint': 'Clears the duplicate flag.',
    'dlg.mark.private': 'Private (hide details)',
    'dlg.mark.privateHint': 'For someone who asked to be hidden: the name is withheld and the place of birth, work, bio and photo are cleared; only the birth year stays. Family links are kept.',
    'dlg.mark.deathDate': 'Year of death (optional)',
    // reorder
    'dlg.reorderChildren': 'Re-arrange children',
    'dlg.reorderSpouses': 'Re-arrange spouses',
    'dlg.reorderLead': 'Drag the handle, or use the arrow buttons, to put them in the right order (eldest first).',
    'dlg.reorderSpousesLead': 'Drag the handle, or use the arrow buttons, to put the marriages in order (first marriage first).',
    'dlg.whichFamily': 'Which family?',
    'dlg.childrenWith': 'Children with {name}',
    'dlg.childrenOtherUnknown': 'Children (other parent not recorded)',
    'dlg.nChildren': '{n} children',
    'dlg.moveUp': 'Move {name} up',
    'dlg.moveDown': 'Move {name} down',
    'dlg.dragHandle': 'Drag to move {name}. Arrow keys move it too.',
    'dlg.movedTo': '{name}: position {n}',
    'dlg.sortByYear': 'Sort by year of birth',
    'dlg.nothingToReorder': 'There is nothing to re-arrange here yet.',
    'dlg.unknownSpouse': 'Spouse not recorded',
    'dlg.cannotReorderNew': 'This family was just created in your proposal; it can be re-arranged after it is approved.',
    // change parents
    'dlg.changeParentsLead': 'Choose the correct father and mother of {name}. Only {name} moves; brothers and sisters stay as they are.',
    'dlg.reparentWarn': 'Replacing a parent who is already recorded moves {name} and their descendants to another branch, so it needs the owner’s separate approval.',
    'dlg.father': 'Father',
    'dlg.mother': 'Mother',
    'dlg.notKnown': 'Not known',
    'dlg.clear': 'Clear',
    'dlg.pickParent': 'Search for the {role}…',
    'dlg.needOneParent': 'Please choose at least one parent.',
    'dlg.current': 'Current marriage',
    // link existing
    'dlg.link': 'Link a person already in the tree',
    'dlg.linkLead': 'For someone who is already in the tree but not yet connected to {name}.',
    'dlg.linkAs': '{name} is their…',
    'dlg.linkAs.spouse': 'Husband or wife',
    'dlg.linkAs.child': 'Son or daughter',
    'dlg.linkAs.parent': 'Father or mother',
    'dlg.linkAs.sibling': 'Brother or sister',
    'dlg.linkPick': 'Who?',
    'dlg.linkPickRequired': 'Please choose a person.',
    'dlg.linkReparent': '{name} already has parents recorded. Moving them needs the owner’s separate approval.',
    'dlg.noSiblingUnion': 'Please add a parent of {name} first, then link the brother or sister.',
    'dlg.parentSameGender': '{name} already has a {role} recorded.',
    // merge
    'dlg.merge': 'Merge a duplicate',
    'dlg.mergeLead': 'When the same person was entered twice, the two records can be combined into one. Details, marriages and children are kept.',
    'dlg.mergeApproval': 'Merging needs the owner’s special approval before it appears.',
    'dlg.mergePick': 'Which record is the same person as {name}?',
    'dlg.mergeKeep': 'Which record should stay?',
    'dlg.mergeKeepThis': 'Keep this one',
    'dlg.mergeParents': 'They have different parents. Which parents are correct?',
    'dlg.mergeParentsOf': 'The parents of this record: {names}',
    'dlg.mergeNew': 'Only records that are already approved can be merged.',
    'dlg.mergeRequired': 'Please choose the duplicate record.',
    'dlg.mergeStats': '{p} parents · {s} spouses · {c} children',
    // removal
    'dlg.remove': 'Request removal',
    'dlg.removeLead': 'Removal hides {name} from the tree. It can be restored later, and it needs the owner’s separate approval.',
    'dlg.removeReason': 'Why should it be removed?',
    'dlg.reason.duplicate': 'This person is listed twice',
    'dlg.reason.entered-by-mistake': 'Added by mistake',
    'dlg.reason.wrong-parents': 'Linked to the wrong family',
    'dlg.reason.person-requested': 'The person asked to be removed',
    'dlg.reason.other': 'Another reason',
    'dlg.reasonChoose': 'Choose a reason…',
    'dlg.reasonRequired': 'Please choose a reason.',
    'dlg.reasonDuplicateHint': 'Merging keeps the information of both records — usually better than removing.',
    'dlg.reasonWrongParentsHint': 'If only the parents are wrong, changing the parents keeps this person in the tree.',
    'dlg.reasonOther': 'Reasons are never published. Please explain the reason privately to {owner} on WhatsApp.',
    'dlg.reasonOtherLink': 'Message {owner} on WhatsApp',
    'dlg.reasonOtherText': 'About removing {name} from the family tree: {link}',
    'dlg.useMerge': 'Merge a duplicate instead',
    'dlg.useChangeParents': 'Change parents instead',
    'dlg.consequences': 'What will happen',
    'dlg.cons.hidden': '{name} will no longer appear in the tree (the record is kept and can be restored).',
    'dlg.cons.unions': 'The marriage records with {names} will be hidden too.',
    'dlg.cons.approval': 'The owner must approve removals separately.',
    'dlg.blockedChildren': '{name} has children in the tree ({names}). Removing {name} would cut them off from the family, so it is not possible.',
    'dlg.blockedChildrenHint': 'If {name} was linked to the wrong parents, change the parents. If it is a duplicate, merge the two records.',
    'dlg.blockedRoot': '{name} is the root of the family tree and cannot be removed.',
    'dlg.typeName': 'To confirm, please type the name: {name}',
    'dlg.typeNameWrong': 'The name does not match yet.',
    'dlg.redact': 'Also erase their personal details completely',
    'dlg.redactHint': 'Recommended when the person asked to be removed: the name and details are cleared, not just hidden.',
    'dlg.removeSubmit': 'Request removal',
    // more options
    'dlg.more': 'More options',
    'dlg.group.change': 'Changes',
    'dlg.group.share': 'Share and explore',
    'dlg.opt.mark': 'Mark as…',
    'dlg.opt.markHint': 'Passed away, verified, needs information, private…',
    'dlg.opt.reorderChildren': 'Re-arrange children',
    'dlg.opt.reorderSpouses': 'Re-arrange spouses',
    'dlg.opt.changeParents': 'Change parents',
    'dlg.opt.link': 'Link a person already in the tree',
    'dlg.opt.merge': 'Merge a duplicate',
    'dlg.opt.share': 'Share on WhatsApp',
    'dlg.opt.invite': 'Invite a relative to add their family',
    'dlg.opt.tree': 'View in the tree',
    'dlg.opt.ancestors': 'View ancestors',
    'dlg.opt.related': 'How are we related?',
    'dlg.opt.remove': 'Request removal',
    'dlg.shareText': '{name} — on our family tree:\n{link}',
    'dlg.invite': 'Invite a relative',
    'dlg.inviteLead': 'Send this link to a relative from {name}’s family. It opens a simple form to add their own family.',
    'dlg.inviteText': 'Salam! Our family tree is online. Please add your family here — it only takes a few minutes:\n{link}',
    'dlg.copyLink': 'Copy the link',
    'dlg.linkCopied': 'Link copied',
    'dlg.copyFailed': 'Could not copy — please select the link and copy it.',
    'dlg.sendWhatsApp': 'Send on WhatsApp',
  },
  ar: {
    'dlg.saveToDraft': 'حفظ في مقترحي',
    'dlg.addToDraft': 'إضافة إلى مقترحي',
    'dlg.addAnyway': 'نعم، المتابعة رغم ذلك',
    'dlg.confirmWarnings': 'يُرجى التحقق من هذه النقاط قبل المتابعة:',
    'dlg.fixErrors': 'تعذّرت الإضافة بعد:',
    'dlg.nothingChanged': 'لم يتغيّر شيء.',
    'dlg.cancel': 'إلغاء',
    'dlg.back': 'رجوع',
    'dlg.next': 'التالي',
    'dlg.close': 'إغلاق',
    'dlg.of': 'لـ{name}',
    'dlg.pendingOnly': '{name} موجود في مقترحك فقط حتى الآن. للتراجع عنه يمكن حذف ذلك التعديل من صفحة المقترح.',
    'dlg.openDraft': 'فتح مقترحي',
    'dlg.reviewNote': 'لا يتغيّر شيء في الشجرة قبل أن يراجع {owner} مقترحك ويوافق عليه.',
    'dlg.add.child': 'إضافة ابن أو ابنة',
    'dlg.add.spouse': 'إضافة زوج أو زوجة',
    'dlg.add.parent': 'إضافة والد أو والدة',
    'dlg.add.sibling': 'إضافة أخ أو أخت',
    'dlg.addRelative': 'إضافة قريب',
    'dlg.addRelativeOf': 'إضافة قريب لـ{name}',
    'dlg.tile.child': 'ابن أو ابنة',
    'dlg.tile.spouse': 'زوج أو زوجة',
    'dlg.tile.parent': 'والد أو والدة',
    'dlg.tile.sibling': 'أخ أو أخت',
    'dlg.tile.parentsFull': 'كلاهما مسجّل',
    'dlg.wizardHint': 'لإضافة عائلة كاملة دفعة واحدة:',
    'dlg.wizardLink': 'معالج إضافة العائلة',
    'dlg.otherParent.f': 'من هي الأم؟',
    'dlg.otherParent.m': 'من هو الأب؟',
    'dlg.otherParent.u': 'من هو الوالد الآخر؟',
    'dlg.withSpouse': '{name}',
    'dlg.anotherMother': 'أمّ أخرى (غير موجودة في القائمة)',
    'dlg.anotherFather': 'أب آخر (غير موجود في القائمة)',
    'dlg.anotherParent': 'والد آخر (غير موجود في القائمة)',
    'dlg.anotherHint': 'ستُضاف أيضاً زوجاً أو زوجةً لـ{name}.',
    'dlg.parentUnknown': 'غير معروف',
    'dlg.parentUnknownHint': 'يمكن إضافته لاحقاً.',
    'dlg.otherName': 'الاسم الأول',
    'dlg.otherNameRequired': 'يُرجى كتابة الاسم، أو اختيار «غير معروف».',
    'dlg.chooseOne': 'يُرجى اختيار أحد الخيارات.',
    'dlg.kind': 'هذا الطفل…',
    'dlg.kindToggle': 'طفل بالكفالة أو الرضاعة؟',
    'dlg.kind.bio': 'من الأبناء (نسباً)',
    'dlg.kind.foster': 'مكفول في رعايته (كفالة)',
    'dlg.kind.milk': 'من الرضاعة',
    'dlg.kind.tieHint': 'يُسجَّل هذا رابطَ كفالة أو رضاعة، لا نسباً.',
    'dlg.spouseSearch': 'هل الزوج أو الزوجة موجود في الشجرة من قبل؟',
    'dlg.spouseSearchHint': 'قد يكون مسجّلاً في فرع آخر من العائلة، والربط يُبقي سجلاً واحداً لكل شخص.',
    'dlg.spouseNew': 'غير موجود — إضافة شخص جديد',
    'dlg.spouseStatus': 'الزواج',
    'dlg.current': 'زواج قائم',
    'dlg.former': 'زواج سابق (انتهى)',
    'dlg.linkThem': 'ربطهما',
    'dlg.chosen': 'تم اختيار:',
    'dlg.change': 'تغيير',
    'dlg.parentsFull': 'والدا {name} مسجّلان في الشجرة. لاستبدال أحدهما يمكن استخدام «تغيير الوالدين».',
    'dlg.changeParents': 'تغيير الوالدين',
    'dlg.scope': 'هل هو كذلك {role} {siblings}؟',
    'dlg.scope.union': 'نعم، لهم جميعاً',
    'dlg.scope.only': 'لا، لـ{name} فقط',
    'dlg.role.m': 'والد',
    'dlg.role.f': 'والدة',
    'dlg.role.u': 'أحد والدَي',
    'dlg.share': 'ما الوالدان المشتركان؟',
    'dlg.share.both': 'الأب والأم نفسهما (شقيق)',
    'dlg.share.father': 'الأب فقط (أخ لأب)',
    'dlg.share.mother': 'الأم فقط (أخ لأم)',
    'dlg.share.noFather': 'الأب غير مسجّل بعد.',
    'dlg.share.noMother': 'الأم غير مسجّلة بعد.',
    'dlg.share.noParents': 'الوالدان غير مسجّلين بعد — سيُجمعان إخوةً.',
    'dlg.siblingOther.m': 'والدته',
    'dlg.siblingOther.f': 'والده',
    'dlg.dupTitle': 'هل هو أحد هؤلاء؟',
    'dlg.dupLead': 'في الشجرة أشخاص بأسماء مشابهة. إن كان أحدهم هو الشخص نفسه، فربطه يمنع التكرار.',
    'dlg.dupYes': 'نعم، ربطهما',
    'dlg.dupNo': 'لا، إضافة شخص جديد',
    'dlg.dupNoParents': 'والداه غير مسجّلين',
    'dlg.edit': 'تصحيح المعلومات',
    'dlg.editLead': 'يكفي تعديل ما يحتاج إلى تصحيح، ويمكن ملء الحقول الفارغة.',
    'dlg.mark': 'تحديد الحالة',
    'dlg.mark.deceased': 'انتقل إلى رحمة الله',
    'dlg.mark.deceasedHint': 'يمكن إضافة تاريخ الوفاة إن كان معروفاً.',
    'dlg.mark.living': 'على قيد الحياة',
    'dlg.mark.livingHint': 'يُلغي تسجيل الوفاة.',
    'dlg.mark.verified': 'معلومات موثّقة',
    'dlg.mark.verifiedHint': 'تم التأكد من التفاصيل مع العائلة.',
    'dlg.mark.unverified': 'غير موثّقة',
    'dlg.mark.unverifiedHint': 'يُزيل علامة التوثيق.',
    'dlg.mark.needs-info': 'تنقصه معلومات',
    'dlg.mark.needsInfoHint': 'يطلب من الأقارب المساعدة في استكمال بياناته.',
    'dlg.mark.needsInfoNote': 'ما المعلومات الناقصة؟',
    'dlg.mark.needsInfoPh': 'مثال: اسم الأم، سنة الميلاد',
    'dlg.mark.info-complete': 'اكتملت المعلومات',
    'dlg.mark.infoCompleteHint': 'يُزيل طلب استكمال المعلومات.',
    'dlg.mark.duplicate': 'سجل مكرّر لشخص آخر',
    'dlg.mark.duplicateHint': 'تنبيه للمشرف فقط. لدمج السجلين يمكن استخدام «دمج سجل مكرّر».',
    'dlg.mark.duplicateOf': 'ما السجل الآخر للشخص نفسه؟',
    'dlg.mark.duplicateRequired': 'يُرجى اختيار السجل الآخر.',
    'dlg.mark.not-duplicate': 'ليس مكرّراً',
    'dlg.mark.notDuplicateHint': 'يُزيل علامة التكرار.',
    'dlg.mark.private': 'خاص (إخفاء التفاصيل)',
    'dlg.mark.privateHint': 'لمن طلب الإخفاء: يُحجب الاسم، وتُمسح أماكن الميلاد والعمل والنبذة والصورة، ولا يبقى إلا سنة الميلاد. وتبقى صلات القرابة كما هي.',
    'dlg.mark.deathDate': 'سنة الوفاة (اختياري)',
    'dlg.reorderChildren': 'ترتيب الأبناء',
    'dlg.reorderSpouses': 'ترتيب الزوجات والأزواج',
    'dlg.reorderLead': 'يمكن السحب من المقبض أو استخدام أزرار الأسهم لوضعهم بالترتيب الصحيح (الأكبر أولاً).',
    'dlg.reorderSpousesLead': 'يمكن السحب من المقبض أو استخدام أزرار الأسهم لترتيب الزيجات (الزواج الأول أولاً).',
    'dlg.whichFamily': 'أيّ أسرة؟',
    'dlg.childrenWith': 'الأبناء من {name}',
    'dlg.childrenOtherUnknown': 'الأبناء (الوالد الآخر غير مسجّل)',
    'dlg.nChildren': 'الأبناء: {n}',
    'dlg.moveUp': 'نقل {name} إلى الأعلى',
    'dlg.moveDown': 'نقل {name} إلى الأسفل',
    'dlg.dragHandle': 'السحب لنقل {name}، وتعمل مفاتيح الأسهم أيضاً.',
    'dlg.movedTo': '{name}: الترتيب {n}',
    'dlg.sortByYear': 'الترتيب حسب سنة الميلاد',
    'dlg.nothingToReorder': 'لا يوجد ما يحتاج إلى ترتيب هنا بعد.',
    'dlg.unknownSpouse': 'الزوج أو الزوجة غير مسجّل',
    'dlg.cannotReorderNew': 'أُنشئت هذه الأسرة في مقترحك للتو، ويمكن ترتيبها بعد الموافقة عليها.',
    'dlg.changeParentsLead': 'اختيار الأب والأم الصحيحين لـ{name}. يُنقل {name} وحده، ويبقى الإخوة والأخوات كما هم.',
    'dlg.reparentWarn': 'استبدال والد مسجّل من قبل ينقل {name} وذريته إلى فرع آخر، لذا يحتاج إلى موافقة منفصلة من المشرف.',
    'dlg.father': 'الأب',
    'dlg.mother': 'الأم',
    'dlg.notKnown': 'غير معروف',
    'dlg.clear': 'إزالة',
    'dlg.pickParent': 'البحث عن {role}…',
    'dlg.needOneParent': 'يُرجى اختيار أحد الوالدين على الأقل.',
    'dlg.link': 'ربط شخص موجود في الشجرة',
    'dlg.linkLead': 'لشخص مسجّل في الشجرة لكنه غير مرتبط بعدُ بـ{name}.',
    'dlg.linkAs': 'صلته بـ{name}:',
    'dlg.linkAs.spouse': 'زوج أو زوجة',
    'dlg.linkAs.child': 'ابن أو ابنة',
    'dlg.linkAs.parent': 'والد أو والدة',
    'dlg.linkAs.sibling': 'أخ أو أخت',
    'dlg.linkPick': 'من هو؟',
    'dlg.linkPickRequired': 'يُرجى اختيار شخص.',
    'dlg.linkReparent': 'لـ{name} والدان مسجّلان من قبل، ونقله يحتاج إلى موافقة منفصلة من المشرف.',
    'dlg.noSiblingUnion': 'يُرجى إضافة أحد والدَي {name} أولاً، ثم ربط الأخ أو الأخت.',
    'dlg.parentSameGender': 'لـ{name} {role} مسجّل من قبل.',
    'dlg.merge': 'دمج سجل مكرّر',
    'dlg.mergeLead': 'إذا سُجّل الشخص نفسه مرتين، يمكن دمج السجلين في سجل واحد مع الاحتفاظ بالتفاصيل والزيجات والأبناء.',
    'dlg.mergeApproval': 'يحتاج الدمج إلى موافقة خاصة من المشرف قبل ظهوره.',
    'dlg.mergePick': 'ما السجل الآخر لـ{name}؟',
    'dlg.mergeKeep': 'أيّ السجلين يبقى؟',
    'dlg.mergeKeepThis': 'إبقاء هذا السجل',
    'dlg.mergeParents': 'لكلٍّ منهما والدان مختلفان. أيّهما الصحيح؟',
    'dlg.mergeParentsOf': 'والدا هذا السجل: {names}',
    'dlg.mergeNew': 'لا يمكن دمج إلا السجلات التي تمت الموافقة عليها.',
    'dlg.mergeRequired': 'يُرجى اختيار السجل المكرّر.',
    'dlg.mergeStats': 'الوالدان: {p} · الأزواج: {s} · الأبناء: {c}',
    'dlg.remove': 'طلب الحذف',
    'dlg.removeLead': 'الحذف يُخفي {name} من الشجرة، ويمكن استعادته لاحقاً، ويحتاج إلى موافقة منفصلة من المشرف.',
    'dlg.removeReason': 'ما سبب الحذف؟',
    'dlg.reason.duplicate': 'الشخص مسجّل مرتين',
    'dlg.reason.entered-by-mistake': 'أُضيف عن طريق الخطأ',
    'dlg.reason.wrong-parents': 'مرتبط بعائلة غير صحيحة',
    'dlg.reason.person-requested': 'صاحب الشأن طلب الحذف',
    'dlg.reason.other': 'سبب آخر',
    'dlg.reasonChoose': 'اختيار السبب…',
    'dlg.reasonRequired': 'يُرجى اختيار السبب.',
    'dlg.reasonDuplicateHint': 'الدمج يحفظ معلومات السجلين، وهو غالباً أفضل من الحذف.',
    'dlg.reasonWrongParentsHint': 'إن كان الخطأ في الوالدين فقط، فتغيير الوالدين يُبقي الشخص في الشجرة.',
    'dlg.reasonOther': 'لا تُنشر الأسباب أبداً. يُرجى توضيح السبب لـ{owner} على انفراد عبر واتساب.',
    'dlg.reasonOtherLink': 'مراسلة {owner} عبر واتساب',
    'dlg.reasonOtherText': 'بخصوص حذف {name} من شجرة العائلة: {link}',
    'dlg.useMerge': 'دمج السجل المكرّر بدلاً من ذلك',
    'dlg.useChangeParents': 'تغيير الوالدين بدلاً من ذلك',
    'dlg.consequences': 'ما الذي سيحدث',
    'dlg.cons.hidden': 'لن يظهر {name} في الشجرة (يُحفظ السجل ويمكن استعادته).',
    'dlg.cons.unions': 'ستُخفى كذلك سجلات الزواج مع {names}.',
    'dlg.cons.approval': 'يوافق المشرف على الحذف بموافقة منفصلة.',
    'dlg.blockedChildren': 'لـ{name} أبناء في الشجرة ({names})، وحذفه يفصلهم عن العائلة، لذا لا يمكن حذفه.',
    'dlg.blockedChildrenHint': 'إن كان {name} مرتبطاً بوالدين غير صحيحين فيمكن تغيير الوالدين، وإن كان مكرّراً فيمكن دمج السجلين.',
    'dlg.blockedRoot': '{name} هو أصل شجرة العائلة، ولا يمكن حذفه.',
    'dlg.typeName': 'للتأكيد، يُرجى كتابة الاسم: {name}',
    'dlg.typeNameWrong': 'الاسم المكتوب لا يطابق بعد.',
    'dlg.redact': 'مسح بياناته الشخصية بالكامل أيضاً',
    'dlg.redactHint': 'يُنصح به إذا طلب صاحب الشأن الحذف: تُمسح البيانات ولا تُخفى فقط.',
    'dlg.removeSubmit': 'طلب الحذف',
    'dlg.more': 'خيارات أخرى',
    'dlg.group.change': 'التعديلات',
    'dlg.group.share': 'المشاركة والاستكشاف',
    'dlg.opt.mark': 'تحديد الحالة',
    'dlg.opt.markHint': 'الوفاة، التوثيق، نقص المعلومات، الخصوصية…',
    'dlg.opt.reorderChildren': 'ترتيب الأبناء',
    'dlg.opt.reorderSpouses': 'ترتيب الزوجات والأزواج',
    'dlg.opt.changeParents': 'تغيير الوالدين',
    'dlg.opt.link': 'ربط شخص موجود في الشجرة',
    'dlg.opt.merge': 'دمج سجل مكرّر',
    'dlg.opt.share': 'مشاركة عبر واتساب',
    'dlg.opt.invite': 'دعوة قريب لإضافة عائلته',
    'dlg.opt.tree': 'العرض في الشجرة',
    'dlg.opt.ancestors': 'عرض الأجداد',
    'dlg.opt.related': 'ما صلة القرابة؟',
    'dlg.opt.remove': 'طلب الحذف',
    'dlg.shareText': '{name} — في شجرة عائلتنا:\n{link}',
    'dlg.invite': 'دعوة قريب',
    'dlg.inviteLead': 'هذا الرابط لقريب من عائلة {name}، يفتح نموذجاً بسيطاً لإضافة عائلته.',
    'dlg.inviteText': 'السلام عليكم! شجرة عائلتنا أصبحت على الإنترنت، ونرجو إضافة عائلتكم هنا — لا يستغرق ذلك إلا دقائق:\n{link}',
    'dlg.copyLink': 'نسخ الرابط',
    'dlg.linkCopied': 'تم نسخ الرابط',
    'dlg.copyFailed': 'تعذّر النسخ — يمكن تحديد الرابط ونسخه يدوياً.',
    'dlg.sendWhatsApp': 'إرسال عبر واتساب',
  },
});

// =========================================================================================================
// Small helpers

const g = () => store.working;
const trim = (s) => String(s ?? '').trim();
const issueKey = (x) => `${x.code}|${x.path ?? ''}|${JSON.stringify(x.params ?? {})}`;
const referenceableUnion = (id) => isUnionId(id) || isTempUnionRef(id);
const genderKey = (p) => (p?.gender === 'm' || p?.gender === 'f' ? p.gender : 'u');
/** Warnings that never need the visitor's attention. */
const SILENT = new Set(['MERGED_REDIRECT', 'ORDER_IGNORED', 'UNKNOWN_FIELD', 'GENDER_MISSING']);

function toastAdded() {
  toast(t('common.addedToDraft'), { type: 'success', timeout: 7000, action: { label: t('common.viewDraft'), href: '#/draft' } });
}

function safeRefNames(proposal) {
  try { return refNames(proposal, g()); } catch { return {}; }
}

let dlgSeq = 0;

/**
 * Modal dialog shell with the same markup as dom.js modal(), but with a body and actions that can change
 * between steps. Resolves `promise` with the value passed to close(value) (false on Esc / close button).
 */
function openShell({ title, size = 'md', className = '', backdropClose = false }) {
  let resolveFn;
  const promise = new Promise((r) => { resolveFn = r; });
  const titleId = `dlg-title-${++dlgSeq}`;
  const opener = document.activeElement;
  const titleEl = h('h2', { class: 'modal-title', id: titleId }, title);
  const body = h('div', { class: 'modal-body dlg-body' });
  const footer = h('footer', { class: 'modal-actions dlg-actions', hidden: true });
  const closeBtn = h('button', { type: 'button', class: 'btn-icon modal-close', attrs: { 'aria-label': t('common.close') }, on: { click: () => close(false) } }, icon('close'));
  const dlg = h('dialog', { class: `modal modal-${size} dlg ${className}`.trim(), attrs: { 'aria-labelledby': titleId } },
    h('header', { class: 'modal-header' }, titleEl, closeBtn), body, footer);
  let done = false;
  function close(value = false) {
    if (done) return;
    done = true;
    try { dlg.close(); } catch { /* ignore */ }
    dlg.remove();
    if (!document.querySelector('dialog.modal[open]')) document.body.classList.remove('modal-open');
    if (opener && opener.isConnected && typeof opener.focus === 'function') { try { opener.focus({ preventScroll: true }); } catch { /* ignore */ } }
    resolveFn(value);
  }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
  // Navigating away (browser Back, a link) closes the dialog.
  const onHash = () => close(false);
  window.addEventListener('hashchange', onHash);
  promise.then(() => window.removeEventListener('hashchange', onHash));
  dlg.addEventListener('click', (e) => { if (backdropClose && e.target === dlg) close(false); });
  document.body.appendChild(dlg);
  document.body.classList.add('modal-open');
  dlg.showModal();

  const shell = {
    dlg, body, footer, promise, close,
    primary: null,
    busy: false,
    confirmedKey: null,
    setTitle(s) { titleEl.textContent = s; },
    setBody(...nodes) { body.replaceChildren(...nodes.flat().filter(Boolean)); body.scrollTop = 0; },
    /** actions: [{label, variant, icon, onClick, primary, id}] */
    setActions(actions) {
      shell.primary = null;
      const btns = (actions || []).filter(Boolean).map((a) => {
        const b = h(a.href ? 'a' : 'button', {
          type: a.href ? undefined : 'button',
          href: a.href || undefined,
          class: ['btn', a.variant ? `btn-${a.variant}` : '', a.className || ''],
          disabled: a.href ? undefined : !!a.disabled,
          dataset: a.id ? { action: a.id } : undefined,
          on: {
            click: async (e) => {
              if (!a.onClick) return;
              if (!a.href) e.preventDefault();
              if (shell.busy) return;
              shell.busy = true;
              try { await a.onClick(e); } catch (err) { console.error(err); } finally { shell.busy = false; }
            },
          },
        }, a.icon ? icon(a.icon) : null, h('span', { class: 'btn-label' }, a.label));
        if (a.primary) shell.primary = b;
        return b;
      });
      footer.replaceChildren(...btns);
      footer.hidden = !btns.length;
    },
    setPrimaryLabel(text) {
      const lbl = shell.primary?.querySelector('.btn-label');
      if (lbl) lbl.textContent = text;
    },
    focusFirst() {
      const f = body.querySelector('[autofocus], input:not([type=hidden]):not([disabled]), select, textarea, button');
      if (f) f.focus();
    },
  };
  return shell;
}

/** Issues box (errors / warnings) shown at the top of a dialog body. */
function issuesBox() {
  const el = h('div', { class: 'dlg-issues', hidden: true, tabIndex: -1 });
  return {
    el,
    clear() { el.hidden = true; el.replaceChildren(); },
    show(kind, lead, lines) {
      el.className = `dlg-issues notice notice-${kind === 'danger' ? 'danger' : kind === 'info' ? 'info' : 'warning'}`;
      el.setAttribute('role', kind === 'danger' ? 'alert' : 'status');
      el.replaceChildren(
        icon(kind === 'info' ? 'info' : 'warning'),
        h('div', null,
          lead ? h('p', { class: 'dlg-issues-lead' }, lead) : null,
          lines && lines.length ? h('ul', { class: 'dlg-issues-list' }, lines.map((l) => h('li', null, l))) : null));
      el.hidden = false;
      try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { el.scrollIntoView(); }
      el.focus({ preventScroll: true });
    },
  };
}

/**
 * Trial-apply `ops` after the current draft (on top of sent proposals), as store.addOps would, without adding.
 * Returns {ok, errors, warnings (new ones only), proposal}.
 */
function trialOps(ops) {
  const trial = store.draftProposal();
  const base = trial.ops.length;
  trial.ops.push(...ops.map((o) => structuredClone(o)));
  const declared = new Set(trial.ops.flatMap((o) => opRefs(o).declares));
  const foreign = [...new Set(trial.ops.flatMap((o) => opRefs(o).uses))].filter((r) => /^newu?\d+$/.test(r) && !declared.has(r));
  trial.dependsOn = [...new Set([...(trial.dependsOn || []), ...store.sentProposalsDeclaring(foreign)])];
  let draftResult = null;
  try { ({ draftResult } = store.overlay(trial)); } catch (e) { console.error(e); }
  if (!draftResult) return { ok: false, errors: [{ code: 'NO_OPS', params: {} }], warnings: [], proposal: trial };
  const known = new Set((store.draftWarnings || []).map(issueKey));
  const warnings = (draftResult.warnings || []).filter((w) => (Number.isInteger(w.op) ? w.op >= base : !known.has(issueKey(w))));
  return { ok: !!draftResult.ok, errors: draftResult.errors || [], warnings, proposal: trial };
}

/**
 * Trial → (errors inline | warnings for confirmation) → store.addOps → close + toast.
 * Returns true when the ops were added. `skipDuplicateIds`: POSSIBLE_DUPLICATE warnings about people the visitor
 * already said are different.
 */
function commit(shell, issues, ops, { skipDuplicateIds = [] } = {}) {
  if (!ops || !ops.length) { issues.show('info', t('dlg.nothingChanged')); return false; }
  const tr = trialOps(ops);
  const ctx = { graph: g(), refNames: safeRefNames(tr.proposal), withOp: false };
  const fmt = (list) => [...new Set(list.map((x) => formatIssue(x, lang(), ctx)))];
  if (!tr.ok) {
    issues.show('danger', t('dlg.fixErrors'), fmt(tr.errors));
    shell.confirmedKey = null;
    return false;
  }
  const warns = tr.warnings.filter((w) => !SILENT.has(w.code) && !(w.code === 'POSSIBLE_DUPLICATE' && skipDuplicateIds.includes(w.params?.id)));
  // Keyed by the visible text: fresh temp refs on every click must not ask again for the same warnings.
  const key = fmt(warns).join('\n');
  if (warns.length && shell.confirmedKey !== key) {
    shell.confirmedKey = key;
    issues.show('warning', t('dlg.confirmWarnings'), fmt(warns));
    shell.setPrimaryLabel(t('dlg.addAnyway'));
    return false;
  }
  const res = store.addOps(ops);
  if (!res.ok) {
    issues.show('danger', t('dlg.fixErrors'), fmt(res.errors || []));
    return false;
  }
  shell.close(true);
  toastAdded();
  return true;
}

/** "Relative of" header card for the person a dialog is about. */
function targetCard(person, caption = '') {
  if (!person) return null;
  const lin = lineageOf(person, { depth: 3 });
  return h('div', { class: 'dlg-target' },
    avatar(person, { size: 'sm' }),
    h('div', { class: 'dlg-target-text' },
      caption ? h('span', { class: 'dlg-target-caption small muted' }, caption) : null,
      nameLabel(person, { other: false }),
      lin && lin !== nameOf(person) ? bdi(lin, { class: 'small muted dlg-target-lineage' }) : null));
}

/** Radio "cards" (base .radio-group). options: [{value, label, hint, disabled, lead (node)}] */
function radioCards({ legend = '', options, value = '', onChange = null, name = `rc${++dlgSeq}`, className = '' }) {
  const inputs = [];
  const errorEl = h('div', { class: 'field-error' });
  const el = h('fieldset', { class: ['dlg-choices', className] },
    legend ? h('legend', null, legend) : null,
    options.map((o) => {
      const input = h('input', { type: 'radio', name, value: o.value, checked: o.value === value, disabled: !!o.disabled });
      input.addEventListener('change', () => { if (input.checked) { errorEl.textContent = ''; el.classList.remove('has-error'); if (onChange) onChange(o.value); } });
      inputs.push(input);
      return h('label', { class: ['dlg-choice', o.disabled ? 'is-disabled' : ''] },
        input,
        o.lead || null,
        h('span', { class: 'dlg-choice-text' },
          h('span', { class: 'dlg-choice-label' }, o.label),
          o.hint ? h('small', { class: 'dlg-choice-hint muted' }, o.hint) : null));
    }),
    errorEl);
  return {
    el,
    inputs,
    get value() { return (inputs.find((i) => i.checked) || {}).value || ''; },
    set value(v) { inputs.forEach((i) => { i.checked = i.value === v; }); },
    setError(msg) { errorEl.textContent = msg || ''; el.classList.toggle('has-error', !!msg); if (msg) (inputs.find((i) => !i.disabled) || inputs[0])?.focus(); },
  };
}

/** A chosen person shown as a compact card with a "change" button. */
function chosenCard(person, onChange) {
  return h('div', { class: 'dlg-chosen' },
    avatar(person, { size: 'sm' }),
    h('div', { class: 'dlg-target-text' },
      nameLabel(person, { other: false }),
      h('span', { class: 'small muted' }, [bdi(lineageOf(person)), yearsOf(person) ? ` · ${yearsOf(person)}` : ''])),
    onChange ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: onChange } }, t('dlg.change')) : null);
}

function listNames(people, max = 4) {
  const names = people.map((p) => nameOf(p));
  const more = names.length - max;
  const shown = names.slice(0, max);
  const sep = lang() === 'ar' ? '، ' : ', ';
  return shown.join(sep) + (more > 0 ? (lang() === 'ar' ? ` و${more} آخرين` : ` +${more}`) : '');
}

function notFoundShell(id) {
  toast(t('common.personNotFound'), { type: 'error' });
  return Promise.resolve(false);
}

/** A person only created by the visitor's own unsent/sent proposal (temp ref): destructive ops are impossible. */
function isNewRecord(id) { return !isPersonId(id); }

function pendingOnlyNotice(person) {
  return h('div', { class: 'notice notice-info' }, icon('info'),
    h('div', null,
      h('p', null, t('dlg.pendingOnly', { name: nameOf(person) })),
      h('a', { class: 'btn btn-sm', href: '#/draft' }, t('dlg.openDraft'))));
}

function otherParentKey(p) {
  return p?.gender === 'm' ? 'f' : p?.gender === 'f' ? 'm' : 'u';
}

// =========================================================================================================
// Duplicate check

function nameKeys(person) {
  const keys = new Set();
  const add = (s) => { const k = trim(s) ? skeletonKey(s) : ''; if (k) keys.add(k); };
  if (!person) return keys;
  if (person.nameStatus && person.nameStatus !== 'known') { add(person.nickname?.ar); return keys; }
  add(person.name?.ar);
  add(person.name?.en || (person.name?.ar ? englishOf(person.name) : ''));
  if (!person.name?.ar && !person.name?.en) add(person.nickname?.ar);
  return keys;
}

/**
 * People already in the tree who may be the person being added: same given name (skeleton key: محمد = Mohamed =
 * Muhammad), compatible gender, not excluded. People near `near` come first; with `nearOnly`, far people are kept
 * only when they have no parents recorded (floating records).
 */
function findMatches(input, { near = null, exclude = new Set(), nearOnly = false, limit = 5 } = {}) {
  const graph = g();
  const typed = nameKeys({ ...input, name: { ar: input.name?.ar || '', en: input.name?.en || '' } });
  if (!typed.size) return [];
  const q = trim(input.name?.ar) || trim(input.name?.en) || trim(input.nickname?.ar);
  if (q.length < 2) return [];
  let hood = new Set();
  try { hood = near ? neighbourhood(graph, near) : new Set(); } catch { hood = new Set(); }
  const seen = new Set();
  const out = [];
  for (const r of graph.search(q, { limit: 60 }) || []) {
    const p = r.person;
    if (!p || seen.has(p.id) || exclude.has(p.id)) continue;
    seen.add(p.id);
    if (input.gender && p.gender && p.gender !== input.gender) continue;
    const keys = nameKeys(p);
    if (![...typed].some((k) => keys.has(k))) continue;
    const isNear = hood.has(p.id);
    if (nearOnly && !isNear && graph.parents(p.id).length) continue;
    out.push({ p, rank: (isNear ? 1e6 : 0) + (r.score || 0) });
  }
  return out.sort((a, b) => b.rank - a.rank).slice(0, limit).map((x) => x.p);
}

/** "Is it one of these?" panel. onLink(person) / onNew(). */
function duplicatesPanel(matches, { onLink, onNew }) {
  return h('div', { class: 'dlg-dupes' },
    h('p', { class: 'dlg-lead' }, t('dlg.dupLead')),
    h('ul', { class: 'list dlg-dupes-list' }, matches.map((p) => {
      const parents = g().parents(p.id);
      const y = yearsOf(p);
      return h('li', { class: 'dlg-dupe' },
        h('a', { class: 'dlg-dupe-person', href: `#/p/${encodeURIComponent(p.id)}`, target: '_blank', rel: 'noopener' },
          avatar(p),
          h('span', { class: 'person-row-main' },
            nameLabel(p, { other: true }),
            bdi(lineageOf(p), { class: 'small muted' }),
            h('span', { class: 'small muted' }, y, y ? ' · ' : '', parents.length ? listNames(parents, 2) : t('dlg.dupNoParents')))),
        h('button', { type: 'button', class: 'btn btn-sm dlg-dupe-yes', on: { click: () => onLink(p) } }, icon('link', { size: 16 }), t('dlg.dupYes')));
    })),
    h('div', { class: 'dlg-dupes-no' },
      h('button', { type: 'button', class: 'btn btn-primary btn-block', on: { click: onNew } }, icon('plus'), t('dlg.dupNo'))));
}

// =========================================================================================================
// Linking an existing person (shared by add dialogs' "Yes, link them" and openLinkExisting)

/**
 * Ops that make existing person `qId` the `as` of person `pId`.
 * opts: spouse {former}; child {withId|null, kind:'bio'|'foster'|'milk'}; parent {scope}; sibling {share}.
 * Returns {ops} or {error: message}.
 */
function linkOps(pId, as, qId, opts = {}) {
  const graph = g();
  const P = graph.person(pId);
  const Q = graph.person(qId);
  if (!P || !Q) return { error: t('common.personNotFound') };
  if (as === 'spouse') {
    return { ops: [{ op: 'link-spouse', a: pId, b: qId, status: opts.former ? 'divorced' : 'married', unionRef: store.newUnionRef() }] };
  }
  if (as === 'child') {
    if (opts.kind === 'foster' || opts.kind === 'milk') {
      const type = opts.kind === 'milk' ? 'milk-child-of' : 'foster-child-of';
      const ops = [{ op: 'add-tie', id: qId, type, person: pId }];
      if (opts.withId) ops.push({ op: 'add-tie', id: qId, type, person: opts.withId });
      return { ops };
    }
    return { ops: [{ op: 'move-person', id: qId, to: { of: pId, with: opts.withId || null }, unionRef: store.newUnionRef() }] };
  }
  if (as === 'parent') {
    const B = graph.birthUnion(pId);
    const partners = B ? (B.partners || []).filter((x) => graph.person(x)) : [];
    if (partners.includes(qId)) return { ops: [] };
    if (partners.length >= 2) return { error: t('dlg.parentsFull', { name: nameOf(P) }) };
    const X = partners[0] ? graph.person(partners[0]) : null;
    if (X && Q.gender && X.gender === Q.gender) return { error: t('dlg.parentSameGender', { name: nameOf(P), role: t(`dlg.role.${genderKey(Q)}`) }) };
    const kids = B && opts.scope !== 'only' ? graph.childrenOfUnion(B.id).map((c) => c.id) : [pId];
    if (!kids.includes(pId)) kids.unshift(pId);
    const u = store.newUnionRef();
    const ops = kids.map((cid, i) => (i === 0
      ? { op: 'move-person', id: cid, to: { of: qId, with: X ? X.id : null }, unionRef: u }
      : { op: 'move-person', id: cid, to: { union: u } }));
    return { ops };
  }
  if (as === 'sibling') {
    const share = opts.share || 'both';
    if (share === 'both') {
      const B = graph.birthUnion(pId);
      if (!B) return { error: t('dlg.noSiblingUnion', { name: nameOf(P) }) };
      const partners = (B.partners || []).filter((x) => graph.person(x));
      if (referenceableUnion(B.id)) return { ops: [{ op: 'move-person', id: qId, to: { union: B.id } }] };
      if (!partners.length) return { error: t('dlg.noSiblingUnion', { name: nameOf(P) }) };
      return { ops: [{ op: 'move-person', id: qId, to: { of: partners[0], with: partners[1] || null }, unionRef: store.newUnionRef() }] };
    }
    const parent = share === 'father' ? graph.father(pId) : graph.mother(pId);
    if (!parent) return { error: t(share === 'father' ? 'dlg.share.noFather' : 'dlg.share.noMother') };
    return { ops: [{ op: 'move-person', id: qId, to: { of: parent.id, with: opts.otherParent || null }, unionRef: store.newUnionRef() }] };
  }
  return { error: t('common.error') };
}

// =========================================================================================================
// openAddRelative

export function openAddRelative(personId, as = 'child') {
  const graph = g();
  const P = graph.person(personId);
  if (!P) return notFoundShell(personId);
  if (!['child', 'spouse', 'parent', 'sibling'].includes(as)) as = 'child';
  const shell = openShell({ title: t(`dlg.add.${as}`), size: 'md', className: `dlg-add dlg-add-${as}` });
  const issues = issuesBox();
  let dupesDismissed = false;
  let shownDupes = [];

  // --- relation-specific questions ------------------------------------------------------------------------
  const q = {}; // question widgets
  let formCtx = { relation: as };
  let blocked = null; // a node explaining why nothing can be added

  if (as === 'child') {
    const opk = otherParentKey(P);
    const spouses = graph.spouses(personId);
    const options = spouses.map((s) => ({
      value: `s:${s.person.id}`,
      label: nameOf(s.person),
      lead: avatar(s.person, { size: 'sm' }),
      hint: lineageOf(s.person) !== nameOf(s.person) ? lineageOf(s.person) : '',
    }));
    options.push({ value: 'new', label: t(opk === 'f' ? 'dlg.anotherMother' : opk === 'm' ? 'dlg.anotherFather' : 'dlg.anotherParent'), hint: t('dlg.anotherHint', { name: nameOf(P) }) });
    options.push({ value: 'unknown', label: t('dlg.parentUnknown'), hint: t('dlg.parentUnknownHint') });
    const initial = spouses.length === 1 ? `s:${spouses[0].person.id}` : spouses.length ? '' : 'unknown';
    const newName = bilingualInputs({ id: `dlg-other-${++dlgSeq}`, kind: 'given', placeholderAr: opk === 'm' ? 'محمد' : 'فاطمة', placeholderEn: opk === 'm' ? 'Muhammad' : 'Fatimah' });
    const newNameField = field({ label: t('dlg.otherName'), control: newName.el, id: newName.ar.id });
    newNameField.el.classList.add('dlg-other-name');
    q.other = radioCards({
      legend: t(`dlg.otherParent.${opk}`), options, value: initial,
      onChange: (v) => { newNameField.el.hidden = v !== 'new'; },
    });
    newNameField.el.hidden = initial !== 'new';
    q.other.el.appendChild(newNameField.el);
    q.newName = newName;
    q.newNameField = newNameField;
    q.kind = radioCards({
      legend: t('dlg.kind'), value: 'bio', className: 'dlg-kind',
      options: [
        { value: 'bio', label: t('dlg.kind.bio') },
        { value: 'foster', label: t('dlg.kind.foster'), hint: t('dlg.kind.tieHint') },
        { value: 'milk', label: t('dlg.kind.milk'), hint: t('dlg.kind.tieHint') },
      ],
      onChange: (v) => {
        // a nursing / kafala bond: no "another parent" new record
        const tie = v !== 'bio';
        const newInput = q.other.inputs.find((i) => i.value === 'new');
        if (newInput) { newInput.disabled = tie; newInput.closest('label').classList.toggle('is-disabled', tie); if (tie && newInput.checked) { q.other.value = 'unknown'; newNameField.el.hidden = true; } }
      },
    });
    q.kindWrap = h('details', { class: 'dlg-kind-wrap' }, h('summary', null, t('dlg.kindToggle')), q.kind.el);
  }

  if (as === 'parent') {
    const B = graph.birthUnion(personId);
    const partners = B ? (B.partners || []).map((x) => graph.person(x)).filter(Boolean) : [];
    if (partners.length >= 2) {
      blocked = h('div', { class: 'notice notice-info' }, icon('info'),
        h('div', null, h('p', null, t('dlg.parentsFull', { name: nameOf(P) })),
          h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => { shell.close(false); openChangeParents(personId); } } }, t('dlg.changeParents'))));
    } else {
      const existing = partners[0] || null;
      if (existing && (existing.gender === 'm' || existing.gender === 'f')) formCtx.gender = existing.gender === 'm' ? 'f' : 'm';
      const sibs = B ? graph.childrenOfUnion(B.id).filter((c) => c.id !== personId) : [];
      if (sibs.length) {
        const role = formCtx.gender ? formCtx.gender : 'u';
        q.scope = radioCards({
          legend: t('dlg.scope', { role: t(`dlg.role.${role}`), siblings: listNames(sibs) }),
          value: 'union',
          options: [
            { value: 'union', label: t('dlg.scope.union') },
            { value: 'only', label: t('dlg.scope.only', { name: nameOf(P) }) },
          ],
        });
      }
    }
  }

  if (as === 'sibling') {
    const father = graph.father(personId);
    const mother = graph.mother(personId);
    const B = graph.birthUnion(personId);
    q.share = radioCards({
      legend: t('dlg.share'),
      value: 'both',
      options: [
        { value: 'both', label: t('dlg.share.both'), hint: !B ? t('dlg.share.noParents') : '' },
        { value: 'father', label: t('dlg.share.father'), disabled: !father, hint: father ? nameOf(father) : t('dlg.share.noFather') },
        { value: 'mother', label: t('dlg.share.mother'), disabled: !mother, hint: mother ? nameOf(mother) : t('dlg.share.noMother') },
      ],
      onChange: (v) => renderSiblingOther(v),
    });
    // For a half-sibling: the other parent (one of that parent's other spouses), optional.
    q.siblingOtherWrap = h('div', { class: 'dlg-sibling-other' });
    const renderSiblingOther = (share) => {
      q.siblingOther = null;
      q.siblingOtherWrap.replaceChildren();
      if (share !== 'father' && share !== 'mother') return;
      const parent = share === 'father' ? father : mother;
      const exclude = share === 'father' ? mother?.id : father?.id;
      const others = graph.spouses(parent.id).filter((s) => s.person.id !== exclude);
      if (!others.length) return;
      q.siblingOther = radioCards({
        legend: t(share === 'father' ? 'dlg.siblingOther.m' : 'dlg.siblingOther.f'),
        value: '',
        options: [
          ...others.map((s) => ({ value: s.person.id, label: nameOf(s.person), lead: avatar(s.person, { size: 'sm' }) })),
          { value: '', label: t('dlg.parentUnknown') },
        ],
      });
      q.siblingOtherWrap.appendChild(q.siblingOther.el);
    };
  }

  const form = blocked ? null : personForm({ mode: 'add', context: formCtx });

  // --- steps ----------------------------------------------------------------------------------------------
  const formStep = h('div', { class: 'dlg-step' },
    q.other ? q.other.el : null,
    q.scope ? q.scope.el : null,
    q.share ? q.share.el : null,
    q.siblingOtherWrap || null,
    form ? h('div', { class: 'dlg-form-wrap' }, form.el) : null,
    q.kindWrap || null);

  function showForm() {
    shell.setTitle(t(`dlg.add.${as}`));
    shell.setBody(targetCard(P, ''), issues.el, blocked || formStep);
    shell.confirmedKey = null;
    if (blocked) {
      shell.setActions([{ label: t('dlg.close'), variant: 'ghost', onClick: () => shell.close(false) }]);
      return;
    }
    shell.setActions([
      { label: t('dlg.cancel'), variant: 'ghost', onClick: () => shell.close(false) },
      { label: t('dlg.addToDraft'), variant: 'primary', icon: 'plus', primary: true, onClick: save },
    ]);
  }

  // Spouse: search first.
  function showSpouseSearch() {
    const exclude = new Set([personId, ...graph.spouses(personId).map((s) => s.person.id)]);
    const status = radioCards({
      legend: t('dlg.spouseStatus'), value: 'current',
      options: [{ value: 'current', label: t('dlg.current') }, { value: 'former', label: t('dlg.former') }],
    });
    const chosenWrap = h('div', { class: 'dlg-chosen-wrap', hidden: true });
    let chosen = null;
    const picker = personPicker({
      label: t('dlg.spouseSearch'),
      near: personId,
      autofocus: true,
      filter: (p) => !exclude.has(p.id) && !graph.isAncestor(p.id, personId) && !graph.isAncestor(personId, p.id)
        && (!P.gender || !p.gender || p.gender !== P.gender),
      onPick: (p) => {
        chosen = p;
        chosenWrap.replaceChildren(chosenCard(p, () => { chosen = null; chosenWrap.hidden = true; pickWrap.hidden = false; picker.clear(); picker.focus(); setActs(); }), status.el);
        chosenWrap.hidden = false;
        pickWrap.hidden = true;
        setActs();
      },
    });
    const pickWrap = h('div', { class: 'dlg-pick' }, picker, h('p', { class: 'field-hint' }, t('dlg.spouseSearchHint')));
    const newBtn = h('button', { type: 'button', class: 'btn btn-block dlg-new-person', on: { click: () => { showForm(); form.focus(); } } }, icon('plus'), t('dlg.spouseNew'));
    function setActs() {
      shell.setActions(chosen
        ? [
          { label: t('dlg.cancel'), variant: 'ghost', onClick: () => shell.close(false) },
          {
            label: t('dlg.linkThem'), variant: 'primary', icon: 'link', primary: true,
            onClick: () => {
              const r = linkOps(personId, 'spouse', chosen.id, { former: status.value === 'former' });
              if (r.error) return issues.show('danger', r.error);
              commit(shell, issues, r.ops);
            },
          },
        ]
        : [{ label: t('dlg.cancel'), variant: 'ghost', onClick: () => shell.close(false) }]);
    }
    shell.setBody(targetCard(P, ''), issues.el, pickWrap, chosenWrap, h('div', { class: 'dlg-or' }, newBtn));
    setActs();
    setTimeout(() => picker.focus(), 30);
  }

  function showDupes(matches, input) {
    shownDupes = matches.map((m) => m.id);
    shell.setTitle(t('dlg.dupTitle'));
    shell.setBody(targetCard(P, ''), issues.el, duplicatesPanel(matches, {
      onLink: (cand) => {
        let r;
        if (as === 'child') {
          const other = q.other.value;
          r = linkOps(personId, 'child', cand.id, { withId: other.startsWith('s:') ? other.slice(2) : null, kind: q.kind.value });
        } else if (as === 'spouse') r = linkOps(personId, 'spouse', cand.id, {});
        else if (as === 'parent') r = linkOps(personId, 'parent', cand.id, { scope: q.scope ? q.scope.value : 'union' });
        else r = linkOps(personId, 'sibling', cand.id, { share: q.share.value, otherParent: q.siblingOther ? q.siblingOther.value || null : null });
        if (r.error) return issues.show('danger', r.error);
        commit(shell, issues, r.ops);
      },
      onNew: () => { dupesDismissed = true; showForm(); save(); },
    }));
    shell.setActions([{ label: t('dlg.back'), variant: 'ghost', icon: 'chevronStart', className: 'dlg-back', onClick: () => { showForm(); } }]);
    void input;
  }

  // --- save -----------------------------------------------------------------------------------------------
  function save() {
    issues.clear();
    // relation questions first
    if (q.other && !q.other.value) { q.other.setError(t('dlg.chooseOne')); return false; }
    if (q.other && q.other.value === 'new') {
      const nm = q.newName.value();
      if (!nm.ar && !nm.en) { q.newNameField.setError(t('dlg.otherNameRequired')); q.newName.ar.focus(); return false; }
      q.newNameField.setError('');
    }
    const v = form.validate();
    if (!v.ok) return false;
    const input = v.value;

    // duplicate check (once)
    if (!dupesDismissed) {
      const graphNow = g();
      const exclude = new Set([personId]);
      // Ancestors and descendants can never be the new child / parent / sibling / spouse.
      graphNow.ancestors(personId).forEach((_, id) => exclude.add(id));
      graphNow.descendants(personId).forEach((_, id) => exclude.add(id));
      if (as === 'spouse') graphNow.spouses(personId).forEach((s) => exclude.add(s.person.id));
      if (as === 'sibling') { const s = graphNow.siblings(personId); [...s.full, ...s.unspecified, ...s.half.map((x) => x.person)].forEach((x) => exclude.add(x.id)); }
      const matches = findMatches(input, { near: personId, exclude, nearOnly: as !== 'spouse' });
      if (matches.length) { showDupes(matches, input); return false; }
    }

    const ref = store.newRef();
    const ops = [];
    if (as === 'child') {
      const other = q.other.value;
      const kind = q.kind.value;
      if (kind !== 'bio') {
        const type = kind === 'milk' ? 'milk-child-of' : 'foster-child-of';
        ops.push({ op: 'add-person', ref, person: input });
        ops.push({ op: 'add-tie', id: ref, type, person: personId });
        if (other.startsWith('s:')) ops.push({ op: 'add-tie', id: ref, type, person: other.slice(2) });
      } else if (other === 'new') {
        const pref = store.newRef();
        const nm = q.newName.value();
        const opk = otherParentKey(P);
        const parentInput = { name: Object.fromEntries(Object.entries(nm).filter(([, x]) => x)), gender: opk === 'u' ? '' : opk, privacy: 'year' };
        ops.push({ op: 'add-person', ref: pref, person: parentInput, link: { as: 'spouse', of: personId }, unionRef: store.newUnionRef() });
        ops.push({ op: 'add-person', ref, person: input, link: { as: 'child', of: personId, with: pref }, unionRef: store.newUnionRef() });
      } else {
        const withId = other.startsWith('s:') ? other.slice(2) : null;
        ops.push({ op: 'add-person', ref, person: input, link: { as: 'child', of: personId, with: withId }, unionRef: store.newUnionRef() });
      }
    } else if (as === 'spouse') {
      ops.push({ op: 'add-person', ref, person: input, link: { as: 'spouse', of: personId, status: 'married' }, unionRef: store.newUnionRef() });
    } else if (as === 'parent') {
      ops.push({ op: 'add-person', ref, person: input, link: { as: 'parent', of: personId, scope: q.scope ? q.scope.value : 'union' }, unionRef: store.newUnionRef() });
    } else {
      const link = { as: 'sibling', of: personId, share: q.share.value || 'both' };
      if (q.siblingOther && q.siblingOther.value) link.otherParent = q.siblingOther.value;
      ops.push({ op: 'add-person', ref, person: input, link, unionRef: store.newUnionRef() });
    }
    return commit(shell, issues, ops, { skipDuplicateIds: shownDupes });
  }

  if (as === 'spouse') showSpouseSearch();
  else { showForm(); setTimeout(() => { if (form) form.focus(); }, 30); }
  return shell.promise;
}

// =========================================================================================================
// openAddRelativeSheet

export function openAddRelativeSheet(personId) {
  const graph = g();
  const P = graph.person(personId);
  if (!P) return notFoundShell(personId);
  const shell = openShell({ title: t('dlg.addRelativeOf', { name: nameOf(P) }), size: 'sm', className: 'dlg-sheet', backdropClose: true });
  const B = graph.birthUnion(personId);
  const parentsFull = !!B && (B.partners || []).filter((x) => graph.person(x)).length >= 2;
  let next = null;
  const tile = (as, ic, disabledHint = '') => h('button', {
    type: 'button', class: ['sheet-tile', 'dlg-tile', `dlg-tile-${as}`], disabled: !!disabledHint,
    on: { click: () => { next = as; shell.close('pick'); } },
  }, icon(ic, { size: 26 }), h('span', null, t(`dlg.tile.${as}`)), disabledHint ? h('small', null, disabledHint) : null);
  shell.setBody(
    targetCard(P, ''),
    h('div', { class: 'sheet-grid dlg-tiles' },
      tile('child', 'arrowDown'),
      tile('spouse', 'heart'),
      tile('parent', 'arrowUp', parentsFull ? t('dlg.tile.parentsFull') : ''),
      tile('sibling', 'users')),
    h('p', { class: 'dlg-wizard-link small muted' }, t('dlg.wizardHint'), ' ',
      h('a', { href: `#/add-family?near=${encodeURIComponent(personId)}`, on: { click: () => shell.close(false) } }, t('dlg.wizardLink'))));
  setTimeout(() => shell.body.querySelector('.sheet-tile')?.focus(), 30);
  return shell.promise.then((v) => (v === 'pick' && next ? openAddRelative(personId, next) : false));
}

// =========================================================================================================
// openEditPerson

export function openEditPerson(personId) {
  const P = g().person(personId);
  if (!P) return notFoundShell(personId);
  const shell = openShell({ title: t('dlg.edit'), size: 'md', className: 'dlg-edit' });
  const issues = issuesBox();
  const form = personForm({ mode: 'edit', person: P });
  shell.setBody(targetCard(P, ''), h('p', { class: 'muted small dlg-lead' }, t('dlg.editLead')), issues.el, form.el);
  shell.setActions([
    { label: t('dlg.cancel'), variant: 'ghost', onClick: () => shell.close(false) },
    {
      label: t('dlg.saveToDraft'), variant: 'primary', icon: 'check', primary: true,
      onClick: () => {
        issues.clear();
        const v = form.validate();
        if (!v.ok) return;
        if (!Object.keys(v.set).length) { issues.show('info', t('dlg.nothingChanged')); return; }
        commit(shell, issues, [{ op: 'edit-person', id: personId, set: v.set, before: v.before }]);
      },
    },
  ]);
  setTimeout(() => form.focus(), 30);
  return shell.promise;
}

// =========================================================================================================
// openMarkAs

export function openMarkAs(personId) {
  const graph = g();
  const P = graph.person(personId);
  if (!P) return notFoundShell(personId);
  const shell = openShell({ title: t('dlg.mark'), size: 'md', className: 'dlg-mark' });
  const issues = issuesBox();
  const tags = P.tags || [];
  const marks = [];
  if (!P.deceased) marks.push('deceased'); else marks.push('living');
  marks.push(tags.includes('verified') ? 'unverified' : 'verified');
  marks.push('needs-info');
  if (tags.includes('needs-info')) marks.push('info-complete');
  marks.push(P.duplicateOf ? 'not-duplicate' : 'duplicate');
  if (P.nameStatus !== 'withheld' || P.photo || P.bio?.ar || P.bio?.en) marks.push('private');
  const hintKey = {
    deceased: 'dlg.mark.deceasedHint', living: 'dlg.mark.livingHint', verified: 'dlg.mark.verifiedHint', unverified: 'dlg.mark.unverifiedHint',
    'needs-info': 'dlg.mark.needsInfoHint', 'info-complete': 'dlg.mark.infoCompleteHint', duplicate: 'dlg.mark.duplicateHint',
    'not-duplicate': 'dlg.mark.notDuplicateHint', private: 'dlg.mark.privateHint',
  };
  const extras = {};
  // deceased: optional date of death
  const deathId = `dlg-death-${++dlgSeq}`;
  const death = dateInput({ id: deathId, withApprox: false });
  const deathField = field({ label: t('dlg.mark.deathDate'), control: death.el, id: deathId });
  extras.deceased = deathField.el;
  // needs-info note
  const noteId = `dlg-note-${++dlgSeq}`;
  const note = h('textarea', { id: noteId, class: 'textarea', maxLength: LIMITS.needsInfo, rows: 3, placeholder: t('dlg.mark.needsInfoPh'), dir: 'auto' });
  note.value = P.needsInfo || '';
  const noteField = field({ label: t('dlg.mark.needsInfoNote'), control: note, id: noteId });
  extras['needs-info'] = noteField.el;
  // duplicate of
  let dupOf = null;
  const dupWrap = h('div', { class: 'dlg-dup-of' });
  const dupError = h('div', { class: 'field-error' });
  const renderDup = () => {
    dupWrap.replaceChildren();
    if (dupOf) dupWrap.append(chosenCard(dupOf, () => { dupOf = null; renderDup(); }));
    else {
      const pk = personPicker({
        label: t('dlg.mark.duplicateOf'), near: personId,
        filter: (p) => p.id !== personId,
        onPick: (p) => { dupOf = p; dupError.textContent = ''; renderDup(); },
      });
      dupWrap.append(pk);
      setTimeout(() => pk.focus(), 20);
    }
    dupWrap.append(dupError);
  };
  renderDup();
  extras.duplicate = dupWrap;

  const extraHost = h('div', { class: 'dlg-mark-extra' });
  const choice = radioCards({
    legend: '',
    value: '',
    className: 'dlg-marks',
    options: marks.map((m) => ({ value: m, label: t(`dlg.mark.${m}`), hint: t(hintKey[m]) })),
    onChange: (m) => {
      issues.clear();
      shell.confirmedKey = null;
      extraHost.replaceChildren(extras[m] || '');
      // put the extra fields right under the chosen option
      const label = choice.inputs.find((i) => i.value === m)?.closest('label');
      if (label) label.after(extraHost);
      if (m === 'duplicate' && !dupOf) setTimeout(() => dupWrap.querySelector('input')?.focus(), 20);
    },
  });
  shell.setBody(targetCard(P, ''), issues.el, choice.el);
  shell.setActions([
    { label: t('dlg.cancel'), variant: 'ghost', onClick: () => shell.close(false) },
    {
      label: t('dlg.saveToDraft'), variant: 'primary', icon: 'check', primary: true,
      onClick: () => {
        issues.clear();
        const m = choice.value;
        if (!m) { choice.setError(t('dlg.chooseOne')); return; }
        const op = { op: 'mark', id: personId, mark: m };
        if (m === 'deceased') {
          const r = death.read();
          if (r.error) { deathField.setError(r.error); death.focus(); return; }
          deathField.setError('');
          if (r.hijri) op.hijri = r.hijri; else if (r.date) op.date = r.date;
        }
        if (m === 'needs-info' && trim(note.value)) op.note = trim(note.value);
        if (m === 'duplicate') {
          if (!dupOf) { dupError.textContent = t('dlg.mark.duplicateRequired'); dupWrap.querySelector('input')?.focus(); return; }
          op.of = dupOf.id;
        }
        commit(shell, issues, [op]);
      },
    },
  ]);
  setTimeout(() => choice.inputs[0]?.focus(), 30);
  return shell.promise;
}

// =========================================================================================================
// Re-arranging (children of a union, spouses of a person)

/**
 * Sortable list: drag the handle with a pointer, or use the up/down buttons / arrow keys on the handle.
 * items: [{id, node}] → {el, order()}
 */
function sortableList(items, { label = (it) => it.id } = {}) {
  const live = h('div', { class: 'sr-only', attrs: { 'aria-live': 'polite' } });
  const list = h('ol', { class: 'dlg-order' });
  const rowOf = new Map();
  function makeRow(it) {
    const name = label(it);
    const handle = h('button', {
      type: 'button', class: 'dlg-order-handle',
      attrs: { 'aria-label': t('dlg.dragHandle', { name }), 'aria-roledescription': 'sortable' },
    }, icon('move', { size: 18 }));
    const up = h('button', { type: 'button', class: 'btn btn-icon btn-sm btn-ghost dlg-order-up', attrs: { 'aria-label': t('dlg.moveUp', { name }) }, on: { click: () => move(row, -1, up) } }, icon('arrowUp', { size: 18 }));
    const down = h('button', { type: 'button', class: 'btn btn-icon btn-sm btn-ghost dlg-order-down', attrs: { 'aria-label': t('dlg.moveDown', { name }) }, on: { click: () => move(row, 1, down) } }, icon('arrowDown', { size: 18 }));
    const pos = h('span', { class: 'dlg-order-pos', attrs: { 'aria-hidden': 'true' } });
    const row = h('li', { class: 'dlg-order-item', dataset: { id: it.id } }, handle, pos, h('div', { class: 'dlg-order-main' }, it.node), h('div', { class: 'dlg-order-btns' }, up, down));
    handle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); move(row, -1, handle); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); move(row, 1, handle); }
    });
    handle.addEventListener('pointerdown', (e) => startDrag(e, row, handle));
    rowOf.set(it.id, row);
    return row;
  }
  function renumber() {
    [...list.children].forEach((li, i) => {
      li.querySelector('.dlg-order-pos').textContent = String(i + 1);
      li.querySelector('.dlg-order-up').disabled = i === 0;
      li.querySelector('.dlg-order-down').disabled = i === list.children.length - 1;
    });
  }
  function announce(row) {
    const i = [...list.children].indexOf(row);
    const it = items.find((x) => x.id === row.dataset.id);
    live.textContent = t('dlg.movedTo', { name: label(it), n: i + 1 });
  }
  function move(row, delta, focusEl) {
    const kids = [...list.children];
    const i = kids.indexOf(row);
    const j = i + delta;
    if (j < 0 || j >= kids.length) return;
    if (delta < 0) list.insertBefore(row, kids[j]);
    else list.insertBefore(row, kids[j].nextSibling);
    renumber();
    announce(row);
    if (focusEl) {
      const target = focusEl.disabled ? row.querySelector('.dlg-order-handle') : focusEl;
      target.focus();
    }
  }
  function startDrag(e, row, handle) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    // Listen on the document: moving the row in the DOM would release a pointer capture on the handle.
    row.classList.add('is-dragging');
    list.classList.add('is-sorting');
    const startY = e.clientY;
    let lastY = startY;
    const onMove = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      ev.preventDefault();
      lastY = ev.clientY;
      const kids = [...list.children].filter((k) => k !== row);
      let before = null;
      for (const k of kids) {
        const r = k.getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { before = k; break; }
      }
      if (before) { if (row.nextSibling !== before) list.insertBefore(row, before); }
      else if (list.lastChild !== row) list.appendChild(row);
      renumber();
    };
    const onUp = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      row.classList.remove('is-dragging');
      list.classList.remove('is-sorting');
      if (Math.abs(lastY - startY) > 4) announce(row);
      handle.focus({ preventScroll: true });
    };
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }
  items.forEach((it) => list.appendChild(makeRow(it)));
  renumber();
  return {
    el: h('div', { class: 'dlg-order-wrap' }, list, live),
    order: () => [...list.children].map((li) => li.dataset.id),
    setOrder(ids) { ids.forEach((id) => { const r = rowOf.get(id); if (r) list.appendChild(r); }); renumber(); },
  };
}

function childNode(c) {
  const y = yearsOf(c);
  return h('span', { class: 'dlg-order-person' }, avatar(c, { size: 'sm' }),
    h('span', { class: 'dlg-order-text' }, nameLabel(c, { other: false }), y ? h('small', { class: 'muted' }, y) : null));
}

export function openReorderChildren(personId) {
  const graph = g();
  const P = graph.person(personId);
  if (!P) return notFoundShell(personId);
  const shell = openShell({ title: t('dlg.reorderChildren'), size: 'md', className: 'dlg-reorder' });
  const issues = issuesBox();
  const unions = graph.unionsOf(personId).filter((u) => graph.childrenOfUnion(u.id).length >= 2);
  const unionLabel = (u) => {
    const other = (u.partners || []).filter((x) => x !== personId).map((x) => graph.person(x)).filter(Boolean)[0];
    return other ? t('dlg.childrenWith', { name: nameOf(other) }) : t('dlg.childrenOtherUnknown');
  };

  function showUnion(u) {
    const kids = graph.childrenOfUnion(u.id);
    const before = kids.map((c) => c.id);
    const sorter = sortableList(kids.map((c) => ({ id: c.id, node: childNode(c), person: c })), { label: (it) => nameOf(it.person) });
    const withYears = kids.filter((c) => graph.person(c.id) && Number.isFinite(Number(String(c.birth?.date || '').slice(0, 4))) && c.birth?.date);
    const sortBtn = withYears.length >= 2 ? h('button', {
      type: 'button', class: 'btn btn-sm btn-ghost',
      on: {
        click: () => {
          const year = (c) => (c.birth?.date ? Number(c.birth.date.slice(0, 4)) : Infinity);
          const sorted = [...kids].map((c, i) => ({ c, i })).sort((a, b) => year(a.c) - year(b.c) || a.i - b.i).map((x) => x.c.id);
          sorter.setOrder(sorted);
        },
      },
    }, icon('calendar', { size: 16 }), t('dlg.sortByYear')) : null;
    const notRef = !referenceableUnion(u.id);
    shell.setBody(targetCard(P, ''), issues.el,
      unions.length > 1 ? h('h3', { class: 'dlg-subtitle' }, unionLabel(u)) : null,
      notRef ? h('div', { class: 'notice notice-info' }, icon('info'), h('p', null, t('dlg.cannotReorderNew'))) : h('p', { class: 'muted small dlg-lead' }, t('dlg.reorderLead')),
      notRef ? null : sorter.el,
      sortBtn && !notRef ? h('div', { class: 'row dlg-order-tools' }, sortBtn) : null);
    shell.setActions([
      unions.length > 1 ? { label: t('dlg.back'), variant: 'ghost', icon: 'chevronStart', className: 'dlg-back', onClick: pickUnion } : { label: t('dlg.cancel'), variant: 'ghost', onClick: () => shell.close(false) },
      notRef ? null : {
        label: t('dlg.saveToDraft'), variant: 'primary', icon: 'check', primary: true,
        onClick: () => {
          issues.clear();
          const order = sorter.order();
          if (order.join() === before.join()) { issues.show('info', t('dlg.nothingChanged')); return; }
          commit(shell, issues, [{ op: 'reorder-children', union: u.id, order, beforeOrder: before }]);
        },
      },
    ]);
  }

  function pickUnion() {
    const choice = radioCards({
      legend: t('dlg.whichFamily'), value: '',
      options: unions.map((u) => {
        const other = (u.partners || []).filter((x) => x !== personId).map((x) => graph.person(x)).filter(Boolean)[0];
        return { value: u.id, label: unionLabel(u), hint: t('dlg.nChildren', { n: graph.childrenOfUnion(u.id).length }), lead: other ? avatar(other, { size: 'sm' }) : null };
      }),
      onChange: (id) => showUnion(unions.find((u) => u.id === id)),
    });
    shell.setBody(targetCard(P, ''), choice.el);
    shell.setActions([{ label: t('dlg.cancel'), variant: 'ghost', onClick: () => shell.close(false) }]);
    setTimeout(() => choice.inputs[0]?.focus(), 30);
  }

  if (!unions.length) {
    shell.setBody(targetCard(P, ''), h('p', { class: 'muted' }, t('dlg.nothingToReorder')));
    shell.setActions([{ label: t('dlg.close'), variant: 'ghost', onClick: () => shell.close(false) }]);
  } else if (unions.length === 1) showUnion(unions[0]);
  else pickUnion();
  return shell.promise;
}

export function openReorderSpouses(personId) {
  const graph = g();
  const P = graph.person(personId);
  if (!P) return notFoundShell(personId);
  const shell = openShell({ title: t('dlg.reorderSpouses'), size: 'md', className: 'dlg-reorder' });
  const issues = issuesBox();
  const unions = graph.unionsOf(personId);
  if (unions.length < 2) {
    shell.setBody(targetCard(P, ''), h('p', { class: 'muted' }, t('dlg.nothingToReorder')));
    shell.setActions([{ label: t('dlg.close'), variant: 'ghost', onClick: () => shell.close(false) }]);
    return shell.promise;
  }
  const items = unions.map((u) => {
    const other = (u.partners || []).filter((x) => x !== personId).map((x) => graph.person(x)).filter(Boolean)[0];
    const n = graph.childrenOfUnion(u.id).length;
    const node = other
      ? h('span', { class: 'dlg-order-person' }, avatar(other, { size: 'sm' }), h('span', { class: 'dlg-order-text' }, nameLabel(other, { other: false }), h('small', { class: 'muted' }, t('dlg.nChildren', { n }))))
      : h('span', { class: 'dlg-order-person' }, h('span', { class: 'avatar avatar-sm avatar-u', attrs: { 'aria-hidden': 'true' } }, '؟'), h('span', { class: 'dlg-order-text' }, h('span', null, t('dlg.unknownSpouse')), h('small', { class: 'muted' }, t('dlg.nChildren', { n }))));
    return { id: u.id, node, label: other ? nameOf(other) : t('dlg.unknownSpouse') };
  });
  const before = items.map((x) => x.id);
  const sorter = sortableList(items, { label: (it) => it.label });
  const notRef = items.some((x) => !referenceableUnion(x.id));
  shell.setBody(targetCard(P, ''), issues.el,
    notRef ? h('div', { class: 'notice notice-info' }, icon('info'), h('p', null, t('dlg.cannotReorderNew'))) : h('p', { class: 'muted small dlg-lead' }, t('dlg.reorderSpousesLead')),
    notRef ? null : sorter.el);
  shell.setActions([
    { label: t('dlg.cancel'), variant: 'ghost', onClick: () => shell.close(false) },
    notRef ? null : {
      label: t('dlg.saveToDraft'), variant: 'primary', icon: 'check', primary: true,
      onClick: () => {
        issues.clear();
        const order = sorter.order();
        if (order.join() === before.join()) { issues.show('info', t('dlg.nothingChanged')); return; }
        commit(shell, issues, [{ op: 'reorder-spouses', id: personId, order }]);
      },
    },
  ]);
  return shell.promise;
}

// =========================================================================================================
// openChangeParents

/** A slot holding one chosen person or a picker. */
function personSlot({ label, initial = null, filter, near, placeholder }) {
  let chosen = initial;
  const el = h('div', { class: 'field dlg-slot' });
  const render = () => {
    el.replaceChildren(h('div', { class: 'field-label' }, label));
    if (chosen) {
      el.append(h('div', { class: 'dlg-chosen' },
        avatar(chosen, { size: 'sm' }),
        h('div', { class: 'dlg-target-text' }, nameLabel(chosen, { other: false }), bdi(lineageOf(chosen), { class: 'small muted' })),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => { chosen = null; render(); el.querySelector('input')?.focus(); } } }, t('dlg.change'))));
    } else {
      el.append(personPicker({ placeholder, filter, near, onPick: (p) => { chosen = p; render(); } }),
        h('p', { class: 'field-hint' }, t('dlg.notKnown')));
    }
  };
  render();
  return { el, get value() { return chosen; } };
}

export function openChangeParents(personId) {
  const graph = g();
  const P = graph.person(personId);
  if (!P) return notFoundShell(personId);
  const shell = openShell({ title: t('dlg.changeParents'), size: 'md', className: 'dlg-parents' });
  const issues = issuesBox();
  const parents = graph.parents(personId);
  let father = parents.find((x) => x.gender === 'm') || null;
  let mother = parents.find((x) => x.gender === 'f') || null;
  for (const x of parents) {
    if (x === father || x === mother) continue;
    if (!father) father = x; else if (!mother) mother = x;
  }
  const desc = graph.descendants(personId);
  const okParent = (p, gender) => p.id !== personId && !desc.has(p.id) && (!p.gender || p.gender === gender);
  const fSlot = personSlot({ label: t('dlg.father'), initial: father, near: personId, filter: (p) => okParent(p, 'm'), placeholder: t('dlg.pickParent', { role: t('dlg.father') }) });
  const mSlot = personSlot({ label: t('dlg.mother'), initial: mother, near: personId, filter: (p) => okParent(p, 'f'), placeholder: t('dlg.pickParent', { role: t('dlg.mother') }) });
  shell.setBody(targetCard(P, ''),
    h('p', { class: 'muted small dlg-lead' }, t('dlg.changeParentsLead', { name: nameOf(P) })),
    parents.length ? h('div', { class: 'notice notice-warning' }, icon('warning'), h('p', null, t('dlg.reparentWarn', { name: nameOf(P) }))) : null,
    issues.el,
    h('div', { class: 'dlg-slots' }, fSlot.el, mSlot.el));
  shell.setActions([
    { label: t('dlg.cancel'), variant: 'ghost', onClick: () => shell.close(false) },
    {
      label: t('dlg.saveToDraft'), variant: 'primary', icon: 'check', primary: true,
      onClick: () => {
        issues.clear();
        const F = fSlot.value;
        const M = mSlot.value;
        if (!F && !M) { issues.show('danger', t('dlg.needOneParent')); return; }
        const cur = new Set(parents.map((x) => x.id));
        const next = new Set([F?.id, M?.id].filter(Boolean));
        if (cur.size === next.size && [...cur].every((x) => next.has(x))) { issues.show('info', t('dlg.nothingChanged')); return; }
        const a = F || M;
        const b = F && M ? M : null;
        commit(shell, issues, [{ op: 'move-person', id: personId, to: { of: a.id, with: b ? b.id : null }, unionRef: store.newUnionRef() }]);
      },
    },
  ]);
  return shell.promise;
}

// =========================================================================================================
// openLinkExisting

export function openLinkExisting(personId) {
  const graph = g();
  const P = graph.person(personId);
  if (!P) return notFoundShell(personId);
  const shell = openShell({ title: t('dlg.link'), size: 'md', className: 'dlg-link' });
  const issues = issuesBox();
  let chosen = null;
  const extraHost = h('div', { class: 'dlg-link-extra' });
  const pickHost = h('div', { class: 'dlg-link-pick' });
  let extra = {};

  const anc = graph.ancestors(personId);
  const desc = graph.descendants(personId);
  const filters = {
    spouse: (p) => p.id !== personId && !anc.has(p.id) && !desc.has(p.id) && !graph.spouses(personId).some((s) => s.person.id === p.id) && (!P.gender || !p.gender || p.gender !== P.gender),
    child: (p) => p.id !== personId && !anc.has(p.id) && !graph.children(personId).some((c) => c.id === p.id),
    parent: (p) => p.id !== personId && !desc.has(p.id) && !graph.parents(personId).some((x) => x.id === p.id),
    sibling: (p) => p.id !== personId && !anc.has(p.id) && !desc.has(p.id),
  };
  const relation = radioCards({
    legend: t('dlg.linkAs', { name: nameOf(P) }), value: '', className: 'dlg-link-as',
    options: ['spouse', 'child', 'parent', 'sibling'].map((v) => ({ value: v, label: t(`dlg.linkAs.${v}`) })),
    onChange: () => { chosen = null; renderPick(); },
  });

  function renderExtra() {
    extraHost.replaceChildren();
    extra = {};
    const as = relation.value;
    if (!chosen) return;
    if (as === 'spouse') {
      extra.status = radioCards({ legend: t('dlg.spouseStatus'), value: 'current', options: [{ value: 'current', label: t('dlg.current') }, { value: 'former', label: t('dlg.former') }] });
      extraHost.append(extra.status.el);
    } else if (as === 'child') {
      const spouses = graph.spouses(personId);
      const opk = otherParentKey(P);
      if (spouses.length) {
        extra.other = radioCards({
          legend: t(`dlg.otherParent.${opk}`), value: spouses.length === 1 ? spouses[0].person.id : '',
          options: [...spouses.map((s) => ({ value: s.person.id, label: nameOf(s.person), lead: avatar(s.person, { size: 'sm' }) })), { value: 'unknown', label: t('dlg.parentUnknown') }],
        });
        extraHost.append(extra.other.el);
      }
      if (graph.parents(chosen.id).length) extraHost.append(h('div', { class: 'notice notice-warning' }, icon('warning'), h('p', null, t('dlg.linkReparent', { name: nameOf(chosen) }))));
    } else if (as === 'parent') {
      const B = graph.birthUnion(personId);
      const sibs = B ? graph.childrenOfUnion(B.id).filter((c) => c.id !== personId) : [];
      if (sibs.length) {
        extra.scope = radioCards({
          legend: t('dlg.scope', { role: t(`dlg.role.${genderKey(chosen)}`), siblings: listNames(sibs) }), value: 'union',
          options: [{ value: 'union', label: t('dlg.scope.union') }, { value: 'only', label: t('dlg.scope.only', { name: nameOf(P) }) }],
        });
        extraHost.append(extra.scope.el);
      }
    } else if (as === 'sibling') {
      const father = graph.father(personId);
      const mother = graph.mother(personId);
      extra.share = radioCards({
        legend: t('dlg.share'), value: 'both',
        options: [
          { value: 'both', label: t('dlg.share.both') },
          { value: 'father', label: t('dlg.share.father'), disabled: !father, hint: father ? nameOf(father) : t('dlg.share.noFather') },
          { value: 'mother', label: t('dlg.share.mother'), disabled: !mother, hint: mother ? nameOf(mother) : t('dlg.share.noMother') },
        ],
      });
      extraHost.append(extra.share.el);
      if (graph.parents(chosen.id).length) extraHost.append(h('div', { class: 'notice notice-warning' }, icon('warning'), h('p', null, t('dlg.linkReparent', { name: nameOf(chosen) }))));
    }
  }

  function renderPick() {
    pickHost.replaceChildren();
    const as = relation.value;
    if (!as) { renderExtra(); return; }
    if (chosen) pickHost.append(h('div', { class: 'field' }, h('div', { class: 'field-label' }, t('dlg.linkPick')), chosenCard(chosen, () => { chosen = null; renderPick(); })));
    else {
      const pk = personPicker({ label: t('dlg.linkPick'), near: personId, filter: filters[as], onPick: (p) => { chosen = p; issues.clear(); renderPick(); } });
      pickHost.append(pk);
      setTimeout(() => pk.focus(), 20);
    }
    renderExtra();
  }

  shell.setBody(targetCard(P, ''), h('p', { class: 'muted small dlg-lead' }, t('dlg.linkLead', { name: nameOf(P) })), issues.el, relation.el, pickHost, extraHost);
  shell.setActions([
    { label: t('dlg.cancel'), variant: 'ghost', onClick: () => shell.close(false) },
    {
      label: t('dlg.saveToDraft'), variant: 'primary', icon: 'link', primary: true,
      onClick: () => {
        issues.clear();
        const as = relation.value;
        if (!as) { relation.setError(t('dlg.chooseOne')); return; }
        if (!chosen) { issues.show('danger', t('dlg.linkPickRequired')); pickHost.querySelector('input')?.focus(); return; }
        const opts = {};
        if (as === 'spouse') opts.former = extra.status?.value === 'former';
        if (as === 'child') {
          if (extra.other && !extra.other.value) { extra.other.setError(t('dlg.chooseOne')); return; }
          opts.withId = extra.other && extra.other.value !== 'unknown' ? extra.other.value : null;
        }
        if (as === 'parent') opts.scope = extra.scope ? extra.scope.value : 'union';
        if (as === 'sibling') opts.share = extra.share ? extra.share.value : 'both';
        const r = linkOps(personId, as, chosen.id, opts);
        if (r.error) { issues.show('danger', r.error); return; }
        commit(shell, issues, r.ops);
      },
    },
  ]);
  setTimeout(() => relation.inputs[0]?.focus(), 30);
  return shell.promise;
}

// =========================================================================================================
// openMerge

function mergeCard(p, { keepRadio }) {
  const graph = g();
  const parents = graph.parents(p.id);
  const y = yearsOf(p);
  return h('label', { class: 'dlg-merge-card' },
    keepRadio,
    h('span', { class: 'dlg-merge-head' }, avatar(p, { size: 'sm' }), nameLabel(p, { other: true })),
    bdi(lineageOf(p), { class: 'small muted' }),
    y ? h('span', { class: 'small muted' }, y) : null,
    h('span', { class: 'small' }, t('dlg.mergeStats', { p: parents.length, s: graph.spouses(p.id).length, c: graph.children(p.id).length })),
    h('span', { class: 'dlg-merge-keep small' }, t('dlg.mergeKeepThis')));
}

export function openMerge(personId) {
  const graph = g();
  const P = graph.person(personId);
  if (!P) return notFoundShell(personId);
  const shell = openShell({ title: t('dlg.merge'), size: 'md', className: 'dlg-merge' });
  const issues = issuesBox();
  if (isNewRecord(personId)) {
    shell.setBody(targetCard(P, ''), pendingOnlyNotice(P));
    shell.setActions([{ label: t('dlg.close'), variant: 'ghost', onClick: () => shell.close(false) }]);
    return shell.promise;
  }
  const spouseIds = new Set(graph.spouses(personId).map((s) => s.person.id));
  const anc = graph.ancestors(personId);
  const desc = graph.descendants(personId);
  let other = P.duplicateOf ? graph.person(P.duplicateOf) : null;
  const host = h('div', { class: 'dlg-merge-host' });
  let keepChoice = null;
  let parentsChoice = null;

  function render() {
    host.replaceChildren();
    keepChoice = null;
    parentsChoice = null;
    if (!other) {
      const pk = personPicker({
        label: t('dlg.mergePick', { name: nameOf(P) }), near: personId,
        filter: (p) => p.id !== personId && isPersonId(p.id) && !spouseIds.has(p.id) && !anc.has(p.id) && !desc.has(p.id) && (!P.gender || !p.gender || p.gender === P.gender),
        onPick: (p) => { other = p; issues.clear(); render(); },
      });
      host.append(pk);
      setTimeout(() => pk.focus(), 20);
      return;
    }
    const name = `keep${++dlgSeq}`;
    const keepThis = h('input', { type: 'radio', name, value: personId, checked: true });
    const keepOther = h('input', { type: 'radio', name, value: other.id });
    keepChoice = [keepThis, keepOther];
    host.append(
      h('fieldset', { class: 'dlg-merge-pair' },
        h('legend', { class: 'field-label' }, t('dlg.mergeKeep')),
        h('div', { class: 'dlg-merge-cards' }, mergeCard(P, { keepRadio: keepThis }), mergeCard(other, { keepRadio: keepOther }))),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => { other = null; render(); } } }, t('dlg.change')));
    const bA = graph.birthUnion(personId);
    const bB = graph.birthUnion(other.id);
    if (bA && bB && bA.id !== bB.id) {
      const names = (u) => listNames((u.partners || []).map((x) => graph.person(x)).filter(Boolean), 2) || t('dlg.parentUnknown');
      parentsChoice = radioCards({
        legend: t('dlg.mergeParents'), value: '',
        options: [
          { value: personId, label: t('dlg.mergeParentsOf', { names: names(bA) }), hint: nameOf(P) },
          { value: other.id, label: t('dlg.mergeParentsOf', { names: names(bB) }), hint: nameOf(other) },
        ],
      });
      host.append(parentsChoice.el);
    }
  }
  render();
  shell.setBody(targetCard(P, ''),
    h('p', { class: 'muted small dlg-lead' }, t('dlg.mergeLead')),
    h('div', { class: 'notice notice-warning' }, icon('warning'), h('p', null, t('dlg.mergeApproval'))),
    issues.el, host);
  shell.setActions([
    { label: t('dlg.cancel'), variant: 'ghost', onClick: () => shell.close(false) },
    {
      label: t('dlg.saveToDraft'), variant: 'primary', icon: 'merge', primary: true,
      onClick: () => {
        issues.clear();
        if (!other) { issues.show('danger', t('dlg.mergeRequired')); return; }
        const keep = keepChoice.find((i) => i.checked)?.value || personId;
        const remove = keep === personId ? other.id : personId;
        const op = { op: 'merge-person', keep, remove, reasonCode: 'duplicate' };
        if (parentsChoice) {
          if (!parentsChoice.value) { parentsChoice.setError(t('dlg.chooseOne')); return; }
          op.parents = parentsChoice.value === keep ? 'keep' : 'remove';
        }
        commit(shell, issues, [op]);
      },
    },
  ]);
  return shell.promise;
}

// =========================================================================================================
// openRequestRemoval

const looseName = (s) => normalizeArabic(String(s || '')).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export function openRequestRemoval(personId) {
  const graph = g();
  const P = graph.person(personId);
  if (!P) return notFoundShell(personId);
  const shell = openShell({ title: t('dlg.remove'), size: 'md', className: 'dlg-remove' });
  const issues = issuesBox();
  const name = nameOf(P);
  const typeName = personName(P, lang()) || name;
  const closeOnly = [{ label: t('dlg.close'), variant: 'ghost', onClick: () => shell.close(false) }];

  if (isNewRecord(personId)) {
    shell.setBody(targetCard(P, ''), pendingOnlyNotice(P));
    shell.setActions(closeOnly);
    return shell.promise;
  }
  const rootId = store.data?.meta?.rootPersonId || graph.meta?.rootPersonId;
  if (rootId === personId) {
    shell.setBody(targetCard(P, ''), h('div', { class: 'notice notice-danger' }, icon('warning'), h('p', null, t('dlg.blockedRoot', { name }))));
    shell.setActions(closeOnly);
    return shell.promise;
  }
  const kids = graph.children(personId);
  const switchTo = (fn) => () => { shell.close(false); fn(personId); };
  if (kids.length) {
    shell.setBody(targetCard(P, ''),
      h('div', { class: 'notice notice-danger' }, icon('warning'),
        h('div', null, h('p', null, t('dlg.blockedChildren', { name, names: listNames(kids) })), h('p', { class: 'small' }, t('dlg.blockedChildrenHint', { name })))),
      h('div', { class: 'row dlg-alt-actions' },
        h('button', { type: 'button', class: 'btn btn-sm', on: { click: switchTo(openChangeParents) } }, icon('users', { size: 16 }), t('dlg.useChangeParents')),
        h('button', { type: 'button', class: 'btn btn-sm', on: { click: switchTo(openMerge) } }, icon('merge', { size: 16 }), t('dlg.useMerge'))));
    shell.setActions(closeOnly);
    return shell.promise;
  }

  // Reason (code only — never free text)
  const reasonId = `dlg-reason-${++dlgSeq}`;
  const reason = h('select', { id: reasonId, class: 'select' },
    h('option', { value: '' }, t('dlg.reasonChoose')),
    REASON_CODES.map((c) => h('option', { value: c }, t(`dlg.reason.${c}`))));
  const reasonField = field({ label: t('dlg.removeReason'), control: reason, id: reasonId });
  const reasonNote = h('div', { class: 'dlg-reason-note' });
  const ownerNo = store.config?.owner?.whatsapp || '';
  const redact = h('input', { type: 'checkbox' });
  const redactWrap = h('label', { class: 'check dlg-redact' }, redact, h('span', null, h('span', null, t('dlg.redact')), h('small', { class: 'muted' }, t('dlg.redactHint'))));
  reason.addEventListener('change', () => {
    reasonField.setError('');
    reasonNote.replaceChildren();
    const c = reason.value;
    if (c === 'duplicate') reasonNote.append(h('div', { class: 'notice notice-info' }, icon('info'), h('div', null, h('p', null, t('dlg.reasonDuplicateHint')), h('button', { type: 'button', class: 'btn btn-sm', on: { click: switchTo(openMerge) } }, icon('merge', { size: 16 }), t('dlg.useMerge')))));
    if (c === 'wrong-parents') reasonNote.append(h('div', { class: 'notice notice-info' }, icon('info'), h('div', null, h('p', null, t('dlg.reasonWrongParentsHint')), h('button', { type: 'button', class: 'btn btn-sm', on: { click: switchTo(openChangeParents) } }, icon('users', { size: 16 }), t('dlg.useChangeParents')))));
    if (c === 'other') {
      const text = t('dlg.reasonOtherText', { name: lineageOf(P), link: store.siteLink(`#/p/${encodeURIComponent(personId)}`) });
      reasonNote.append(h('div', { class: 'notice notice-info' }, icon('info'), h('div', null,
        h('p', null, t('dlg.reasonOther', { owner: ownerName() })),
        h('a', { class: 'btn btn-sm', href: whatsappUrl(text, ownerNo), target: '_blank', rel: 'noopener' }, icon('whatsapp', { size: 16 }), t('dlg.reasonOtherLink', { owner: ownerName() })))));
    }
    if (c === 'person-requested') redact.checked = true;
  });

  // Consequences
  const childless = graph.unionsOf(personId).filter((u) => !graph.childrenOfUnion(u.id).length);
  const partnersOf = childless.flatMap((u) => (u.partners || []).filter((x) => x !== personId).map((x) => graph.person(x)).filter(Boolean));
  const cons = h('div', { class: 'dlg-consequences' },
    h('h3', { class: 'dlg-subtitle' }, t('dlg.consequences')),
    h('ul', null,
      h('li', null, t('dlg.cons.hidden', { name })),
      partnersOf.length ? h('li', null, t('dlg.cons.unions', { names: listNames(partnersOf) })) : null,
      h('li', null, t('dlg.cons.approval'))));

  // Type the name to confirm
  const typeId = `dlg-type-${++dlgSeq}`;
  const typed = h('input', { id: typeId, class: 'input', type: 'text', autocomplete: 'off', dir: 'auto', attrs: { spellcheck: 'false' } });
  const typeField = field({ label: t('dlg.typeName', { name: typeName }), control: typed, id: typeId });
  const targets = new Set([nameOf(P, 'ar'), nameOf(P, 'en'), personName(P, 'ar'), personName(P, 'en'), P.name?.ar, P.name?.en].filter(Boolean).map(looseName).filter(Boolean));
  const matches = () => targets.has(looseName(typed.value));
  typed.addEventListener('input', () => { typeField.setError(''); if (submitBtn()) submitBtn().disabled = !matches(); });
  const submitBtn = () => shell.primary;

  shell.setBody(targetCard(P, ''),
    h('p', { class: 'dlg-lead' }, t('dlg.removeLead', { name })),
    issues.el, reasonField.el, reasonNote, cons, redactWrap, typeField.el);
  shell.setActions([
    { label: t('dlg.cancel'), variant: 'ghost', onClick: () => shell.close(false) },
    {
      label: t('dlg.removeSubmit'), variant: 'danger', icon: 'trash', primary: true,
      onClick: () => {
        issues.clear();
        if (!reason.value) { reasonField.setError(t('dlg.reasonRequired')); reason.focus(); return; }
        if (!matches()) { typeField.setError(t('dlg.typeNameWrong')); typed.focus(); return; }
        const op = { op: 'remove-person', id: personId, reasonCode: reason.value };
        if (redact.checked) op.redact = true;
        commit(shell, issues, [op]);
      },
    },
  ]);
  if (shell.primary) shell.primary.disabled = true;
  setTimeout(() => reason.focus(), 30);
  return shell.promise;
}

// =========================================================================================================
// Invite & share

function shareText(P) {
  return t('dlg.shareText', { name: lineageOf(P, { depth: 4 }), link: store.siteLink(`#/p/${encodeURIComponent(P.id)}`) });
}

function openInvite(personId) {
  const P = g().person(personId);
  if (!P) return notFoundShell(personId);
  const shell = openShell({ title: t('dlg.invite'), size: 'sm', className: 'dlg-invite', backdropClose: true });
  const link = store.siteLink(`#/add-family?near=${encodeURIComponent(personId)}`);
  const text = t('dlg.inviteText', { link });
  const linkInput = h('input', { class: 'input dlg-invite-link', type: 'text', readOnly: true, dir: 'ltr', value: link, attrs: { 'aria-label': t('dlg.copyLink') } });
  linkInput.addEventListener('focus', () => linkInput.select());
  shell.setBody(targetCard(P, ''), h('p', { class: 'dlg-lead' }, t('dlg.inviteLead', { name: nameOf(P) })), linkInput);
  shell.setActions([
    { label: t('dlg.copyLink'), icon: 'copy', onClick: async () => { const ok = await copyText(link); toast(ok ? t('dlg.linkCopied') : t('dlg.copyFailed'), { type: ok ? 'success' : 'error' }); } },
    { label: t('dlg.sendWhatsApp'), variant: 'primary', icon: 'whatsapp', href: whatsappUrl(text) },
  ]);
  return shell.promise.then(() => false);
}

// =========================================================================================================
// openMoreOptions

export function openMoreOptions(personId) {
  const graph = g();
  const P = graph.person(personId);
  if (!P) return notFoundShell(personId);
  const shell = openShell({ title: t('dlg.more'), size: 'sm', className: 'dlg-sheet dlg-more', backdropClose: true });
  let next = null;
  const pick = (fn) => () => { next = fn; shell.close('pick'); };
  const item = (ic, label, onClick, { hint = '', href = null, danger = false, external = false } = {}) => h(href ? 'a' : 'button', {
    type: href ? undefined : 'button',
    href: href || undefined,
    target: external ? '_blank' : undefined,
    rel: external ? 'noopener' : undefined,
    class: ['sheet-item', danger ? 'sheet-item-danger' : ''],
    on: { click: onClick || (() => shell.close(false)) },
  }, icon(ic, { size: 20 }), h('span', { class: 'sheet-item-text' }, h('span', null, label), hint ? h('small', { class: 'muted' }, hint) : null));

  const hasChildrenToOrder = graph.unionsOf(personId).some((u) => graph.childrenOfUnion(u.id).length >= 2);
  const hasSpousesToOrder = graph.unionsOf(personId).length >= 2;
  const me = store.me && store.me !== personId ? store.me : null;
  const relHash = me ? `#/relationship/${encodeURIComponent(me)}/${encodeURIComponent(personId)}` : `#/relationship/_/${encodeURIComponent(personId)}`;

  shell.setBody(targetCard(P, ''),
    h('h3', { class: 'dlg-group-title' }, t('dlg.group.change')),
    h('div', { class: 'sheet-list' },
      item('flag', t('dlg.opt.mark'), pick(openMarkAs), { hint: t('dlg.opt.markHint') }),
      hasChildrenToOrder ? item('list', t('dlg.opt.reorderChildren'), pick(openReorderChildren)) : null,
      hasSpousesToOrder ? item('move', t('dlg.opt.reorderSpouses'), pick(openReorderSpouses)) : null,
      item('users', t('dlg.opt.changeParents'), pick(openChangeParents)),
      item('link', t('dlg.opt.link'), pick(openLinkExisting)),
      item('merge', t('dlg.opt.merge'), pick(openMerge))),
    h('h3', { class: 'dlg-group-title' }, t('dlg.group.share')),
    h('div', { class: 'sheet-list' },
      item('whatsapp', t('dlg.opt.share'), null, { href: whatsappUrl(shareText(P)), external: true }),
      item('send', t('dlg.opt.invite'), pick(openInvite)),
      item('tree', t('dlg.opt.tree'), null, { href: `#/tree/${encodeURIComponent(personId)}` }),
      item('arrowUp', t('dlg.opt.ancestors'), null, { href: `#/tree/${encodeURIComponent(personId)}?dir=up` }),
      item('users', t('dlg.opt.related'), null, { href: relHash })),
    h('div', { class: 'sheet-list dlg-danger-zone' },
      item('trash', t('dlg.opt.remove'), pick(openRequestRemoval), { danger: true })));
  setTimeout(() => shell.body.querySelector('.sheet-item')?.focus(), 30);
  return shell.promise.then((v) => (v === 'pick' && next ? next(personId) : false));
}
