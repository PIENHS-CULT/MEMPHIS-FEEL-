-- =====================================================================
-- PIENHS CULT OS / AI Studio MVP — harness v2 dla ai_studio_jobs_v1
-- Tylko jednorazowa instancja PostgreSQL 16/17 (lokalnie lub CI).
-- Start: run_db_tests.sh (świeża baza + reset ról testowych).
-- Wymaga w katalogu: ai_studio_jobs_v1.sql, ai_studio_jobs_v1.rollback.sql.
-- NIE URUCHAMIAĆ NA PRODUKCJI.
--
-- Model ról = Supabase (stan produkcji 2026-10-16):
--   app_owner     odpowiednik roli postgres: NOSUPERUSER, BYPASSRLS, właściciel
--                 obiektów; wykonuje migrację i rollback (jak apply_migration)
--   authenticator LOGIN NOINHERIT -> SET ROLE anon | authenticated | service_role
--                 (jak PostgREST: klient, Edge Functions z kluczem service role)
-- Izolacja stanu: każdy scenariusz ma własnego użytkownika i projekt (A–G).
-- Czas: strefa UTC; progi czasowe testowane jawnymi znacznikami (np. -11/-9 min).
--   Jedyna zależność od zegara: limit miesięczny jest SKIP w pierwszych 61 min
--   miesiąca (UTC), bo okna godzinowego i miesięcznego nie da się wtedy rozdzielić.
-- Wynik: błąd psql (exit 3), gdy jest choć jeden FAIL lub liczba testów != oczekiwana.
-- =====================================================================
\set ON_ERROR_STOP on
\pset footer off
\pset tuples_only on
\pset format unaligned

-- 0. ROLE, BAZA, AUTH (superuser) -------------------------------------------
set timezone to 'UTC';
create role app_owner login nosuperuser bypassrls;
create role anon nologin inherit;
create role authenticated nologin inherit;
create role service_role nologin inherit bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role, authenticator to app_owner;
alter database :"DBNAME" owner to app_owner;
alter database :"DBNAME" set timezone to 'UTC';

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to app_owner, anon, authenticated, service_role;
grant select, references on table auth.users to app_owner;
grant execute on function auth.uid() to app_owner, anon, authenticated, service_role;

-- 0a. NARZĘDZIA TESTOWE (superuser) -------------------------------------------
create schema tests;
create table tests.results (
  n serial primary key,
  name text not null unique,
  status text not null check (status in ('PASS', 'FAIL', 'SKIP')),
  detail text
);
create table tests.ids (name text primary key, id uuid not null);
create table tests.snapshots (name text primary key, state text not null);
create table tests.notes (name text primary key, val text not null);

create function tests.record(p_name text, p_status text, p_detail text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into tests.results (name, status, detail) values (p_name, p_status, p_detail);
  raise notice '% %', p_status, p_name;
end;
$$;
create function tests.ok(p_name text, p_ok boolean, p_detail text default null) returns void
language sql security definer set search_path = '' as $$
  select tests.record(p_name, case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end, p_detail)
$$;
create function tests.skip(p_name text, p_reason text) returns void
language sql security definer set search_path = '' as $$
  select tests.record(p_name, 'SKIP', p_reason)
$$;
-- Test negatywny bez skutków ubocznych: wywołanie zawsze w subtransakcji wycofywanej,
-- także gdy błąd NIE wystąpił. Nieoczekiwany sukces nie zmienia fixture'ów kolejnych
-- testów (brak kaskady FAIL), a wynik wskazuje dokładnie zepsuty przypadek.
create function tests.raises(p_name text, p_sql text, p_expected text) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
    raise exception 'tests_no_error' using errcode = 'TS000';
  exception when others then
    v_state := sqlstate;
    v_msg := sqlerrm;
  end;
  if v_state = 'TS000' then
    perform tests.ok(p_name, false, 'brak błędu (skutki wycofane)');
  else
    perform tests.ok(p_name, v_msg = p_expected or v_state = p_expected, v_state || ' ' || v_msg);
  end if;
end;
$$;
create function tests.sqlstate_of(p_sql text) returns text
language plpgsql security invoker set search_path = '' as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end;
$$;
create function tests.save(p_name text, p_id uuid) returns void
language sql security definer set search_path = '' as $$
  insert into tests.ids (name, id) values (p_name, p_id)
  on conflict (name) do update set id = excluded.id
$$;
create function tests.id(p_name text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from tests.ids where name = p_name;
  if v is null then
    raise exception 'tests.id: brak fixture %', p_name;
  end if;
  return v;
end;
$$;
create function tests.note(p_name text, p_val text) returns void
language sql security definer set search_path = '' as $$
  insert into tests.notes (name, val) values (p_name, p_val)
  on conflict (name) do update set val = excluded.val
$$;
create function tests.val(p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select val from tests.notes where name = p_name
$$;

-- poprawny wynik AI (kontrakt callbacku)
create function tests.good() returns jsonb language sql immutable as $$
  select '{
    "prompt": "Dark phonk, distorted 808, cowbell lead, 140 BPM, tape saturation",
    "negativePrompt": "bright pop",
    "description": "Mroczny phonk z cowbellem.",
    "tags": ["dark phonk", "cowbell", "808"],
    "structure": [{"section": "Intro", "description": "mgła, szum taśmy"}],
    "vocalInstructions": ["low male growl, pitched -4"],
    "productionNotes": ["tape saturation on the bus"],
    "model": "gpt-5-mini"
  }'::jsonb
$$;
-- każde pole na granicy limitu, suma <= 64 KB (musi przejść)
create function tests.boundary_valid() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'prompt', repeat('p', 12000),
    'negativePrompt', repeat('n', 2000),
    'description', repeat('d', 2000),
    'tags', (select jsonb_agg(lpad(g::text, 40, 't')) from generate_series(1, 30) g),
    'structure', (select jsonb_agg(jsonb_build_object('section', lpad(g::text, 80, 's'), 'description', repeat('x', 100))) from generate_series(1, 40) g),
    'vocalInstructions', (select jsonb_agg(repeat('v', 100)) from generate_series(1, 40) g),
    'productionNotes', (select jsonb_agg(repeat('w', 100)) from generate_series(1, 40) g),
    'model', 'gpt-5-mini')
$$;
-- każde pole poprawne, suma > 64 KB (musi zostać odrzucona wyłącznie przez limit sumy)
create function tests.big_valid() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'prompt', repeat('p', 12000),
    'negativePrompt', repeat('n', 2000),
    'description', repeat('d', 2000),
    'tags', (select jsonb_agg(lpad(g::text, 40, 't')) from generate_series(1, 30) g),
    'structure', (select jsonb_agg(jsonb_build_object('section', lpad(g::text, 80, 's'), 'description', repeat('x', 1000))) from generate_series(1, 40) g),
    'vocalInstructions', (select jsonb_agg(repeat('v', 500)) from generate_series(1, 40) g),
    'productionNotes', (select jsonb_agg(repeat('w', 500)) from generate_series(1, 40) g),
    'model', 'gpt-5-mini')
