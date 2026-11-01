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
  const VIEWS = ["home", "form", "student", "login", "board"];
  function show(view, push = true) {
    VIEWS.forEach((v) => { $("view-" + v).hidden = v !== view; });
    $("bar").hidden = view !== "form";
    $("sbar").hidden = view !== "student";
    $("wrap").classList.toggle("wide", view === "board");
    $("tab-form").setAttribute("aria-selected", view !== "board"); $("tab-board").setAttribute("aria-selected", view === "board");
    if (push && view !== "login") { const u = { home: "/", form: "/teacher", student: "/student", board: "/admin" }[view]; if (location.pathname + location.hash !== u) history.replaceState(null, "", u); }
    window.scrollTo({ top: 0 });
  }
  $("go-teacher").addEventListener("click", () => show("form"));
  $("go-student").addEventListener("click", () => { show("student"); renderStep(); });
  document.querySelectorAll("[data-home]").forEach((b) => b.addEventListener("click", () => show("home")));
  $("tab-form").addEventListener("click", () => show("home"));
  $("tab-board").addEventListener("click", () => show("board"));
  $("l-back").addEventListener("click", () => show("home"));
  function routeFromHash() {
    const h = location.hash, p = location.pathname.replace(/\/$/, "");
    if (h === "#teacher" || p === "/teacher") show("form", h === "#teacher");
    else if (h === "#student" || p === "/student") { show("student", h === "#student"); renderStep(); }
    else if (h === "#board" || p === "/admin") { show("login", false); }
    else show("home", false);
  }
  window.addEventListener("hashchange", routeFromHash);

  /* ===================== Student: موهبتي تستحق الاكتشاف ===================== */
  const TT = window.HASR_TALENTS;
  const SD_KEY = "hasr-student-draft-v1";
  const sBlank = () => ({ step: 1, name: "", grade: "", section: "", talents: [], distinct: "", achievement: "", link: "", consent: false });
  let sd = sBlank();
  try { const d = JSON.parse(localStorage.getItem(SD_KEY) || "null"); if (d && Array.isArray(d.talents)) sd = { ...sBlank(), ...d }; } catch (e) {}
  const sPersist = () => { try { localStorage.setItem(SD_KEY, JSON.stringify(sd)); } catch (e) {} };
  const groupOf = (t) => TT.TALENT_GROUPS.find((g) => g.id === TT.TALENT_GROUP[t]);

  $("sd-name").value = sd.name; $("sd-distinct").value = sd.distinct; $("sd-ach").value = sd.achievement; $("sd-link").value = sd.link; $("sd-consent").checked = sd.consent;
  const segInit = (id, field) => {
    const box = $(id);
    const paint = () => box.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === sd[field]));
    box.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; sd[field] = b.dataset.v; paint(); sPersist(); say("sd-msg", ""); });
    paint();
  };
  segInit("sd-grade", "grade"); segInit("sd-section", "section");
  [["sd-name", "name"], ["sd-distinct", "distinct"], ["sd-ach", "achievement"], ["sd-link", "link"]].forEach(([id, f]) => $(id).addEventListener("input", (e) => { sd[f] = e.target.value; sPersist(); if (f === "distinct") $("sd-chars").textContent = `${e.target.value.length} / 400`; }));
  $("sd-consent").addEventListener("change", (e) => { sd.consent = e.target.checked; sPersist(); });
  $("sd-examples").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const ta = $("sd-distinct"); ta.value = (ta.value ? ta.value.trim() + " " : "") + b.textContent.replace("…", " "); ta.focus(); ta.dispatchEvent(new Event("input"));
  });

  function renderTalents() {
    $("sd-count").textContent = `${sd.talents.length} من 3`;
    $("sd-chosen").innerHTML = sd.talents.length ? sd.talents.map((t, i) => `
      <div class="ch" data-i="${i}">
        <div class="ch-top"><span>${groupOf(t.name).icon} ${esc(t.name)}</span><button type="button" data-act="rm">إزالة</button></div>
        <div class="lv" role="group" aria-label="مستواك في ${esc(t.name)}">${TT.LEVELS.map((l) => `<button type="button" data-lv="${l.id}" aria-pressed="${t.level === l.id}">${l.icon} ${l.label}</button>`).join("")}</div>
      </div>`).join("") : `<div class="chosen-empty">ما اخترت أي موهبة بعد. افتح مجموعة واضغط على موهبتك 👇</div>`;
    const full = sd.talents.length >= 3;
    const openIds = [...document.querySelectorAll("#sd-groups details[open]")].map((d) => d.dataset.g);
    $("sd-groups").innerHTML = TT.TALENT_GROUPS.map((g) => {
      const n = sd.talents.filter((t) => TT.TALENT_GROUP[t.name] === g.id).length;
      return `<details class="grp" data-g="${g.id}"${openIds.includes(g.id) ? " open" : ""}><summary><span class="gi">${g.icon}</span>${g.name}<span class="n${n ? " has" : ""}">${n ? `✓ ${n} مختارة` : `${g.items.length} مواهب`}</span></summary>
        <div class="chips">${g.items.map((t) => { const on = sd.talents.some((x) => x.name === t); return `<button type="button" class="chip" data-t="${esc(t)}" aria-pressed="${on}"${!on && full ? " disabled" : ""}>${esc(t)}</button>`; }).join("")}</div></details>`;
    }).join("");
  }
  $("sd-groups").addEventListener("click", (e) => {
    const c = e.target.closest("[data-t]"); if (!c) return;
    const t = c.dataset.t; const i = sd.talents.findIndex((x) => x.name === t);
    if (i >= 0) sd.talents.splice(i, 1);
    else if (sd.talents.length < 3) sd.talents.push({ name: t, level: 0 });
    sPersist(); renderTalents(); say("sd-msg", sd.talents.length >= 3 ? "اخترت 3 مواهب، الحد الأقصى. حدد مستواك في كل وحدة فوق 👆" : "");
  });
  $("sd-chosen").addEventListener("click", (e) => {
    const ch = e.target.closest(".ch"); if (!ch) return; const t = sd.talents[+ch.dataset.i];
    if (e.target.closest("[data-act=rm]")) sd.talents.splice(+ch.dataset.i, 1);
    const lv = e.target.closest("[data-lv]"); if (lv) t.level = +lv.dataset.lv;
    sPersist(); renderTalents(); say("sd-msg", "");
  });

  function stepProblem(n) {
    if (n === 1) {
      const name = sd.name.replace(/\s+/g, " ").trim();
      if (name.split(" ").length < 3 || name.length < 6) return "اكتب اسمك الرباعي (ثلاثة أسماء على الأقل)";
      if (!sd.grade) return "اختر صفك الدراسي";
      if (!sd.section) return "اختر فصلك";
    }
    if (n === 2) {
      if (!sd.talents.length) return "اختر موهبة واحدة على الأقل";
      const miss = sd.talents.find((t) => !t.level); if (miss) return `حدد مستواك في «${miss.name}»`;
    }
    if (n === 3) {
      if (sd.distinct.trim().length < 10) return "اكتب جملة عن الشيء اللي يميزك (10 أحرف على الأقل)";
      if (!sd.consent) return "أكّد صحة المعلومات قبل الإرسال";
    }
    return "";
  }
  function renderStep() {
    [1, 2, 3].forEach((n) => { $("sp" + n).hidden = sd.step !== n; });
    document.querySelectorAll(".steps .st").forEach((el) => el.classList.toggle("on", +el.dataset.s <= sd.step));
    $("sd-prev").hidden = sd.step === 1;
    $("sd-next").textContent = sd.step === 3 ? "إرسال مشاركتي 🚀" : "التالي ←";
    $("sd-sum").textContent = `الخطوة ${sd.step} من 3`;
    $("sd-chars").textContent = `${sd.distinct.length} / 400`;
    if (sd.step === 2) renderTalents();
  }
  $("sd-prev").addEventListener("click", () => { sd.step = Math.max(1, sd.step - 1); sPersist(); say("sd-msg", ""); renderStep(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  let sSending = false;
  $("sd-next").addEventListener("click", async () => {
    const p = stepProblem(sd.step); if (p) { say("sd-msg", p, "err"); return; }
    say("sd-msg", "");
    if (sd.step < 3) { sd.step++; sPersist(); renderStep(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (sSending) return;
    sSending = true; $("sd-next").disabled = true; $("sd-next").textContent = "جارٍ الإرسال…";
    try {
      const data = await api("POST", "/disclosures", { name: sd.name.trim(), grade: sd.grade, section: sd.section, talents: sd.talents.map((t) => ({ name: t.name, level: t.level })),
        distinct: sd.distinct.trim(), achievement: sd.achievement.trim(), link: sd.link.trim(), consent: sd.consent, website: $("sd-website").value });
      if (!data || data.ok !== true) throw new Error("ما انحفظت المشاركة. حاول مرة ثانية.");
      $("s-done").hidden = false;
      sd = sBlank(); try { localStorage.removeItem(SD_KEY); } catch (e) {}
      ["sd-name", "sd-distinct", "sd-ach", "sd-link"].forEach((id) => { $(id).value = ""; }); $("sd-consent").checked = false;
      document.querySelectorAll("#sd-grade button, #sd-section button").forEach((b) => b.setAttribute("aria-pressed", "false"));
      renderStep();
    } catch (err) {
      say("sd-msg", err.status === 0 || err.status === 400 || err.status === 409 || err.status === 429 ? err.message : "ما انحفظت مشاركتك بسبب خطأ في الخادم. حاول مرة ثانية بعد قليل، وبياناتك باقية في الصفحة.", "err");
    } finally { sSending = false; $("sd-next").disabled = false; if (sd.step === 3) $("sd-next").textContent = "إرسال مشاركتي 🚀"; }
  });
  $("sd-close").addEventListener("click", () => { $("s-done").hidden = true; show("home"); });

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
  function leaveBoard() { isAdmin = false; stopLive(); $("tabs").hidden = true; $("open-board").parentElement.hidden = false; show("home"); }
  $("logout").addEventListener("click", async () => { try { await api("POST", "/logout"); } catch (e) {} leaveBoard(); });

  /* ===================== Admin: data ===================== */
  let noms = [], reviews = {}, roster = [], discs = [], rejections = new Set(), stream = null, pollTimer = null;
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
      discs = d.disclosures || []; rejections = new Set(d.rejections || []);
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

  /* ملف موحد لكل طالب: ترشيحات المعلمين + إفصاحه الذاتي (يُربط فقط بعد تأكيد المشرف) */
  const GROUP_BY_ID = Object.fromEntries(TT.TALENT_GROUPS.map((g) => [g.id, g]));
  const LEVEL_BY_ID = Object.fromEntries(TT.LEVELS.map((l) => [l.id, l]));
  const SOURCE = { teacher: { cls: "teacher", label: "🟢 توصية معلم" }, self: { cls: "self", label: "🟡 إفصاح ذاتي" }, both: { cls: "both", label: "⭐ إفصاح ذاتي + توصية معلم" } };
  function students() {
    const map = new Map();
    for (const n of noms) {
      let g = map.get(n.student_key);
      if (!g) { g = { key: n.student_key, name: n.student, grade: n.grade, section: n.section, areas: new Set(), traits: new Set(), noms: [], discs: [], first: n.created_at }; map.set(n.student_key, g); }
      (n.areas || []).forEach((a) => g.areas.add(a)); (n.traits || []).forEach((t) => g.traits.add(t));
      if (!g.section && n.section) g.section = n.section;
      g.noms.push(n); if (n.created_at < g.first) g.first = n.created_at;
    }
    for (const s of discs) {
      let g = s.linked_key && map.get(s.linked_key);
      if (!g) { g = { key: "d:" + s.id, name: s.name, grade: s.grade, section: s.section, areas: new Set(), traits: new Set(), noms: [], discs: [], first: s.created_at }; map.set(g.key, g); }
      else if (s.name.split(" ").length > g.name.split(" ").length) { g.teacherName = g.name; g.name = s.name; }
      if (!g.section && s.section) g.section = s.section;
      g.discs.push(s); if (s.created_at < g.first) g.first = s.created_at;
    }
    return [...map.values()].map((g) => {
      const groups = new Set([...g.areas].map((a) => TT.TEACHER_AREA_GROUP[a]).filter(Boolean));
      const talents = g.discs.flatMap((s) => s.talents);
      talents.forEach((t) => groups.add(t.group));
      const source = g.noms.length && g.discs.length ? "both" : g.noms.length ? "teacher" : "self";
      return { ...g, areas: [...g.areas], traits: [...g.traits], groups: [...groups], talents, source, review: reviews[g.key] || { status: "جديد", notes: "" } };
    });
  }
  function pathsOf(g) {
    const tracks = new Set(g.groups.map((id) => GROUP_BY_ID[id] && GROUP_BY_ID[id].track));
    const first = /أول|اول/.test(String(g.grade || ""));
    const out = [];
    if (tracks.has("acad")) out.push(first ? "ترشيح لمقياس موهبة" : "برنامج إثرائي / إبداع");
    if (tracks.has("art")) out.push("النشاط والمسابقات");
    if (tracks.has("sport")) out.push("النشاط الرياضي");
    if (tracks.has("lead")) out.push("برنامج قيادي");
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

  /* تطابقات محتملة: إفصاح غير مربوط × طالب من ترشيحات المعلمين، بنفس الصف وتشابه الاسم */
  function nameLike(a, b) {
    const x = norm(a).split(" "), y = norm(b).split(" ");
    const [s, l] = x.length <= y.length ? [x, y] : [y, x];
    if (s.join(" ") === l.join(" ")) return true;
    if (s.length >= 2 && s.every((w, i) => w === l[i])) return true; // ثلاثي ضمن رباعي
    return s.length >= 2 && s[0] === l[0] && s[s.length - 1] === l[l.length - 1]; // الاسم الأول + العائلة
  }
  function candidates() {
    const teacherStudents = students().filter((g) => g.noms.length);
    const out = [];
    for (const d of discs) {
      if (d.linked_key) continue;
      for (const g of teacherStudents) {
        if (gradeBase(g.grade) !== gradeBase(d.grade)) continue;
        if (rejections.has(`${d.id}|${g.key}`)) continue;
        if (nameLike(d.name, g.noms[0].student)) out.push({ d, g });
      }
    }
    return out;
  }
  function renderMatches() {
    const list = candidates();
    $("matches").hidden = !list.length;
    $("match-list").innerHTML = list.map(({ d, g }) => `
      <div class="match" data-d="${d.id}" data-k="${esc(g.key)}">
        <span class="who">هل <b>${esc(d.name)}</b> <span class="src self">🟡 إفصاح ذاتي</span> هو نفسه <b>${esc(g.noms[0].student)}</b> <span class="src teacher">🟢 توصية ${g.noms.length > 1 ? g.noms.length + " معلمين" : "معلم"}</span>؟ <small class="muted">(${esc(d.grade)}${d.section ? " / " + esc(d.section) : ""} · ${esc(g.grade || "-")}${g.section ? " / " + esc(g.section) : ""})</small></span>
        <span class="actions"><button type="button" class="btn primary small" data-act="link">نعم، نفس الطالب</button><button type="button" class="btn ghost small" data-act="nolink">لا، طالبان مختلفان</button></span>
      </div>`).join("");
  }
  $("match-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return; const m = b.closest(".match");
    const body = { disclosureId: +m.dataset.d, studentKey: m.dataset.k };
    try {
      await api("POST", b.dataset.act === "link" ? "/admin/links" : "/admin/links/reject", body);
      say("board-msg", b.dataset.act === "link" ? "تم ربط الإفصاح بترشيحات المعلم في ملف واحد ⭐" : "تم. لن يظهر هذا الاقتراح مرة ثانية.", "ok");
      scheduleReload();
    } catch (err) { say("board-msg", err.message, "err"); }
  });

  function renderAll() { renderStats(); renderMatches(); renderInsights(); renderFilters(); renderTable(); }
  function renderStats() {
    const st = students();
    const c = { teacher: 0, self: 0, both: 0 }; st.forEach((g) => c[g.source]++);
    $("s-students").textContent = st.length;
    $("s-tany").textContent = c.teacher + c.both;
    $("s-sany").textContent = c.self + c.both;
    $("s-both").textContent = c.both;
    $("s-extra").textContent = `ترشيحات وصلت ${noms.length} · معلمون شاركوا ${teacherCounts().length} · مرشحون لمقياس موهبة ${st.filter((g) => pathsOf(g).includes("ترشيح لمقياس موهبة")).length}`;
    $("vt-disc-n").textContent = `(${discs.length})`;
  }
  function renderInsights() {
    const st = students();
    const groupName = (id) => (GROUP_BY_ID[id] || {}).name || id;
    const groups = [["حسب مصدر المشاركة", tally(st.map((g) => SOURCE[g.source].label))], ["حسب مجموعة الموهبة", tally(st.flatMap((g) => g.groups.map(groupName)))], ["حسب الصف", tally(st.map((g) => gradeBase(g.grade)))], ["المسار المقترح", tally(st.flatMap(pathsOf))], ["حالة المراجعة", tally(st.map((g) => g.review.status))]];
    $("bars").innerHTML = st.length ? groups.map(([title, rows]) => {
      const max = Math.max(1, ...rows.map((r) => r[1]));
      return `<div><h3>${title}</h3>${rows.map(([k, v]) => `<div class="barrow${/إفصاح|النشاط|الفنون|الإعلام|الإلقاء/.test(k) ? " art" : ""}"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%"></div></div><span>${v}</span></div>`).join("")}</div>`;
    }).join("") : `<p class="muted">يظهر الملخص بعد وصول أول مشاركة.</p>`;

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

  /* الفلاتر: المصدر + المجموعة/الموهبة + الحالة + البحث، وعرضان: كل الطلاب / إفصاحات الطلاب */
  let fSource = "", view2 = "all";
  $("f-status").innerHTML += STATUSES.map((s) => `<option>${s}</option>`).join("");
  $("f-group").innerHTML += TT.TALENT_GROUPS.map((g) => `<optgroup label="${g.icon} ${g.name}"><option value="g:${g.id}">كل ${g.name}</option>${g.items.map((t) => `<option value="t:${esc(t)}">${esc(t)}</option>`).join("")}</optgroup>`).join("");
  function renderFilters() {
    const st = students(); const c = { teacher: 0, self: 0, both: 0 }; st.forEach((g) => c[g.source]++);
    const opts = [["", `الكل (${st.length})`], ["teacher", `🟢 توصية معلم (${c.teacher})`], ["self", `🟡 إفصاح ذاتي (${c.self})`], ["both", `⭐ الاثنين (${c.both})`]];
    $("f-source").innerHTML = opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${fSource === v}">${l}</button>`).join("");
    document.querySelectorAll(".stat.click").forEach((b) => b.setAttribute("aria-pressed", b.dataset.src === fSource));
  }
  $("f-source").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; fSource = b.dataset.v; renderFilters(); renderTable(); });
  document.querySelectorAll(".stat.click").forEach((b) => b.addEventListener("click", () => { fSource = fSource === b.dataset.src ? "" : b.dataset.src; renderFilters(); renderTable(); $("thead").scrollIntoView({ behavior: "smooth", block: "center" }); }));
  $("vt-all").addEventListener("click", () => { view2 = "all"; $("vt-all").setAttribute("aria-selected", "true"); $("vt-disc").setAttribute("aria-selected", "false"); renderTable(); });
  $("vt-disc").addEventListener("click", () => { view2 = "disc"; $("vt-disc").setAttribute("aria-selected", "true"); $("vt-all").setAttribute("aria-selected", "false"); renderTable(); });
  $("q").addEventListener("input", renderTable);
  $("f-status").addEventListener("change", renderTable);
  $("f-group").addEventListener("change", renderTable);

  const srcBadge = (g) => `<span class="src ${SOURCE[g.source].cls}">${SOURCE[g.source].label}</span>`;
  const talentHtml = (t) => `<span class="talent">${(GROUP_BY_ID[t.group] || {}).icon || ""} ${esc(t.name)} ${LEVEL_BY_ID[t.level] ? LEVEL_BY_ID[t.level].icon : ""}</span>`;
  const linkHtml = (u) => { if (!u) return ""; let host = u; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (e) {} return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(host)}</a>`; };
  const statusCell = (g) => { const si = STATUSES.indexOf(g.review.status); return `<td><select class="status s${si < 0 ? 0 : si}" data-act="status" aria-label="حالة ${esc(g.name)}">${STATUSES.map((s) => `<option${s === g.review.status ? " selected" : ""}>${s}</option>`).join("")}</select></td>`; };
  const notesCell = (g) => `<td><textarea class="notes" data-act="notes" maxlength="1000" rows="2" aria-label="ملاحظات ${esc(g.name)}" placeholder="أضف ملاحظة">${esc(g.review.notes || "")}</textarea></td>`;
  const nameCell = (g) => `<td><b>${esc(g.name)}</b>${g.teacherName ? `<br><small class="muted">باسم المعلم: ${esc(g.teacherName)}</small>` : ""}<br>${srcBadge(g)}${g.noms.length > 1 ? ` <span class="multi">${g.noms.length} معلمين</span>` : ""}${g.discs.some((d) => d.linked_key) ? `<br><button type="button" class="linkbtn" data-act="unlink" data-d="${g.discs.find((d) => d.linked_key).id}" style="font-size:12px">فك الربط</button>` : ""}</td>`;
  function renderTable() {
    const q = norm($("q").value); const fs = $("f-status").value; const fg = $("f-group").value;
    let st = students();
    if (view2 === "disc") st = st.filter((g) => g.discs.length);
    st = st
      .filter((g) => !fSource || (fSource === "teacherAny" ? g.source !== "self" : fSource === "selfAny" ? g.source !== "teacher" : g.source === fSource))
      .filter((g) => !fs || g.review.status === fs)
      .filter((g) => !fg || (fg.startsWith("g:") ? g.groups.includes(fg.slice(2)) : g.talents.some((t) => t.name === fg.slice(2))))
      .filter((g) => !q || q.split(" ").every((w) => norm(`${g.name} ${g.teacherName || ""} ${g.grade} ${g.section} فصل${g.section} ${g.noms.map((n) => n.teacher).join(" ")}`).includes(w)))
      .sort((a, b) => ({ both: 0, self: 1, teacher: 2 }[a.source] - { both: 0, self: 1, teacher: 2 }[b.source]) || (b.noms.length - a.noms.length) || String(b.first).localeCompare(String(a.first)));
    const cols = view2 === "disc"
      ? ["الطالب", "الصف", "المواهب ومستواها", "وش يميزه", "الإنجاز", "الشاهد", "الحالة", "ملاحظاتك", ""]
      : ["الطالب", "الصف", "المواهب والمجالات", "المسار المقترح", "التوصيات والإفصاح", "الحالة", "ملاحظاتك", ""];
    $("thead").innerHTML = `<tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>`;
    if (!st.length) { $("rows").innerHTML = `<tr><td colspan="${cols.length}" class="empty">${noms.length || discs.length ? "لا توجد نتائج مطابقة." : "لا توجد مشاركات بعد. أول ما يرسل معلم ترشيحه أو طالب إفصاحه بيظهر هنا تلقائياً."}</td></tr>`; return; }
    const grade = (g) => `<td>${esc(g.grade || "-")}${g.section ? ` / ${esc(g.section)}` : ""}</td>`;
    const del = `<td><button type="button" class="rowdel" data-act="delete">حذف</button></td>`;
    $("rows").innerHTML = st.map((g) => view2 === "disc" ? `<tr data-key="${esc(g.key)}">
        ${nameCell(g)}${grade(g)}
        <td>${g.talents.map(talentHtml).join("<br>")}</td>
        <td style="min-width:200px">${g.discs.map((d) => esc(d.distinct)).join("<hr>")}</td>
        <td style="min-width:140px">${g.discs.map((d) => esc(d.achievement)).filter(Boolean).join("<hr>") || '<span class="muted">-</span>'}</td>
        <td>${g.discs.map((d) => linkHtml(d.link)).filter(Boolean).join("<br>") || '<span class="muted">-</span>'}</td>
        ${statusCell(g)}${notesCell(g)}${del}</tr>` : `<tr data-key="${esc(g.key)}">
        ${nameCell(g)}${grade(g)}
        <td>${g.areas.map((a) => `<span class="pill">${esc(a)}</span>`).join(" ")}${g.areas.length && g.talents.length ? "<br>" : ""}${g.talents.map(talentHtml).join(" ")}${!g.areas.length && !g.talents.length ? "-" : ""}</td>
        <td>${pathsOf(g).map((p) => `<span class="path">${esc(p)}</span>`).join("<br>")}</td>
        <td style="min-width:220px">${g.noms.length ? `<ul class="noms">${g.noms.map((n) => `<li>${esc(prettyTeacher(n.teacher))}${n.subject ? ` (${esc(n.subject)})` : ""}${n.note ? `: ${esc(n.note)}` : ""}</li>`).join("")}</ul>` : ""}${g.discs.map((d) => `<div class="disc"><b>يقول الطالب:</b> ${esc(d.distinct)}${d.achievement ? `<br><b>إنجاز:</b> ${esc(d.achievement)}` : ""}${d.link ? `<br>${linkHtml(d.link)}` : ""}</div>`).join("")}</td>
        ${statusCell(g)}${notesCell(g)}${del}</tr>`).join("");
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
    if (e.target.dataset.act === "unlink") {
      try { await api("DELETE", "/admin/links/" + e.target.dataset.d); say("board-msg", "تم فك الربط، وعاد الملفان منفصلين.", "ok"); scheduleReload(); } catch (err) { say("board-msg", err.message, "err"); }
      return;
    }
    if (e.target.dataset.act !== "delete") return;
    const btn = e.target; const key = btn.closest("tr").dataset.key;
    if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = "تأكيد الحذف"; setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = ""; btn.textContent = "حذف"; } }, 3000); return; }
    try {
      await api("DELETE", "/admin/students/" + encodeURIComponent(key));
      say("board-msg", "تم حذف الطالب ومشاركاته.", "ok"); scheduleReload();
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
    const st = students(); if (!st.length) { say("summary-msg", "ما فيه مشاركات بعد.", "err"); return; }
    const tc = teacherCounts(); const line = (rows) => rows.map(([k, v]) => `${k} ${v}`).join("، ");
    const doneN = roster.filter((n) => tc.some((t) => sameTeacher(t.name, n))).length;
    const part = roster.length ? `${doneN} من ${roster.length} معلم (${Math.round(doneN / roster.length * 100)}%)` : `${tc.length} معلم`;
    copyText([
      "ملخص حصر الطلاب الموهوبين – ثانوية الإمام الشاطبي 1448هـ",
      `إجمالي الطلاب: ${st.length} (ترشيحات المعلمين ${noms.length}، إفصاحات الطلاب ${discs.length})`,
      `حسب المصدر: ${line(tally(st.map((g) => SOURCE[g.source].label)))}`,
      `المعلمون المشاركون: ${part}`,
      `حسب مجموعة الموهبة: ${line(tally(st.flatMap((g) => g.groups.map((id) => (GROUP_BY_ID[id] || {}).name || id))))}`,
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
    routeFromHash();
    try { const d = await api("GET", "/session"); if (d.admin && (location.hash === "#board" || location.pathname.startsWith("/admin"))) enterBoard(); else if (d.admin) { isAdmin = true; $("tabs").hidden = false; $("open-board").parentElement.hidden = true; await loadAll(); startLive(); } } catch (e) {}
  })();
})();
