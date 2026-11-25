// Automatic English spelling of Arabic names ("auto English").
//
// A person's English name is stored ONLY when someone typed / corrected it deliberately; otherwise the
// English spelling is generated here from the Arabic. So everyone gets a sensible default (e.g. محمد → Muhammad)
// and each person can still choose their own spelling (Mohammed, Mohamed…) by editing it.
//
// Strategy: (1) a dictionary of common names / family names with the preferred spelling, (2) compound rules
// (عبد ال…، أبو …، … الدين، آل …، ال…، بن/بنت), (3) a rule-based letter-by-letter fallback for anything else.
// Pure module: no DOM, works in browsers and Node.

const TASHKEEL = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const SHADDA = 'ّ';

/** Normalize Arabic for dictionary lookup (keeps word boundaries). */
export function normalizeForTranslit(s) {
  return String(s || '')
    .replace(TASHKEEL, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[‌‍‎‏]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Preferred spellings. Keys are written naturally and normalized at load time.
// Gulf/Hijazi conventions; the owner chose "Muhammad" for محمد.
const GIVEN = {
  // — male —
  'محمد': 'Muhammad', 'محمدعلي': 'Muhammad Ali', 'محمد علي': 'Muhammad Ali', 'أحمد': 'Ahmed', 'محمود': 'Mahmoud', 'مصطفى': 'Mustafa',
  'حامد': 'Hamed', 'حمد': 'Hamad', 'حمود': 'Hamoud', 'حمدي': 'Hamdi', 'حمدان': 'Hamdan', 'علي': 'Ali', 'حسن': 'Hassan',
  'حسين': 'Hussein', 'حسان': 'Hassan', 'إبراهيم': 'Ibrahim', 'إسماعيل': 'Ismail', 'إسحاق': 'Ishaq', 'يعقوب': 'Yaqoub',
  'يوسف': 'Yousef', 'يونس': 'Younes', 'يحيى': 'Yahya', 'زكريا': 'Zakariya', 'موسى': 'Musa', 'عيسى': 'Eisa', 'داود': 'Dawood',
  'سليمان': 'Sulaiman', 'نوح': 'Nouh', 'آدم': 'Adam', 'إدريس': 'Idris', 'إلياس': 'Elias', 'هارون': 'Haroun', 'صالح': 'Saleh',
  'عمر': 'Omar', 'عثمان': 'Othman', 'أبوبكر': 'Abubakr', 'أبو بكر': 'Abubakr', 'خالد': 'Khalid', 'سعد': 'Saad', 'سعيد': 'Saeed',
  'سعود': 'Saud', 'سالم': 'Salem', 'سليم': 'Salim', 'سلمان': 'Salman', 'سامي': 'Sami', 'سمير': 'Samir', 'سامر': 'Samer',
  'فيصل': 'Faisal', 'فهد': 'Fahad', 'فهمي': 'Fahmi', 'فؤاد': 'Fouad', 'فاروق': 'Farouk', 'فارس': 'Fares', 'فايز': 'Fayez',
  'فواز': 'Fawaz', 'فراس': 'Firas', 'فريد': 'Farid', 'فتحي': 'Fathi', 'تركي': 'Turki', 'طارق': 'Tariq', 'طلال': 'Talal',
  'طه': 'Taha', 'ثامر': 'Thamer', 'ثابت': 'Thabit', 'ماجد': 'Majed', 'مازن': 'Mazen', 'مالك': 'Malik', 'مأمون': 'Mamoun',
  'منصور': 'Mansour', 'مراد': 'Murad', 'مروان': 'Marwan', 'مشعل': 'Mishal', 'معاذ': 'Muath', 'معتز': 'Moataz', 'مهند': 'Muhannad',
  'منير': 'Munir', 'مؤمن': 'Mumin', 'مجدي': 'Majdi', 'مدحت': 'Medhat', 'متولي': 'Metwally', 'موفق': 'Muwaffaq', 'مكي': 'Makki',
  'مهدي': 'Mahdi', 'محسن': 'Mohsen', 'مجيد': 'Majeed', 'نبيل': 'Nabil', 'نزار': 'Nizar', 'نادر': 'Nader', 'ناصر': 'Nasser',
  'نايف': 'Naif', 'نواف': 'Nawaf', 'نصر': 'Nasr', 'نور': 'Nour', 'نوري': 'Nouri', 'هشام': 'Hisham', 'هاشم': 'Hashim',
  'هاني': 'Hani', 'هيثم': 'Haitham', 'همام': 'Humam', 'وليد': 'Walid', 'وائل': 'Wael', 'وديع': 'Wadie', 'وسيم': 'Waseem',
  'وحيد': 'Waheed', 'ياسر': 'Yasser', 'ياسين': 'Yasin', 'يزيد': 'Yazeed', 'جميل': 'Jamil', 'جمال': 'Jamal', 'جلال': 'Jalal',
  'جابر': 'Jaber', 'جاسم': 'Jassim', 'جواد': 'Jawad', 'رائد': 'Raed', 'رائف': 'Raef', 'راشد': 'Rashed', 'رشيد': 'Rashid',
  'رامي': 'Rami', 'رياض': 'Riyad', 'رضا': 'Reda', 'رفيق': 'Rafiq', 'ربيع': 'Rabie', 'زياد': 'Ziyad', 'زكي': 'Zaki', 'زيد': 'Zaid',
  'زهير': 'Zuhair', 'عادل': 'Adel', 'عاصم': 'Asim', 'عامر': 'Amer', 'عماد': 'Emad', 'عمار': 'Ammar', 'عصام': 'Essam',
  'عزت': 'Ezzat', 'عزيز': 'Aziz', 'عوض': 'Awad', 'عيد': 'Eid', 'عارف': 'Aref', 'عاطف': 'Atef', 'علاء': 'Alaa', 'عدنان': 'Adnan',
  'عمرو': 'Amr', 'عبيد': 'Obaid', 'غازي': 'Ghazi', 'غسان': 'Ghassan', 'بدر': 'Badr', 'بندر': 'Bandar', 'باسم': 'Basim',
  'بسام': 'Bassam', 'بكر': 'Bakr', 'بلال': 'Bilal', 'حاتم': 'Hatem', 'حازم': 'Hazem', 'حمزة': 'Hamza', 'حسام': 'Hossam',
  'حافظ': 'Hafez', 'حبيب': 'Habib', 'حكيم': 'Hakim', 'خليل': 'Khalil', 'خلف': 'Khalaf', 'خضر': 'Khader', 'شاكر': 'Shaker',
  'شريف': 'Sharif', 'شادي': 'Shadi', 'شوقي': 'Shawqi', 'صلاح': 'Salah', 'صادق': 'Sadiq', 'صبري': 'Sabri', 'صقر': 'Saqr',
  'ضياء': 'Diaa', 'لؤي': 'Louay', 'لطفي': 'Lutfi', 'كمال': 'Kamal', 'كريم': 'Karim', 'كامل': 'Kamel', 'قاسم': 'Qasim',
  'قيس': 'Qais', 'أنور': 'Anwar', 'أنس': 'Anas', 'أيمن': 'Ayman', 'أسامة': 'Osama', 'أمين': 'Amin', 'أشرف': 'Ashraf',
  'أكرم': 'Akram', 'إياد': 'Iyad', 'إيهاب': 'Ehab', 'إسلام': 'Islam', 'أسعد': 'Asaad', 'سهيل': 'Suhail', 'سلطان': 'Sultan',
  'سيف': 'Saif', 'السيد': 'Al-Sayed', 'السعيد': 'Al-Saeed', 'سيد': 'Sayed', 'منذر': 'Munther', 'مهيب': 'Muhib', 'هادي': 'Hadi',
  'أصيل': 'Aseel', 'عبد الله': 'Abdullah', 'عبدالله': 'Abdullah', 'عبد الإله': 'Abdulelah', 'عبدالإله': 'Abdulelah',
  'عبدالرحمن': 'Abdulrahman', 'عبدالعزيز': 'Abdulaziz', 'عبداللطيف': 'Abdullatif', 'عبدالرحيم': 'Abdulrahim',
  'عبدالوهاب': 'Abdulwahab', 'عبدالملك': 'Abdulmalik', 'عبدالكريم': 'Abdulkarim', 'عبدالمجيد': 'Abdulmajeed',
  'عبدالحميد': 'Abdulhamid', 'عبدالصمد': 'Abdulsamad', 'عبدالغفار': 'Abdulghaffar', 'عبدالقادر': 'Abdulqader',
  'عبدالحليم': 'Abdulhalim', 'عبدالمحسن': 'Abdulmohsen', 'عبدالسلام': 'Abdulsalam', 'عبدالباسط': 'Abdulbasit',
  'عبدالفتاح': 'Abdulfattah', 'عبدالمنعم': 'Abdulmonem', 'عبدالناصر': 'Abdulnasser', 'عبدالهادي': 'Abdulhadi',
  'عبدالرزاق': 'Abdulrazzaq', 'عبدالجليل': 'Abduljalil', 'عبدالخالق': 'Abdulkhaliq', 'عبدالحكيم': 'Abdulhakim',
  'عبدالرؤوف': 'Abdulraouf', 'عبدالغني': 'Abdulghani', 'عبدالمطلب': 'Abdulmuttalib', 'عبدالمعين': 'Abdulmoeen',
  // — female —
  'فاطمة': 'Fatima', 'عائشة': 'Aisha', 'خديجة': 'Khadija', 'مريم': 'Maryam', 'زينب': 'Zainab', 'رقية': 'Ruqayya', 'حفصة': 'Hafsa',
  'سمية': 'Sumaya', 'أسماء': 'Asmaa', 'آمنة': 'Amna', 'أمينة': 'Amina', 'صفية': 'Safiya', 'سكينة': 'Sukaina', 'حليمة': 'Halima',
  'نفيسة': 'Nafisa', 'نورة': 'Noura', 'سارة': 'Sara', 'هند': 'Hind', 'هدى': 'Huda', 'هيفاء': 'Haifa', 'هيام': 'Hiyam',
  'هناء': 'Hanaa', 'هالة': 'Hala', 'حلى': 'Hala', 'حنان': 'Hanan', 'حياة': 'Hayat', 'سلوى': 'Salwa', 'سناء': 'Sanaa',
  'سعاد': 'Suad', 'سميرة': 'Samira', 'سهى': 'Suha', 'سهام': 'Siham', 'سلمى': 'Salma', 'سحر': 'Sahar', 'سوسن': 'Sawsan',
  'سماح': 'Samah', 'ليلى': 'Laila', 'لمياء': 'Lamia', 'لينا': 'Lina', 'لبنى': 'Lubna', 'نادية': 'Nadia', 'نائلة': 'Naila',
  'ناهد': 'Nahid', 'نوال': 'Nawal', 'نجلاء': 'Najlaa', 'نجوى': 'Najwa', 'نهى': 'Nuha', 'نسرين': 'Nisreen', 'نعمات': 'Nemat',
  'نعمة': 'Nema', 'نظمية': 'Nazmiya', 'نزيهة': 'Naziha', 'وفاء': 'Wafa', 'وعد': 'Waad', 'ولاء': 'Walaa', 'وصال': 'Wesal',
  'وئام': 'Weam', 'وداد': 'Widad', 'رحاب': 'Rehab', 'ريهام': 'Reham', 'ريم': 'Reem', 'رنا': 'Rana', 'رشا': 'Rasha',
  'رجاء': 'Rajaa', 'رزان': 'Razan', 'رويدة': 'Ruwaida', 'ريماز': 'Rimaz', 'رانيا': 'Rania', 'رهف': 'Rahaf', 'روان': 'Rawan',
  'روتانا': 'Rotana', 'بديعة': 'Badia', 'بثينة': 'Buthaina', 'بسمة': 'Basma', 'بلقيس': 'Balqis', 'بشرى': 'Bushra',
  'ابتسام': 'Ibtisam', 'ابتهال': 'Ibtihal', 'إلهام': 'Ilham', 'إيمان': 'Eman', 'إحسان': 'Ihsan', 'أميمة': 'Omaima',
  'أماني': 'Amani', 'أمل': 'Amal', 'آمال': 'Amal', 'أضواء': 'Adwaa', 'أنغام': 'Angham', 'أريج': 'Areej', 'أسيل': 'Aseel',
  'إسراء': 'Israa', 'عفاف': 'Afaf', 'عواطف': 'Awatif', 'عبير': 'Abeer', 'عيون': 'Oyoun', 'عهود': 'Ohoud', 'علوية': 'Alawiya',
  'عزة': 'Azza', 'عبلة': 'Abla', 'غيداء': 'Ghaida', 'غادة': 'Ghada', 'غزل': 'Ghazal', 'فوزية': 'Fawzia', 'فايزة': 'Faiza',
  'فريدة': 'Farida', 'فدوى': 'Fadwa', 'خيرية': 'Khairiya', 'خلود': 'Khulood', 'جميلة': 'Jamila', 'جود': 'Jood', 'حميدة': 'Hamida',
  'حصة': 'Hessa', 'زكية': 'Zakiya', 'زلفى': 'Zulfa', 'زبيدة': 'Zubaida', 'زهرة': 'Zahra', 'شادية': 'Shadia', 'شيماء': 'Shaimaa',
  'منال': 'Manal', 'منى': 'Mona', 'مها': 'Maha', 'ميمي': 'Mimi', 'مي': 'May', 'مروة': 'Marwa', 'ميساء': 'Maysaa', 'دعاء': 'Duaa',
  'دانة': 'Dana', 'دلال': 'Dalal', 'تهاني': 'Tahani', 'تغريد': 'Taghreed', 'ثريا': 'Thuraya', 'كوثر': 'Kawthar', 'ياسمين': 'Yasmin',
  // modern names
  'جمانة': 'Jumana', 'ليان': 'Layan', 'لجين': 'Lujain', 'شهد': 'Shahad', 'ريتاج': 'Ritaj', 'رغد': 'Raghad', 'هتان': 'Hattan',
  'حسني': 'Husni', 'مرتضى': 'Murtada', 'زهراء': 'Zahraa', 'ضحى': 'Duha', 'بتول': 'Batoul', 'سطام': 'Sattam', 'ريناد': 'Renad',
  'جنى': 'Jana', 'لمى': 'Lama', 'ديما': 'Dima', 'مشاري': 'Mishari', 'لولوة': 'Lulwa', 'أثير': 'Atheer', 'شوق': 'Shoug',
  'غلا': 'Ghala', 'لمار': 'Lamar', 'ريتال': 'Rital', 'روابي': 'Rawabi', 'ريان': 'Rayan', 'راكان': 'Rakan', 'يزن': 'Yazan',
  'البراء': 'Al-Baraa', 'تالا': 'Tala', 'يارا': 'Yara', 'سلاف': 'Sulaf', 'رنيم': 'Raneem', 'رهام': 'Reham', 'ملك': 'Malak',
  'جوري': 'Jouri', 'دانية': 'Dania', 'حور': 'Hoor', 'مرام': 'Maram', 'أروى': 'Arwa', 'وجدان': 'Wejdan', 'عائشه': 'Aisha',
  'عبدالمنان': 'Abdulmannan', 'كاظم': 'Kadhim', 'باقر': 'Baqir', 'معن': 'Maan', 'أوس': 'Aws', 'نايل': 'Nayel', 'مهدية': 'Mahdiya',
  'بيبي': 'Bibi', 'أنوار': 'Anwar', 'لطيفة': 'Latifa', 'شريفة': 'Sharifa', 'نوف': 'Nouf', 'العنود': 'Al-Anoud', 'الجوهرة': 'Al-Jawhara',
};

// Family / tribe names and other surname tokens.
const SURNAME = {
  'عالم': 'Alem', 'محمود': 'Mahmoud', 'فتة': 'Fatta', 'قربان': 'Qurban', 'كابلي': 'Kabli', 'بليلة': 'Balila', 'أبوغلية': 'Abu Ghulia',
  'حبيب': 'Habib', 'عاشور': 'Ashour', 'أصغر': 'Asghar', 'الحوتي': 'Al-Hawati', 'زيني': 'Zaini', 'عزت': 'Ezzat', 'عيد': 'Eid',
  'الريس': 'Al-Rayyis', 'متولي': 'Metwally', 'المرزوقي': 'Al-Marzouqi', 'مرزوقي': 'Marzouqi', 'أبو النجا': 'Abu Al-Naja',
  'أبوالنجا': 'Abu Al-Naja', 'دهلوي': 'Dahlawi', 'حافظ': 'Hafez', 'آل غالب': 'Al Ghalib', 'جودت': 'Jawdat', 'زقزوق': 'Zaqzouq',
  'المدني': 'Al-Madani', 'السقاف': 'Al-Saqqaf', 'الركا': 'Al-Raka', 'منصور': 'Mansour', 'الجهني': 'Al-Juhani',
  'الحكمي': 'Al-Hakami', 'راوه': 'Rawah', 'شمس': 'Shams', 'علوي': 'Alawi', 'أبوالخير': 'Abulkhair', 'أبو الخير': 'Abulkhair',
  'كتبي': 'Kutbi', 'صعيدي': 'Saeedi', 'داغستاني': 'Daghestani', 'قنديل': 'Qandil', 'الشربيني': 'Al-Sharbini', 'مراد': 'Murad',
  'مكي': 'Makki', 'خالد': 'Khalid', 'الحربي': 'Al-Harbi', 'العتيبي': 'Al-Otaibi', 'القحطاني': 'Al-Qahtani', 'الغامدي': 'Al-Ghamdi',
  'الزهراني': 'Al-Zahrani', 'الشهري': 'Al-Shehri', 'الدوسري': 'Al-Dosari', 'المطيري': 'Al-Mutairi', 'الشمري': 'Al-Shammari',
  'العنزي': 'Al-Anazi', 'السبيعي': 'Al-Subaie', 'الأنصاري': 'Al-Ansari', 'الهاشمي': 'Al-Hashemi', 'باناجة': 'Banaja',
  'بخاري': 'Bukhari', 'فلمبان': 'Felemban', 'سندي': 'Sindi', 'هوساوي': 'Hawsawi', 'برناوي': 'Barnawi', 'تركستاني': 'Turkistani',
  'بخش': 'Bakhsh', 'نقشبندي': 'Naqshbandi', 'مغربي': 'Maghrabi', 'يماني': 'Yamani', 'شطا': 'Shata', 'خياط': 'Khayyat',
  'عطار': 'Attar', 'جمجوم': 'Jamjoom', 'الصبان': 'Al-Sabban', 'مدني': 'Madani', 'البار': 'Al-Bar', 'باعشن': 'Baashen',
  'العمودي': 'Al-Amoudi', 'بن لادن': 'Bin Laden', 'زاهد': 'Zahid', 'كعكي': 'Kaaki', 'قاضي': 'Qadi', 'فقيه': 'Faqih',
};

// Particles inside full names.
const PARTICLES = { 'بن': 'bin', 'ابن': 'ibn', 'بنت': 'bint', 'آل': 'Al', 'ال': 'Al-', 'أبو': 'Abu', 'ابو': 'Abu', 'أم': 'Umm', 'ام': 'Umm', 'بو': 'Bu' };

const GIVEN_MAP = new Map();
const SURNAME_MAP = new Map();
for (const [k, v] of Object.entries(GIVEN)) GIVEN_MAP.set(keyOf(k), v);
for (const [k, v] of Object.entries(SURNAME)) SURNAME_MAP.set(keyOf(k), v);

function keyOf(s) { return normalizeForTranslit(s).replace(/ /g, ''); }

function lookup(token, kind) {
  const k = keyOf(token);
  if (!k) return '';
  if (kind === 'surname') return SURNAME_MAP.get(k) || GIVEN_MAP.get(k) || '';
  return GIVEN_MAP.get(k) || SURNAME_MAP.get(k) || '';
}

// ---------------------------------------------------------------------------
// Rule-based fallback, letter by letter (approximate; Arabic short vowels are not written).
const CONS = {
  'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh',
  'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h',
  'پ': 'p', 'چ': 'ch', 'ڤ': 'v', 'گ': 'g',
};
const LONG = new Set(['ا', 'و', 'ي', 'ى', 'ة', 'آ', 'أ', 'إ']);

function fallbackWord(raw) {
  // Keep shadda information (doubling) before normalizing.
  const chars = [];
  for (const ch of String(raw)) {
    if (ch === SHADDA && chars.length) chars[chars.length - 1].double = true;
    else if (!/[ً-ٰٟـ]/.test(ch)) chars.push({ ch, double: false });
  }
  const s = chars.map((c) => ({ ...c, ch: c.ch === 'ى' ? 'ى' : c.ch }));
  let out = '';
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const { ch, double } = s[i];
    const next = s[i + 1]?.ch;
    const last = i === n - 1;
    const isCons = (c) => c && !LONG.has(c) && c !== 'ع' && c !== 'ء' && c !== 'ئ' && c !== 'ؤ';
    if (ch === 'ا' || ch === 'آ') { out += (i === 0 ? 'a' : 'a'); continue; }
    if (ch === 'أ') { out += i === 0 ? 'a' : (out.endsWith('a') ? '' : 'a'); continue; }
    if (ch === 'إ') { out += 'i'; continue; }
    if (ch === 'ع') {
      if (i === 0) out += next === 'ي' ? 'e' : next === 'و' ? 'o' : 'a';
      else if (!/[aeiou]$/.test(out) && !LONG.has(next)) out += 'a';
      continue;
    }
    if (ch === 'ء' || ch === 'ئ' || ch === 'ؤ') {
      if (last) { if (!/a$/.test(out)) out += 'a'; continue; }
      out += ch === 'ئ' ? 'e' : ch === 'ؤ' ? 'u' : "'";
      continue;
    }
    if (ch === 'ة') { out += last ? 'a' : 't'; continue; }
    if (ch === 'ى') { out += 'a'; continue; }
    if (ch === 'و') {
      if (i === 0) { out += 'w'; continue; }
      if (last) { out += /[aeiou]$/.test(out) ? 'w' : 'ou'; continue; }
      if (s[i + 1]?.ch === 'ا') { out += 'wa'; i++; continue; }
      out += /[aeiou]$/.test(out) ? 'w' : 'ou';
      continue;
    }
    if (ch === 'ي') {
      if (i === 0) { out += 'y'; continue; }
      if (last) { out += /[aeiou]$/.test(out) ? 'y' : 'i'; continue; }
      if (s[i + 1]?.ch === 'ا') { out += 'ya'; i++; continue; }
      out += /[aeiou]$/.test(out) ? 'y' : 'ee';
      continue;
    }
    const lat = CONS[ch];
    if (lat === undefined) continue; // unknown (Latin letters, punctuation…) — ignore
    out += double ? lat + lat.slice(-1) : lat;
    // Insert a short vowel between two consonants (except before the last letter after a long vowel).
    if (!last && isCons(next)) {
      const prevLongA = /aa$|a$/.test(out.slice(0, -lat.length)) && i > 0 && (s[i - 1]?.ch === 'ا');
      if (i === 0) out += 'a';
      else if (!prevLongA && i < n - 2) out += 'a';
    } else if (!last && i > 0 && s[i - 1]?.ch === 'ا' && i === n - 2 && isCons(next)) {
      out += 'e';
    }
  }
  // "Salm" → "Salem" style: long ā followed by a final consonant cluster of one consonant.
  out = out.replace(/a([^aeiou'])([^aeiou'])$/, (m, a, b) => `a${a}e${b}`);
  return capitalize(out || '');
}

function capitalize(w) {
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

function wordOrDict(token, kind) {
  const hit = lookup(token, kind);
  if (hit) return hit;
  const norm = normalizeForTranslit(token);
  // Definite article glued to the word: الحربي → Al-Harbi
  if (norm.startsWith('ال') && norm.length > 3) {
    const rest = lookup(norm.slice(2), kind) || fallbackWord(token.replace(/^[ً-ٟ]*[اأإآ]?[ً-ٟ]*ل/, ''));
    return `Al-${capitalize(rest)}`;
  }
  // عبد ال… glued: عبدالحليم → Abdulhalim
  if (norm.startsWith('عبدال') && norm.length > 5) {
    const rest = lookup('ال' + norm.slice(5), 'given') || lookup(norm.slice(5), 'given') || fallbackWord(norm.slice(5));
    return 'Abdul' + rest.replace(/^Al-/, '').toLowerCase();
  }
  // أبو glued: أبوغلية → Abu Ghulia
  if (norm.startsWith('ابو') && norm.length > 4) {
    return 'Abu ' + wordOrDict(norm.slice(3), kind);
  }
  return fallbackWord(token);
}

/**
 * Transliterate an Arabic name (given name, surname, nickname or a full name) to English.
 * kind: "given" (default) | "surname" — only affects dictionary priority.
 * Returns '' for empty input. Latin input is returned unchanged.
 */
export function transliterate(arabic, { kind = 'given' } = {}) {
  const src = String(arabic || '').trim();
  if (!src) return '';
  if (!/[؀-ۿ]/.test(src)) return src; // already Latin
  // Whole-string dictionary hit (handles "عبد الرحمن", "محمد علي", "أبو النجا", "آل غالب").
  const whole = lookup(src, kind);
  if (whole) return whole;

  const tokens = src.replace(/[()«»"“”]/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const norm = normalizeForTranslit(tok);
    const next = tokens[i + 1];
    // عبد + name → Abdul…
    if (norm === 'عبد' && next) {
      const pair = lookup(tok + next, kind);
      if (pair) { out.push(pair); i++; continue; }
      const rest = normalizeForTranslit(next).replace(/^ال/, '');
      out.push('Abdul' + (lookup(rest, 'given') || fallbackWord(rest)).toLowerCase());
      i++;
      continue;
    }
    // X الدين → X Al-Din
    if (next && normalizeForTranslit(next) === 'الدين') {
      out.push(`${wordOrDict(tok, kind)} Al-Din`);
      i++;
      continue;
    }
    // Particles
    if (PARTICLES[norm] !== undefined || PARTICLES[tok] !== undefined) {
      const p = PARTICLES[tok] ?? PARTICLES[norm];
      if ((norm === 'ابو' || norm === 'ام' || norm === 'بو') && next) {
        const pair = lookup(tok + ' ' + next, kind);
        if (pair) { out.push(pair); i++; continue; }
        out.push(`${p} ${wordOrDict(next, kind)}`);
        i++;
        continue;
      }
      if (norm === 'ال' || tok === 'آل') {
        if (next) { out.push(`${p === 'Al-' ? 'Al-' : 'Al '}${wordOrDict(next, kind)}`.replace('Al- ', 'Al-')); i++; continue; }
      }
      out.push(p);
      continue;
    }
    out.push(wordOrDict(tok, kind));
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** Auto English for each bilingual name field of a person whose English value is empty. */
export function autoEnglish(person) {
  const r = { name: '', surname: '', nickname: '' };
  if (!person) return r;
  if (!person.name?.en && person.name?.ar) r.name = transliterate(person.name.ar, { kind: 'given' });
  if (!person.surname?.en && person.surname?.ar) r.surname = transliterate(person.surname.ar, { kind: 'surname' });
  if (!person.nickname?.en && person.nickname?.ar) r.nickname = transliterate(person.nickname.ar, { kind: 'given' });
  return r;
}

/** English text of a bilingual field: stored English, else automatic transliteration of the Arabic. */
export function englishOf(field, kind = 'given') {
  if (!field) return '';
  if (field.en && String(field.en).trim()) return String(field.en);
  return field.ar ? transliterate(field.ar, { kind }) : '';
}

/** Is the English of this field automatic (not stored)? */
export function isAutoEnglish(field) {
  return !!(field && field.ar && !(field.en && String(field.en).trim()));
}