$$;

-- pełny stan schematu public (bez OID i grantorów) do porównań migracja/rollback
create function tests.state() returns text language sql stable set search_path = '' as $$
  select string_agg(x, E'\n' order by x) from (
    select 'tbl ' || c.relname || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity as x
      from pg_catalog.pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    union all
    select 'acl ' || c.relname || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type
      from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) a
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    union all
    select 'colacl ' || c.relname || '.' || att.attname || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type
      from pg_catalog.pg_class c
      join pg_catalog.pg_attribute att on att.attrelid = c.oid
      cross join lateral pg_catalog.aclexplode(att.attacl) a
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and att.attacl is not null
    union all
    select 'col ' || c.relname || '.' || att.attname || ' ' || pg_catalog.format_type(att.atttypid, att.atttypmod)
           || ' nn=' || att.attnotnull || ' def=' || coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '-')
      from pg_catalog.pg_class c
      join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
      left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = att.attnum
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    union all
    select 'con ' || c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_catalog.pg_get_constraintdef(c.oid)
      from pg_catalog.pg_constraint c where c.connamespace = 'public'::regnamespace
    union all
    select 'idx ' || i.indexdef from pg_catalog.pg_indexes i where i.schemaname = 'public'
    union all
    select 'trg ' || pg_catalog.pg_get_triggerdef(t.oid)
      from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
    union all
    select 'pol ' || p.tablename || ' ' || p.policyname || ' ' || p.permissive || ' ' || p.cmd || ' '
           || pg_catalog.array_to_string(p.roles, ',') || ' ' || coalesce(p.qual, '-') || ' ' || coalesce(p.with_check, '-')
      from pg_catalog.pg_policies p where p.schemaname = 'public'
    union all
    select 'fn ' || p.oid::regprocedure::text || ' secdef=' || p.prosecdef
           || ' cfg=' || coalesce(pg_catalog.array_to_string(p.proconfig, ';'), '-') || ' src=' || pg_catalog.md5(p.prosrc)
      from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace
    union all
    select 'fnacl ' || p.oid::regprocedure::text || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     where p.pronamespace = 'public'::regnamespace
    union all
    select 'pub ' || pt.pubname || ' ' || pt.schemaname || '.' || pt.tablename from pg_catalog.pg_publication_tables pt
    union all
    select 'cmt ' || c.relname || ' ' || coalesce(pg_catalog.obj_description(c.oid, 'pg_class'), '-')
      from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    union all
    select 'cmt ' || p.oid::regprocedure::text || ' ' || coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '-')
      from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace
  ) s
$$;
create function tests.snap(p_name text) returns void
language sql security definer set search_path = '' as $$
  insert into tests.snapshots (name, state) values (p_name, tests.state())
$$;
create function tests.check_state(p_test text, p_snapshot text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_now  text := tests.state();
  v_then text;
  v_diff text;
begin
  select state into v_then from tests.snapshots where name = p_snapshot;
  select string_agg(x, ' | ') into v_diff from (
    (select '-' || l as x from unnest(string_to_array(v_then, E'\n')) l
     except select '-' || l from unnest(string_to_array(v_now, E'\n')) l)
    union all
    (select '+' || l from unnest(string_to_array(v_now, E'\n')) l
     except select '+' || l from unnest(string_to_array(v_then, E'\n')) l)
  ) d;
  perform tests.ok(p_test, v_then is not null and v_now = v_then, left(coalesce(v_diff, ''), 2000));
end;
$$;
-- liczba unikalnych nazw testów w tym pliku (kontrola: żaden test nie został pominięty)
create function tests.expected_total() returns integer language sql immutable as $$ select 127 $$;

grant usage on schema tests to app_owner, anon, authenticated, service_role, authenticator;
grant execute on all functions in schema tests to app_owner, anon, authenticated, service_role, authenticator;
grant select on tests.results, tests.snapshots, tests.notes to app_owner;

-- 0b. FIXTURES: użytkownicy (superuser) ----------------------------------------
--   A: główny przepływ   B: drugi tenant (RLS)   C: limit godzinowy
--   D: limit miesięczny  E: limit aktywnych + sweep   F: walidacja   G: kody błędów
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000000' || x)::uuid, 'user_' || x || '@test.local'
  from unnest(array['0a', '0b', '0c', '0d', '0e', '0f', '1a']) x;
insert into tests.ids (name, id) values
  ('uA', '00000000-0000-0000-0000-00000000000a'), ('uB', '00000000-0000-0000-0000-00000000000b'),
  ('uC', '00000000-0000-0000-0000-00000000000c'), ('uD', '00000000-0000-0000-0000-00000000000d'),
  ('uE', '00000000-0000-0000-0000-00000000000e'), ('uF', '00000000-0000-0000-0000-00000000000f'),
  ('uG', '00000000-0000-0000-0000-00000000001a'),
  ('pA', '10000000-0000-0000-0000-00000000000a'), ('pA2', '10000000-0000-0000-0000-0000000000a2'),
  ('pB', '10000000-0000-0000-0000-00000000000b'), ('pC', '10000000-0000-0000-0000-00000000000c'),
  ('pD', '10000000-0000-0000-0000-00000000000d'), ('pE', '10000000-0000-0000-0000-00000000000e'),
  ('pF', '10000000-0000-0000-0000-00000000000f'), ('pG', '10000000-0000-0000-0000-00000000001a');

-- 1. REPLIKA STANU PRODUKCJI (app_owner = postgres w Supabase) --------------------
\c - app_owner
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create publication supabase_realtime;

\ir baseline_prod_2026-10-16.sql

insert into public.projects (id, user_id, title)
select tests.id(p), tests.id(u), 'Projekt ' || p
  from (values ('pA', 'uA'), ('pA2', 'uA'), ('pB', 'uB'), ('pC', 'uC'),
               ('pD', 'uD'), ('pE', 'uE'), ('pF', 'uF'), ('pG', 'uG')) v(p, u);

select tests.snap('before');

-- 2. MIGRACJA 2x (idempotencja) -------------------------------------------------
\ir ai_studio_jobs_v1.sql
select tests.snap('after_1');
\ir ai_studio_jobs_v1.sql
select tests.check_state('M00 migracja 2x = ten sam stan', 'after_1');

-- 3. BACKEND: authenticator -> service_role (Edge Functions) --------------------
\c - authenticator
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);

