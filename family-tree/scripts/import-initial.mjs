#!/usr/bin/env node
// One-time import of the owner's initial notes ("Notes 26-11-25", 6 pages) into data/family.json.
//
// How the notes were read:
//   * Black headings are family heads: «أولاد محمد حسن سالم عالم» and «أبناء محمد علي محمود».
//   * Colours mark generations: gold = children, teal = grandchildren, purple = great-grandchildren.
//   * "x - y" = x married y (x is the family member, y the spouse).
//   * A line "- y" = the person just above (same colour) also married y; children that follow belong to that marriage.
//   * The «الأشقاء» section lists the mothers (black) of محمد علي محمود's children; a "- y" line there is that
//     mother's other husband, and the children after it are half-siblings.
//   * "؟" = unknown name (stored as nameStatus "unknown"); text in parentheses = nickname / other name (or a note, e.g. «عمة إنصاف»).
//   * A spouse's full name "زكية إسماعيل قربان" is stored as given name "زكية" + surname "إسماعيل قربان", so it
//     displays exactly as written, without inventing separate parent records.
//
// Re-running produces identical output (ids are derived deterministically from the import order).
// Usage:  node scripts/import-initial.mjs [--out data/family.json]

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? resolve(process.argv[outArg + 1]) : resolve(here, '../data/family.json');
const NOW = '2026-11-25T00:00:00Z';

const people = {};
const unions = {};
let seq = 0;

function makeId(prefix) {
  seq += 1;
  const hash = createHash('sha256').update(`gft-initial-${prefix}-${seq}`).digest();
  let s = '';
  for (let i = 0; s.length < 7; i++) s += (hash[i] % 36).toString(36);
  return prefix + s;
}

const bi = (ar, en) => ({ ar, en });

/** Create a person. opts: surname [ar,en], nickname [ar,en], bio [ar,en], needsInfo string. */
function P(ar, en, gender, opts = {}) {
  const id = makeId('p');
  // «؟» in the notes = name not known → nameStatus "unknown" (the UI shows a polite relational label instead).
  const p = ar === '؟' ? { id, nameStatus: 'unknown' } : { id, name: bi(ar, en) };
  if (opts.surname) p.surname = bi(...opts.surname);
  if (opts.nickname) p.nickname = bi(...opts.nickname);
  if (gender) p.gender = gender;
  if (opts.bio) p.bio = bi(...opts.bio);
  if (opts.needsInfo) { p.tags = ['needs-info']; p.needsInfo = opts.needsInfo; }
  p.history = [{ issue: null, at: NOW, action: 'import' }];
  people[id] = p;
  return id;
}

/** Create a union (marriage and/or shared parents). */
function U(partners, children = [], status) {
  const id = makeId('u');
  const u = { id, partners: partners.filter(Boolean) };
  if (children.length) u.children = children;
  if (status) u.status = status;
  else if (u.partners.length === 2) u.status = 'married';
  unions[id] = u;
  return id;
}

/** Shortcut: family member `a` married spouse `b`, with children. */
const M = (a, b, children = []) => U([a, b], children);

const UNKNOWN_NAME = 'الاسم غير معروف — Name unknown';

// ---------------------------------------------------------------------------
// Family 1 — أولاد محمد حسن سالم عالم
// The head's full name «محمد حسن سالم عالم» = محمد بن حسن بن سالم، من عائلة عالم.
const salem = P('سالم', 'Salem', 'm', {
  surname: ['عالم', 'Alem'],
  needsInfo: 'أُضيف من الاسم الكامل «محمد حسن سالم عالم» — يُرجى التأكيد وإضافة التفاصيل. Added from the full name; please confirm.',
});
const hassan0 = P('حسن', 'Hassan', 'm', {
  needsInfo: 'أُضيف من الاسم الكامل «محمد حسن سالم عالم» — يُرجى التأكيد وإضافة التفاصيل. Added from the full name; please confirm.',
});
U([salem], [hassan0]);
const head1 = P('محمد', 'Mohammed', 'm', { surname: ['عالم', 'Alem'] });
U([hassan0], [head1]);

// Children of محمد حسن سالم عالم (their mother is not named in the notes)
const ahmed1 = P('أحمد', 'Ahmed', 'm');
const khadijaBibi = P('خديجة', 'Khadija', 'f', { nickname: ['بيبي', 'Bibi'] });
const aisha1 = P('عائشة', 'Aisha', 'f');
const maryam1 = P('مريم', 'Maryam', 'f');
const ali1 = P('علي', 'Ali', 'm');
U([head1], [ahmed1, khadijaBibi, aisha1, maryam1, ali1]);

