# دليل المشرف · Owner guide

<div dir="rtl">

## دليل مشرف شجرة العائلة

هذا الدليل لمن يدير الشجرة ويوافق على التعديلات. لا يحتاج الأقارب إلى أي شيء منه: هم يقترحون التعديلات من الموقع ويرسلونها عبر واتساب أو GitHub، والمشرف وحده يوافق عليها.

### ١. الإعداد بعد الدمج في الفرع الرئيسي (main)

الأتمتة ونموذج المقترحات في GitHub لا يعملان إلا بعد دمج العمل في الفرع الافتراضي (main). بعد الدمج:

1. **تفعيل GitHub Pages:** من ‏Settings ← Pages، اختيار «Deploy from a branch»، ثم الفرع `main` والمجلد `/ (root)`. يظهر الموقع بعد دقائق على `https://<المالك>.github.io/<المستودع>/family-tree/`.
2. **صلاحيات الإجراءات (Actions):** من ‏Settings ← Actions ← General، يجب أن تكون Actions مفعّلة. إذا ظهر خطأ 403 في سجل التشغيل، يُختار «Read and write permissions» تحت «Workflow permissions».
3. **حماية الفرع:** إذا كان الفرع `main` محمياً ويشترط طلبات دمج (Pull requests)، فلن يتمكن الروبوت من حفظ البيانات. الحل: إبقاء الفرع دون هذا الشرط، أو السماح لـ GitHub Actions بتجاوزه.
4. **ملف الإعدادات `config.json`:**
   - `approvers`: أسماء حسابات GitHub المسموح لها بالموافقة (مثل `["gtsgate"]`).
   - `owner.name`: اسم المشرف كما يظهر للأقارب، و`owner.whatsapp`: رقم واتساب بالأرقام فقط مع رمز الدولة (مثل `9665xxxxxxxx`) ليصل إليه زر «إرسال عبر واتساب» مباشرة.
   - `siteUrl`: رابط الموقع العام (تُبنى منه روابط المعاينة في تعليقات الروبوت).
5. **التصنيفات (Labels):** تُنشأ تلقائياً عند أول مقترح. ولإنشائها مسبقاً: Actions ← «Family tree · check proposal» ← Run workflow مع رقم أي مقترح.
6. **التنبيهات على الجوال:** تثبيت تطبيق GitHub Mobile، ثم من صفحة المستودع: Watch ← Custom ← Issues، لتصل التنبيهات عند وصول كل مقترح.

### ٢. كيف تتم الموافقة من الجوال

1. يُعِدّ القريب تعديلاته في الموقع ثم يرسلها. أغلب الأقارب يرسلونها **عبر واتساب** إلى المشرف؛ وفي هذه الحالة تُفتح صفحة «الإدارة» في الموقع (`#/admin`)، ويُلصق الرمز، ثم يُستخدم زر «إنشاء المقترح والموافقة عليه». ومن لديه حساب GitHub يرسلها مباشرة عبر نموذج المقترحات.
2. خلال دقيقة تقريباً يكتب الروبوت **تعليق مراجعة** واحداً في المقترح (ويحدّثه عند كل تعديل):
   - ✅ جاهز، أو ⚠️ جاهز ويتضمن حذفاً، أو ❌ فيه ما يمنع تطبيقه.
   - قائمة مرقّمة بالتعديلات بالعربية والإنجليزية، والتنبيهات، ورابط **معاينة** على الموقع.
   - الأوامر الجاهزة للنسخ، مثل `/approve a1b2c3d4e5f60718`.
3. **للموافقة:** يكفي نسخ الأمر من تعليق الروبوت وإرساله تعليقاً (أو كتابة `/موافق a1b2c3d4e5f60718`). الأحرف الستة عشر بعد الأمر هي **بصمة** المقترح، وتضمن أن الموافقة على النسخة التي ظهرت في المراجعة تماماً.
   - بديل سريع: إضافة التصنيف `approve`. يُقبل هذا فقط إذا لم يُعدَّل المقترح بعد مراجعته الأولى، وإلا يطلب الروبوت الأمر مع البصمة.