do $$ begin
  perform tests.ok('K00 fixture: rozmiary wyników testowych',
    octet_length(tests.boundary_valid()::text) <= 65536 and octet_length(tests.big_valid()::text) > 65536
    and octet_length(jsonb_build_object('x', repeat('a', 8183))::text) = 8192);
end $$;

-- 3a. mgj_create ---------------------------------------------------------------
do $$
declare j public.music_generation_jobs; j2 public.music_generation_jobs; j3 public.music_generation_jobs; n integer;
begin
  select * into j from public.mgj_create(tests.id('uA'), tests.id('pA'), 'aa000000-0000-0000-0000-000000000001', 'Tytuł 1', 'Idea 1', '{"bpm": 140}');
  perform tests.save('jA1', j.id);
  perform tests.ok('C01 create: queued, attempts 0, wejście zapisane',
    j.status = 'queued' and j.user_id = tests.id('uA') and j.project_id = tests.id('pA') and j.attempts = 0
    and j.input_payload = '{"bpm": 140}'::jsonb and j.dispatched_at is null and j.completed_at is null);
  select * into j2 from public.mgj_create(tests.id('uA'), tests.id('pA'), 'aa000000-0000-0000-0000-000000000001', 'Inny', 'Inna', '{}');
  select count(*) into n from public.music_generation_jobs where user_id = tests.id('uA');
  perform tests.ok('C02 create: replay request_id = ten sam job, bez nowego wiersza',
    j2.id = j.id and j2.working_title = 'Tytuł 1' and n = 1);
  select * into j3 from public.mgj_create(tests.id('uA'), tests.id('pA2'), 'aa000000-0000-0000-0000-000000000001', 'Inny', 'Inna', '{}');
  perform tests.ok('C03 create: replay z innym projektem zwraca job pierwotny',
    j3.id = j.id and j3.project_id = tests.id('pA'));
end $$;

select tests.raises('C04 create: cudzy projekt',
  $q$select public.mgj_create(tests.id('uA'), tests.id('pB'), gen_random_uuid(), 't', 'i', '{}')$q$, 'mgj_project_not_found');
select tests.raises('C05 create: nieistniejący projekt',
  $q$select public.mgj_create(tests.id('uA'), gen_random_uuid(), gen_random_uuid(), 't', 'i', '{}')$q$, 'mgj_project_not_found');
select tests.raises('C06a create: user null',
  $q$select public.mgj_create(null, tests.id('pF'), gen_random_uuid(), 't', 'i', '{}')$q$, 'mgj_invalid_input');
select tests.raises('C06b create: project null',
  $q$select public.mgj_create(tests.id('uF'), null, gen_random_uuid(), 't', 'i', '{}')$q$, 'mgj_invalid_input');
select tests.raises('C06c create: request null',
  $q$select public.mgj_create(tests.id('uF'), tests.id('pF'), null, 't', 'i', '{}')$q$, 'mgj_invalid_input');
select tests.raises('C06d create: input SQL NULL',
  $q$select public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), 't', 'i', null)$q$, 'mgj_invalid_input');
select tests.raises('C06e create: input JSON null',
  $q$select public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), 't', 'i', 'null'::jsonb)$q$, 'mgj_invalid_input');
select tests.raises('C06f create: input tablica',
  $q$select public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), 't', 'i', '[1, 2]'::jsonb)$q$, 'mgj_invalid_input');

do $$
declare j public.music_generation_jobs; ok120 boolean; ok5000 boolean; ok8192 boolean;
begin
  select * into j from public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), repeat('t', 120), 'i', '{}');
  ok120 := j.status = 'queued';
  perform public.mgj_fail(j.id, 'test_cleanup');
  select * into j from public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), 't', repeat('i', 5000), '{}');
  ok5000 := j.status = 'queued';
  perform public.mgj_fail(j.id, 'test_cleanup');
  select * into j from public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), 't', 'i', jsonb_build_object('x', repeat('a', 8183)));
  ok8192 := j.status = 'queued';
  perform public.mgj_fail(j.id, 'test_cleanup');
  perform tests.ok('C07a create: granice dozwolone (tytuł 120, idea 5000, input 8192 B)', ok120 and ok5000 and ok8192);
end $$;
select tests.raises('C07b create: tytuł 121',
  $q$select public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), repeat('t', 121), 'i', '{}')$q$, 'mgj_invalid_input');
select tests.raises('C07c create: tytuł pusty',
  $q$select public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), '', 'i', '{}')$q$, 'mgj_invalid_input');
select tests.raises('C07d create: tytuł z białych znaków',
  $q$select public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), E' \t\n ', 'i', '{}')$q$, 'mgj_invalid_input');
select tests.raises('C07e create: idea 5001',
  $q$select public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), 't', repeat('i', 5001), '{}')$q$, 'mgj_invalid_input');
select tests.raises('C07f create: idea ze spacji',
  $q$select public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), 't', '    ', '{}')$q$, 'mgj_invalid_input');
select tests.raises('C07g create: input 8193 B',
  $q$select public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), 't', 'i', jsonb_build_object('x', repeat('a', 8184)))$q$, 'mgj_invalid_input');

do $$
declare e1 public.music_generation_jobs; e2 public.music_generation_jobs; e3 public.music_generation_jobs; msg text := 'none';
begin
  select * into e1 from public.mgj_create(tests.id('uE'), tests.id('pE'), gen_random_uuid(), 'E1', 'E1', '{}');
  select * into e2 from public.mgj_create(tests.id('uE'), tests.id('pE'), gen_random_uuid(), 'E2', 'E2', '{}');
  begin
    perform public.mgj_create(tests.id('uE'), tests.id('pE'), gen_random_uuid(), 'E3', 'E3', '{}');
  exception when others then
    msg := sqlerrm;
  end;
  perform tests.ok('C08a create: trzeci aktywny job odrzucony', msg = 'mgj_limit_active', msg);
  perform public.mgj_fail(e1.id, 'test_cleanup');
  select * into e3 from public.mgj_create(tests.id('uE'), tests.id('pE'), gen_random_uuid(), 'E3', 'E3', '{}');
  perform tests.ok('C08b create: po zwolnieniu slotu job dozwolony', e3.status = 'queued');
  perform public.mgj_fail(e2.id, 'test_cleanup');
  perform public.mgj_fail(e3.id, 'test_cleanup');
