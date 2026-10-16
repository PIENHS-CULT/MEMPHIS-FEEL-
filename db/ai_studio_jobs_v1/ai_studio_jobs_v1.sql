-- =====================================================================
-- PIENHS CULT OS / AI Studio MVP
-- Migracja: ai_studio_jobs_v1                      (rewizja 2026-10-16b)
-- Cel:      phonklife's Project (rfkngzzqnuejiawshwoz), PostgreSQL 17.6
-- Wykonuje: rola postgres (właściciel obiektów, NOSUPERUSER, BYPASSRLS)
-- Testy:    ai_studio_jobs_v1.tests.sql (harness v2), PG 16 i 17.6.
-- Idempotentna. Rollback: ai_studio_jobs_v1.rollback.sql.
-- Skutek uboczny (zamierzony): generate-music-prompt v1 traci prawo
-- zapisu do prompt_versions (zapis wersji wyłącznie przez backend).
-- =====================================================================

-- 1. music_generation_jobs: znaczniki cyklu życia ---------------------
alter table public.music_generation_jobs
  add column if not exists dispatched_at timestamptz,
  add column if not exists completed_at timestamptz;

-- 2. Indeksy kluczy obcych (advisor: unindexed_foreign_keys) -----------
create index if not exists music_generation_jobs_project_id_idx
  on public.music_generation_jobs (project_id);
create index if not exists music_generation_jobs_result_prompt_version_id_idx
  on public.music_generation_jobs (result_prompt_version_id);

-- 3. updated_at (istniejąca funkcja public.set_updated_at) --------------
drop trigger if exists music_generation_jobs_set_updated_at
  on public.music_generation_jobs;
create trigger music_generation_jobs_set_updated_at
  before update on public.music_generation_jobs
  for each row execute function public.set_updated_at();

