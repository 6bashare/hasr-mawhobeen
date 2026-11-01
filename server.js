'use strict';
/*
 * حصر الطلاب الموهوبين – ثانوية الإمام الشاطبي — الخادم
 * على نفس فكرة سوق الشاطبي: Node.js بلا حزم خارجية (http + node:sqlite + crypto + zlib)،
 * والبيانات في قاعدة SQLite على القرص الدائم في Render.
 * يتطلب Node.js 22.13 أو أحدث.
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

/* ───────────── الإعدادات ───────────── */
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const ON_RENDER = process.env.RENDER === 'true';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

/* حارس القرص: يرفض التشغيل إن لم يكن مجلد البيانات على قرص دائم مستقل، حتى لا تُحفظ الترشيحات في مكان يُمسح عند إعادة النشر */
if (process.env.REQUIRE_DISK === '1' || (ON_RENDER && process.env.REQUIRE_DISK !== '0')) {
  if (fs.statSync(DATA_DIR).dev === fs.statSync(ROOT).dev) {
    console.error(`\n⛔ مجلد البيانات ${DATA_DIR} ليس على قرص دائم مستقل. أضف قرصًا دائمًا (Persistent Disk) واجعل DATA_DIR يشير إليه.\n`);
    process.exit(1);
  }
}

const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  secureCookies: process.env.SECURE_COOKIES === '1' || (ON_RENDER && process.env.SECURE_COOKIES !== '0'),
  trustProxy: process.env.TRUST_PROXY === '1' || (ON_RENDER && process.env.TRUST_PROXY !== '0'),
};

const GRADES = ['أول ثانوي', 'ثاني ثانوي', 'ثالث ثانوي'];
const SECTIONS = ['', '1', '2'];
const AREAS = ['علوم', 'رياضيات', 'لغة عربية وأدب', 'لغة إنجليزية', 'تقنية وبرمجة', 'خطابة وإلقاء', 'خط عربي', 'رسم وفنون', 'قيادة'];
const TRAITS = ['سريع الفهم', 'مبدع', 'مثابر', 'قيادي'];
const STATUSES = ['جديد', 'قيد المراجعة', 'يحتاج استكمال', 'مرشح للمتابعة والرعاية'];
const { TALENT_GROUPS, LEVELS, TEACHER_AREA_GROUP, TALENT_GROUP } = require('./public/talents.js');
const ALL_TALENTS = Object.keys(TALENT_GROUP);

const now = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
function loadOrCreate(file, make) {
  const p = path.join(DATA_DIR, file);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  const v = make();
  fs.writeFileSync(p, v + '\n', { mode: 0o600 });
  return v;
}
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
let adminPasswordFromFile = false;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = loadOrCreate('admin-password.txt', () => crypto.randomBytes(9).toString('base64url'));
  adminPasswordFromFile = true;
}