end $$;

do $$
declare n integer := 0; msg text := 'none'; j public.music_generation_jobs;
begin
  for i in 1..12 loop
    begin
      select * into j from public.mgj_create(tests.id('uC'), tests.id('pC'), gen_random_uuid(), 'C', 'C', '{}');
      perform public.mgj_fail(j.id, 'test_cleanup');
      n := n + 1;
    exception when others then
      msg := sqlerrm;
      exit;
    end;
  end loop;
  perform tests.ok('C09 create: limit godzinowy = 10 (11. odrzucony)',
    n = 10 and msg = 'mgj_limit_hour', format('utworzono=%s błąd=%s', n, msg));
end $$;

do $$
declare v_start timestamptz := date_trunc('month', now()); j public.music_generation_jobs; msg text := 'none';
begin
  if now() - v_start <= interval '61 minutes' then
    perform tests.skip('C10 create: limit miesięczny = 80 (80. dozwolony, 81. odrzucony)',
      'pierwsze 61 min miesiąca UTC: okien godzinowego i miesięcznego nie da się rozdzielić');
    return;
  end if;
  insert into public.music_generation_jobs
    (user_id, project_id, request_id, working_title, idea, status, error_code, created_at, completed_at)
  select tests.id('uD'), tests.id('pD'), gen_random_uuid(), 'fill', 'fill', 'failed', 'test_fill',
         v_start + interval '1 minute', v_start + interval '1 minute'
    from generate_series(1, 79);
  select * into j from public.mgj_create(tests.id('uD'), tests.id('pD'), gen_random_uuid(), 'D80', 'D80', '{}');
  perform public.mgj_fail(j.id, 'test_cleanup');
  begin
    perform public.mgj_create(tests.id('uD'), tests.id('pD'), gen_random_uuid(), 'D81', 'D81', '{}');
  exception when others then
    msg := sqlerrm;
  end;
  perform tests.ok('C10 create: limit miesięczny = 80 (80. dozwolony, 81. odrzucony)',
    j.status = 'queued' and msg = 'mgj_limit_month', msg);
end $$;

do $$
declare old public.music_generation_jobs; fresh public.music_generation_jobs; nxt public.music_generation_jobs; err text;
begin
  select * into old from public.mgj_create(tests.id('uE'), tests.id('pE'), gen_random_uuid(), 'E-old', 'E-old', '{}');
  perform tests.save('jEold', old.id);
  perform public.mgj_dispatch(old.id, repeat('e', 64));
  update public.music_generation_jobs set dispatched_at = now() - interval '11 minutes' where id = old.id;
  select * into fresh from public.mgj_create(tests.id('uE'), tests.id('pE'), gen_random_uuid(), 'E-fresh', 'E-fresh', '{}');
  update public.music_generation_jobs set created_at = now() - interval '9 minutes' where id = fresh.id;
  begin
    select * into nxt from public.mgj_create(tests.id('uE'), tests.id('pE'), gen_random_uuid(), 'E-next', 'E-next', '{}');
  exception when others then
    err := sqlerrm;
  end;
  perform tests.ok('C11a sweep: processing > 10 min -> failed/timeout przed liczeniem limitu',
    err is null
    and (select status = 'failed' and error_code = 'timeout' and completed_at is not null
           from public.music_generation_jobs where id = old.id)
    and nxt.status = 'queued', err);
  perform tests.ok('C11b sweep: queued 9 min pozostaje queued',
    (select status from public.music_generation_jobs where id = fresh.id) = 'queued');
  perform public.mgj_fail(fresh.id, 'test_cleanup');
  if nxt.id is not null then
    perform public.mgj_fail(nxt.id, 'test_cleanup');
  end if;
end $$;

-- 3b. mgj_dispatch -------------------------------------------------------------
do $$
declare j public.music_generation_jobs;
begin
  perform public.mgj_dispatch(tests.id('jA1'), repeat('1', 64));
  select * into j from public.music_generation_jobs where id = tests.id('jA1');
  perform tests.ok('D01 dispatch: queued -> processing, dispatched_at, attempts 1, hash zapisany',
    j.status = 'processing' and j.dispatched_at is not null and j.attempts = 1 and j.error_code is null
    and exists (select 1 from public.music_generation_job_tokens t where t.job_id = j.id and t.token_hash = repeat('1', 64)));
end $$;
select tests.raises('D02 dispatch: ponowna wysyłka',
  $q$select public.mgj_dispatch(tests.id('jA1'), repeat('1', 64))$q$, 'mgj_invalid_state');
do $$
declare j public.music_generation_jobs;
begin
  select * into j from public.mgj_create(tests.id('uA'), tests.id('pA'), 'aa000000-0000-0000-0000-000000000002', 'Tytuł 2', 'Idea 2', '{}');
  perform tests.save('jA2', j.id);
end $$;
select tests.raises('D03a dispatch: hash nie-hex',
  $q$select public.mgj_dispatch(tests.id('jA2'), 'xyz')$q$, 'mgj_invalid_token');
select tests.raises('D03b dispatch: hash wielkimi literami',
  $q$select public.mgj_dispatch(tests.id('jA2'), repeat('A', 64))$q$, 'mgj_invalid_token');
select tests.raises('D03c dispatch: hash 63 znaki',
  $q$select public.mgj_dispatch(tests.id('jA2'), repeat('a', 63))$q$, 'mgj_invalid_token');
select tests.raises('D03d dispatch: hash 65 znaków',
  $q$select public.mgj_dispatch(tests.id('jA2'), repeat('a', 65))$q$, 'mgj_invalid_token');
select tests.raises('D03e dispatch: hash null',
  $q$select public.mgj_dispatch(tests.id('jA2'), null)$q$, 'mgj_invalid_token');
select tests.raises('D04 dispatch: nieistniejący job',
  $q$select public.mgj_dispatch(gen_random_uuid(), repeat('a', 64))$q$, 'mgj_job_not_found');
do $$
declare j public.music_generation_jobs;
begin
  select * into j from public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), 'F-x', 'F-x', '{}');
  perform public.mgj_fail(j.id, 'test_cleanup');
  perform tests.save('jFfailed', j.id);
end $$;
select tests.raises('D05 dispatch: job failed',
  $q$select public.mgj_dispatch(tests.id('jFfailed'), repeat('a', 64))$q$, 'mgj_invalid_state');

-- 3c. mgj_complete -------------------------------------------------------------
select tests.raises('K01a complete: zły token',
  $q$select public.mgj_complete(tests.id('jA1'), repeat('9', 64), tests.good())$q$, 'mgj_invalid_token');