4. بعد دقيقة أو اثنتين يكتب الروبوت «✅ طُبّقت التعديلات»، مع روابط الأشخاص في الموقع ورابط **«إبلاغ صاحب المقترح عبر واتساب»**، ثم يُغلق المقترح. قد يستغرق ظهور التغيير على الموقع بضع دقائق؛ والروابط فيها `?rev=` فتنتظر الصفحة حتى يُنشر التحديث.

### ٣. الأوامر

تُكتب الأوامر في **أول سطر** من التعليق، ويجب أن يبدأ التعليق بالشرطة المائلة `/`. حالة الأحرف لا تهم، والأرقام العربية مقبولة.

| الأمر | البديل العربي | العمل |
|---|---|---|
| `/approve a1b2c3d4e5f60718` | `/موافق a1b2c3d4e5f60718` | الموافقة على المقترح |
| `/approve a1b2c3d4e5f60718 skip 3,5` | `/موافق a1b2c3d4e5f60718 تخطي 3،5` | الموافقة مع تخطي التعديلين 3 و5 (بأرقامهما في تعليق المراجعة) وما يعتمد عليهما |
| `/approve a1b2c3d4e5f60718 force` | `/موافق a1b2c3d4e5f60718 فرض` | التطبيق رغم أن بيانات الشخص تغيّرت منذ إعداد المقترح |
| `/approve-deletion a1b2c3d4e5f60718` | `/موافق-حذف a1b2c3d4e5f60718` | موافقة تشمل الحذف أو الدمج أو تغيير الوالدين (موافقة منفصلة عمداً) |
| `/correct` + رمز جديد | `/تصحيح` | استبدال المقترح بنسخة مصحّحة ومراجعتها فقط، دون موافقة |
| `/reject` | `/رفض` | اعتذار لطيف ثابت النص (لا يذكر أي سبب) وإغلاق المقترح |
| `/undo` | `/تراجع` | التراجع عن مقترح طُبّق (على المقترح المغلق نفسه) |

لتجاهل مقترح دون رد: يكفي إغلاقه.

### ٤. تصحيح مقترح

- **الطريقة الأسهل:** من صفحة «الإدارة» في الموقع، «تصحيح هذا المقترح» ينقله إلى مسودة المشرف، وبعد التعديل يظهر زر «نسخ تعليق الموافقة»، فيُلصق التعليق (وهو `/approve` متبوعاً بالرمز الجديد) في المقترح نفسه. يراجع الروبوت النسخة المصحّحة ويطبّقها، ولا حاجة إلى بصمة لأن الرمز مكتوب بيد المشرف.
- للمراجعة فقط دون موافقة: `/correct` في السطر الأول ثم الرمز الجديد.
- إذا عدّل القريب نص مقترحه بنفسه، يحدّث الروبوت تعليق المراجعة ويطلب الموافقة بالبصمة الجديدة.
- عند ظهور «يعتمد هذا المقترح على #12»: الموافقة على #12 أولاً، ثم على هذا المقترح.

### ٥. التراجع

- `/undo` على المقترح المطبّق (المغلق) يعيد الأشخاص والأسر التي غيّرها إلى ما كانت عليه، ويحذف من أضافهم، ثم يضيف التصنيف `undone`.
- إذا تغيّر أحد هذه السجلات بعد التطبيق (بمقترح لاحق)، يرفض الروبوت التراجع ويذكر السجلات، حتى لا تضيع التعديلات اللاحقة. يمكن عندها التصحيح بمقترح جديد من الموقع.
- لإعادة تطبيق مقترح بعد التراجع عنه: إعادة فتحه، وإزالة التصنيف `undone`، ثم الموافقة عليه من جديد.

### ٦. طلبات الخصوصية