// أحمد - خديجة فتة
{
  const khadijaFatta = P('خديجة', 'Khadija', 'f', { surname: ['فتة', 'Fatta'] });
  const mohammed = P('محمد', 'Mohammed', 'm');
  const ibrahim = P('ابراهيم', 'Ibrahim', 'm');
  const fatima = P('فاطمة', 'Fatima', 'f');
  const fawzia = P('فوزية', 'Fawzia', 'f');
  const khairiya = P('خيرية', 'Khairiya', 'f');
  const nemat = P('نعمات', 'Nemat', 'f');
  const nazmiya = P('نظمية', 'Nazmiya', 'f');
  M(ahmed1, khadijaFatta, [mohammed, ibrahim, fatima, fawzia, khairiya, nemat, nazmiya]);

  // محمد - زكية إسماعيل قربان
  M(mohammed, P('زكية', 'Zakiya', 'f', { surname: ['إسماعيل قربان', 'Ismail Qurban'] }), [
    P('هدى', 'Huda', 'f'), P('سامي', 'Sami', 'm'), P('أحمد', 'Ahmed', 'm'),
    P('هيفاء', 'Haifa', 'f'), P('سلوى', 'Salwa', 'f'), P('هيام', 'Hiyam', 'f'),
  ]);

  // ابراهيم - إلهام حسن كابلي
  const rehab = P('رحاب', 'Rehab', 'f');
  M(ibrahim, P('إلهام', 'Ilham', 'f', { surname: ['حسن كابلي', 'Hassan Kabli'] }), [
    P('نزار', 'Nizar', 'm'), rehab, P('ريهام', 'Reham', 'f'),
  ]);
  M(rehab, P('عمار', 'Ammar', 'm', { surname: ['بليلة', 'Balila'] }));

  // فاطمة - صالح أبوغلية
  M(fatima, P('صالح', 'Saleh', 'm', { surname: ['أبوغلية', 'Abu Ghulia'] }), [
    P('سليمان', 'Sulaiman', 'm'), P('سمير', 'Samir', 'm'), P('محمد', 'Mohammed', 'm'), P('خالد', 'Khalid', 'm'),
    P('سميرة', 'Samira', 'f'), P('بديعة', 'Badia', 'f'), P('ابتسام', 'Ibtisam', 'f'), P('ناهد', 'Nahid', 'f'),
  ]);

  // فوزية - خليل حبيب
  M(fawzia, P('خليل', 'Khalil', 'm', { surname: ['حبيب', 'Habib'] }), [
    P('نبيل', 'Nabil', 'm'), P('وفاء', 'Wafa', 'f'), P('نادية', 'Nadia', 'f'), P('ليلى', 'Laila', 'f'),
  ]);

  // خيرية - ياسين عاشور
  M(khairiya, P('ياسين', 'Yasin', 'm', { surname: ['عاشور', 'Ashour'] }), [
    P('جمال', 'Jamal', 'm'), P('وفاء', 'Wafa', 'f'), P('بثينة', 'Buthaina', 'f'), P('هناء', 'Hanaa', 'f'),
  ]);

  // نعمات - علي أصغر
  M(nemat, P('علي', 'Ali', 'm', { surname: ['أصغر', 'Asghar'] }), [
    P('مازن', 'Mazen', 'm'), P('مصطفى', 'Mustafa', 'm'), P('آمال', 'Amal', 'f'),
  ]);

  // نظمية - حسين أصغر
  M(nazmiya, P('حسين', 'Hussein', 'm', { surname: ['أصغر', 'Asghar'] }), [
    P('خالد', 'Khalid', 'm'), P('وليد', 'Walid', 'm'), P('باسم', 'Basim', 'm'),
    P('؟', '?', '', { needsInfo: UNKNOWN_NAME }),
    P('عفاف', 'Afaf', 'f'),
  ]);
}

// عائشة - أحمد الحوَتي
M(aisha1, P('أحمد', 'Ahmed', 'm', { surname: ['الحوَتي', 'Al-Hawati'] }), [
  P('يوسف', 'Yousef', 'm'), P('سعاد', 'Suad', 'f'), P('نائلة', 'Naila', 'f'),
]);

// مريم - عبدالملك؟ زيني
M(maryam1, P('عبدالملك', 'Abdulmalik', 'm', {
  surname: ['زيني', 'Zaini'],
  needsInfo: 'الاسم الأول غير مؤكد («عبدالملك؟» في الملاحظات). First name uncertain.',
}));

