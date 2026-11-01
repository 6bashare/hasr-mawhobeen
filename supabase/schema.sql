-- =====================================================================
-- قاعدة بيانات استمارة حصر الطلاب الموهوبين – ثانوية الإمام الشاطبي
-- شغّل هذا الملف كاملاً مرة واحدة في: Supabase > SQL Editor > New query > Run
-- آمن لإعادة التشغيل (لا يحذف بيانات موجودة).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- 1) الجداول ----------

-- حسابات معلم الموهوبين المسموح لها بفتح اللوحة
create table if not exists public.admins (
  email text primary key
);

-- كل ترشيح يرسله معلم (يُحتفظ بجميع الترشيحات حتى لو تكرر الطالب)
create table if not exists public.nominations (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  teacher     text not null check (char_length(teacher) between 2 and 80),
  subject     text not null default '' check (char_length(subject) <= 60),
  student     text not null check (char_length(student) between 2 and 80),
  grade       text not null default '' check (char_length(grade) <= 30),
  section     text not null default '' check (char_length(section) <= 5),
  areas       text[] not null default '{}',
  traits      text[] not null default '{}',
  note        text not null default '' check (char_length(note) <= 300),
  teacher_key text not null,
  student_key text not null,
  constraint nominations_teacher_student_unique unique (teacher_key, student_key)
);
create index if not exists nominations_student_key_idx on public.nominations (student_key);

-- حالة كل طالب وملاحظات معلم الموهوبين (طالب واحد = سجل واحد مهما تعدد المرشحون)
create table if not exists public.student_reviews (
  student_key text primary key,
  status      text not null default 'جديد'
              check (status in ('جديد', 'قيد المراجعة', 'يحتاج استكمال', 'مرشح للمتابعة والرعاية')),
  notes       text not null default '' check (char_length(notes) <= 1000),
  updated_at  timestamptz not null default now()
);

-- إعدادات اللوحة (مثل قائمة معلمي المدرسة)
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- سجل الإرسال للحماية من الرسائل الآلية والإرسال المتكرر (لا يقرؤه أحد من المتصفح)
create table if not exists public.submission_log (
  id bigserial primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists submission_log_ip_at_idx on public.submission_log (ip, at);

-- ---------- 2) دوال مساعدة ----------

-- توحيد كتابة الأسماء العربية (أ/إ/آ، ى، ة، التشكيل، المسافات)
create or replace function public.norm_ar(t text)
returns text language sql immutable as $$
  select trim(regexp_replace(
           regexp_replace(
             translate(lower(coalesce(t, '')), 'أإآىة', 'ااايه'),
             '[ً-ْـ]', '', 'g'),
           '\s+', ' ', 'g'));
$$;

create or replace function public.teacher_key(t text)
returns text language sql immutable as $$
  select trim(regexp_replace(public.norm_ar(t), '^(الاستاذ|استاذ|المعلم|ا\.)\s*', ''));
$$;

-- الطالب نفسه = نفس الاسم بعد التوحيد + نفس الصف
create or replace function public.student_key(name text, grade text)
returns text language sql immutable as $$
  select public.norm_ar(name) || '|' || coalesce(substring(public.norm_ar(grade) from '(اول|ثاني|ثالث)'), '');
$$;

-- هل المستخدم الحالي معلم موهوبين مصرح له؟
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- 3) استقبال الترشيحات من المعلمين ----------
-- الطريق الوحيد للكتابة بدون تسجيل دخول. يتحقق من البيانات ويحد من التكرار والرسائل الآلية.
create or replace function public.submit_nominations(
  p_teacher  text,
  p_subject  text,
  p_students jsonb,
  p_hp       text default ''
)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_headers json;
  v_ip      text;
  v_recent  int;
  v_tkey    text;
  s         jsonb;
  v_rows    int;
  v_added   int := 0;
  v_dup     int := 0;