select tests.raises('K01b complete: token null',
  $q$select public.mgj_complete(tests.id('jA1'), null, tests.good())$q$, 'mgj_invalid_token');
select tests.raises('K02 complete: job queued bez tokenu',
  $q$select public.mgj_complete(tests.id('jA2'), repeat('2', 64), tests.good())$q$, 'mgj_invalid_token');
select tests.raises('K03 complete: nieistniejący job',
  $q$select public.mgj_complete(gen_random_uuid(), repeat('1', 64), tests.good())$q$, 'mgj_job_not_found');

do $$
declare r record;
begin
  for r in
    select c.name, c.payload from (values
      ('K04a wynik: nie-obiekt',                     '[]'::jsonb),
      ('K04b wynik: brak prompt',                    tests.good() - 'prompt'),
      ('K04c wynik: brak description',               tests.good() - 'description'),
      ('K04d wynik: brak tags',                      tests.good() - 'tags'),
      ('K04e wynik: prompt pusty',                   jsonb_set(tests.good(), '{prompt}', '""')),
      ('K04f wynik: prompt ze spacji',               jsonb_set(tests.good(), '{prompt}', to_jsonb('   '::text))),
      ('K04g wynik: prompt 12001',                   jsonb_set(tests.good(), '{prompt}', to_jsonb(repeat('x', 12001)))),
      ('K04h wynik: description 2001',               jsonb_set(tests.good(), '{description}', to_jsonb(repeat('x', 2001)))),
      ('K04i wynik: description z białych znaków',   jsonb_set(tests.good(), '{description}', to_jsonb(E' \n '::text))),
      ('K04j wynik: negativePrompt liczba',          jsonb_set(tests.good(), '{negativePrompt}', '5')),
      ('K04k wynik: negativePrompt 2001',            jsonb_set(tests.good(), '{negativePrompt}', to_jsonb(repeat('x', 2001)))),
      ('K04l wynik: tags pusta tablica',             jsonb_set(tests.good(), '{tags}', '[]')),
      ('K04m wynik: tags 31',                        jsonb_set(tests.good(), '{tags}', (select jsonb_agg('t' || g) from generate_series(1, 31) g))),
      ('K04n wynik: tag nie-string',                 jsonb_set(tests.good(), '{tags}', '["ok", 5]')),
      ('K04o wynik: tag pusty',                      jsonb_set(tests.good(), '{tags}', '["ok", ""]')),
      ('K04p wynik: tag 41 znaków',                  jsonb_set(tests.good(), '{tags}', jsonb_build_array(repeat('x', 41)))),
      ('K04q wynik: structure nie-tablica',          jsonb_set(tests.good(), '{structure}', '{}')),
      ('K04r wynik: structure 41',                   jsonb_set(tests.good(), '{structure}', (select jsonb_agg(jsonb_build_object('section', 's' || g, 'description', 'd')) from generate_series(1, 41) g))),
      ('K04s wynik: element structure jako string',  jsonb_set(tests.good(), '{structure}', '["Intro"]')),
      ('K04t wynik: structure bez section',          jsonb_set(tests.good(), '{structure}', '[{"description": "d"}]')),
      ('K04u wynik: section 81 znaków',              jsonb_set(tests.good(), '{structure}', jsonb_build_array(jsonb_build_object('section', repeat('s', 81), 'description', 'd')))),
      ('K04v wynik: opis sekcji 1001',               jsonb_set(tests.good(), '{structure}', jsonb_build_array(jsonb_build_object('section', 's', 'description', repeat('d', 1001))))),
      ('K04w wynik: vocalInstructions obiekt',       jsonb_set(tests.good(), '{vocalInstructions}', '[{"a": 1}]')),
      ('K04x wynik: vocalInstructions pusty element', jsonb_set(tests.good(), '{vocalInstructions}', '[""]')),
      ('K04y wynik: vocalInstructions 501',          jsonb_set(tests.good(), '{vocalInstructions}', jsonb_build_array(repeat('v', 501)))),
      ('K04z wynik: productionNotes 41',             jsonb_set(tests.good(), '{productionNotes}', (select jsonb_agg('n' || g) from generate_series(1, 41) g))),
      ('K04za wynik: model nie-string',              jsonb_set(tests.good(), '{model}', '1')),
      ('K04zb wynik: suma > 64 KB przy poprawnych polach', tests.big_valid())
    ) as c(name, payload)
  loop
    perform tests.raises(r.name,
      format('select public.mgj_complete(tests.id(%L), repeat(%L, 64), %L::jsonb)', 'jA1', '1', r.payload::text),
      'mgj_invalid_result');
  end loop;
end $$;
do $$ begin
  perform tests.ok('K04zz po odrzuceniach: job nadal processing, brak wersji',
    (select status from public.music_generation_jobs where id = tests.id('jA1')) = 'processing'
    and (select count(*) from public.prompt_versions where project_id = tests.id('pA')) = 0);
end $$;

do $$
declare v uuid; j public.music_generation_jobs; pv public.prompt_versions;
begin
  v := public.mgj_complete(tests.id('jA1'), repeat('1', 64), tests.good());
  perform tests.save('pvA1', v);
  select * into j from public.music_generation_jobs where id = tests.id('jA1');
  select * into pv from public.prompt_versions where id = v;
  perform tests.ok('K05 complete: wersja 1, job completed, pola wyjściowe',
    j.status = 'completed' and j.result_prompt_version_id = v and j.completed_at is not null and j.error_code is null
    and j.output_tags = array['dark phonk', 'cowbell', '808'] and j.output_description = 'Mroczny phonk z cowbellem.'
    and pv.version_number = 1 and pv.user_id = tests.id('uA') and pv.project_id = tests.id('pA')
    and pv.prompt_text = tests.good() ->> 'prompt' and pv.negative_prompt = 'bright pop'
    and pv.structure = tests.good() -> 'structure'
    and pv.vocal_instructions = tests.good() -> 'vocalInstructions'
    and pv.production_notes = tests.good() -> 'productionNotes'
    and pv.model_name = 'gpt-5-mini'
    and pv.generation_metadata = jsonb_build_object('provider', 'make', 'job_id', j.id));
end $$;

do $$
declare v uuid;
begin
  v := public.mgj_complete(tests.id('jA1'), repeat('1', 64), jsonb_set(tests.good(), '{prompt}', '"inny"'));
  perform tests.ok('K06 complete: powtórka zwraca tę samą wersję, treść bez zmian',
    v = tests.id('pvA1')
    and (select count(*) from public.prompt_versions where project_id = tests.id('pA')) = 1
    and (select prompt_text from public.prompt_versions where id = v) = tests.good() ->> 'prompt');
