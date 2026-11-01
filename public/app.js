(function () {
  "use strict";
  const SITE = location.origin + "/";
  /* طبقة الاتصال بالخادم (نفس فكرة سوق الشاطبي) */
  async function api(method, path, body) {
    const opts = { method, credentials: "same-origin", headers: { "X-Hasr": "1" } };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch("/api" + path, opts); }
    catch (e) { throw Object.assign(new Error("تعذر الاتصال بالإنترنت. تأكد من الشبكة وحاول مرة ثانية، وبياناتك باقية في الصفحة."), { status: 0 }); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "حدث خطأ غير متوقع. حاول مرة ثانية."), { status: res.status });
    return data;
  }

  const TRAITS = [
    { t: "سريع الفهم", d: "يتعلم بسرعة ويفكر بعمق" },
    { t: "مبدع", d: "أفكاره وأعماله جديدة" },
    { t: "مثابر", d: "مهتم بمجاله ولا يمل" },
    { t: "قيادي", d: "يبادر ويؤثر في زملائه" }
  ];
  const TRACKS = [
    { id: "acad", areas: ["علوم", "رياضيات", "لغة عربية وأدب", "لغة إنجليزية", "تقنية وبرمجة"] },
    { id: "art", areas: ["خطابة وإلقاء", "خط عربي", "رسم وفنون"] },
    { id: "lead", areas: ["قيادة"] }
  ];
  const AREAS = TRACKS.flatMap((t) => t.areas);
  const GRADES = ["أول ثانوي", "ثاني ثانوي", "ثالث ثانوي"];
  const SECTIONS = ["1", "2"];
  const STATUSES = ["جديد", "قيد المراجعة", "يحتاج استكمال", "مرشح للمتابعة والرعاية"];
  const DRAFT_KEY = "hasr-draft-v4";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function say(id, text, kind) { const m = $(id); m.textContent = text || ""; m.className = "msg " + (kind || ""); }


  /* ===================== Teacher form ===================== */
  const blank = () => ({ name: "", grade: "", section: "", areas: [], traits: [], note: "" });
  let state = { tName: "", tSubject: "", students: [blank()] };
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); if (d && Array.isArray(d.students) && d.students.length) state = d; } catch (e) {}
  const persist = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch (e) {} };

  $("t-name").value = state.tName; $("t-subject").value = state.tSubject;
  $("t-name").addEventListener("input", (e) => { state.tName = e.target.value; changed(); });
  $("t-subject").addEventListener("input", (e) => { state.tSubject = e.target.value; changed(); });

  function renderStudents() {
    $("students").innerHTML = state.students.map((s, i) => `
      <div class="student" data-i="${i}">
        <div class="student-head"><strong>الطالب ${i + 1}</strong>${state.students.length > 1 ? `<button type="button" class="remove" data-act="remove">حذف</button>` : ""}</div>
        <div class="row2">
          <label class="fld" for="s${i}-name">اسم الطالب<input type="text" id="s${i}-name" data-f="name" maxlength="80" value="${esc(s.name)}" placeholder="الاسم الثلاثي"></label>
          <label class="fld" for="s${i}-grade">الصف<select id="s${i}-grade" data-f="grade"><option value="">اختر</option>${GRADES.map((g) => `<option${s.grade === g ? " selected" : ""}>${g}</option>`).join("")}</select></label>
          <label class="fld" for="s${i}-section">الفصل<select id="s${i}-section" data-f="section"><option value="">-</option>${SECTIONS.map((n) => `<option${(s.section || "") === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
        </div>
        <div>
          <div class="lbl">وش يميّزه؟ <small>اختر واحد أو أكثر</small></div>
          <div class="chips">${AREAS.map((a) => `<button type="button" class="chip" data-area="${a}" aria-pressed="${s.areas.includes(a)}">${a}</button>`).join("")}</div>
        </div>
        <div>
          <div class="lbl">وش تلاحظ عليه؟</div>
          <div class="traits">${TRAITS.map((t, k) => `<button type="button" class="trait" data-trait="${k}" aria-pressed="${s.traits.includes(k)}"><span class="box">✓</span><span>${t.t}<small>${t.d}</small></span></button>`).join("")}</div>
        </div>
        <label class="fld" for="s${i}-note">مثال أو إنجاز <small>(اختياري)</small><input type="text" id="s${i}-note" data-f="note" maxlength="300" value="${esc(s.note)}" placeholder="مثال: فاز بمسابقة الإلقاء، أو حل مسألة بطريقة جديدة"></label>
      </div>`).join("");
  }
  const onField = (e) => { const card = e.target.closest(".student"); const f = e.target.dataset.f; if (!card || !f) return; state.students[+card.dataset.i][f] = e.target.value; changed(); };
  $("students").addEventListener("input", onField);
  $("students").addEventListener("change", onField);
  $("students").addEventListener("click", (e) => {
    const card = e.target.closest(".student"); if (!card) return;
    const s = state.students[+card.dataset.i];
    const chip = e.target.closest("[data-area]"); const tr = e.target.closest("[data-trait]");
    if (chip) { const a = chip.dataset.area; s.areas = s.areas.includes(a) ? s.areas.filter((x) => x !== a) : [...s.areas, a]; chip.setAttribute("aria-pressed", s.areas.includes(a)); changed(); }
    else if (tr) { const k = +tr.dataset.trait; s.traits = s.traits.includes(k) ? s.traits.filter((x) => x !== k) : [...s.traits, k].sort(); tr.setAttribute("aria-pressed", s.traits.includes(k)); changed(); }
    else if (e.target.dataset.act === "remove") { state.students.splice(+card.dataset.i, 1); renderStudents(); changed(); }
  });
  $("add-student").addEventListener("click", () => {
    if (state.students.length >= 15) { say("form-msg", "الحد الأقصى 15 طالباً في الإرسال الواحد. أرسلهم ثم أضف البقية.", "err"); return; }
    state.students.push(blank()); renderStudents(); changed();
    const last = $("students").lastElementChild; if (last) { last.scrollIntoView({ behavior: "smooth", block: "start" }); last.querySelector("input")?.focus({ preventScroll: true }); }
  });

  const filled = () => state.students.filter((s) => s.name.trim().length >= 2);
  function problem() {
    if (state.tName.trim().length < 2) return "اكتب اسمك أولاً";
    if (!filled().length) return "اكتب اسم طالب واحد على الأقل";
    return "";
  }
  let sending = false;
  function changed(clearMsg = true) {
    persist();
    const n = filled().length; const p = problem();
    $("sum").textContent = p || `${n} ${n === 1 ? "طالب" : n === 2 ? "طالبان" : "طلاب"} جاهز للإرسال`;
    $("send").disabled = !!p || sending;
    if (!sending && clearMsg) say("form-msg", "");
  }

  function showThanks(n, dup) {
    const first = state.tName.trim().replace(/^(أ\.|أ\s|الأستاذ|أستاذ)\s*/, "").split(/\s+/)[0] || "";
    $("th-title").textContent = first ? `شكراً أ. ${first}` : "شكراً لك";
    $("th-count").textContent = n;
    $("th-line").textContent = n === 1 ? "طالب رشّحته اليوم" : n === 2 ? "طالبان رشّحتهما اليوم" : "طلاب رشّحتهم اليوم";
    $("th-extra").textContent = dup ? `(${dup} منهم كان مرشحاً منك سابقاً، فلم يتكرر)` : "";
    $("thanks").hidden = false;
  }

  $("send").addEventListener("click", async () => {
    const p = problem(); if (p) { say("form-msg", p, "err"); return; }
    sending = true; $("send").disabled = true; $("send").textContent = "جارٍ الإرسال…"; say("form-msg", "");
    const payload = filled().map((s) => ({ name: s.name.trim(), grade: s.grade, section: s.section || "", areas: s.areas, traits: s.traits.map((k) => TRAITS[k].t), note: s.note.trim() }));
    try {
      const data = await api("POST", "/nominations", { teacher: state.tName.trim(), subject: state.tSubject.trim(), students: payload, website: $("website").value });
      if (!data || data.ok !== true) throw new Error("ما انحفظ الإرسال. حاول مرة ثانية، وبياناتك باقية في الصفحة.");
      showThanks((data.added || 0) + (data.duplicates || 0), data.duplicates || 0);
      state.students = [blank()]; renderStudents();
    } catch (err) {
      say("form-msg", err.status === 429 || err.status === 400 || err.status === 0 ? err.message : "ما انحفظ الإرسال بسبب خطأ في الخادم. حاول مرة ثانية بعد قليل، وبياناتك باقية في الصفحة.", "err");
    } finally {
      sending = false; $("send").textContent = "إرسال الترشيحات"; changed(false);
    }
  });
  $("th-close").addEventListener("click", () => { $("thanks").hidden = true; });
  $("th-new").addEventListener("click", () => { $("thanks").hidden = true; window.scrollTo({ top: 0, behavior: "smooth" }); });

  renderStudents(); changed();

  /* Deadline (Umm al-Qura) */
  const DEADLINE = "2026-11-05";
  let deadlineText = "";
  try {
    const d = new Date(DEADLINE + "T23:59:00+03:00");
    const hij = (o) => new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", o).format(d);
    $("dl-month").textContent = hij({ month: "long" });
    $("dl-day").textContent = hij({ day: "numeric" });
    const days = Math.ceil((d - new Date()) / 86400000);
    deadlineText = `${hij({ weekday: "long" })} ${hij({ day: "numeric", month: "long" })}`;
    $("dl-text").innerHTML = days < 0
      ? `انتهى موعد الترشيح (${deadlineText})، ولا يزال بإمكانك الإرسال.`
      : `آخر موعد للترشيح: <b>${deadlineText}</b>${days === 0 ? " · اليوم" : days === 1 ? " · باقي يوم واحد" : days === 2 ? " · باقي يومان" : days <= 10 ? ` · باقي ${days} أيام` : ""}`;
  } catch (e) { $("deadline").hidden = true; }

  /* ===================== Views ===================== */
  function show(view) {
    $("view-form").hidden = view !== "form"; $("view-login").hidden = view !== "login"; $("view-board").hidden = view !== "board";
    $("bar").hidden = view !== "form";
    $("wrap").classList.toggle("wide", view === "board");
    $("tab-form").setAttribute("aria-selected", view === "form"); $("tab-board").setAttribute("aria-selected", view === "board");
    window.scrollTo({ top: 0 });
  }
  $("tab-form").addEventListener("click", () => show("form"));
  $("tab-board").addEventListener("click", () => show("board"));
  $("l-back").addEventListener("click", () => show("form"));

  /* ===================== Admin: auth ===================== */
  let isAdmin = false;
  $("open-board").addEventListener("click", () => {
    if (isAdmin) show("board"); else { show("login"); setTimeout(() => $("l-pass").focus(), 50); }
  });
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("l-btn").disabled = true; say("login-msg", "جارٍ التحقق…");
    try {
      await api("POST", "/admin/login", { password: $("l-pass").value });
      $("l-pass").value = ""; say("login-msg", ""); enterBoard();
    } catch (err) { say("login-msg", err.message, "err"); }
    finally { $("l-btn").disabled = false; }
  });
  function leaveBoard() { isAdmin = false; stopLive(); $("tabs").hidden = true; $("open-board").parentElement.hidden = false; show("form"); }
  $("logout").addEventListener("click", async () => { try { await api("POST", "/logout"); } catch (e) {} leaveBoard(); });

  /* ===================== Admin: data ===================== */
  let noms = [], reviews = {}, roster = [], stream = null, pollTimer = null;
  const norm = (s) => String(s || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[\u064B-\u0652\u0640]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const canon = (s) => norm(s).replace(/^(الاستاذ|استاذ|المعلم|ا\.)\s*/, "").trim();
  const prettyTeacher = (s) => String(s || "").replace(/^(أ\.|أ\s|الأستاذ|أستاذ)\s*/, "").trim();

  async function enterBoard() {
    isAdmin = true; $("tabs").hidden = false; $("open-board").parentElement.hidden = true;
    show("board"); await loadAll(); startLive();
  }
  async function loadAll() {
    try {
      const d = await api("GET", "/admin/data");
      noms = d.nominations || [];
      reviews = Object.fromEntries((d.reviews || []).map((x) => [x.student_key, x]));
      roster = Array.isArray(d.roster) ? d.roster : [];
      if (document.activeElement !== $("roster")) $("roster").value = roster.join("\n");
      if ($("board-msg").classList.contains("err")) say("board-msg", "");
      renderAll();
    } catch (e) {
      if (e.status === 401) { leaveBoard(); show("login"); say("login-msg", "انتهت الجلسة. ادخل مرة ثانية.", "err"); return; }
      say("board-msg", "تعذر تحميل البيانات. تحقق من الاتصال، وبنحاول مرة ثانية تلقائياً.", "err");
    }
  }
  let reloadT = null;
  const scheduleReload = () => { clearTimeout(reloadT); reloadT = setTimeout(loadAll, 250); };
  function setLive(on, text) { $("live").classList.toggle("on", on); $("live-text").textContent = text; }
  function startLive() {
    stopLive();
    if (window.EventSource) {
      stream = new EventSource("/api/admin/stream");
      stream.addEventListener("hello", () => setLive(true, "تحديث فوري"));
      stream.addEventListener("change", scheduleReload);
      stream.onerror = () => setLive(false, "إعادة الاتصال…");
      stream.onopen = () => { setLive(true, "تحديث فوري"); scheduleReload(); };
    }
    pollTimer = setInterval(loadAll, 30000); // شبكة أمان لو انقطع الاتصال المباشر
    document.addEventListener("visibilitychange", onVisible);
  }
  function onVisible() { if (document.visibilityState === "visible" && isAdmin) loadAll(); }
  function stopLive() {
    if (stream) { stream.close(); stream = null; }
    clearInterval(pollTimer); pollTimer = null; document.removeEventListener("visibilitychange", onVisible);
    setLive(false, "غير متصل");
  }

  /* Group nominations into unique students */
  function students() {
    const map = new Map();
    for (const n of noms) {
      let g = map.get(n.student_key);
      if (!g) { g = { key: n.student_key, name: n.student, grade: n.grade, section: n.section, areas: new Set(), traits: new Set(), noms: [], first: n.created_at }; map.set(n.student_key, g); }
      (n.areas || []).forEach((a) => g.areas.add(a)); (n.traits || []).forEach((t) => g.traits.add(t));
      if (!g.section && n.section) g.section = n.section;
      g.noms.push(n); if (n.created_at < g.first) g.first = n.created_at;
    }
    return [...map.values()].map((g) => ({ ...g, areas: [...g.areas], traits: [...g.traits], review: reviews[g.key] || { status: "جديد", notes: "" } }));
  }
  function pathsOf(g) {
    const has = (id) => g.areas.some((a) => TRACKS.find((t) => t.id === id).areas.includes(a));
    const first = String(g.grade || "").includes("أول") || String(g.grade || "").includes("اول");
    const out = [];
    if (has("acad")) out.push(first ? "ترشيح لمقياس موهبة" : "برنامج إثرائي / إبداع");
    if (has("art")) out.push("النشاط والمسابقات");
    if (has("lead")) out.push("برنامج قيادي");
    if (!out.length) out.push("تحدده اللجنة");
    return out;
  }
  const gradeBase = (g) => (String(g || "").match(/(أول|ثاني|ثالث)/) || [, "غير محدد"])[1];
  const tally = (items) => { const m = new Map(); items.forEach((k) => m.set(k, (m.get(k) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  function teacherCounts() {
    const m = new Map();
    for (const n of noms) { const k = n.teacher_key || canon(n.teacher); const x = m.get(k) || { name: n.teacher, n: 0 }; x.n++; m.set(k, x); }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }
  function sameTeacher(a, b) {
    const x = canon(a), y = canon(b); if (!x || !y) return false;
    if (x === y || x.includes(y) || y.includes(x)) return true;
    const tx = x.split(" "), ty = y.split(" ");
    return tx[0] === ty[0] && tx.length > 1 && ty.length > 1 && tx[tx.length - 1] === ty[ty.length - 1];
  }

  function renderAll() { renderStats(); renderInsights(); renderTable(); }
  function renderStats() {
    const st = students();
    $("s-students").textContent = st.length;
    $("s-noms").textContent = noms.length;
    $("s-teachers").textContent = teacherCounts().length;
    $("s-first").textContent = st.filter((g) => pathsOf(g).includes("ترشيح لمقياس موهبة")).length;
  }
  function renderInsights() {
    const st = students();
    const artSet = new Set(TRACKS.find((t) => t.id === "art").areas);
    const groups = [["حسب المجال", tally(st.flatMap((g) => g.areas))], ["حسب الصف", tally(st.map((g) => gradeBase(g.grade)))], ["المسار المقترح", tally(st.flatMap(pathsOf))], ["حالة المراجعة", tally(st.map((g) => g.review.status))]];
    $("bars").innerHTML = st.length ? groups.map(([title, rows]) => {
      const max = Math.max(1, ...rows.map((r) => r[1]));
      return `<div><h3>${title}</h3>${rows.map(([k, v]) => `<div class="barrow${artSet.has(k) || k === "النشاط والمسابقات" ? " art" : ""}"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%"></div></div><span>${v}</span></div>`).join("")}</div>`;
    }).join("") : `<p class="muted">يظهر الملخص بعد وصول أول ترشيح.</p>`;

    const tc = teacherCounts();
    if (roster.length) {
      const done = roster.filter((n) => tc.some((t) => sameTeacher(t.name, n)));
      const wait = roster.filter((n) => !done.includes(n));
      const pct = Math.round((done.length / roster.length) * 100);
      $("part-head").innerHTML = `<b style="color:var(--pine);font-size:18px">${pct}%</b> نسبة المشاركة · ${done.length} من ${roster.length} معلم`;
      $("part-bar-wrap").hidden = false; $("part-bar").style.width = pct + "%";
      $("people").innerHTML = `<div class="done"><h3>شاركوا (${done.length})</h3><ul>${done.map((n) => `<li>${esc(n)} · ${tc.find((t) => sameTeacher(t.name, n)).n}</li>`).join("") || '<li style="background:none;color:var(--ink-2)">لا أحد بعد</li>'}</ul></div><div class="wait"><h3>باقي (${wait.length})</h3><ul>${wait.map((n) => `<li>${esc(n)}</li>`).join("") || '<li style="background:none;color:var(--pine)">الكل شارك 🎉</li>'}</ul></div>`;
    } else {
      $("part-head").textContent = tc.length ? `${tc.length} معلم شارك حتى الآن. أدخل قائمة معلمي المدرسة لتعرف نسبة المشاركة ومن باقي.` : "أدخل أسماء معلمي المدرسة مرة وحدة، وتعرف مين شارك ومين باقي.";
      $("part-bar-wrap").hidden = true;
      $("people").innerHTML = tc.length ? `<div class="done"><h3>شاركوا (${tc.length})</h3><ul>${tc.map((t) => `<li>${esc(t.name)} · ${t.n}</li>`).join("")}</ul></div>` : "";
      $("roster-box").open = true;
    }
  }

  $("f-status").innerHTML += STATUSES.map((s) => `<option>${s}</option>`).join("");
  $("q").addEventListener("input", renderTable);
  $("f-status").addEventListener("change", renderTable);
  function renderTable() {
    const q = norm($("q").value); const fs = $("f-status").value;
    const order = (g) => STATUSES.indexOf(g.review.status);
    const st = students()
      .filter((g) => !fs || g.review.status === fs)
      .filter((g) => !q || norm(g.name).includes(q) || g.noms.some((n) => norm(n.teacher).includes(q)))
      .sort((a, b) => (b.noms.length - a.noms.length) || (b.traits.length - a.traits.length) || String(b.first).localeCompare(String(a.first)));
    if (!st.length) { $("rows").innerHTML = `<tr><td colspan="9" class="empty">${noms.length ? "لا توجد نتائج مطابقة." : "لا توجد ترشيحات بعد. أول ما يرسل معلم ترشيحه بيظهر هنا تلقائياً."}</td></tr>`; return; }
    $("rows").innerHTML = st.map((g) => {
      const si = STATUSES.indexOf(g.review.status);
      return `<tr data-key="${esc(g.key)}">
        <td><b>${esc(g.name)}</b>${g.noms.length > 1 ? `<br><span class="multi">مرشح من ${g.noms.length} معلمين</span>` : ""}</td>
        <td>${esc(g.grade || "-")}${g.section ? ` / ${esc(g.section)}` : ""}</td>
        <td>${g.areas.length ? g.areas.map((a) => `<span class="pill">${esc(a)}</span>`).join(" ") : "-"}</td>
        <td class="num"><b>${g.traits.length}</b>/4${g.traits.length ? `<br><small>${esc(g.traits.join("، "))}</small>` : ""}</td>
        <td>${pathsOf(g).map((p) => `<span class="path">${esc(p)}</span>`).join("<br>")}</td>
        <td><ul class="noms">${g.noms.map((n) => `<li>${esc(prettyTeacher(n.teacher))}${n.subject ? ` (${esc(n.subject)})` : ""}${n.note ? `: ${esc(n.note)}` : ""}</li>`).join("")}</ul></td>
        <td><select class="status s${si < 0 ? 0 : si}" data-act="status" aria-label="حالة ${esc(g.name)}">${STATUSES.map((s) => `<option${s === g.review.status ? " selected" : ""}>${s}</option>`).join("")}</select></td>
        <td><textarea class="notes" data-act="notes" maxlength="1000" rows="2" aria-label="ملاحظات ${esc(g.name)}" placeholder="أضف ملاحظة">${esc(g.review.notes || "")}</textarea></td>
        <td><button type="button" class="rowdel" data-act="delete">حذف</button></td>
      </tr>`;
    }).join("");
  }

  async function saveReview(key, patch) {
    const d = await api("PUT", "/admin/reviews/" + encodeURIComponent(key), patch);
    reviews[key] = d.review;
  }
  $("rows").addEventListener("change", async (e) => {
    const tr = e.target.closest("tr[data-key]"); if (!tr) return; const key = tr.dataset.key;
    try {
      if (e.target.dataset.act === "status") { await saveReview(key, { status: e.target.value }); say("board-msg", "تم تحديث الحالة.", "ok"); renderStats(); renderInsights(); e.target.className = "status s" + STATUSES.indexOf(e.target.value); }
      if (e.target.dataset.act === "notes") { await saveReview(key, { notes: e.target.value }); say("board-msg", "تم حفظ الملاحظة.", "ok"); }
    } catch (err) { say("board-msg", "ما انحفظ التعديل. تحقق من الاتصال وحاول مرة ثانية.", "err"); }
  });
  $("rows").addEventListener("click", async (e) => {
    if (e.target.dataset.act !== "delete") return;
    const btn = e.target; const key = btn.closest("tr").dataset.key;
    if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = "تأكيد الحذف"; setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = ""; btn.textContent = "حذف"; } }, 3000); return; }
    try {
      await api("DELETE", "/admin/students/" + encodeURIComponent(key));
      say("board-msg", "تم حذف الطالب وترشيحاته.", "ok"); scheduleReload();
    } catch (err) { say("board-msg", "تعذر الحذف.", "err"); }
  });

  $("save-roster").addEventListener("click", async () => {
    const names = $("roster").value.split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    try {
      const d = await api("PUT", "/admin/roster", { names }); roster = d.roster; renderInsights(); $("roster-box").open = false; say("part-msg", `حُفظت قائمة ${names.length} معلم.`, "ok");
    } catch (e) { say("part-msg", "تعذر حفظ القائمة.", "err"); }
  });

  function copyText(text, msgId, okText) {
    const ok = () => say(msgId, okText, "ok");
    const fallback = () => { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); ok(); } catch (e) { say(msgId, "تعذر النسخ.", "err"); } ta.remove(); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
  }
  $("copy-summary").addEventListener("click", () => {
    const st = students(); if (!st.length) { say("summary-msg", "ما فيه ترشيحات بعد.", "err"); return; }
    const tc = teacherCounts(); const line = (rows) => rows.map(([k, v]) => `${k} ${v}`).join("، ");
    const doneN = roster.filter((n) => tc.some((t) => sameTeacher(t.name, n))).length;
    const part = roster.length ? `${doneN} من ${roster.length} معلم (${Math.round(doneN / roster.length * 100)}%)` : `${tc.length} معلم`;
    copyText([
      "ملخص حصر الطلاب الموهوبين – ثانوية الإمام الشاطبي 1448هـ",
      `عدد الطلاب المرشحين: ${st.length} (من ${noms.length} ترشيح)`,
      `المعلمون المشاركون: ${part}`,
      `حسب المجال: ${line(tally(st.flatMap((g) => g.areas)))}`,
      `حسب الصف: ${line(tally(st.map((g) => gradeBase(g.grade))))}`,
      `المسار المقترح: ${line(tally(st.flatMap(pathsOf)))}`,
      `حالة المراجعة: ${line(tally(st.map((g) => g.review.status)))}`,
      "",
      "الخطوة القادمة: عرض القائمة على لجنة الموهوبين لاعتمادها، ثم ترشيح طلاب أول ثانوي لمقياس موهبة وتوزيع البقية على البرامج والمسابقات.",
      "معلم الموهوبين: عبدالرحيم حسن العمري"
    ].join("\n"), "summary-msg", "تم نسخ الملخص. الصقه في رسالة للمدير أو وكيل الشؤون التعليمية.");
  });
  $("copy-thanks").addEventListener("click", () => {
    const tc = teacherCounts(); if (!tc.length) { say("part-msg", "ما فيه مشاركين بعد.", "err"); return; }
    copyText(["شكر وتقدير 🌟", "يتقدم برنامج رعاية الموهوبين بثانوية الإمام الشاطبي بالشكر والتقدير للزملاء الذين شاركوا في حصر الطلاب الموهوبين:", ...tc.map((t) => `▫️ أ. ${prettyTeacher(t.name)} (${t.n} ${t.n === 1 ? "طالب" : t.n === 2 ? "طالبان" : "طلاب"})`), "", "شكراً لأنكم انتبهتم لطلابكم، فخلف كل موهوب معلّم."].join("\n"), "part-msg", "تم نسخ رسالة الشكر. انشرها في قروب المعلمين.");
  });
  $("copy-remind").addEventListener("click", () => {
    copyText(["زملائي الكرام، السلام عليكم ورحمة الله 🌿", `تذكير لطيف بالمشاركة في حصر الطلاب الموهوبين${deadlineText ? " قبل " + deadlineText : ""}.`, "الاستمارة تأخذ دقيقة من جوالك، وترشيحك يصلني مباشرة:", SITE, "", "شاكرين تعاونكم، فأنتم أول من يكتشف مواهب طلابنا."].join("\n"), "part-msg", "تم نسخ التذكير. أرسله في القروب أو للمتبقين.");
  });

  /* Excel export: the server builds a real .xlsx */
  $("xlsx").addEventListener("click", () => {
    if (!noms.length) { say("board-msg", "ما فيه ترشيحات للتصدير.", "err"); return; }
    const a = document.createElement("a"); a.href = "/api/admin/export.xlsx"; a.download = "حصر_الموهوبين_1448.xlsx";
    document.body.appendChild(a); a.click(); a.remove();
  });
  $("backup").addEventListener("click", () => {
    const a = document.createElement("a"); a.href = "/api/admin/backup"; document.body.appendChild(a); a.click(); a.remove();
  });

  /* Restore admin session on load */
  (async () => {
    try { const d = await api("GET", "/session"); if (d.admin) enterBoard(); } catch (e) {}
  })();
})();