/* ───────────── قاعدة البيانات ───────────── */
const db = new DatabaseSync(path.join(DATA_DIR, 'hasr.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS nominations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  INTEGER NOT NULL,
  teacher     TEXT NOT NULL,
  subject     TEXT NOT NULL DEFAULT '',
  student     TEXT NOT NULL,
  grade       TEXT NOT NULL DEFAULT '',
  section     TEXT NOT NULL DEFAULT '',
  areas       TEXT NOT NULL DEFAULT '[]',
  traits      TEXT NOT NULL DEFAULT '[]',
  note        TEXT NOT NULL DEFAULT '',
  teacher_key TEXT NOT NULL,
  student_key TEXT NOT NULL,
  UNIQUE (teacher_key, student_key)
);
CREATE INDEX IF NOT EXISTS nominations_student_key ON nominations(student_key);
CREATE TABLE IF NOT EXISTS student_reviews (
  student_key TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'جديد',
  notes       TEXT NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
`);
/* إضافة مسار «موهبتي تستحق الاكتشاف»: جداول جديدة فقط، ولا يُعدَّل أي جدول قائم.
   قبل إنشائها أول مرة تُؤخذ نسخة احتياطية تلقائية من قاعدة البيانات الحالية على القرص الدائم. */
{
  const hasDisclosures = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'disclosures'").get();
  const hasData = db.prepare('SELECT COUNT(*) AS n FROM nominations').get().n > 0;
  if (!hasDisclosures && hasData) {
    const stamp = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const file = path.join(DATA_DIR, `hasr-before-students-${stamp}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    console.log(`   🗄️ نسخة احتياطية قبل إضافة مسار الطلاب: ${file}`);
  }
}
db.exec(`
CREATE TABLE IF NOT EXISTS disclosures (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   INTEGER NOT NULL,
  name         TEXT NOT NULL,
  grade        TEXT NOT NULL,
  section      TEXT NOT NULL DEFAULT '',
  talents      TEXT NOT NULL,
  distinct_text TEXT NOT NULL,
  achievement  TEXT NOT NULL DEFAULT '',
  link         TEXT NOT NULL DEFAULT '',
  name_key     TEXT NOT NULL,
  linked_key   TEXT,
  UNIQUE (name_key, grade)
);
CREATE TABLE IF NOT EXISTS match_rejections (
  disclosure_id INTEGER NOT NULL,
  student_key   TEXT NOT NULL,
  PRIMARY KEY (disclosure_id, student_key)
);
`);
const stmts = new Map();
const q = (sql) => { let s = stmts.get(sql); if (!s) { s = db.prepare(sql); stmts.set(sql, s); } return s; };
const getSetting = (k, d) => { const r = q('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : d; };
const setSetting = (k, v) => q('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

/* ───────────── أدوات ───────────── */
class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };
function text(v, { min = 0, max = 200, label = 'الحقل' } = {}) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < min) fail(400, min <= 1 ? `اكتب ${label}` : `${label} قصير جدًا`);
  if (s.length > max) fail(400, `${label} أطول من المسموح (${max} حرفًا)`);
  return s;
}
const pick = (arr, allowed) => (Array.isArray(arr) ? [...new Set(arr.map(String).filter((x) => allowed.includes(x)))] : []);

/* توحيد كتابة الأسماء العربية: أ/إ/آ، ى، ة، التشكيل، الأرقام، المسافات */
function normAr(t) {
  return String(t || '').toLowerCase()
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[ً-ْـ]/g, '').replace(/\s+/g, ' ').trim();
}
const teacherKey = (t) => normAr(t).replace(/^(الاستاذ|استاذ|المعلم|ا\.)\s*/, '').trim();
const studentKey = (name, grade) => normAr(name) + '|' + ((normAr(grade).match(/(اول|ثاني|ثالث)/) || [, ''])[1]);

/* ───────────── الحماية من التكرار والمحاولات ───────────── */
const buckets = new Map();
function rateHit(key, max, windowMs) {
  let b = buckets.get(key);
  if (!b || now() - b.start > windowMs) { b = { start: now(), count: 0, windowMs }; buckets.set(key, b); }
  b.count++;
  return { blocked: b.count > max, retryAfter: Math.ceil((b.start + windowMs - now()) / 1000) };
}
function rateBlocked(key, max, windowMs) {
  const b = buckets.get(key);
  return !!b && now() - b.start <= windowMs && b.count >= max ? Math.ceil((b.start + windowMs - now()) / 1000) : 0;
}
setInterval(() => {
  const t = now();
  for (const [k, b] of buckets) if (t - b.start > b.windowMs) buckets.delete(k);
  q('DELETE FROM sessions WHERE expires_at < ?').run(t);
}, 10 * 60 * 1000).unref();

/* ───────────── الجلسات ───────────── */
const COOKIE = 'hasr_sid';
function parseCookies(h) {
  const out = {};
  (h || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setCookie(res, value, maxAge) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (CONFIG.secureCookies) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function createSession(res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttl = 12 * 3600 * 1000;
  q('INSERT INTO sessions(token_hash, expires_at, created_at) VALUES(?,?,?)').run(sha(token), now() + ttl, now());
  setCookie(res, token, Math.floor(ttl / 1000));
}
function readSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const s = q('SELECT * FROM sessions WHERE token_hash = ?').get(sha(token));
  return s && s.expires_at > now() ? { tokenHash: s.token_hash } : null;
}
const needAdmin = (ctx) => { if (!ctx.session) fail(401, 'سجّل الدخول أولًا'); };

/* ───────────── التحديث الفوري للوحة (Server-Sent Events) ───────────── */
const streams = new Set();
let version = Number(getSetting('version', '0'));
function bump() {
  version++;
  setSetting('version', String(version));
  for (const r of streams) { try { r.write(`event: change\ndata: ${version}\n\n`); } catch {} }
}
setInterval(() => { for (const r of streams) { try { r.write(': ping\n\n'); } catch {} } }, 25000).unref();

/* ───────────── المسارات ───────────── */
const routes = [];
const RAW = Symbol('raw');
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
}