// علي - فايزة محمود  (فايزة is the daughter of محمد علي محمود and إحسان قنديل — see family 2)
const faiza = P('فايزة', 'Faiza', 'f');
{
  const hassan = P('حسن', 'Hassan', 'm');
  const hussein = P('حسين', 'Hussein', 'm');
  const essam = P('عصام', 'Essam', 'm');
  const adel = P('عادل', 'Adel', 'm');
  const emad = P('عماد الدين', 'Emad Al-Din', 'm');
  const awatif = P('عواطف', 'Awatif', 'f');
  M(ali1, faiza, [hassan, hussein, essam, adel, emad, awatif]);
  M(hassan, P('إلهام', 'Ilham', 'f', { surname: ['عزت', 'Ezzat'] }));
  M(essam, P('سوسن', 'Sawsan', 'f', { surname: ['محمد عيد', 'Mohammed Eid'] }));
  M(essam, P('زلفى', 'Zulfa', 'f', { surname: ['الريس', 'Al-Rayyis'] }));
  M(emad, P('أماني', 'Amani', 'f', { surname: ['محمود حسين خالد', 'Mahmoud Hussein Khaled'] }));
  M(awatif, P('حسن', 'Hassan', 'm', { surname: ['متولي', 'Metwally'] }));
}

// ---------------------------------------------------------------------------
// Family 2 — أبناء محمد علي محمود
const head2 = P('محمد علي', 'Mohammed Ali', 'm', { surname: ['محمود', 'Mahmoud'] });

// Mothers («الأشقاء» section)
const wDaghestani = P('؟', '?', 'f', {
  surname: ['داغستاني', 'Daghestani'],
  needsInfo: 'الاسم الأول غير معروف. First name unknown.',
});
const wIhsan = P('إحسان', 'Ihsan', 'f', { surname: ['قنديل', 'Qandil'] });
const wAlawiya = P('علوية', 'Alawiya', 'f', { surname: ['مراد', 'Murad'] });
const wAisha = P('عائشة', 'Aisha', 'f');
const wFatima = P('فاطمة', 'Fatima', 'f', { surname: ['محمد حافظ', 'Mohammed Hafez'] });

const hussein2 = P('حسين', 'Hussein', 'm');
const ibrahim2 = P('إبراهيم', 'Ibrahim', 'm', {
  needsInfo: 'اسم الوالدة غير مذكور في الملاحظات. Mother not listed in the notes.',
});
const jamil2 = P('جميل', 'Jamil', 'm');
const abdullatif2 = P('عبداللطيف', 'Abdullatif', 'm');
const abdulrahman2 = P('عبدالرحمن', 'Abdulrahman', 'm');
const abdulaziz2 = P('عبدالعزيز', 'Abdulaziz', 'm');
const buthaina2 = P('بثينة', 'Buthaina', 'f');
const asim2 = P('عاصم', 'Asim', 'm');
const mohammedAli2 = P('محمدعلي', 'Mohammed Ali', 'm');

const uDaghestani = M(head2, wDaghestani, [hussein2]);
const uIbrahim = U([head2], [ibrahim2]);
const uIhsan = M(head2, wIhsan, [faiza]);
const uAlawiya = M(head2, wAlawiya, [jamil2]);
const uAisha = M(head2, wAisha, [abdullatif2, abdulrahman2, abdulaziz2]);
const uFatima = M(head2, wFatima, [buthaina2, asim2, mohammedAli2]);
people[head2].spouseOrder = [uDaghestani, uIbrahim, uIhsan, uAlawiya, uAisha, uFatima];

// The mothers' other marriages (half-siblings)
M(wIhsan, P('السعيد', 'Al-Saeed', 'm', { surname: ['الشربيني', 'Al-Sharbini'] }), [
  P('إسماعيل', 'Ismail', 'm'), P('حميدة', 'Hamida', 'f', { nickname: ['ميمي', 'Mimi'] }),
  P('سميرة', 'Samira', 'f'), P('السيد', 'Al-Sayed', 'm'), P('سلوى', 'Salwa', 'f'),
]);
M(wAlawiya, P('؟', '?', 'm', {
  surname: ['عالم', 'Alem'],
  needsInfo: 'الاسم الأول غير معروف. First name unknown.',
}), [
  P('غازي', 'Ghazi', 'm'), P('نزيهة', 'Naziha', 'f'), P('؟', '?', '', { needsInfo: UNKNOWN_NAME }),
]);
M(wFatima, P('حسين', 'Hussein', 'm', { surname: ['الريس', 'Al-Rayyis'] }), [
  P('هشام', 'Hisham', 'm'), P('ياسر', 'Yasser', 'm'),
]);

