#!/usr/bin/env bash
# PIENHS CULT OS / AI Studio MVP — audyt ai_studio_jobs_v1 na lokalnym stosie Supabase.
# Środowisko: Supabase CLI (supabase start w tym katalogu) — obrazy platformy: PostgreSQL 17.6,
# PostgREST, GoTrue, Realtime. Nie dotyka żadnego projektu Supabase.
# Wymaga: działającego stosu, psql, node 22 i zależności (npm ci).
#
#   A  baseline (stan produkcji) -> prod_parity.sql "przed" = prod_state_2026-10-16.txt
#      (obiekty migracji, rola wykonująca, domyślne ACL, event triggery)
#   B  migracja 2x jako postgres (idempotencja)
#   C  testy API: PostgREST z JWT, Auth, Realtime z RLS (api_audit.mjs)
#   D  rollback 2x -> stan = "przed", wiersze zachowane; ponowna migracja -> stan = "po"
set -euo pipefail
cd "$(dirname "$0")"
DBDIR=..
OUT="${OUT_DIR:-out}"
mkdir -p "${OUT}"
passes=0
fails=0
check() {
  if [[ "$2" == "0" ]]; then
    echo "PASS $1"; passes=$((passes + 1))
  else
    echo "FAIL $1"; fails=$((fails + 1))
  fi
}

# Dane połączenia ze stosu (klucze lokalne nie trafiają do logów ani artefaktów).
STATUS="$(supabase status -o env --workdir .)"
get() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" <<< "${STATUS}" | head -1; }
DB_URL="$(get DB_URL)"
API_URL="$(get API_URL)"
ANON_KEY="$(get ANON_KEY)"; [[ -n "${ANON_KEY}" ]] || ANON_KEY="$(get PUBLISHABLE_KEY)"
SERVICE_KEY="$(get SERVICE_ROLE_KEY)"; [[ -n "${SERVICE_KEY}" ]] || SERVICE_KEY="$(get SECRET_KEY)"
unset STATUS
[[ -n "${DB_URL}" && -n "${API_URL}" && -n "${ANON_KEY}" && -n "${SERVICE_KEY}" ]] || { echo "Brak danych stosu (supabase status)." >&2; exit 2; }

PSQL=(psql -X -q -v ON_ERROR_STOP=1 "${DB_URL}")
SP='set search_path = "$user", public, extensions'
parity() { "${PSQL[@]}" -At -c "${SP}" -f "${DBDIR}/prod_parity.sql" > "$1"; }
# same TEST PLIK_A PLIK_B [REGEX_WIERSZY]: identyczne zbiory wierszy, inaczej FAIL z diffem.
same() {
  local re="${4:-.}"
  if diff <(grep -E "${re}" "$2" | sort) <(grep -E "${re}" "$3" | sort) > "${OUT}/diff.tmp"; then
    check "$1" 0
  else
    check "$1" 1
    sed 's/^/    /' "${OUT}/diff.tmp" | head -80
  fi
}
run_sql() {  # run_sql TEST PLIK LOG
  if "${PSQL[@]}" -f "$2" > "$3" 2>&1; then check "$1" 0; else check "$1" 1; sed 's/^/    /' "$3" | tail -20; fi
}
rows() { "${PSQL[@]}" -At -c "select (select count(*) from public.music_generation_jobs) || '/' || (select count(*) from public.prompt_versions)"; }

echo "# $("${PSQL[@]}" -At -c "select current_user || ' | ' || version()")"
echo "# search_path roli: $("${PSQL[@]}" -At -c 'show search_path')"
echo "# sha256: $(sha256sum "${DBDIR}/ai_studio_jobs_v1.sql" | cut -c1-16) migracja | $(sha256sum "${DBDIR}/ai_studio_jobs_v1.rollback.sql" | cut -c1-16) rollback | $(sha256sum "${DBDIR}/baseline_prod_2026-10-16.sql" | cut -c1-16) baseline"

# ---- A. Stan produkcji i zgodność środowiska -------------------------------------
run_sql "A00 baseline: obiekty produkcji przed migracją" "${DBDIR}/baseline_prod_2026-10-16.sql" "${OUT}/baseline.log"
parity "${OUT}/before.txt"
PROD="${DBDIR}/prod_state_2026-10-16.txt"
same "A01 obiekty migracji: stos = produkcja" "${PROD}" "${OUT}/before.txt" '^(tbl|acl|colacl|col|con|idx|trg|pol|fn|fnacl|pub|pubown|cmt) '
same "A02 rola wykonująca: stos = produkcja" "${PROD}" "${OUT}/before.txt" '^role '
same "A03 domyślne ACL roli wykonującej: stos = produkcja" "${PROD}" "${OUT}/before.txt" '^dacl '
same "A04 event triggery: stos = produkcja" "${PROD}" "${OUT}/before.txt" '^evt '

# ---- B. Migracja 2x ------------------------------------------------------------------
run_sql "B01 migracja (rola postgres, event triggery platformy aktywne)" "${DBDIR}/ai_studio_jobs_v1.sql" "${OUT}/migracja1.log"
parity "${OUT}/after1.txt"
run_sql "B02 migracja ponownie (idempotencja)" "${DBDIR}/ai_studio_jobs_v1.sql" "${OUT}/migracja2.log"
parity "${OUT}/after2.txt"
same "B03 migracja 2x = ten sam stan" "${OUT}/after1.txt" "${OUT}/after2.txt"
"${PSQL[@]}" -c "notify pgrst, 'reload schema'"

# ---- C. API: PostgREST, Auth, Realtime -----------------------------------------------
if SB_API_URL="${API_URL}" SB_ANON_KEY="${ANON_KEY}" SB_SERVICE_KEY="${SERVICE_KEY}" node api_audit.mjs; then
  check "C00 testy API (PostgREST, Auth, Realtime)" 0
else
  check "C00 testy API (PostgREST, Auth, Realtime)" 1
fi

# ---- D. Rollback 2x, dane, ponowna migracja ----------------------------------------------
ROWS_BEFORE="$(rows)"
run_sql "D01 rollback" "${DBDIR}/ai_studio_jobs_v1.rollback.sql" "${OUT}/rollback1.log"
run_sql "D02 rollback ponownie (idempotencja)" "${DBDIR}/ai_studio_jobs_v1.rollback.sql" "${OUT}/rollback2.log"
parity "${OUT}/rolled_back.txt"
same "D03 rollback 2x = stan przed migracją" "${OUT}/before.txt" "${OUT}/rolled_back.txt"
ROWS_AFTER="$(rows)"
check "D04 rollback zachowuje wiersze jobs/prompt_versions (${ROWS_BEFORE} -> ${ROWS_AFTER})" "$([[ "${ROWS_BEFORE}" == "${ROWS_AFTER}" && "${ROWS_BEFORE}" != "0/0" ]] && echo 0 || echo 1)"
run_sql "D05 ponowna migracja po rollbacku" "${DBDIR}/ai_studio_jobs_v1.sql" "${OUT}/migracja3.log"
parity "${OUT}/after3.txt"
same "D06 ponowna migracja = stan po pierwszej migracji" "${OUT}/after1.txt" "${OUT}/after3.txt"

rm -f "${OUT}/diff.tmp"
echo "SUPABASE: PASS ${passes} / FAIL ${fails}"
[[ "${fails}" -eq 0 ]] || exit 1
echo "AUDYT SUPABASE: OK"