end $$;

select tests.raises('F06 fail: token dla joba bez tokenu',
  $q$select public.mgj_fail(tests.id('jA2'), 'ai_error', repeat('2', 64))$q$, 'mgj_invalid_token');

do $$
declare v uuid; pv public.prompt_versions;
begin
  perform public.mgj_dispatch(tests.id('jA2'), repeat('2', 64));
  v := public.mgj_complete(tests.id('jA2'), repeat('2', 64),
         jsonb_set(jsonb_set(tests.good(), '{negativePrompt}', '""'), '{model}', to_jsonb(repeat('m', 130))));
  select * into pv from public.prompt_versions where id = v;
  perform tests.ok('K07 complete: wersja 2, negativePrompt "" -> null, model obcięty do 120',
    pv.version_number = 2 and pv.negative_prompt is null and char_length(pv.model_name) = 120);
end $$;

do $$
declare j public.music_generation_jobs; v uuid;
begin
  select * into j from public.mgj_create(tests.id('uA'), tests.id('pA2'), gen_random_uuid(), 'Tytuł 3', 'Idea 3', '{}');
  perform public.mgj_dispatch(j.id, repeat('3', 64));
  v := public.mgj_complete(j.id, repeat('3', 64), tests.good());
  perform tests.ok('K08 complete: numeracja niezależna per projekt (pA2 = 1)',
    (select version_number from public.prompt_versions where id = v) = 1);
end $$;

do $$
declare v uuid;
begin
  v := public.mgj_complete(tests.id('jEold'), repeat('e', 64), tests.good());
  perform tests.ok('K09 complete: spóźniony wynik po timeout przyjęty',
    v is not null
    and (select status = 'completed' and error_code is null and result_prompt_version_id = v
           from public.music_generation_jobs where id = tests.id('jEold')));
end $$;

do $$
declare j public.music_generation_jobs;
begin
  select * into j from public.mgj_create(tests.id('uF'), tests.id('pF'), gen_random_uuid(), 'F-d', 'F-d', '{}');
  perform public.mgj_dispatch(j.id, repeat('f', 64));
  perform public.mgj_fail(j.id, 'dispatch_failed');
  perform tests.save('jFdf', j.id);
end $$;
select tests.raises('K10 complete: po dispatch_failed odrzucony',
  $q$select public.mgj_complete(tests.id('jFdf'), repeat('f', 64), tests.good())$q$, 'mgj_invalid_state');

do $$
declare j public.music_generation_jobs; v uuid;
begin
  select * into j from public.mgj_create(tests.id('uB'), tests.id('pB'), 'bb000000-0000-0000-0000-000000000001', 'B job', 'B idea', '{}');
  perform tests.save('jB1', j.id);
  perform public.mgj_dispatch(j.id, repeat('b', 64));
  v := public.mgj_complete(j.id, repeat('b', 64), tests.boundary_valid());
  perform tests.save('pvB1', v);
  perform tests.ok('K11 complete: wynik z polami na granicach limitów (<= 64 KB) przyjęty',
    v is not null and (select array_length(tags, 1) = 30 and jsonb_array_length(structure) = 40
                         from public.prompt_versions where id = v));
end $$;

-- 3d. mgj_fail -------------------------------------------------------------------
do $$
declare j public.music_generation_jobs;
begin
  select * into j from public.mgj_create(tests.id('uA'), tests.id('pA'), gen_random_uuid(), 'Tytuł 4', 'Idea 4', '{}');
  perform tests.save('jA4', j.id);
  perform public.mgj_dispatch(j.id, repeat('4', 64));
  perform public.mgj_fail(j.id, 'ai_error', repeat('4', 64));
  select * into j from public.music_generation_jobs where id = j.id;
  perform tests.ok('F01 fail z tokenem: processing -> failed, kod, completed_at',
    j.status = 'failed' and j.error_code = 'ai_error' and j.completed_at is not null);
end $$;
select tests.raises('F02 fail: zły token',
  $q$select public.mgj_fail(tests.id('jA4'), 'ai_error', repeat('9', 64))$q$, 'mgj_invalid_token');
do $$ begin
  perform public.mgj_fail(tests.id('jA1'), 'ai_error', repeat('1', 64));
  perform tests.ok('F03 fail: job completed bez zmian',
    (select status = 'completed' and error_code is null from public.music_generation_jobs where id = tests.id('jA1')));
end $$;
do $$
declare j public.music_generation_jobs; codes text[] := array[]::text[]; c text;
begin
  foreach c in array array['Bad Code!', '', 'x' || repeat('y', 64), 'ai_error'] loop
    select * into j from public.mgj_create(tests.id('uG'), tests.id('pG'), gen_random_uuid(), 'G', 'G', '{}');
    perform public.mgj_fail(j.id, c);
    codes := codes || (select error_code from public.music_generation_jobs where id = j.id);
  end loop;
  select * into j from public.mgj_create(tests.id('uG'), tests.id('pG'), gen_random_uuid(), 'G', 'G', '{}');
  perform public.mgj_fail(j.id, null);
  codes := codes || (select error_code from public.music_generation_jobs where id = j.id);
  perform tests.ok('F04 fail bez tokenu na queued + sanityzacja kodów',
    codes = array['unknown', 'unknown', 'unknown', 'ai_error', 'unknown'], array_to_string(codes, ','));
end $$;
select tests.raises('F05 fail: nieistniejący job',
  $q$select public.mgj_fail(gen_random_uuid(), 'ai_error')$q$, 'mgj_job_not_found');

do $$
declare j public.music_generation_jobs;
begin
  select * into j from public.mgj_create(tests.id('uA'), tests.id('pA'), gen_random_uuid(), 'Tytuł 5', 'Idea 5', '{}');
  perform tests.save('jA5', j.id);
  perform public.mgj_dispatch(j.id, repeat('5', 64));
end $$;

-- 4. KLIENT: authenticator -> authenticated (A) ---------------------------------
\c - authenticator
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);

do $$ begin
  perform tests.ok('R01 RLS: A widzi tylko własne joby',
    (select count(*) from public.music_generation_jobs) = 5
    and (select count(*) from public.music_generation_jobs where user_id <> tests.id('uA')) = 0);
end $$;
select tests.raises('R02 klient: INSERT jobs',
  $q$insert into public.music_generation_jobs (user_id, project_id, request_id, working_title, idea) values (tests.id('uA'), tests.id('pA'), gen_random_uuid(), 'x', 'x')$q$, '42501');