route('GET', '/api/health', () => ({ ok: true }));

/* — المعلم: إرسال الترشيحات (بدون دخول) — */
route('POST', '/api/nominations', (ctx) => {
  const b = ctx.body;
  if (String(b.website || '') !== '') return { ok: true, added: 0, duplicates: 0 }; // حقل مخفي: بوت
  const teacher = text(b.teacher, { min: 2, max: 80, label: 'اسم المعلم' });
  const subject = text(b.subject, { max: 60, label: 'المادة' });
  if (!Array.isArray(b.students) || !b.students.length) fail(400, 'اكتب اسم طالب واحد على الأقل');
  if (b.students.length > 15) fail(400, 'الحد الأقصى 15 طالبًا في الإرسال الواحد');
  const students = b.students.map((s) => ({
    name: text(s && s.name, { min: 2, max: 80, label: 'اسم الطالب' }),
    grade: GRADES.includes(s.grade) ? s.grade : '',
    section: SECTIONS.includes(String(s.section ?? '')) ? String(s.section ?? '') : '',
    areas: pick(s.areas, AREAS),
    traits: pick(s.traits, TRAITS),
    note: text(s.note, { max: 300, label: 'المثال أو الإنجاز' }),
  }));

  const g = rateHit('send:global', 300, 10 * 60 * 1000);
  const r = rateHit(`send:${ctx.ip}`, 20, 10 * 60 * 1000); // شبكة المدرسة قد تجمع عدة معلمين على عنوان واحد
  if (r.blocked || g.blocked) fail(429, 'تم الإرسال أكثر من مرة خلال وقت قصير. انتظر 10 دقائق ثم أعد المحاولة', { retryAfter: r.retryAfter });

  const tkey = teacherKey(teacher);
  const ins = q(`INSERT INTO nominations(created_at, teacher, subject, student, grade, section, areas, traits, note, teacher_key, student_key)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(teacher_key, student_key) DO NOTHING`);
  let added = 0, duplicates = 0;
  db.exec('BEGIN');
  try {
    for (const s of students) {
      const res = ins.run(now(), teacher, subject, s.name, s.grade, s.section, JSON.stringify(s.areas), JSON.stringify(s.traits), s.note, tkey, studentKey(s.name, s.grade));
      if (res.changes) added++; else duplicates++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  if (added) bump();
  return { ok: true, added, duplicates };
});

/* — الطالب: «موهبتي تستحق الاكتشاف» (بدون دخول) — */
function cleanLink(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (s.length > 300) fail(400, 'الرابط طويل جدًا');
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch { fail(400, 'الرابط غير صحيح. انسخه كما هو من المتصفح'); }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) fail(400, 'الرابط غير صحيح. انسخه كما هو من المتصفح');
  return u.href;
}
route('POST', '/api/disclosures', (ctx) => {
  const b = ctx.body;
  if (String(b.website || '') !== '') return { ok: true }; // حقل مخفي: بوت
  const name = text(b.name, { min: 6, max: 80, label: 'الاسم' });
  if (name.split(' ').length < 3) fail(400, 'اكتب اسمك الرباعي (ثلاثة أسماء على الأقل)');
  if (!GRADES.includes(b.grade)) fail(400, 'اختر صفك الدراسي');
  if (!['1', '2'].includes(String(b.section ?? ''))) fail(400, 'اختر فصلك');
  if (!Array.isArray(b.talents) || b.talents.length < 1) fail(400, 'اختر موهبة واحدة على الأقل');
  if (b.talents.length > 3) fail(400, 'الحد الأقصى ثلاث مواهب');
  const seen = new Set();
  const talents = b.talents.map((t) => {
    const n = String(t && t.name || '');
    const level = Number(t && t.level);
    if (!ALL_TALENTS.includes(n)) fail(400, 'موهبة غير معروفة');
    if (![1, 2, 3].includes(level)) fail(400, `حدد مستواك في «${n}»`);
    if (seen.has(n)) fail(400, 'لا تكرر نفس الموهبة');
    seen.add(n);
    return { name: n, group: TALENT_GROUP[n], level };
  });
  const distinct = text(b.distinct, { min: 10, max: 400, label: 'وصف موهبتك' });
  const achievement = text(b.achievement, { max: 300, label: 'وصف الإنجاز' });
  const link = cleanLink(b.link);
  if (b.consent !== true) fail(400, 'أكّد صحة المعلومات أولًا');

  const g = rateHit('disc:global', 600, 10 * 60 * 1000);
  const r = rateHit(`disc:${ctx.ip}`, 40, 10 * 60 * 1000); // طلاب فصل كامل قد يرسلون من شبكة المدرسة نفسها
  if (r.blocked || g.blocked) fail(429, 'وصلتنا مشاركات كثيرة من نفس الشبكة. انتظر دقائق ثم أعد المحاولة', { retryAfter: r.retryAfter });

  const res = q(`INSERT INTO disclosures(created_at, name, grade, section, talents, distinct_text, achievement, link, name_key)
                 VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(name_key, grade) DO NOTHING`)
    .run(now(), name, b.grade, String(b.section), JSON.stringify(talents), distinct, achievement, link, normAr(name));
  if (!res.changes) fail(409, 'وصلتنا مشاركتك من قبل 🌟 إذا تبي تضيف شيئًا كلّم معلم الموهوبين');
  bump();
  return { ok: true };
});

/* — الدخول — */
route('POST', '/api/admin/login', (ctx) => {
  const wait = rateBlocked(`login:${ctx.ip}`, 5, 15 * 60 * 1000) || rateBlocked('login:global', 300, 15 * 60 * 1000);
  if (wait) fail(429, `محاولات كثيرة. حاول مرة أخرى بعد ${Math.max(1, Math.ceil(wait / 60))} دقيقة`, { retryAfter: wait });
  const given = sha(String(ctx.body.password || ''));
  const ok = crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(sha(ADMIN_PASSWORD), 'hex'));
  if (!ok) {
    rateHit('login:global', 300, 15 * 60 * 1000);
    const r = rateHit(`login:${ctx.ip}`, 5, 15 * 60 * 1000);
    fail(r.blocked ? 429 : 401, r.blocked ? 'محاولات كثيرة. تم إيقاف الدخول مؤقتًا لمدة 15 دقيقة' : 'كلمة المرور غير صحيحة');
  }
  buckets.delete(`login:${ctx.ip}`);
  createSession(ctx.res);
  return { ok: true };
});
route('POST', '/api/logout', (ctx) => {
  if (ctx.session) q('DELETE FROM sessions WHERE token_hash = ?').run(ctx.session.tokenHash);
  setCookie(ctx.res, '', 0);
  return { ok: true };
});
route('GET', '/api/session', (ctx) => ({ admin: !!ctx.session }));

