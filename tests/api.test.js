'use strict';
/* اختبارات الخادم: الإرسال، منع التكرار، دمج الطالب، الحماية، الصلاحيات، الحالات، التحديث الفوري، Excel. */
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hasr-api-'));
process.env.DATA_DIR = dir; process.env.ADMIN_PASSWORD = 'test-password-123'; process.env.REQUIRE_DISK = '0'; process.env.TRUST_PROXY = '1';
const { server } = require('../server.js');
const H = { 'X-Hasr': '1', 'Content-Type': 'application/json' };
let B, ok = 0;
const t = async (name, fn) => { await fn(); ok++; console.log('  ✓ ' + name); };
const post = (p, body, h = {}) => fetch(B + p, { method: 'POST', headers: { ...H, ...h }, body: JSON.stringify(body) });
const send = (teacher, students, extra = {}) => post('/nominations', { teacher, subject: 'رياضيات', students, ...extra });

server.listen(0, async () => {
  B = `http://127.0.0.1:${server.address().port}/api`;
  try {
    await t('المعلم يرسل بدون دخول وتُحفظ الترشيحات', async () => {
      const r = await send('أ. أحمد الزهراني', [{ name: 'خالد سعد', grade: 'أول ثانوي', section: '2', areas: ['رياضيات', 'قيادة'], traits: ['سريع الفهم'], note: 'فاز بالكانجارو' }, { name: 'فهد علي', grade: 'ثاني ثانوي', areas: ['خط عربي'] }]);
      assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, added: 2, duplicates: 0 });
    });
    await t('إعادة الإرسال من نفس المعلم لا تكرر الطالب', async () => {
      const r = await send('احمد الزهراني', [{ name: 'خالد  سعد', grade: 'أول ثانوي' }]);
      assert.deepEqual(await r.json(), { ok: true, added: 0, duplicates: 1 });
    });
    await t('معلم آخر يرشح نفس الطالب: يُحفظ الترشيح', async () => {
      const r = await send('سالم القرني', [{ name: 'خالِد سعد', grade: 'أول ثانوي', areas: ['خطابة وإلقاء'] }]);
      assert.equal((await r.json()).added, 1);
    });
    await t('الحقل المخفي يتجاهل البوت بصمت', async () => {
      const r = await send('بوت', [{ name: 'spam spam' }], { website: 'http://spam' });
      assert.equal((await r.json()).added, 0);
    });
    await t('رفض البيانات غير الصالحة', async () => {
      assert.equal((await send('', [{ name: 'طالب' }])).status, 400);
      assert.equal((await send('معلم', [])).status, 400);
      assert.equal((await send('معلم', Array.from({ length: 16 }, (_, i) => ({ name: 'طالب ' + i })))).status, 400);
      const r = await fetch(B + '/nominations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(r.status, 403); // بدون ترويسة الحماية
    });
    await t('الزائر لا يقرأ اللوحة ولا يعدّل', async () => {
      assert.equal((await fetch(B + '/admin/data')).status, 401);
      assert.equal((await fetch(B + '/admin/export.xlsx')).status, 401);
      assert.equal((await fetch(B + '/admin/stream')).status, 401);
      assert.equal((await fetch(B + '/admin/reviews/x', { method: 'PUT', headers: H, body: '{"status":"جديد"}' })).status, 401);
      assert.equal((await fetch(B + '/admin/students/x', { method: 'DELETE', headers: H })).status, 401);
    });
    let cookie;
    await t('كلمة مرور خاطئة تُرفض وتُقفل بعد 5 محاولات', async () => {
      for (let i = 0; i < 4; i++) assert.equal((await post('/admin/login', { password: 'wrong' }, { 'X-Forwarded-For': '9.9.9.9' })).status, 401);
      assert.equal((await post('/admin/login', { password: 'wrong' }, { 'X-Forwarded-For': '9.9.9.9' })).status, 401);
      const r = await post('/admin/login', { password: 'test-password-123' });
      assert.equal(r.status, 200);
      cookie = r.headers.get('set-cookie').split(';')[0];
      assert.match(r.headers.get('set-cookie'), /HttpOnly/);
    });
    await t('المشرف يرى الترشيحات والطالب المكرر مدموج', async () => {
      const d = await (await fetch(B + '/admin/data', { headers: { Cookie: cookie } })).json();
      assert.equal(d.nominations.length, 3);
      assert.equal(new Set(d.nominations.map((n) => n.student_key)).size, 2);
    });
    await t('التحديث الفوري يصل للوحة عند وصول ترشيح جديد', async () => {
      const ctrl = new AbortController();
      const res = await fetch(B + '/admin/stream', { headers: { Cookie: cookie }, signal: ctrl.signal });
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      const got = (async () => { while (!buf.includes('event: change')) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); } return buf; })();
      await new Promise((r) => setTimeout(r, 100));
      await send('ماجد الحربي', [{ name: 'سعود ناصر', grade: 'ثالث ثانوي', areas: ['رسم وفنون'] }]);
      const out = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('لم يصل التحديث')), 3000))]);
      assert.match(out, /event: change/); ctrl.abort();
    });
    await t('تغيير الحالة والملاحظات وحفظها', async () => {
      const d = await (await fetch(B + '/admin/data', { headers: { Cookie: cookie } })).json();
      const key = d.nominations.find((n) => n.student === 'خالد سعد').student_key;
      let r = await fetch(B + '/admin/reviews/' + encodeURIComponent(key), { method: 'PUT', headers: { ...H, Cookie: cookie }, body: JSON.stringify({ status: 'قيد المراجعة', notes: 'مقابلة الأحد' }) });
      assert.equal(r.status, 200);
      r = await fetch(B + '/admin/reviews/' + encodeURIComponent(key), { method: 'PUT', headers: { ...H, Cookie: cookie }, body: JSON.stringify({ status: 'حالة غلط' }) });
      assert.equal(r.status, 400);
      const d2 = await (await fetch(B + '/admin/data', { headers: { Cookie: cookie } })).json();
      assert.deepEqual(d2.reviews[0], { student_key: key, status: 'قيد المراجعة', notes: 'مقابلة الأحد' });
    });
    await t('قائمة المعلمين تُحفظ', async () => {
      const r = await fetch(B + '/admin/roster', { method: 'PUT', headers: { ...H, Cookie: cookie }, body: JSON.stringify({ names: ['أحمد الزهراني', 'سالم القرني', ' '] }) });
      assert.deepEqual((await r.json()).roster, ['أحمد الزهراني', 'سالم القرني']);
    });
    await t('تصدير Excel ملف xlsx صالح', async () => {
      const r = await fetch(B + '/admin/export.xlsx', { headers: { Cookie: cookie } });
      assert.equal(r.status, 200);
      const buf = Buffer.from(await r.arrayBuffer());
      assert.equal(buf.readUInt32LE(0), 0x04034b50);
      fs.writeFileSync(path.join(dir, 'out.xlsx'), buf);
    });
    await t('حذف الطالب يحذف كل ترشيحاته', async () => {
      const d = await (await fetch(B + '/admin/data', { headers: { Cookie: cookie } })).json();
      const key = d.nominations.find((n) => n.student === 'فهد علي').student_key;
      await fetch(B + '/admin/students/' + encodeURIComponent(key), { method: 'DELETE', headers: { ...H, Cookie: cookie } });
      const d2 = await (await fetch(B + '/admin/data', { headers: { Cookie: cookie } })).json();
      assert.ok(!d2.nominations.some((n) => n.student === 'فهد علي'));
    });
    await t('تسجيل الخروج يلغي الجلسة', async () => {
      await fetch(B + '/logout', { method: 'POST', headers: { ...H, Cookie: cookie } });
      assert.equal((await fetch(B + '/admin/data', { headers: { Cookie: cookie } })).status, 401);
    });
    await t('حد الإرسال المتكرر من نفس الجهاز', async () => {
      const h = { 'X-Forwarded-For': '5.5.5.5' };
      let last;
      for (let i = 0; i < 21; i++) last = await post('/nominations', { teacher: 'معلم ' + i, students: [{ name: 'طالب رقم ' + i }] }, h);
      assert.equal(last.status, 429);
    });

    /* ===== مسار الطالب ===== */
    const disc = (b, h = {}) => post('/disclosures', { name: 'خالد سعد محمد العتيبي', grade: 'أول ثانوي', section: '2', talents: [{ name: 'البرمجة', level: 3 }, { name: 'التعليق الصوتي', level: 1 }], distinct: 'أبرمج ألعابًا صغيرة وأنشرها لأصحابي', achievement: 'المركز الثاني في هاكاثون المدرسة', link: 'github.com/khaled', consent: true, ...b }, { 'X-Forwarded-For': '7.7.7.7', ...h });
    await t('الطالب يرسل إفصاحه بدون دخول', async () => {
      const r = await disc({}); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
    });
    await t('الخادم يرفض الإفصاح غير المكتمل أو غير الصالح', async () => {
      const cases = [{ name: 'خالد سعد' }, { grade: 'رابع' }, { section: '3' }, { talents: [] }, { talents: [{ name: 'البرمجة', level: 1 }, { name: 'الرسم والتلوين', level: 1 }, { name: 'السباحة', level: 1 }, { name: 'الشطرنج', level: 1 }] },
        { talents: [{ name: 'موهبة وهمية', level: 1 }] }, { talents: [{ name: 'البرمجة', level: 5 }] }, { distinct: 'قصير' }, { link: 'javascript:alert(1)' }, { consent: false }];
      for (const c of cases) assert.equal((await disc({ name: 'طالب اختبار رفض البيانات', ...c })).status, 400, JSON.stringify(c));
    });
    await t('نفس الطالب لا يرسل مرتين (حتى مع اختلاف الهمزات والمسافات)', async () => {
      const r = await disc({ name: 'خالِد  سعد محمد العتيبى' }); assert.equal(r.status, 409);
    });
    await t('الحقل المخفي يتجاهل البوت', async () => {
      const r = await disc({ name: 'بوت بوت بوت', website: 'x' }); assert.equal(r.status, 200);
    });
    let c2;
    await t('الإفصاح يظهر للمشرف منفصلًا حتى يؤكد التطابق', async () => {
      c2 = (await post('/admin/login', { password: 'test-password-123' })).headers.get('set-cookie').split(';')[0];
      const d = await (await fetch(B + '/admin/data', { headers: { Cookie: c2 } })).json();
      assert.equal(d.disclosures.length, 1); assert.equal(d.disclosures[0].linked_key, null);
      assert.equal(d.disclosures[0].link, 'https://github.com/khaled');
      assert.ok(!d.disclosures.some((x) => x.name === 'بوت بوت بوت'));
    });
    await t('الزائر لا يقرأ الإفصاحات ولا يربط', async () => {
      assert.equal((await post('/admin/links', { disclosureId: 1, studentKey: 'x' })).status, 401);
      assert.equal((await post('/admin/links/reject', { disclosureId: 1, studentKey: 'x' })).status, 401);
    });
    await t('تأكيد التطابق يربط الملفين وينقل الملاحظات دون فقد', async () => {
      const d = await (await fetch(B + '/admin/data', { headers: { Cookie: c2 } })).json();
      const id = d.disclosures[0].id, key = d.nominations.find((n) => n.student === 'خالد سعد').student_key;
      await fetch(B + '/admin/reviews/' + encodeURIComponent('d:' + id), { method: 'PUT', headers: { ...H, Cookie: c2 }, body: JSON.stringify({ notes: 'ملاحظة على الإفصاح' }) });
      assert.equal((await post('/admin/links', { disclosureId: id, studentKey: key }, { Cookie: c2 })).status, 200);
      const d2 = await (await fetch(B + '/admin/data', { headers: { Cookie: c2 } })).json();
      assert.equal(d2.disclosures[0].linked_key, key);
      const rv = d2.reviews.find((r) => r.student_key === key);
      assert.match(rv.notes, /مقابلة الأحد/); assert.match(rv.notes, /ملاحظة على الإفصاح/);
      assert.ok(!d2.reviews.some((r) => r.student_key === 'd:' + id));
      assert.equal(d2.nominations.filter((n) => n.student_key === key).length, 2); // ترشيحات المعلمين كما هي
    });
    await t('رفض التطابق يُحفظ، وفك الربط يعيد الملفين منفصلين', async () => {
      const r = await disc({ name: 'سعود ناصر عبدالله الحربي', grade: 'ثالث ثانوي', section: '1', talents: [{ name: 'كرة القدم', level: 2 }] }, { 'X-Forwarded-For': '7.7.7.8' });
      assert.equal(r.status, 200);
      let d = await (await fetch(B + '/admin/data', { headers: { Cookie: c2 } })).json();
      const s = d.disclosures.find((x) => x.name.startsWith('سعود'));
      await post('/admin/links/reject', { disclosureId: s.id, studentKey: 'سعود ناصر|ثالث' }, { Cookie: c2 });
      d = await (await fetch(B + '/admin/data', { headers: { Cookie: c2 } })).json();
      assert.ok(d.rejections.includes(`${s.id}|سعود ناصر|ثالث`));
      const k = d.disclosures.find((x) => x.linked_key);
      await fetch(B + '/admin/links/' + k.id, { method: 'DELETE', headers: { ...H, Cookie: c2 } });
      d = await (await fetch(B + '/admin/data', { headers: { Cookie: c2 } })).json();
      assert.equal(d.disclosures.find((x) => x.id === k.id).linked_key, null);
      await post('/admin/links', { disclosureId: k.id, studentKey: d.nominations.find((n) => n.student === 'خالد سعد').student_key }, { Cookie: c2 });
    });
    await t('Excel فيه المصدر وورقة إفصاحات الطلاب', async () => {
      const r = await fetch(B + '/admin/export.xlsx', { headers: { Cookie: c2 } });
      assert.equal(r.status, 200);
      fs.writeFileSync(path.join(dir, 'out2.xlsx'), Buffer.from(await r.arrayBuffer()));
    });
    await t('حذف ملف طالب إفصاح ذاتي فقط', async () => {
      const d = await (await fetch(B + '/admin/data', { headers: { Cookie: c2 } })).json();
      const s = d.disclosures.find((x) => x.name.startsWith('سعود'));
      await fetch(B + '/admin/students/' + encodeURIComponent('d:' + s.id), { method: 'DELETE', headers: { ...H, Cookie: c2 } });
      const d2 = await (await fetch(B + '/admin/data', { headers: { Cookie: c2 } })).json();
      assert.ok(!d2.disclosures.some((x) => x.id === s.id));
      assert.equal(d2.disclosures.length, 1);
    });
    console.log(`\n${ok} اختبار نجح`);
    console.log('XLSX=' + path.join(dir, 'out2.xlsx'));
    server.close(); process.exit(0);
  } catch (e) { console.error('  ✗', e); server.close(); process.exit(1); }
});