begin
  -- حقل مخفي لا يعبئه إلا البوت: نتجاهل الإرسال بصمت
  if coalesce(p_hp, '') <> '' then
    return json_build_object('ok', true, 'added', 0, 'duplicates', 0);
  end if;

  if p_teacher is null or char_length(trim(p_teacher)) < 2 then
    raise exception 'teacher_required';
  end if;
  if p_students is null or jsonb_typeof(p_students) <> 'array' or jsonb_array_length(p_students) = 0 then
    raise exception 'no_students';
  end if;
  if jsonb_array_length(p_students) > 15 then
    raise exception 'too_many';
  end if;

  begin
    v_headers := current_setting('request.headers', true)::json;
  exception when others then
    v_headers := null;
  end;
  v_ip := coalesce(nullif(trim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''), 'unknown');

  delete from submission_log where at < now() - interval '1 day';
  select count(*) into v_recent from submission_log
   where ip = v_ip and at > now() - interval '10 minutes';
  if v_recent >= 6 then
    raise exception 'rate_limited';
  end if;
  insert into submission_log (ip) values (v_ip);

  v_tkey := public.teacher_key(p_teacher);

  for s in select value from jsonb_array_elements(p_students) loop
    if char_length(trim(coalesce(s ->> 'name', ''))) < 2 then
      continue;
    end if;
    insert into nominations (teacher, subject, student, grade, section, areas, traits, note, teacher_key, student_key)
    values (
      left(trim(p_teacher), 80),
      left(trim(coalesce(p_subject, '')), 60),
      left(trim(s ->> 'name'), 80),
      left(coalesce(s ->> 'grade', ''), 30),
      left(coalesce(s ->> 'section', ''), 5),
      coalesce((select array_agg(left(x, 40)) from (
                 select jsonb_array_elements_text(case when jsonb_typeof(s -> 'areas') = 'array' then s -> 'areas' else '[]'::jsonb end) x
                 limit 12) a), '{}'),
      coalesce((select array_agg(left(x, 30)) from (
                 select jsonb_array_elements_text(case when jsonb_typeof(s -> 'traits') = 'array' then s -> 'traits' else '[]'::jsonb end) x
                 limit 6) t), '{}'),
      left(trim(coalesce(s ->> 'note', '')), 300),
      v_tkey,
      public.student_key(s ->> 'name', s ->> 'grade')
    )
    on conflict on constraint nominations_teacher_student_unique do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_added := v_added + 1; else v_dup := v_dup + 1; end if;
  end loop;

  return json_build_object('ok', true, 'added', v_added, 'duplicates', v_dup);
end;
$$;

-- ---------- 4) الصلاحيات (Row Level Security) ----------
alter table public.admins          enable row level security;
alter table public.nominations     enable row level security;
alter table public.student_reviews enable row level security;
alter table public.settings        enable row level security;
alter table public.submission_log  enable row level security;

-- لا شيء للزوار (anon) إطلاقاً: لا قراءة ولا كتابة مباشرة
revoke all on public.admins, public.nominations, public.student_reviews, public.settings, public.submission_log from anon;
revoke all on sequence public.submission_log_id_seq from anon, authenticated;
revoke all on public.submission_log from authenticated;

-- معلم الموهوبين (حساب مسجل دخول وموجود في admins) فقط
drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins
  for select to authenticated using (public.is_admin());

drop policy if exists nominations_admin on public.nominations;
create policy nominations_admin on public.nominations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists reviews_admin on public.student_reviews;
create policy reviews_admin on public.student_reviews
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- الدوال: الإرسال متاح للجميع، والباقي للمسجلين
revoke all on function public.submit_nominations(text, text, jsonb, text) from public;
grant execute on function public.submit_nominations(text, text, jsonb, text) to anon, authenticated;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------- 5) التحديث الفوري للوحة ----------
do $$
begin
  begin alter publication supabase_realtime add table public.nominations;     exception when others then null; end;
  begin alter publication supabase_realtime add table public.student_reviews; exception when others then null; end;
  begin alter publication supabase_realtime add table public.settings;        exception when others then null; end;
end $$;

-- ---------- 6) أضف بريدك هنا (نفس البريد الذي ستنشئ به حسابك في Authentication) ----------
-- insert into public.admins (email) values ('بريدك@example.com') on conflict do nothing;