select tests.raises('R03 klient: UPDATE status',
  $q$update public.music_generation_jobs set status = 'completed' where id = tests.id('jA5')$q$, '42501');
select tests.raises('R04 klient: UPDATE user_id',
  $q$update public.music_generation_jobs set user_id = tests.id('uB') where id = tests.id('jA5')$q$, '42501');
select tests.raises('R05 klient: DELETE jobs',
  $q$delete from public.music_generation_jobs where id = tests.id('jA5')$q$, '42501');
do $$
declare n integer;
begin
  update public.music_generation_jobs set notified_at = now() where id = tests.id('jA1');
  get diagnostics n = row_count;
  perform tests.ok('R06 klient: notified_at na własnym jobie',
    n = 1 and (select notified_at is not null from public.music_generation_jobs where id = tests.id('jA1')));
  update public.music_generation_jobs set notified_at = now() where id = tests.id('jB1');
  get diagnostics n = row_count;
  perform tests.ok('R07 klient: notified_at na cudzym jobie = 0 wierszy', n = 0);
end $$;
select tests.raises('R08a klient: SELECT tokeny',
  $q$select count(*) from public.music_generation_job_tokens$q$, '42501');
select tests.raises('R08b klient: INSERT tokeny',
  $q$insert into public.music_generation_job_tokens (job_id, token_hash) values (tests.id('jA5'), repeat('0', 64))$q$, '42501');
select tests.raises('R08c klient: UPDATE tokeny',
  $q$update public.music_generation_job_tokens set token_hash = repeat('0', 64)$q$, '42501');
select tests.raises('R08d klient: DELETE tokeny',
  $q$delete from public.music_generation_job_tokens$q$, '42501');
select tests.raises('R09a klient: EXECUTE mgj_create',
  $q$select public.mgj_create(tests.id('uA'), tests.id('pA'), gen_random_uuid(), 't', 'i', '{}')$q$, '42501');
select tests.raises('R09b klient: EXECUTE mgj_dispatch',
  $q$select public.mgj_dispatch(tests.id('jA5'), repeat('0', 64))$q$, '42501');
select tests.raises('R09c klient: EXECUTE mgj_complete',
  $q$select public.mgj_complete(tests.id('jA5'), repeat('5', 64), tests.good())$q$, '42501');
select tests.raises('R09d klient: EXECUTE mgj_fail',
  $q$select public.mgj_fail(tests.id('jA5'), 'ai_error')$q$, '42501');
select tests.raises('R10a klient: INSERT prompt_versions',
  $q$insert into public.prompt_versions (project_id, user_id, version_number, prompt_text) values (tests.id('pA'), tests.id('uA'), 99, 'x')$q$, '42501');
select tests.raises('R10b klient: UPDATE prompt_versions',
  $q$update public.prompt_versions set prompt_text = 'x' where id = tests.id('pvA1')$q$, '42501');
do $$ begin
  perform tests.ok('R10c RLS: A widzi tylko własne wersje (3)',
    (select count(*) from public.prompt_versions) = 3
    and (select count(*) from public.prompt_versions where user_id <> tests.id('uA')) = 0);
end $$;
do $$
declare n integer := -1; nulled boolean := false; err text;
begin
  begin
    delete from public.prompt_versions where id = tests.id('pvA1');
    get diagnostics n = row_count;
    nulled := (select result_prompt_version_id from public.music_generation_jobs where id = tests.id('jA1')) is null;
    raise exception 'rollback_r10d';
  exception when others then
    if sqlerrm <> 'rollback_r10d' then
      err := sqlerrm;
    end if;
  end;
  perform tests.ok('R10d klient: DELETE własnej wersji (FK -> null), wycofane', err is null and n = 1 and nulled, err);
end $$;
do $$ begin
  perform tests.ok('R11 RLS: A nie widzi projektu B', not exists (select 1 from public.projects where id = tests.id('pB')));
end $$;

-- 4a. Obrona w głąb: nawet z EXECUTE klient nie zapisze (brak praw do tabel) -------
\c - app_owner
begin;
grant execute on function public.mgj_create(uuid, uuid, uuid, text, text, jsonb) to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select tests.sqlstate_of($q$select public.mgj_create(tests.id('uA'), tests.id('pA'), gen_random_uuid(), 't', 'i', '{}')$q$) as r12 \gset
rollback;
select tests.ok('R12 obrona w głąb: EXECUTE bez praw do tabel = 42501', :'r12' = '42501', :'r12');

-- 5. KLIENT: authenticator -> anon ----------------------------------------------
\c - authenticator
set role anon;
select tests.raises('N01 anon: SELECT jobs',
  $q$select count(*) from public.music_generation_jobs$q$, '42501');
select tests.raises('N02 anon: SELECT prompt_versions',
  $q$select count(*) from public.prompt_versions$q$, '42501');
select tests.raises('N03 anon: SELECT tokeny',
  $q$select count(*) from public.music_generation_job_tokens$q$, '42501');
select tests.raises('N04 anon: EXECUTE mgj_create',
  $q$select public.mgj_create(tests.id('uA'), tests.id('pA'), gen_random_uuid(), 't', 'i', '{}')$q$, '42501');
select tests.raises('N05 anon: SELECT projects',
  $q$select count(*) from public.projects$q$, '42501');

