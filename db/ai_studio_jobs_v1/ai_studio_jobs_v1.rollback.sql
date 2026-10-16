-- =====================================================================
-- PIENHS CULT OS / AI Studio MVP
-- ROLLBACK migracji ai_studio_jobs_v1                  STATUS: DRAFT
-- Cel: phonklife's Project (rfkngzzqnuejiawshwoz)
-- Przywraca stan sprzed migracji (2026-10-16), łącznie z pierwotnymi
-- politykami prompt_versions. Idempotentny. Uruchamiać tylko przy
-- wycofaniu; usuwa tokeny i kolumny dispatched_at / completed_at.
-- =====================================================================

-- 1. Realtime
do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'music_generation_jobs'
  ) then
    alter publication supabase_realtime drop table public.music_generation_jobs;
  end if;
end;
$$;

-- 2. Funkcje backendu
drop function if exists public.mgj_fail(uuid, text, text);
drop function if exists public.mgj_complete(uuid, text, jsonb);
drop function if exists public.mgj_dispatch(uuid, text);
drop function if exists public.mgj_create(uuid, uuid, uuid, text, text, jsonb);

-- 3. Tokeny
drop table if exists public.music_generation_job_tokens;

-- 4. music_generation_jobs: polityka, uprawnienia, trigger, indeksy, kolumny
drop policy if exists "Users can mark own jobs notified" on public.music_generation_jobs;
revoke update (notified_at) on table public.music_generation_jobs from authenticated;
grant all on table public.music_generation_jobs to anon, authenticated;
drop trigger if exists music_generation_jobs_set_updated_at on public.music_generation_jobs;
drop index if exists public.music_generation_jobs_project_id_idx;
drop index if exists public.music_generation_jobs_result_prompt_version_id_idx;
alter table public.music_generation_jobs
  drop column if exists dispatched_at,
  drop column if exists completed_at;

-- 5. prompt_versions: pierwotne uprawnienia i polityki (harden_user_rls_authz)
grant insert, update on table public.prompt_versions to authenticated;

drop policy if exists prompt_versions_insert_own on public.prompt_versions;
create policy prompt_versions_insert_own on public.prompt_versions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists prompt_versions_update_own on public.prompt_versions;
create policy prompt_versions_update_own on public.prompt_versions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
