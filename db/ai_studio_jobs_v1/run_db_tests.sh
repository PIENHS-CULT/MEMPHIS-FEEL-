#!/usr/bin/env bash
# PIENHS CULT OS / AI Studio MVP — runner testów migracji ai_studio_jobs_v1
# Wymaga: psql oraz połączenia superusera do JEDNORAZOWEJ instancji PostgreSQL 16/17
# (zmienne PGHOST, PGPORT, PGUSER). Role testowe (anon, authenticated, service_role,
# authenticator, app_owner) są globalne dla klastra i zostaną usunięte, dlatego
# wymagane jest ALLOW_ROLE_RESET=1. Nigdy nie wskazywać bazy produkcyjnej.
#
# Faza 1: harness SQL (ai_studio_jobs_v1.tests.sql) — 127 testów, exit 3 przy FAIL.
# Faza 2: testy współbieżności (2 sesje): numeracja wersji, replay request_id,
#         limit aktywnych jobów. Kolejność sesji wymuszona przez pg_stat_activity;
#         osobny użytkownik i projekt na test.
set -euo pipefail

if [[ "${ALLOW_ROLE_RESET:-}" != "1" ]]; then
  echo "Odmowa: ustaw ALLOW_ROLE_RESET=1 (tylko jednorazowa instancja testowa)." >&2
  exit 2
fi

cd "$(dirname "$0")"
DB="${TEST_DB:-ai_studio_test}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -d postgres \
  -c "drop database if exists ${DB}" \
  -c "drop role if exists authenticator" \
  -c "drop role if exists service_role" \
  -c "drop role if exists authenticated" \
  -c "drop role if exists anon" \
  -c "drop role if exists app_owner" \
  -c "create database ${DB}"

echo "# serwer: PostgreSQL $("${PSQL[@]}" -d "${DB}" -Atc 'show server_version')"
echo "# sha256: $(sha256sum ai_studio_jobs_v1.sql | cut -c1-16) migracja | $(sha256sum ai_studio_jobs_v1.rollback.sql | cut -c1-16) rollback | $(sha256sum ai_studio_jobs_v1.tests.sql | cut -c1-16) testy | $(sha256sum baseline_prod_2026-10-16.sql | cut -c1-16) baseline | $(sha256sum "$(basename "$0")" | cut -c1-16) runner"

# ---- Faza 1 --------------------------------------------------------------------
"${PSQL[@]}" -d "${DB}" -f ai_studio_jobs_v1.tests.sql

# ---- Faza 2: współbieżność ---------------------------------------------------------
echo "=== WSPÓŁBIEŻNOŚĆ ==="
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
SU=("${PSQL[@]}" -At -d "${DB}")
AU=("${PSQL[@]}" -At -d "${DB}" -U authenticator)
OW=("${PSQL[@]}" -At -d "${DB}" -U app_owner)
fails=0
passes=0

check() {
  if [[ "$2" == "$3" ]]; then
    echo "PASS $1"; passes=$((passes + 1))
  else
    echo "FAIL $1 :: oczekiwano [$3], jest [$2]"; fails=$((fails + 1))
  fi
}
rc() { [[ "$(cat "$1")" == "0" ]] && echo 0 || echo 1; }
# Sesja A: wykonuje $1 w transakcji i trzyma blokady 2 s; sesja B startuje dopiero,
# gdy A jest w pg_sleep (czyli po wykonaniu funkcji). Wynik: pliki $2a.* i $2b.*.
# $2.sync = sync, gdy punkt synchronizacji osiągnięty (inaczej test = FAIL, bo
# przebieg sekwencyjny nie dowodzi niczego o współbieżności).
race() {
  local sql_a="$1" tag="$2" sql_b="$3"
  (
    if "${AU[@]}" -c "begin" -c "set local role service_role" -c "${sql_a}" -c "select pg_sleep(2)" -c "commit" \
         > "${TMP}/${tag}a.out" 2>&1; then
      echo 0 > "${TMP}/${tag}a.rc"
    else
      echo 1 > "${TMP}/${tag}a.rc"
    fi
  ) &
  echo nosync > "${TMP}/${tag}.sync"
  for _ in $(seq 1 100); do
    if [[ "$("${SU[@]}" -c "select count(*) from pg_stat_activity where datname = current_database() and state = 'active' and query = 'select pg_sleep(2)'")" == "1" ]]; then
      echo sync > "${TMP}/${tag}.sync"; break
    fi
    sleep 0.1
  done
  if "${AU[@]}" -c "set role service_role" -c "${sql_b}" > "${TMP}/${tag}b.out" 2>&1; then
    echo 0 > "${TMP}/${tag}b.rc"
  else
    echo 1 > "${TMP}/${tag}b.rc"
  fi
  wait
}