-- 6. STRUKTURA I UPRAWNIENIA (app_owner) ------------------------------------------
\c - app_owner
do $$ begin
  perform tests.ok('S01 Realtime: jobs w supabase_realtime, tokeny poza publikacją',
    exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'music_generation_jobs')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'music_generation_job_tokens'));
  perform tests.ok('S02 mgj_*: 4 funkcje, SECURITY INVOKER, search_path pusty',
    (select count(*) = 4 and bool_and(not p.prosecdef and p.proconfig @> array['search_path=""'])
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'mgj\_%'));
  perform tests.ok('S03 EXECUTE mgj_*: brak PUBLIC/anon/authenticated, jest service_role',
    (select bool_and(not has_function_privilege('public', p.oid, 'EXECUTE')
                     and not has_function_privilege('anon', p.oid, 'EXECUTE')
                     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     and has_function_privilege('service_role', p.oid, 'EXECUTE'))
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'mgj\_%'));
  perform tests.ok('S04 tokeny: RLS on; anon/authenticated bez S/I/U/D; service_role S/I/U/D',
    (select relrowsecurity from pg_class where oid = 'public.music_generation_job_tokens'::regclass)
    and not has_table_privilege('anon', 'public.music_generation_job_tokens', 'SELECT, INSERT, UPDATE, DELETE')
    and not has_table_privilege('authenticated', 'public.music_generation_job_tokens', 'SELECT, INSERT, UPDATE, DELETE')
    and has_table_privilege('service_role', 'public.music_generation_job_tokens', 'SELECT')
    and has_table_privilege('service_role', 'public.music_generation_job_tokens', 'INSERT')
    and has_table_privilege('service_role', 'public.music_generation_job_tokens', 'UPDATE')
    and has_table_privilege('service_role', 'public.music_generation_job_tokens', 'DELETE'));
  perform tests.ok('S05 jobs: anon bez praw; authenticated SELECT + UPDATE tylko notified_at',
    not has_table_privilege('anon', 'public.music_generation_jobs', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    and has_table_privilege('authenticated', 'public.music_generation_jobs', 'SELECT')
    and not has_table_privilege('authenticated', 'public.music_generation_jobs', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    and has_column_privilege('authenticated', 'public.music_generation_jobs', 'notified_at', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.music_generation_jobs', 'status', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.music_generation_jobs', 'user_id', 'UPDATE'));
  perform tests.ok('S06 prompt_versions: authenticated bez INSERT/UPDATE, z SELECT/DELETE',
    not has_table_privilege('authenticated', 'public.prompt_versions', 'INSERT, UPDATE')
    and has_table_privilege('authenticated', 'public.prompt_versions', 'SELECT')
    and has_table_privilege('authenticated', 'public.prompt_versions', 'DELETE'));
  perform tests.ok('S07 indeksy FK jobs',
    exists (select 1 from pg_indexes where indexname = 'music_generation_jobs_project_id_idx')
    and exists (select 1 from pg_indexes where indexname = 'music_generation_jobs_result_prompt_version_id_idx'));
  update public.music_generation_jobs set updated_at = '2000-01-01' where id = tests.id('jA1');
  perform tests.ok('S08 trigger updated_at',
    (select updated_at > '2001-01-01' from public.music_generation_jobs where id = tests.id('jA1')));
  perform tests.ok('S09 polityki: jobs {select own, update own}, prompt_versions {select own, delete own}',
    (select array_agg(policyname || ':' || cmd order by policyname) from pg_policies
      where schemaname = 'public' and tablename = 'music_generation_jobs')
      = array['Users can mark own jobs notified:UPDATE', 'Users can read their own music generation jobs:SELECT']
    and (select array_agg(policyname || ':' || cmd order by policyname) from pg_policies
      where schemaname = 'public' and tablename = 'prompt_versions')
      = array['prompt_versions_delete_own:DELETE', 'prompt_versions_select_own:SELECT']);
end $$;

-- 7. NIEZMIENNIKI DANYCH (app_owner) ----------------------------------------------
do $$ begin
  perform tests.ok('V01 completed => completed_at i wynik',
    not exists (select 1 from public.music_generation_jobs
                 where status = 'completed' and (completed_at is null or result_prompt_version_id is null)));
  perform tests.ok('V02 failed => completed_at i poprawny kod błędu',
    not exists (select 1 from public.music_generation_jobs
                 where status = 'failed' and (completed_at is null or error_code is null or error_code !~ '^[a-z0-9_]{1,64}$')));
  perform tests.ok('V03 processing => dispatched_at i token (min. 1 przypadek)',
    exists (select 1 from public.music_generation_jobs where status = 'processing')
    and not exists (select 1 from public.music_generation_jobs j
                     where j.status = 'processing'
                       and (j.dispatched_at is null or not exists (select 1 from public.music_generation_job_tokens t where t.job_id = j.id))));
  perform tests.ok('V04 queued => brak dispatched_at i tokenu',
    not exists (select 1 from public.music_generation_jobs j
                 where j.status = 'queued'
                   and (j.dispatched_at is not null or exists (select 1 from public.music_generation_job_tokens t where t.job_id = j.id))));
  perform tests.ok('V05 numery wersji ciągłe od 1 w każdym projekcie',
    not exists (select 1 from public.prompt_versions group by project_id
                 having min(version_number) <> 1 or max(version_number) <> count(*)));
  perform tests.ok('V06 właściciel wersji = właściciel projektu',
    not exists (select 1 from public.prompt_versions v join public.projects p on p.id = v.project_id where v.user_id <> p.user_id));
  perform tests.ok('V07 output_tags joba = tags wersji',
    not exists (select 1 from public.music_generation_jobs j join public.prompt_versions v on v.id = j.result_prompt_version_id
                 where j.output_tags <> v.tags));
  perform tests.ok('V08 token tylko dla jobów po dispatch (attempts >= 1)',
    not exists (select 1 from public.music_generation_job_tokens t join public.music_generation_jobs j on j.id = t.job_id where j.attempts < 1));
end $$;

-- 8. ROLLBACK 2x, DANE, PONOWNA MIGRACJA (app_owner) --------------------------------
select tests.note('jobs_rows', (select count(*)::text from public.music_generation_jobs));
select tests.note('pv_rows', (select count(*)::text from public.prompt_versions));
\ir ai_studio_jobs_v1.rollback.sql
\ir ai_studio_jobs_v1.rollback.sql
select tests.check_state('M01 rollback 2x = stan sprzed migracji (schemat, ACL, polityki, funkcje, publikacja)', 'before');
select tests.ok('M02 rollback zachowuje wiersze jobs i prompt_versions',
  (select count(*)::text from public.music_generation_jobs) = tests.val('jobs_rows')
  and (select count(*)::text from public.prompt_versions) = tests.val('pv_rows'));
\ir ai_studio_jobs_v1.sql
select tests.check_state('M03 ponowna migracja po rollbacku = stan po pierwszej migracji', 'after_1');

-- 9. WYNIK ------------------------------------------------------------------------
\echo '=== WYNIK ==='
select status || ' ' || count(*) from tests.results group by status order by status;
select 'FAIL: ' || name || ' :: ' || coalesce(detail, '') from tests.results where status = 'FAIL' order by n;
select 'SKIP: ' || name || ' :: ' || coalesce(detail, '') from tests.results where status = 'SKIP' order by n;
select 'ŁĄCZNIE ' || count(*) || ' / oczekiwano ' || tests.expected_total() from tests.results;
do $$
declare v_total integer; v_fail integer;
begin
  select count(*), count(*) filter (where status = 'FAIL') into v_total, v_fail from tests.results;
  if v_fail > 0 then
    raise exception 'TESTY: % FAIL', v_fail;
  end if;
  if v_total <> tests.expected_total() then
    raise exception 'TESTY: oczekiwano %, zarejestrowano %', tests.expected_total(), v_total;
  end if;
end $$;
\echo 'WYNIK: OK'