/* — لوحة الحصر — */
function nominationRow(n) {
  return { id: n.id, created_at: new Date(n.created_at).toISOString(), teacher: n.teacher, subject: n.subject, student: n.student, grade: n.grade, section: n.section,
    areas: JSON.parse(n.areas), traits: JSON.parse(n.traits), note: n.note, teacher_key: n.teacher_key, student_key: n.student_key };
}
function allData() {
  return {
    version,
    nominations: q('SELECT * FROM nominations ORDER BY created_at DESC').all().map(nominationRow),
    reviews: q('SELECT * FROM student_reviews').all().map((r) => ({ student_key: r.student_key, status: r.status, notes: r.notes })),
    roster: JSON.parse(getSetting('roster', '[]')),
    disclosures: q('SELECT * FROM disclosures ORDER BY created_at DESC').all().map(disclosureRow),
    rejections: q('SELECT * FROM match_rejections').all().map((r) => `${r.disclosure_id}|${r.student_key}`),
  };
}
function disclosureRow(d) {
  return { id: d.id, created_at: new Date(d.created_at).toISOString(), name: d.name, grade: d.grade, section: d.section, talents: JSON.parse(d.talents),
    distinct: d.distinct_text, achievement: d.achievement, link: d.link, linked_key: d.linked_key || null };
}
route('GET', '/api/admin/data', (ctx) => { needAdmin(ctx); return allData(); });

