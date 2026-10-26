-- =====================================================================
-- PIENHS CULT OS / AI Studio MVP
-- Stan produkcji PRZED migracją ai_studio_jobs_v1
-- Źródło: phonklife's Project (rfkngzzqnuejiawshwoz), odczyt 2026-10-16.
-- Obiekty: set_updated_at, projects, prompt_versions, music_generation_jobs.
-- Zgodność z produkcją: prod_parity.sql = prod_state_2026-10-16.txt (REVIEW.md, sekcja 4).
-- Wymaga: schemat auth (auth.users, auth.uid()) i domyślne ACL Supabase roli wykonującej.
-- Używają: ai_studio_jobs_v1.tests.sql (replika, PostgreSQL 16/17) oraz
--          supabase_audit/run_supabase_audit.sh (lokalny stos Supabase).
-- NIE uruchamiać na produkcji (obiekty już tam istnieją).
-- =====================================================================
create function public.set_updated_at() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) >= 1 and char_length(title) <= 120),
  description text,
  status text not null default 'draft' check (status = any (array['draft', 'active', 'archived'])),
  primary_genre text,
  fusion_genres text[] not null default '{}',
  moods text[] not null default '{}',
  target_bpm integer check (target_bpm >= 40 and target_bpm <= 240),
  musical_key text,
  language text,
  concept jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_id_updated_at_idx on public.projects (user_id, updated_at desc);
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
alter table public.projects enable row level security;
revoke all on table public.projects from anon;
create policy projects_select_own on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy projects_insert_own on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy projects_update_own on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy projects_delete_own on public.projects for delete to authenticated using ((select auth.uid()) = user_id);

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  prompt_text text not null check (char_length(prompt_text) >= 1 and char_length(prompt_text) <= 12000),
  negative_prompt text,
  structure jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  vocal_instructions jsonb not null default '[]'::jsonb,
  production_notes jsonb not null default '[]'::jsonb,
  model_name text,
  generation_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, version_number)
);
create index prompt_versions_project_id_created_at_idx on public.prompt_versions (project_id, created_at desc);
create index prompt_versions_user_id_idx on public.prompt_versions (user_id);
alter table public.prompt_versions enable row level security;
revoke all on table public.prompt_versions from anon;
create policy prompt_versions_select_own on public.prompt_versions for select to authenticated using ((select auth.uid()) = user_id);
create policy prompt_versions_insert_own on public.prompt_versions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy prompt_versions_update_own on public.prompt_versions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy prompt_versions_delete_own on public.prompt_versions for delete to authenticated using ((select auth.uid()) = user_id);

-- migracja produkcyjna create_music_generation_jobs (20261016005242), 1:1
create table if not exists public.music_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  request_id uuid not null,
  working_title text not null check (char_length(working_title) between 1 and 120),
  idea text not null check (char_length(idea) between 1 and 5000),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  input_payload jsonb not null default '{}'::jsonb,
  result_prompt_version_id uuid references public.prompt_versions(id) on delete set null,
  output_description text,
  output_tags text[] not null default '{}',
  error_code text,
  attempts integer not null default 0 check (attempts >= 0),
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, request_id)
);
create index if not exists music_generation_jobs_user_created_idx
  on public.music_generation_jobs (user_id, created_at desc);
create index if not exists music_generation_jobs_status_created_idx
  on public.music_generation_jobs (status, created_at);
alter table public.music_generation_jobs enable row level security;
drop policy if exists "Users can read their own music generation jobs"
  on public.music_generation_jobs;
create policy "Users can read their own music generation jobs"
  on public.music_generation_jobs
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
comment on table public.music_generation_jobs is
  'Tracks PIENHS CULT AI Studio generation requests, status, and notification state.';