- **قريب لا يريد ظهور اسمه أو تفاصيله:** من صفحته في الموقع، «خيارات أخرى ← تحديد الحالة ← خاص». يُحجب الاسم وتُحذف التفاصيل الشخصية مع بقاء موقعه في الشجرة.
- **طلب الحذف الكامل:** «خيارات أخرى ← طلب حذف» مع السبب «بطلب من الشخص نفسه»؛ وتلزمه موافقة الحذف `/approve-deletion`. الحذف «لين» وقابل للاسترجاع، مع إمكانية مسح كل البيانات الشخصية.
- **تنبيه مهم:** سجل GitHub عام ويحتفظ بالنسخ السابقة. لإزالة معلومة حساسة من التاريخ نهائياً يلزم تدخل تقني (إعادة كتابة السجل) أو التواصل مع دعم GitHub. لذلك تُحفظ تواريخ ميلاد الأحياء بالسنة فقط، ويُفضّل إرسال أي تفاصيل خاصة عبر واتساب لا في المقترحات. ويمكن لمالك المستودع حذف مقترح كامل من GitHub عند الحاجة (من قائمة المقترح ← Delete issue).

### ٧. النسخ الاحتياطية

- كل يوم جمعة يُنشئ الروبوت إصداراً باسم `data-YYYY-MM-DD` في صفحة **Releases**، مرفقاً به `family.json` و`changelog.json` و`applied.json`، ويحتفظ بآخر 12 نسخة.
- لنسخة فورية: Actions ← «Family tree · weekly backup» ← Run workflow.
- للاسترجاع: تنزيل الملفات من الإصدار المطلوب، ثم رفعها إلى مجلد `family-tree/data/` من واجهة GitHub (Add file ← Upload files) وحفظها.

### ٨. إضافة مشرف ثانٍ

1. إضافة اسم حسابه في GitHub إلى `approvers` في `config.json` (مثل `["gtsgate", "second-user"]`) وحفظ الملف في الفرع الرئيسي.
2. هذا يكفي لأوامر التعليقات (`/approve` وغيرها). أما استخدام **التصنيفات** فيتطلب صلاحية في المستودع: Settings ← Collaborators ← Add people (صلاحية Triage على الأقل).
3. الروبوت لا يثق بصلاحيات GitHub وحدها: الموافقة تُقبل فقط ممن يرد اسمه في `approvers`.

### ٩. حل المشكلات

- **لم يظهر تعليق الروبوت:** صفحة Actions تعرض سبب الفشل. هل دُمج العمل في main؟ هل Actions مفعّلة؟ هل في المقترح رمز يبدأ بـ `GFT1:`؟
- **«يلزم تأكيد البصمة»:** عُدّل المقترح بعد مراجعته؛ يكفي نسخ الأمر الذي يقترحه الروبوت.
- **«تلزم موافقة الحذف»:** المقترح يحذف أو يدمج أو يغيّر الوالدين؛ يُستخدم `/approve-deletion` مع البصمة.
- **«تعذّر حفظ التحديث… ستُعاد المحاولة تلقائياً»:** حدث تحديث آخر في الوقت نفسه؛ يعيد الروبوت المحاولة كل 6 ساعات، أو فوراً من Actions ← «Family tree · apply approved proposals» ← Run workflow.
- **الموقع لم يتحدّث:** التحقق من إعداد Pages، والانتظار بضع دقائق؛ روابط `?rev=` تنتظر النشر تلقائياً.
- **أمر بلا رد:** يجيب الروبوت في كل تشغيل لاحق على أوامر المشرف التي لم يرد عليها (عدا `/undo`)؛ وإذا لم يرد على `/undo` خلال دقائق، يكفي إرساله مرة أخرى.
- **تشغيل تجريبي دون أي تغيير:** Actions ← «Family tree · apply approved proposals» ← Run workflow مع خيار `dry_run`.

</div>

---

## Owner guide (English)

This guide is for whoever keeps the tree and approves changes. Relatives need none of it: they prepare changes on the site and send them through WhatsApp or GitHub; only approvers can apply them.

### 1. Setup after merging to `main`

The automation and the issue form only work once the work is merged into the default branch (`main`). Then:

1. **Turn on GitHub Pages:** Settings → Pages → *Deploy from a branch* → branch `main`, folder `/ (root)`. The site appears after a few minutes at `https://<owner>.github.io/<repo>/family-tree/`.
2. **Actions permissions:** Settings → Actions → General — Actions must be enabled. If a run fails with HTTP 403, choose *Read and write permissions* under *Workflow permissions*. (Each workflow already asks only for what it needs.)
3. **Branch protection:** if `main` requires pull requests, the bot cannot save data. Leave that rule off, or let GitHub Actions bypass it.
4. **`config.json`:**
   - `approvers`: GitHub logins allowed to approve (e.g. `["gtsgate"]`).
   - `owner.name`: how relatives see the keeper's name; `owner.whatsapp`: digits only with the country code (e.g. `9665xxxxxxxx`) so “Send on WhatsApp” goes straight to the keeper.
   - `siteUrl`: the public site URL (preview links in bot comments are built from it).
5. **Labels** (`family-tree, approve, approve-deletion, needs-changes, applied, deletion-request, duplicate, undone`) are created automatically on the first proposal. To create them earlier: Actions → *Family tree · check proposal* → *Run workflow* with any issue number.
6. **Phone notifications:** install GitHub Mobile, then on the repository: Watch → Custom → Issues.

### 2. How approval works on the phone

1. A relative prepares changes on the site and sends them. Most will send **on WhatsApp**: open the site's Admin page (`#/admin`), paste the code and tap **“Create issue and approve”**. Relatives with a GitHub account can send through the issue form directly.
2. Within about a minute the bot writes **one check comment** on the issue (updated whenever the issue changes):
   - ✅ ready, ⚠️ ready but includes removals, or ❌ something prevents applying it;
   - the numbered changes in Arabic and English, warnings, and a **preview** link to the site;
   - ready-to-copy commands such as `/approve a1b2c3d4e5f60718`.
3. **To approve**, copy the command from the bot comment and post it as a comment (or type `/موافق a1b2c3d4e5f60718`). The 16 characters are the proposal's **fingerprint**: they guarantee that exactly the version shown in the check is approved.
   - Shortcut: add the `approve` label. This is accepted only if the proposal was not edited after its first check; otherwise the bot asks for the command with the fingerprint.
4. A minute or two later the bot posts “✅ Applied”, with links to the people on the site and a **“Tell them on WhatsApp”** link, and closes the issue. The site may take a few minutes to update; the links carry `?rev=` so the page waits for the new version.

### 3. Commands

Commands go on the **first line** of a comment, and the comment must start with `/`. Case does not matter; Arabic digits are fine.

| Command | Arabic alias | Effect |
|---|---|---|
| `/approve a1b2c3d4e5f60718` | `/موافق a1b2c3d4e5f60718` | Approve |
| `/approve a1b2c3d4e5f60718 skip 3,5` | `/موافق a1b2c3d4e5f60718 تخطي 3،5` | Approve but skip changes 3 and 5 (numbers from the check comment) and anything depending on them |
| `/approve a1b2c3d4e5f60718 force` | `/موافق a1b2c3d4e5f60718 فرض` | Apply even though the person's data changed since the proposal was prepared |
| `/approve-deletion a1b2c3d4e5f60718` | `/موافق-حذف a1b2c3d4e5f60718` | Approval that includes removals, merges or changing parents (deliberately separate) |
| `/correct` + new code | `/تصحيح` | Replace the proposal with a corrected one and check it, without approving |
| `/reject` | `/رفض` | A fixed, polite thank-you/decline (never states a reason) and close |
| `/undo` | `/تراجع` | Undo an applied proposal (on that closed issue) |

To ignore a proposal without replying, just close it.

### 4. Correcting a proposal

- **Easiest:** on the site's Admin page, **“Correct this proposal”** loads it into the keeper's draft; after editing, **“Copy approval comment”** copies `/approve` followed by the new code — paste it as a comment on the same issue. The bot checks the corrected version and applies it; no fingerprint is needed because the keeper wrote the code.
- To check a correction without approving: `/correct` on the first line, then the new code.
- If the relative edits their issue, the bot refreshes its check and asks for the new fingerprint.
- “This builds on #12”: approve #12 first, then this one.