// حسين - بلقيس عبداللطيف
{
  const khadija = P('خديجة', 'Khadija', 'f');
  const nafisa = P('نفيسة', 'Nafisa', 'f');
  M(hussein2, P('بلقيس', 'Balqis', 'f', { surname: ['عبداللطيف', 'Abdullatif'] }), [khadija, nafisa]);

  // خديجة - هاشم محمد مكي المرزوقي
  const samir = P('سمير', 'Samir', 'm');
  const wadie = P('وديع', 'Wadie', 'm');
  const hisham = P('هشام', 'Hisham', 'm');
  const basma = P('بسمة', 'Basma', 'f', { nickname: ['ابتسام', 'Ibtisam'] });
  const abeer = P('عبير', 'Abeer', 'f');
  M(khadija, P('هاشم', 'Hashim', 'm', { surname: ['محمد مكي المرزوقي', 'Mohammed Makki Al-Marzouqi'] }), [samir, wadie, hisham, basma, abeer]);
  M(samir, P('ابتسام', 'Ibtisam', 'f', { surname: ['هشام أبو النجا', 'Hisham Abu Al-Naja'], bio: ['عمة إنصاف', "Insaf's paternal aunt"] }));
  M(wadie, P('سلوى', 'Salwa', 'f', { surname: ['دهلوي', 'Dahlawi'] }));
  M(hisham, P('حنان', 'Hanan', 'f', { surname: ['دهلوي', 'Dahlawi'] }));
  M(basma, P('عادل', 'Adel', 'm', { surname: ['حافظ', 'Hafez'] }));
  M(abeer, P('محمد', 'Mohammed', 'm', { surname: ['آل غالب', 'Al Ghalib'] }));

  // نفيسة - فاروق أحمد جودت
  const sanaa = P('سناء', 'Sanaa', 'f');
  const rajaa = P('رجاء', 'Rajaa', 'f');
  M(nafisa, P('فاروق', 'Farouk', 'm', { surname: ['أحمد جودت', 'Ahmed Jawdat'] }), [sanaa, rajaa, P('أحمد', 'Ahmed', 'm')]);
  M(sanaa, P('طارق', 'Tariq', 'm', { surname: ['عاشور', 'Ashour'] }));
  M(rajaa, P('سمير', 'Samir', 'm', { surname: ['عاشور', 'Ashour'] }));
}

// إبراهيم - فوزية زقزوق
{
  const mahmoud = P('محمود', 'Mahmoud', 'm');
  const omaima = P('أميمة', 'Omaima', 'f');
  const sahar = P('سحر', 'Sahar', 'f');
  const haifa = P('هيفاء', 'Haifa', 'f');
  const ruwaida = P('رويدة', 'Ruwaida', 'f');
  M(ibrahim2, P('فوزية', 'Fawzia', 'f', { surname: ['زقزوق', 'Zaqzouq'] }), [
    mahmoud, P('طارق', 'Tariq', 'm'), omaima, sahar, haifa, ruwaida, P('إيمان', 'Eman', 'f'), P('أضواء', 'Adwaa', 'f'),
  ]);
  M(mahmoud, P('مها', 'Maha', 'f', { surname: ['صالح المدني', 'Saleh Al-Madani'] }));
  M(omaima, P('عمر', 'Omar', 'm', { surname: ['محمد حسين', 'Mohammed Hussein'] }));
  M(sahar, P('أنور', 'Anwar', 'm', { surname: ['محمد حسين', 'Mohammed Hussein'] }));
  M(haifa, P('أحمد', 'Ahmed', 'm', { surname: ['السقاف', 'Al-Saqqaf'] }));
  M(ruwaida, P('محمد', 'Mohammed', 'm', { surname: ['الركا', 'Al-Raka'] }));
}