-- 4. Jednorazowe tokeny callbacku: tylko service_role -------------------
create table if not exists public.music_generation_job_tokens (
  job_id uuid primary key
    references public.music_generation_jobs (id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.music_generation_job_tokens enable row level security;
revoke all on table public.music_generation_job_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.music_generation_job_tokens to service_role;
comment on table public.music_generation_job_tokens is
  'SHA-256 of per-job callback tokens. Service role only. Plain tokens are never stored.';

-- 5. Uprawnienia music_generation_jobs ----------------------------------
--    klient: SELECT własnych wierszy (polityka istnieje) + UPDATE(notified_at)
revoke all on table public.music_generation_jobs from anon, authenticated;
grant select on table public.music_generation_jobs to authenticated;
grant update (notified_at) on table public.music_generation_jobs to authenticated;

drop policy if exists "Users can mark own jobs notified" on public.music_generation_jobs;
create policy "Users can mark own jobs notified"
  on public.music_generation_jobs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 6. prompt_versions: wersje tworzy wyłącznie backend; brak edycji ------
--    (zamyka wstawianie wersji do cudzego projektu i wyścig numeracji)
revoke insert, update on table public.prompt_versions from authenticated;
drop policy if exists prompt_versions_insert_own on public.prompt_versions;
drop policy if exists prompt_versions_update_own on public.prompt_versions;

-- 7. Realtime: status jobów do panelu (RLS filtruje po użytkowniku) -----
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'music_generation_jobs'
  ) then
    alter publication supabase_realtime add table public.music_generation_jobs;
  end if;
end;
$$;

-- 8. Funkcje backendu: SECURITY INVOKER, wywołuje wyłącznie service_role -

-- 8a. Utworzenie joba: idempotencja, własność projektu, limity, sweep
create or replace function public.mgj_create(
  p_user_id uuid,
  p_project_id uuid,
  p_request_id uuid,
  p_working_title text,
  p_idea text,
  p_input jsonb default '{}'::jsonb
)
returns public.music_generation_jobs
language plpgsql
set search_path = ''
as $$
declare
  c_max_active    constant integer  := 2;
  c_max_per_hour  constant integer  := 10;
  c_max_per_month constant integer  := 80;
  c_stale         constant interval := interval '10 minutes';
  v_job   public.music_generation_jobs;
  v_count integer;
begin
  if p_user_id is null or p_project_id is null or p_request_id is null
     or p_working_title is null or char_length(p_working_title) not between 1 and 120
     or btrim(p_working_title, E' \t\r\n') = ''
     or p_idea is null or char_length(p_idea) not between 1 and 5000
     or btrim(p_idea, E' \t\r\n') = ''
     or p_input is null or jsonb_typeof(p_input) <> 'object'
     or octet_length(p_input::text) > 8192 then
    raise exception 'mgj_invalid_input' using errcode = '22023';
  end if;

  -- serializacja per użytkownik (idempotencja + limity bez wyścigów)
  perform pg_advisory_xact_lock(hashtextextended('mgj:' || p_user_id::text, 0));

  select * into v_job
    from public.music_generation_jobs
   where user_id = p_user_id and request_id = p_request_id;
  if found then
    return v_job;
  end if;

  perform 1 from public.projects where id = p_project_id and user_id = p_user_id;
  if not found then
    raise exception 'mgj_project_not_found' using errcode = 'P0002';
  end if;

  -- joby bez wyniku po c_stale -> failed/timeout
  update public.music_generation_jobs
     set status = 'failed', error_code = 'timeout', completed_at = now()
   where user_id = p_user_id
     and status in ('queued', 'processing')
     and coalesce(dispatched_at, created_at) < now() - c_stale;

  select count(*) into v_count from public.music_generation_jobs
   where user_id = p_user_id and status in ('queued', 'processing');
  if v_count >= c_max_active then
    raise exception 'mgj_limit_active' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.music_generation_jobs
   where user_id = p_user_id and created_at > now() - interval '1 hour';
  if v_count >= c_max_per_hour then
    raise exception 'mgj_limit_hour' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.music_generation_jobs
   where user_id = p_user_id and created_at >= date_trunc('month', now());
  if v_count >= c_max_per_month then
    raise exception 'mgj_limit_month' using errcode = 'P0001';
  end if;

  insert into public.music_generation_jobs
    (user_id, project_id, request_id, working_title, idea, input_payload)
  values
    (p_user_id, p_project_id, p_request_id, p_working_title, p_idea, p_input)
  returning * into v_job;

  return v_job;
end;
$$;

-- 8b. Wysyłka: queued -> processing, zapis hasha jednorazowego tokenu
create or replace function public.mgj_dispatch(p_job_id uuid, p_token_hash text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'mgj_invalid_token' using errcode = '22023';
  end if;

  select status into v_status
    from public.music_generation_jobs
   where id = p_job_id
   for update;
  if not found then
    raise exception 'mgj_job_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'queued' then
    raise exception 'mgj_invalid_state' using errcode = 'P0001';
  end if;

  insert into public.music_generation_job_tokens (job_id, token_hash)
  values (p_job_id, p_token_hash)
  on conflict (job_id) do update
    set token_hash = excluded.token_hash, created_at = now();

  update public.music_generation_jobs
     set status = 'processing',
         dispatched_at = now(),
         attempts = attempts + 1,
         error_code = null
   where id = p_job_id;
end;
$$;

-- 8c. Wynik AI: walidacja, wersja pod blokadą projektu, zamknięcie joba
create or replace function public.mgj_complete(
  p_job_id uuid,
  p_token_hash text,
  p_result jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_job     public.music_generation_jobs;
  v_hash    text;
  v_version integer;
  v_pv_id   uuid;
  v_tags    text[];
begin
  select * into v_job
    from public.music_generation_jobs
   where id = p_job_id
   for update;
  if not found then
    raise exception 'mgj_job_not_found' using errcode = 'P0002';
  end if;

  select token_hash into v_hash
    from public.music_generation_job_tokens
   where job_id = p_job_id;
  if v_hash is null or p_token_hash is null or v_hash <> p_token_hash then
    raise exception 'mgj_invalid_token' using errcode = '28000';
  end if;

  if v_job.status = 'completed' then
    return v_job.result_prompt_version_id;          -- powtórka callbacku
  end if;
  if not (v_job.status = 'processing'
          or (v_job.status = 'failed' and v_job.error_code = 'timeout')) then
    raise exception 'mgj_invalid_state' using errcode = 'P0001';
  end if;

  -- typy (każdy krok osobno: brak zależności od kolejności ewaluacji)
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'mgj_invalid_result' using errcode = '22023';
  end if;
  if jsonb_typeof(p_result -> 'prompt') is distinct from 'string'
     or jsonb_typeof(p_result -> 'description') is distinct from 'string'
     or jsonb_typeof(p_result -> 'tags') is distinct from 'array'
     or coalesce(jsonb_typeof(p_result -> 'negativePrompt'), 'string') <> 'string'
     or coalesce(jsonb_typeof(p_result -> 'structure'), 'array') <> 'array'
     or coalesce(jsonb_typeof(p_result -> 'vocalInstructions'), 'array') <> 'array'
     or coalesce(jsonb_typeof(p_result -> 'productionNotes'), 'array') <> 'array'
     or coalesce(jsonb_typeof(p_result -> 'model'), 'string') <> 'string' then
    raise exception 'mgj_invalid_result' using errcode = '22023';
  end if;
  -- rozmiary i treść
  if char_length(p_result ->> 'prompt') not between 1 and 12000
     or btrim(p_result ->> 'prompt', E' \t\r\n') = ''
     or char_length(p_result ->> 'description') not between 1 and 2000
     or btrim(p_result ->> 'description', E' \t\r\n') = ''
     or char_length(coalesce(p_result ->> 'negativePrompt', '')) > 2000
     or jsonb_array_length(p_result -> 'tags') not between 1 and 30
     or jsonb_array_length(coalesce(p_result -> 'structure', '[]'::jsonb)) > 40
     or jsonb_array_length(coalesce(p_result -> 'vocalInstructions', '[]'::jsonb)) > 40
     or jsonb_array_length(coalesce(p_result -> 'productionNotes', '[]'::jsonb)) > 40
     or octet_length(p_result::text) > 65536 then
    raise exception 'mgj_invalid_result' using errcode = '22023';
  end if;
  -- elementy: tags[] = string 1..40
  if exists (
    select 1 from jsonb_array_elements(p_result -> 'tags') as t(v)
     where jsonb_typeof(t.v) <> 'string'
        or char_length(t.v #>> '{}') not between 1 and 40
  ) then
    raise exception 'mgj_invalid_result' using errcode = '22023';
  end if;
  -- elementy: structure[] = {section: string 1..80, description: string 1..1000}
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_result -> 'structure', '[]'::jsonb)) as s(v)
     where jsonb_typeof(s.v) <> 'object'
        or jsonb_typeof(s.v -> 'section') is distinct from 'string'
        or jsonb_typeof(s.v -> 'description') is distinct from 'string'
  ) then
    raise exception 'mgj_invalid_result' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_result -> 'structure', '[]'::jsonb)) as s(v)
     where char_length(s.v ->> 'section') not between 1 and 80
        or char_length(s.v ->> 'description') not between 1 and 1000
  ) then
    raise exception 'mgj_invalid_result' using errcode = '22023';
  end if;
  -- elementy: vocalInstructions[] i productionNotes[] = string 1..500
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_result -> 'vocalInstructions', '[]'::jsonb)) as t(v)
     where jsonb_typeof(t.v) <> 'string'
        or char_length(t.v #>> '{}') not between 1 and 500
    union all
    select 1 from jsonb_array_elements(coalesce(p_result -> 'productionNotes', '[]'::jsonb)) as t(v)
     where jsonb_typeof(t.v) <> 'string'
        or char_length(t.v #>> '{}') not between 1 and 500
  ) then
    raise exception 'mgj_invalid_result' using errcode = '22023';
  end if;

  select array_agg(t.v #>> '{}' order by t.ord) into v_tags
    from jsonb_array_elements(p_result -> 'tags') with ordinality as t(v, ord);

  -- numer wersji: blokada wiersza projektu serializuje równoległe zapisy
  perform 1 from public.projects where id = v_job.project_id for update;
  select coalesce(max(version_number), 0) + 1 into v_version
    from public.prompt_versions
   where project_id = v_job.project_id;

  insert into public.prompt_versions (
    project_id, user_id, version_number, prompt_text, negative_prompt,
    structure, tags, vocal_instructions, production_notes,
    model_name, generation_metadata
  ) values (
    v_job.project_id, v_job.user_id, v_version,
    p_result ->> 'prompt',
    nullif(p_result ->> 'negativePrompt', ''),
    coalesce(p_result -> 'structure', '[]'::jsonb),
    v_tags,
    coalesce(p_result -> 'vocalInstructions', '[]'::jsonb),
    coalesce(p_result -> 'productionNotes', '[]'::jsonb),
    left(p_result ->> 'model', 120),
    jsonb_build_object('provider', 'make', 'job_id', v_job.id)
  )
  returning id into v_pv_id;

  update public.music_generation_jobs
     set status = 'completed',
         completed_at = now(),
         result_prompt_version_id = v_pv_id,
         output_description = p_result ->> 'description',
         output_tags = v_tags,
         error_code = null
   where id = p_job_id;

  return v_pv_id;
end;
$$;

-- 8d. Błąd: z tokenem (Make) albo bez (backend: dispatch_failed itp.)
create or replace function public.mgj_fail(
  p_job_id uuid,
  p_error_code text,
  p_token_hash text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_hash   text;
  v_code   text := coalesce(nullif(p_error_code, ''), 'unknown');
begin
  if v_code !~ '^[a-z0-9_]{1,64}$' then
    v_code := 'unknown';
  end if;

  select status into v_status
    from public.music_generation_jobs
   where id = p_job_id
   for update;
  if not found then
    raise exception 'mgj_job_not_found' using errcode = 'P0002';
  end if;

  if p_token_hash is not null then
    select token_hash into v_hash
      from public.music_generation_job_tokens
     where job_id = p_job_id;
    if v_hash is distinct from p_token_hash then
      raise exception 'mgj_invalid_token' using errcode = '28000';
    end if;
  end if;

  if v_status in ('completed', 'failed') then
    return;                                         -- job zamknięty
  end if;

  update public.music_generation_jobs
     set status = 'failed', error_code = v_code, completed_at = now()
   where id = p_job_id;
end;
$$;

-- 9. EXECUTE wyłącznie service_role ------------------------------------
revoke all on function public.mgj_create(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.mgj_dispatch(uuid, text)                        from public, anon, authenticated;
revoke all on function public.mgj_complete(uuid, text, jsonb)                 from public, anon, authenticated;
revoke all on function public.mgj_fail(uuid, text, text)                      from public, anon, authenticated;
grant execute on function public.mgj_create(uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.mgj_dispatch(uuid, text)                        to service_role;
grant execute on function public.mgj_complete(uuid, text, jsonb)                 to service_role;
grant execute on function public.mgj_fail(uuid, text, text)                      to service_role;

comment on function public.mgj_create(uuid, uuid, uuid, text, text, jsonb) is
  'AI Studio: create job (idempotent per user+request_id, ownership check, non-blank title/idea, limits 2 active / 10 per hour / 80 per month UTC, stale sweep 10 min). Service role only.';
comment on function public.mgj_dispatch(uuid, text) is
  'AI Studio: queued -> processing, stores SHA-256 of one-time callback token. Service role only.';
comment on function public.mgj_complete(uuid, text, jsonb) is
  'AI Studio: validate AI result (types, sizes, items), insert prompt_versions under project lock, close job. Idempotent replay; late result after timeout accepted. Service role only.';
comment on function public.mgj_fail(uuid, text, text) is
  'AI Studio: mark job failed (token required for Make callbacks). Error code sanitized. Service role only.';