route('GET', '/api/admin/stream', (ctx) => {
  needAdmin(ctx);
  const res = ctx.res;
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`retry: 5000\nevent: hello\ndata: ${version}\n\n`);
  streams.add(res);
  ctx.req.on('close', () => streams.delete(res));
  return RAW;
});

route('PUT', '/api/admin/reviews/:key', (ctx) => {
  needAdmin(ctx);
  const key = text(ctx.params.key, { min: 1, max: 200, label: 'الطالب' });
  const cur = q('SELECT * FROM student_reviews WHERE student_key = ?').get(key) || { status: 'جديد', notes: '' };
  const status = ctx.body.status === undefined ? cur.status : ctx.body.status;
  if (!STATUSES.includes(status)) fail(400, 'حالة غير معروفة');
  const notes = ctx.body.notes === undefined ? cur.notes : String(ctx.body.notes).slice(0, 1000);
  q(`INSERT INTO student_reviews(student_key, status, notes, updated_at) VALUES(?,?,?,?)
     ON CONFLICT(student_key) DO UPDATE SET status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at`).run(key, status, notes, now());
  bump();
  return { ok: true, review: { student_key: key, status, notes } };
});

route('DELETE', '/api/admin/students/:key', (ctx) => {
  needAdmin(ctx);
  const key = ctx.params.key;
  const r = q('DELETE FROM nominations WHERE student_key = ?').run(key);
  let d = q('DELETE FROM disclosures WHERE linked_key = ?').run(key).changes;
  const m = /^d:(\d+)$/.exec(key);
  if (m) d += q('DELETE FROM disclosures WHERE id = ?').run(Number(m[1])).changes;
  q('DELETE FROM student_reviews WHERE student_key = ?').run(key);
  bump();
  return { ok: true, deleted: r.changes + d };
});