### 5. Undo

- `/undo` on an applied (closed) issue puts the people and families it changed back as they were, removes the people it added, and labels the issue `undone`.
- If any of those records changed afterwards (a later proposal), the bot refuses and lists them, so later work is never erased. Fix them with a new proposal instead.
- To apply a proposal again after an undo: reopen it, remove the `undone` label and approve it again.

### 6. Privacy requests

- **Someone does not want their name or details shown:** on their page, *More options → Mark as → Private*. The name is withheld and personal details are cleared; their place in the tree stays.
- **Removal:** *More options → Request removal* with the reason “person requested”; it needs `/approve-deletion`. Removal is soft (restorable) and can also wipe all personal fields.
- **Important:** GitHub history is public and keeps earlier versions. Erasing something from history requires a history rewrite or GitHub Support. That is why living people's birth dates are stored as a year only, and why private details belong on WhatsApp, not in proposals. The repository owner can delete a whole issue on GitHub if needed (issue menu → *Delete issue*).

### 7. Backups

- Every Friday the bot creates a release `data-YYYY-MM-DD` on the **Releases** page with `family.json`, `changelog.json` and `applied.json` attached, keeping the latest 12. Data releases are never marked “latest”.
- On demand: Actions → *Family tree · weekly backup* → *Run workflow*.
- To restore: download the files from the release and upload them to `family-tree/data/` in the GitHub web interface (*Add file → Upload files*), then commit.

### 8. Adding a second approver

1. Add their GitHub login to `approvers` in `config.json` (e.g. `["gtsgate", "second-user"]`) and commit it to `main`.
2. That is enough for comment commands. Using **labels** also needs repository access: Settings → Collaborators → *Add people* (at least *Triage*).
3. The bot does not rely on GitHub roles alone: an approval counts only from a login listed in `approvers` (labels are verified through the issue's event history).

### 9. Troubleshooting

- **No bot comment:** the Actions tab shows why. Is the work merged into `main`? Are Actions enabled? Does the issue contain a code starting with `GFT1:`?
- **“Please confirm the fingerprint”:** the proposal was edited after it was checked — copy the command the bot suggests.
- **“The deletion approval is needed”:** the proposal removes, merges or re-parents people — use `/approve-deletion` with the fingerprint.
- **“…will be retried automatically”:** another update happened at the same moment; the queue runs again every 6 hours, or immediately via Actions → *Family tree · apply approved proposals* → *Run workflow*.
- **Site not updated:** check the Pages settings and wait a few minutes; `?rev=` links wait for publication on their own.
- **A command got no reply:** every later run answers approver commands that never got a reply (except `/undo`); if `/undo` gets no reply within a few minutes, post it again.
- **Try without changing anything:** Actions → *Family tree · apply approved proposals* → *Run workflow* with `dry_run` ticked.

### For maintainers

```sh
cd family-tree
node --test                                   # all tests (core, site, automation)
node scripts/validate-data.mjs                # data invariants and ledger shapes
node scripts/check-proposal.mjs --dry-run --event scripts/fixtures/issue-opened.json
node scripts/apply-proposal.mjs --dry-run --event scripts/fixtures/approve-comment.json
```

Offline dry runs simulate GitHub from the event file, apply in memory and print the comments the bot would post; nothing is written. With `GITHUB_TOKEN` set, `--dry-run` reads the real issues and only logs writes.

**Moving the portal to its own repository:** copy the contents of `family-tree/` to the new repository root and `.github/` beside them; in each `family-tree-*.yml` change `PORTAL_DIR: family-tree` to `PORTAL_DIR: .` (the CI `paths:` filters already list both layouts); update `repo`, `siteUrl` and `portalPath` in `config.json`. The scripts find their files relative to their own location and read the repository name from `GITHUB_REPOSITORY`.