// جميل - سُكَينة (أنوار) حسن حسين منصور ، - نوال محمد عيد
{
  const suhail = P('سهيل', 'Suhail', 'm');
  const abdulrahim = P('عبدالرحيم', 'Abdulrahim', 'm');
  const khalid = P('خالد', 'Khalid', 'm');
  const oyoun = P('عيون', 'Oyoun', 'f');
  M(jamil2, P('سُكَينة', 'Sukaina', 'f', { nickname: ['أنوار', 'Anwar'], surname: ['حسن حسين منصور', 'Hassan Hussein Mansour'] }), [suhail, abdulrahim, khalid, oyoun]);
  M(suhail, P('لمياء', 'Lamia', 'f', { surname: ['فايز الجهني', 'Fayez Al-Juhani'] }), [
    P('وسيم', 'Waseem', 'm'), P('وليد', 'Walid', 'm'), P('غزل', 'Ghazal', 'f'), P('أصيل', 'Aseel', 'f'), P('سعود', 'Saud', 'm'),
  ]);
  M(abdulrahim, P('نادية', 'Nadia', 'f', { surname: ['سعيد الحكمي', 'Saeed Al-Hakami'] }));
  M(khalid, P('عهود', 'Ohoud', 'f', { surname: ['عبدالوهاب راوه', 'Abdulwahab Rawah'] }));
  M(oyoun, P('موفق', 'Muwaffaq', 'm', { surname: ['عبدالصمد عزت', 'Abdulsamad Ezzat'] }), [
    P('حلى', 'Hala', 'f'), P('فيصل', 'Faisal', 'm'), P('عبد الإله', 'Abdulelah', 'm'),
  ]);
  M(jamil2, P('نوال', 'Nawal', 'f', { surname: ['محمد عيد', 'Mohammed Eid'] }), [
    P('نزار', 'Nizar', 'm'), P('مازن', 'Mazen', 'm'), P('حازم', 'Hazem', 'm'), P('ثامر', 'Thamer', 'm'),
    P('محمد', 'Mohammed', 'm'), P('ابتهال', 'Ibtihal', 'f'),
  ]);
}

// عبداللطيف - شادية أحمد جودت ، - زبيدة
M(abdullatif2, P('شادية', 'Shadia', 'f', { surname: ['أحمد جودت', 'Ahmed Jawdat'] }), [
  P('حسين', 'Hussein', 'm'), P('وعد', 'Waad', 'f'), P('ولاء', 'Walaa', 'f'), P('وصال', 'Wesal', 'f'),
]);
M(abdullatif2, P('زبيدة', 'Zubaida', 'f'), [
  P('عبدالعزيز', 'Abdulaziz', 'm'), P('رجاء', 'Rajaa', 'f'), P('رزان', 'Razan', 'f'),
]);

// عبدالرحمن - هناء محمد عاشور
M(abdulrahman2, P('هناء', 'Hanaa', 'f', { surname: ['محمد عاشور', 'Mohammed Ashour'] }), [
  P('رائد', 'Raed', 'm'), P('رائف', 'Raef', 'm'), P('رشا', 'Rasha', 'f'),
]);

// بثينة - عبدالوهاب حسن شمس
{
  const ghaida = P('غيداء', 'Ghaida', 'f');
  M(buthaina2, P('عبدالوهاب', 'Abdulwahab', 'm', { surname: ['حسن شمس', 'Hassan Shams'] }), [
    P('حسن', 'Hassan', 'm'), P('وليد', 'Walid', 'm'), ghaida,
  ]);
  M(ghaida, P('محمد', 'Mohammed', 'm', { surname: ['سعيد أبوالخير علوي', 'Saeed Abulkhair Alawi'] }), [
    P('سمير', 'Samir', 'm'), P('وديع', 'Wadie', 'm'), P('سعيد', 'Saeed', 'm'), P('ريماز', 'Rimaz', 'f'),
  ]);
}

// عبدالعزيز - سناء (كتبي) عارف مرزوقي ، - سلوى عبدالغفار ، - زينب صعيدي
M(abdulaziz2, P('سناء', 'Sanaa', 'f', { nickname: ['كتبي', 'Kutbi'], surname: ['عارف مرزوقي', 'Aref Marzouqi'] }), [
  P('وليد', 'Walid', 'm'), P('منال', 'Manal', 'f'), P('أنغام', 'Angham', 'f'), P('وئام', 'Weam', 'f'),
]);
M(abdulaziz2, P('سلوى', 'Salwa', 'f', { surname: ['عبدالغفار', 'Abdulghaffar'] }));
M(abdulaziz2, P('زينب', 'Zainab', 'f', { surname: ['صعيدي', 'Saeedi'] }), [P('روتانا', 'Rotana', 'f')]);

// محمدعلي - بلقيس حسن شمس
M(mohammedAli2, P('بلقيس', 'Balqis', 'f', { surname: ['حسن شمس', 'Hassan Shams'] }), [
  P('علاء', 'Alaa', ''), P('عهود', 'Ohoud', 'f'),
]);

// ---------------------------------------------------------------------------
const data = {
  schema: 1,
  meta: {
    title: { ar: 'شجرة العائلة الكبرى', en: 'The Grand Family Tree' },
    rootPersonId: salem,
    revision: 1,
    updatedAt: NOW,
  },
  people,
  unions,
};

writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
const nPeople = Object.keys(people).length;
const nUnions = Object.keys(unions).length;
console.log(`Wrote ${OUT}: ${nPeople} people, ${nUnions} unions.`);
