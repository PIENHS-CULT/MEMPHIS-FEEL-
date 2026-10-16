-- PIENHS CULT OS / AI Studio MVP — ai_studio_jobs_v1: kontrola zgodności z produkcją
-- TYLKO ODCZYT katalogów (bez danych, bez zmian). Zakres: obiekty objęte migracją.
-- Użycie:
--   1. Produkcja (SQL Editor lub execute_sql jako postgres), search_path domyślna:
--      "$user", public, extensions. Wynik porównać z prod_state_2026-10-16.txt:
--      identyczny = brak dryfu od dnia przeglądu (warunek wdrożenia).
--   2. Replika harnessu (stan "przed", po rollbacku) z tą samą search_path,
--      rola app_owner zamieniona na postgres: różnice opisane w REVIEW.md, sekcja 4.
with t as (
  select c.oid, c.relname from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and c.relname in ('projects', 'prompt_versions', 'music_generation_jobs', 'music_generation_job_tokens')
), f as (
  select p.oid from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and (p.proname = 'set_updated_at' or p.proname like 'mgj\_%')
)
select string_agg(x, E'\n' order by x) as state from (
  select 'tbl ' || c.relname || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity || ' owner=' || pg_catalog.pg_get_userbyid(c.relowner) as x
    from pg_catalog.pg_class c join t on t.oid = c.oid
  union all
  select 'acl ' || c.relname || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type
    from pg_catalog.pg_class c join t on t.oid = c.oid cross join lateral pg_catalog.aclexplode(c.relacl) a
  union all
  select 'colacl ' || c.relname || '.' || att.attname || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type
    from pg_catalog.pg_class c join t on t.oid = c.oid
    join pg_catalog.pg_attribute att on att.attrelid = c.oid
    cross join lateral pg_catalog.aclexplode(att.attacl) a
   where att.attacl is not null
  union all
  select 'col ' || c.relname || '.' || att.attname || ' ' || pg_catalog.format_type(att.atttypid, att.atttypmod)
         || ' nn=' || att.attnotnull || ' def=' || coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '-')
    from pg_catalog.pg_class c join t on t.oid = c.oid
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = att.attnum
  union all
  select 'con ' || t.relname || ' ' || c.conname || ' ' || pg_catalog.pg_get_constraintdef(c.oid)
    from pg_catalog.pg_constraint c join t on t.oid = c.conrelid
  union all
  select 'idx ' || i.indexdef from pg_catalog.pg_indexes i join t on t.relname = i.tablename where i.schemaname = 'public'
  union all
  select 'trg ' || pg_catalog.pg_get_triggerdef(tg.oid) || ' enabled=' || tg.tgenabled::text
    from pg_catalog.pg_trigger tg join t on t.oid = tg.tgrelid where not tg.tgisinternal
  union all
  select 'pol ' || p.tablename || ' ' || p.policyname || ' ' || p.permissive || ' ' || p.cmd || ' '
         || pg_catalog.array_to_string(p.roles, ',') || ' ' || coalesce(p.qual, '-') || ' ' || coalesce(p.with_check, '-')
    from pg_catalog.pg_policies p join t on t.relname = p.tablename where p.schemaname = 'public'
  union all
  select 'fn ' || p.oid::regprocedure::text || ' secdef=' || p.prosecdef || ' owner=' || pg_catalog.pg_get_userbyid(p.proowner)
         || ' cfg=' || coalesce(pg_catalog.array_to_string(p.proconfig, ';'), '-') || ' src=' || pg_catalog.md5(p.prosrc)
    from pg_catalog.pg_proc p join f on f.oid = p.oid
  union all
  select 'fnacl ' || p.oid::regprocedure::text || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type
    from pg_catalog.pg_proc p join f on f.oid = p.oid
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  union all
  select 'pub ' || pt.pubname || ' ' || pt.tablename
    from pg_catalog.pg_publication_tables pt join t on t.relname = pt.tablename where pt.schemaname = 'public'
  union all
  select 'pubown ' || p.pubname || ' ' || pg_catalog.pg_get_userbyid(p.pubowner) || ' alltables=' || p.puballtables
    from pg_catalog.pg_publication p where p.pubname = 'supabase_realtime'
  union all
  select 'cmt ' || c.relname || ' ' || coalesce(pg_catalog.obj_description(c.oid, 'pg_class'), '-')
    from pg_catalog.pg_class c join t on t.oid = c.oid
  union all
  select 'cmt ' || p.oid::regprocedure::text || ' ' || coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '-')
    from pg_catalog.pg_proc p join f on f.oid = p.oid
  union all
  select 'dacl ' || coalesce(n.nspname, '*') || ' ' || d.defaclobjtype::text || ' '
         || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type
    from pg_catalog.pg_default_acl d
    left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
   where d.defaclrole = current_user::regrole and (n.nspname = 'public' or d.defaclnamespace = 0)
  union all
  select 'evt ' || e.evtname || ' ' || e.evtevent || ' ' || e.evtfoid::regprocedure::text || ' enabled=' || e.evtenabled::text
    from pg_catalog.pg_event_trigger e
  union all
  select 'role ' || current_user || ' super=' || r.rolsuper || ' bypassrls=' || r.rolbypassrls
    from pg_catalog.pg_roles r where r.rolname = current_user
) s;