# Każdy test współbieżności ma własnego użytkownika i projekt (sufiksy 2a, 2b, 2c):
# błąd jednego testu nie zmienia stanu wejściowego kolejnych.
uid() { echo "00000000-0000-0000-0000-0000000000$1"; }
pid() { echo "10000000-0000-0000-0000-0000000000$1"; }
fixture() {
  "${SU[@]}" -c "insert into auth.users (id, email) values ('$(uid "$1")', 'user_$1@test.local')"
  "${OW[@]}" -c "insert into public.projects (id, user_id, title) values ('$(pid "$1")', '$(uid "$1")', 'Projekt $1')"
}
svc() { "${AU[@]}" -c "set role service_role" "$@"; }

# P1: dwa joby w jednym projekcie kończą się równocześnie.
fixture 2a
J1=$(svc -c "select id from public.mgj_create('$(uid 2a)', '$(pid 2a)', gen_random_uuid(), 'P1a', 'P1a', '{}')")
J2=$(svc -c "select id from public.mgj_create('$(uid 2a)', '$(pid 2a)', gen_random_uuid(), 'P1b', 'P1b', '{}')")
svc -c "select public.mgj_dispatch('${J1}', repeat('c', 64))" \
    -c "select public.mgj_dispatch('${J2}', repeat('d', 64))" > /dev/null
race "select public.mgj_complete('${J1}', repeat('c', 64), tests.good())" p1 \
     "select public.mgj_complete('${J2}', repeat('d', 64), tests.good())"
V=$("${OW[@]}" -c "select string_agg(version_number::text, ',' order by version_number) from public.prompt_versions where project_id = '$(pid 2a)'")
check "P1 współbieżne mgj_complete w jednym projekcie -> wersje 1,2 bez błędu" "$(cat "${TMP}/p1.sync"):$(rc "${TMP}/p1a.rc")$(rc "${TMP}/p1b.rc"):${V}" "sync:00:1,2"

# P2: ten sam request_id w dwóch sesjach.
fixture 2b
R=$("${SU[@]}" -c "select gen_random_uuid()")
race "select id from public.mgj_create('$(uid 2b)', '$(pid 2b)', '${R}', 'P2', 'P2', '{}')" p2 \
     "select id from public.mgj_create('$(uid 2b)', '$(pid 2b)', '${R}', 'P2', 'P2', '{}')"
IDA=$(grep -Eo '^[0-9a-f-]{36}$' "${TMP}/p2a.out" || true)
IDB=$(grep -Eo '^[0-9a-f-]{36}$' "${TMP}/p2b.out" || true)
N=$("${OW[@]}" -c "select count(*) from public.music_generation_jobs where user_id = '$(uid 2b)'")
SAME=$([[ -n "${IDA}" && "${IDA}" == "${IDB}" ]] && echo same || echo diff)
check "P2 współbieżny replay request_id -> jeden wiersz, ten sam id" "$(cat "${TMP}/p2.sync"):$(rc "${TMP}/p2a.rc")$(rc "${TMP}/p2b.rc"):${SAME}:${N}" "sync:00:same:1"

# P3: 1 job aktywny, dwie sesje walczą o ostatni wolny slot (limit 2).
fixture 2c
svc -c "select id from public.mgj_create('$(uid 2c)', '$(pid 2c)', gen_random_uuid(), 'P3-0', 'P3-0', '{}')" > /dev/null
race "select id from public.mgj_create('$(uid 2c)', '$(pid 2c)', gen_random_uuid(), 'P3a', 'P3a', '{}')" p3 \
     "select id from public.mgj_create('$(uid 2c)', '$(pid 2c)', gen_random_uuid(), 'P3b', 'P3b', '{}')"
ACT=$("${OW[@]}" -c "select count(*) from public.music_generation_jobs where user_id = '$(uid 2c)' and status in ('queued', 'processing')")
ERR=$(grep -o 'mgj_limit_active' "${TMP}/p3b.out" | head -1 || true)
check "P3 współbieżny limit aktywnych -> 2 aktywne, druga sesja odrzucona" "$(cat "${TMP}/p3.sync"):$(rc "${TMP}/p3a.rc")$(rc "${TMP}/p3b.rc"):${ERR}:${ACT}" "sync:01:mgj_limit_active:2"

echo "WSPÓŁBIEŻNOŚĆ: PASS ${passes} / FAIL ${fails}"
[[ "${fails}" -eq 0 ]] || exit 1
echo "RUNNER: OK"