/* — تأكيد أن إفصاح الطالب وترشيح المعلم لنفس الطالب (بموافقة المشرف فقط) — */
route('POST', '/api/admin/links', (ctx) => {
  needAdmin(ctx);
  const id = Number(ctx.body.disclosureId), key = String(ctx.body.studentKey || '');
  const d = q('SELECT * FROM disclosures WHERE id = ?').get(id);
  if (!d) fail(404, 'المشاركة غير موجودة');
  if (!q('SELECT 1 FROM nominations WHERE student_key = ? LIMIT 1').get(key)) fail(404, 'الطالب غير موجود في ترشيحات المعلمين');
  db.exec('BEGIN');
  try {
    q('UPDATE disclosures SET linked_key = ? WHERE id = ?').run(key, id);
    // ملاحظات المشرف على الإفصاح تنتقل للملف الموحد دون فقدان
    const own = q('SELECT * FROM student_reviews WHERE student_key = ?').get('d:' + id);
    if (own) {
      const target = q('SELECT * FROM student_reviews WHERE student_key = ?').get(key);
      if (!target) q('UPDATE student_reviews SET student_key = ? WHERE student_key = ?').run(key, 'd:' + id);
      else {
        const notes = [target.notes, own.notes].filter(Boolean).join(' | ').slice(0, 1000);
        q('UPDATE student_reviews SET notes = ?, updated_at = ? WHERE student_key = ?').run(notes, now(), key);
        q('DELETE FROM student_reviews WHERE student_key = ?').run('d:' + id);
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  bump();
  return { ok: true };
});
route('POST', '/api/admin/links/reject', (ctx) => {
  needAdmin(ctx);
  q('INSERT OR IGNORE INTO match_rejections(disclosure_id, student_key) VALUES(?, ?)').run(Number(ctx.body.disclosureId), String(ctx.body.studentKey || ''));
  bump();
  return { ok: true };
});
route('DELETE', '/api/admin/links/:id', (ctx) => {
  needAdmin(ctx);
  q('UPDATE disclosures SET linked_key = NULL WHERE id = ?').run(Number(ctx.params.id));
  bump();
  return { ok: true };
});

route('PUT', '/api/admin/roster', (ctx) => {
  needAdmin(ctx);
  if (!Array.isArray(ctx.body.names)) fail(400, 'قائمة غير صالحة');
  const names = ctx.body.names.map((n) => String(n).replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean).slice(0, 300);
  setSetting('roster', JSON.stringify(names));
  bump();
  return { ok: true, roster: names };
});

/* — نسخة احتياطية كاملة لقاعدة البيانات — */
route('GET', '/api/admin/backup', (ctx) => {
  needAdmin(ctx);
  const tmp = path.join(DATA_DIR, `.backup-${crypto.randomBytes(6).toString('hex')}.db`);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buf = fs.readFileSync(tmp);
    const stamp = new Date(now() + 3 * 3600e3).toISOString().slice(0, 16).replace(/[T:]/g, '-');
    ctx.res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="hasr-backup-${stamp}.db"`, 'Content-Length': buf.length });
    ctx.res.end(buf);
  } finally { fs.rmSync(tmp, { force: true }); }
  return RAW;
});

/* — تصدير Excel (xlsx حقيقي بدون مكتبات) — */
const xmlEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
function colName(i) { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function sheetXml(rows) {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = colName(ci) + (ri + 1);
    return typeof v === 'number' ? `<c r="${ref}"${ri === 0 ? ' s="1"' : ''}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const widths = (rows[0] || []).map((_, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${Math.min(60, Math.max(12, ...rows.map((r) => String(r[ci] ?? '').length + 2)))}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${body}</sheetData></worksheet>`;
}
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const parts = [], central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), data = Buffer.from(f.data, 'utf8'), comp = zlib.deflateRawSync(data), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    parts.push(lh, name, comp); central.push(ch, name); offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
function xlsx(sheets) {
  const ns = 'http://schemas.openxmlformats.org';
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0E8F78"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows) })),
  ]);
}
const TRACK_OF = Object.fromEntries(TALENT_GROUPS.map((g) => [g.id, g.track]));
const GROUP_NAME = Object.fromEntries(TALENT_GROUPS.map((g) => [g.id, g.name]));
function pathsOf(groups, grade) {
  const tracks = new Set(groups.map((g) => TRACK_OF[g]));
  const out = [];
  if (tracks.has('acad')) out.push(/أول|اول/.test(grade) ? 'ترشيح لمقياس موهبة' : 'برنامج إثرائي / إبداع');
  if (tracks.has('art')) out.push('النشاط والمسابقات');
  if (tracks.has('sport')) out.push('النشاط الرياضي');
  if (tracks.has('lead')) out.push('برنامج قيادي');
  return out.length ? out : ['تحدده اللجنة'];
}
const SOURCE_LABEL = { teacher: '🟢 توصية معلم', self: '🟡 إفصاح ذاتي', both: '⭐ إفصاح ذاتي + توصية معلم' };
const levelLabel = (n) => (LEVELS.find((l) => l.id === n) || {}).short || '';
/* ملف موحد لكل طالب: ترشيحات المعلمين + إفصاحه الذاتي بعد تأكيد المشرف للتطابق */
function entities(d) {
  const map = new Map();
  for (const n of [...d.nominations].reverse()) {
    let e = map.get(n.student_key);
    if (!e) { e = { key: n.student_key, name: n.student, grade: n.grade, section: n.section, areas: new Set(), traits: new Set(), noms: [], discs: [] }; map.set(n.student_key, e); }
    n.areas.forEach((a) => e.areas.add(a)); n.traits.forEach((t) => e.traits.add(t)); if (!e.section) e.section = n.section; e.noms.push(n);
  }
  for (const s of d.disclosures) {
    let e = s.linked_key && map.get(s.linked_key);
    if (!e) { e = { key: 'd:' + s.id, name: s.name, grade: s.grade, section: s.section, areas: new Set(), traits: new Set(), noms: [], discs: [] }; map.set(e.key, e); }
    e.discs.push(s);
    if (s.name.split(' ').length > e.name.split(' ').length) e.name = s.name;
    if (!e.section) e.section = s.section;
  }
  return [...map.values()].map((e) => {
    const groups = new Set([...e.areas].map((a) => TEACHER_AREA_GROUP[a]).filter(Boolean));
    e.discs.forEach((s) => s.talents.forEach((t) => groups.add(t.group)));
    const source = e.noms.length && e.discs.length ? 'both' : e.noms.length ? 'teacher' : 'self';
    return { ...e, areas: [...e.areas], traits: [...e.traits], groups: [...groups], source };
  });
}
const pretty = (t) => String(t || '').replace(/^(أ\.|أ\s|الأستاذ|أستاذ)\s*/, '').trim();
route('GET', '/api/admin/export.xlsx', (ctx) => {
  needAdmin(ctx);
  const d = allData();
  const reviews = Object.fromEntries(d.reviews.map((r) => [r.student_key, r]));
  const order = { both: 0, self: 1, teacher: 2 };
  const ents = entities(d).sort((a, b) => order[a.source] - order[b.source]);
  const students = [['الطالب', 'المصدر', 'الصف', 'الفصل', 'مجالات المعلمين', 'مواهب الطالب (المستوى)', 'المجموعات', 'المسار المقترح', 'عدد توصيات المعلمين', 'المعلمون', 'ملاحظات المعلمين', 'وصف الطالب لموهبته', 'الإنجاز', 'الشاهد', 'الحالة', 'ملاحظات معلم الموهوبين']];
  for (const e of ents) {
    const r = reviews[e.key] || { status: 'جديد', notes: '' };
    const talents = e.discs.flatMap((s) => s.talents.map((t) => `${t.name} (${levelLabel(t.level)})`));
    students.push([e.name, SOURCE_LABEL[e.source], e.grade, e.section, e.areas.join('، '), talents.join('، '), e.groups.map((g) => GROUP_NAME[g]).join('، '), pathsOf(e.groups, e.grade).join(' + '),
      e.noms.length, e.noms.map((n) => pretty(n.teacher)).join('، '), e.noms.filter((n) => n.note).map((n) => `${pretty(n.teacher)}: ${n.note}`).join(' | '),
      e.discs.map((s) => s.distinct).join(' | '), e.discs.map((s) => s.achievement).filter(Boolean).join(' | '), e.discs.map((s) => s.link).filter(Boolean).join(' '), r.status, r.notes]);
  }
  const ts = (iso) => new Date(Date.parse(iso) + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const all = [['التاريخ', 'المعلم', 'المادة', 'الطالب', 'الصف', 'الفصل', 'المجال', 'السمات', 'ملاحظة']];
  for (const n of d.nominations) all.push([ts(n.created_at), n.teacher, n.subject, n.student, n.grade, n.section, n.areas.join('، '), n.traits.join('، '), n.note]);
  const discs = [['التاريخ', 'الطالب', 'الصف', 'الفصل', 'الموهبة الأولى', 'الموهبة الثانية', 'الموهبة الثالثة', 'وش يميزه', 'الإنجاز', 'الشاهد', 'مرتبط بترشيح معلم']];
  for (const s of d.disclosures) {
    const t = s.talents.map((x) => `${x.name} (${levelLabel(x.level)})`);
    discs.push([ts(s.created_at), s.name, s.grade, s.section, t[0] || '', t[1] || '', t[2] || '', s.distinct, s.achievement, s.link, s.linked_key ? 'نعم' : 'لا']);
  }
  const buf = xlsx([{ name: 'الطلاب', rows: students }, { name: 'إفصاحات الطلاب', rows: discs }, { name: 'ترشيحات المعلمين', rows: all }]);
  ctx.res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Cache-Control': 'no-store', 'Content-Length': buf.length,
    'Content-Disposition': `attachment; filename="hasr-1448.xlsx"; filename*=UTF-8''${encodeURIComponent('حصر_الموهوبين_1448.xlsx')}` });
  ctx.res.end(buf);
  return RAW;
});

/* ───────────── الملفات الثابتة ───────────── */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const gzCache = new Map();
function sendFile(req, res, file, cache) {
  let st;
  try { st = fs.statSync(file); if (!st.isFile()) throw 0; } catch { return false; }
  const ext = path.extname(file).toLowerCase();
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', cache);
  if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return true; }
  if (/\.(html|css|js|json|svg|txt)$/.test(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const key = file + etag; let gz = gzCache.get(key);
    if (!gz) { gz = zlib.gzipSync(fs.readFileSync(file), { level: 9 }); gzCache.set(key, gz); }
    res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding');
    res.end(req.method === 'HEAD' ? undefined : gz);
  } else {
    res.setHeader('Content-Length', st.size);
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  }
  return true;
}
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"].join('; '));
}

/* ───────────── الخادم ───────────── */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'حجم البيانات كبير جدًا')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
function clientIp(req) {
  if (CONFIG.trustProxy) { const f = req.headers['x-forwarded-for']; if (f) return String(f).split(',')[0].trim(); }
  return req.socket.remoteAddress || 'unknown';
}

async function handle(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, 'http://local');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.statusCode = 400; return res.end(); }

  if (pathname.startsWith('/api/')) {
    const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
    if (!r) { const any = routes.some((x) => x.re.test(pathname)); return sendJson(res, any ? 405 : 404, { error: any ? 'طريقة الطلب غير مسموحة' : 'المسار غير موجود' }); }
    try {
      const m = r.re.exec(pathname);
      const params = {}; r.keys.forEach((k, i) => (params[k] = m[i + 1]));
      let body = {};
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.headers['x-hasr'] !== '1') fail(403, 'طلب غير موثوق'); // حماية من الطلبات المزوّرة بين المواقع
        const raw = await readBody(req, 64 * 1024);
        if (raw) {
          if (!/^application\/json/.test(req.headers['content-type'] || '')) fail(415, 'نوع البيانات غير مدعوم');
          try { body = JSON.parse(raw); } catch { fail(400, 'بيانات غير صالحة'); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'بيانات غير صالحة');
        }
      }
      const ctx = { req, res, params, body, ip: clientIp(req), session: readSession(req) };
      const out = await r.handler(ctx);
      if (out === RAW) return;
      return sendJson(res, 200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) { if (e.extra?.retryAfter) res.setHeader('Retry-After', String(e.extra.retryAfter)); return sendJson(res, e.status, { error: e.message }); }
      console.error('[خطأ]', e);
      return sendJson(res, 500, { error: 'حدث خطأ في الخادم. حاول مرة أخرى' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
  if (pathname === '/' || pathname === '/admin' || pathname === '/admin/' || pathname === '/teacher' || pathname === '/student') return void sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'), 'no-cache');
  const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const f = path.join(PUBLIC_DIR, safe);
  if (f.startsWith(PUBLIC_DIR + path.sep) && sendFile(req, res, f, 'no-cache')) return;
  res.statusCode = 404;
  sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'), 'no-cache');
}

const server = http.createServer((req, res) => { handle(req, res).catch((e) => { console.error(e); try { sendJson(res, 500, { error: 'خطأ في الخادم' }); } catch {} }); });
server.requestTimeout = 0; // اتصالات التحديث الفوري طويلة
server.headersTimeout = 60000;

if (require.main === module) {
  server.listen(CONFIG.port, () => {
    console.log(`\n🌟 حصر الموهوبين يعمل على http://localhost:${CONFIG.port}`);
    console.log(`   مجلد البيانات: ${DATA_DIR}`);
    if (adminPasswordFromFile) console.log(`   كلمة مرور اللوحة محفوظة في: ${path.join(DATA_DIR, 'admin-password.txt')}`);
    else if (ADMIN_PASSWORD.length < 10) console.warn('   ⚠️ كلمة مرور اللوحة قصيرة. استخدم 10 أحرف على الأقل');
    console.log('');
  });
}
module.exports = { server, db, normAr, studentKey, teacherKey };
