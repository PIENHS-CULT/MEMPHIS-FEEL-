---
type: przegląd
projekt: PIENHS CULT OS
modul: AI Studio MVP
przedmiot: ai_studio_jobs_v1 — migracja, rollback, harness, zgodność z produkcją
data: 2026-10-16
status: PASS lokalnie (PostgreSQL 16.15 i 17.6); replika zgodna z produkcją; produkcja bez zmian
tags: [pienhs-cult-os, ai-studio, supabase, migracja, testy, rls]
---

# ai_studio_jobs_v1 — przegląd kontraktów, uprawnień i testów

## 0. Wynik

| Pozycja | Stan |
|---|---|
| PostgreSQL 16.15 | 127/127 PASS, współbieżność 3/3 PASS |
| PostgreSQL 17.6 (wersja produkcji) | 127/127 PASS, współbieżność 3/3 PASS |
| Testy mutacyjne | 10/10 wykrytych, każda przez testy, których dotyczy |
| Replika harnessu a produkcja | zgodna dla wszystkich obiektów migracji (odczyt 2026-10-16); 2 różnice środowiska (sekcja 4) |
| Produkcja (`rfkngzzqnuejiawshwoz`) | bez zmian; 2 próby `apply_migration` anulowane w oknie potwierdzenia |
| Audyt na środowisku Supabase | lokalny stos Supabase w CI (D6), wyniki: sekcja 11 |
| CI GitHub Actions | `PIENHS-CULT/memphis-feel-`, gałąź `ai-studio/db-tests` (D7), wyniki: sekcja 11 |

Wersje (sha256, 16 znaków): migracja `dbd35dff03cf8172` · rollback `8a2b75e69a7b47d1` · testy `90e2589f3ced9edb` · baseline `ffe7e90e1175ef86` · runner `b53e60b24d8b0ea3`.

## 1. Zmiany względem plików przekazanych do przeglądu

Migracja (rewizja b):
- `mgj_complete`: walidacja elementów — `structure[]` = obiekt `{section 1–80, description 1–1000}`, `vocalInstructions[]` i `productionNotes[]` = string 1–500.
- `mgj_complete`: `prompt` i `description` nie mogą być puste ani złożone z białych znaków.
- `mgj_create`: `working_title` i `idea` nie mogą być złożone z białych znaków.

Rollback: bez zmian (sygnatury funkcji bez zmian).

Testy:
- harness v2: model ról Supabase, kontrola stanu, czas (sekcja 6),
- testy negatywne bez skutków ubocznych,
- runner: osobne dane testowe dla każdego testu współbieżności, kontrola punktu synchronizacji,
- `prod_parity.sql`: porównanie produkcji z repliką, tylko odczyt (sekcja 4),
- `baseline_prod_2026-10-16.sql`: stan produkcji przed migracją w osobnym pliku (jedno źródło dla harnessu i audytu Supabase),
- `supabase_audit/`: audyt na lokalnym stosie Supabase (sekcja 11).

## 2. Kontrakty funkcji

Wszystkie 4 funkcje: `SECURITY INVOKER`, `search_path = ''`, `EXECUTE` wyłącznie `service_role`.
Błędy: komunikat `mgj_*` + SQLSTATE; Edge Function mapuje je na HTTP po komunikacie.

### mgj_create(user, project, request_id, title, idea, input) → job

| Warunek | Wynik | Testy |
|---|---|---|
| argument NULL; title/idea puste, z białych znaków, > 120 / > 5000; input nie-obiekt, JSON null, > 8192 B | `mgj_invalid_input` (22023) | C06a–f, C07b–g |
| title 120, idea 5000, input 8192 B | job `queued` | C07a |
| powtórzony (user, request_id) | ten sam job, bez nowego wiersza (także z innym projektem i danymi) | C02, C03, P2 |
| projekt nie istnieje lub nie należy do usera | `mgj_project_not_found` (P0002) | C04, C05 |
| 2 joby aktywne (queued/processing) | `mgj_limit_active` | C08a–b, P3 |
| 10 jobów utworzonych w ostatniej godzinie | `mgj_limit_hour` | C09 |
| 80 jobów w bieżącym miesiącu (UTC) | `mgj_limit_month` | C10 |
| joby usera bez wyniku > 10 min (od `dispatched_at`, inaczej `created_at`) | `failed/timeout` przed liczeniem limitów | C11a–b |
| poprawne wywołanie | `queued`, `attempts` 0, input zapisany | C01 |

### mgj_dispatch(job, token_hash)

| Warunek | Wynik | Testy |
|---|---|---|
| hash NULL lub nie `^[0-9a-f]{64}$` | `mgj_invalid_token` (22023) | D03a–e |
| job nie istnieje | `mgj_job_not_found` | D04 |
| status ≠ `queued` | `mgj_invalid_state` | D02, D05 |
| poprawne wywołanie | `processing`, `dispatched_at`, `attempts + 1`, hash zapisany | D01 |

### mgj_complete(job, token_hash, result) → prompt_version_id

| Warunek | Wynik | Testy |
|---|---|---|
| job nie istnieje | `mgj_job_not_found` | K03 |
| zły token, token NULL, job bez tokenu | `mgj_invalid_token` (28000) | K01a–b, K02 |
| job `completed` | zwraca istniejącą wersję, bez zmian | K06 |
| job `failed` z innego powodu niż `timeout` | `mgj_invalid_state` | K10 |
| job `failed/timeout` | spóźniony wynik przyjęty | K09 |
| zły typ lub brak pola; poza limitem (sekcja 1); suma > 64 KB | `mgj_invalid_result` (22023), job bez zmian | K04a–zb, K04zz |
| pola na granicach limitów, suma ≤ 64 KB | przyjęty | K11 |
| poprawne wywołanie | wersja = max + 1 pod blokadą wiersza projektu; job `completed`; `negativePrompt ""` → NULL; `model` obcięty do 120 | K05, K07, K08, P1 |

### mgj_fail(job, error_code, token_hash = NULL)

| Warunek | Wynik | Testy |
|---|---|---|
| job nie istnieje | `mgj_job_not_found` | F05 |
| token podany, a zły albo job bez tokenu | `mgj_invalid_token` | F02, F06 |
| job zamknięty (completed/failed) | bez zmian | F03 |
| poprawne wywołanie | `failed`, `completed_at`, kod `^[a-z0-9_]{1,64}$`, inaczej `unknown` | F01, F04 |

## 3. RLS i uprawnienia po migracji

| Obiekt | anon | authenticated | service_role | Testy |
|---|---|---|---|---|
| `music_generation_jobs` | brak | SELECT własnych; UPDATE tylko `notified_at` własnych | wszystko (BYPASSRLS) | R01–R07, N01, S05 |
| `music_generation_job_tokens` | brak | brak | S/I/U/D | R08a–d, N03, S04 |
| `prompt_versions` | brak | SELECT i DELETE własnych; bez INSERT/UPDATE | wszystko | R10a–d, N02, S06, S09 |
| `projects` | brak | bez zmian (CRUD własnych) | wszystko | R11, N05 |
| `mgj_*` | brak EXECUTE | brak EXECUTE | EXECUTE | R09a–d, N04, S03 |

- Obrona w głąb: nawet po nadaniu `EXECUTE` klientowi wywołanie kończy się 42501, bo klient nie ma praw zapisu do tabel (R12).
- Polityka UPDATE na jobach jest bezpieczna tylko razem z grantem kolumnowym. Mutacja M1 (bez `REVOKE`) pozwoliła klientowi zmienić `status` (R03).
- Pozostaje (stan produkcji sprzed migracji, domyślne granty Supabase): `authenticated` ma TRUNCATE, REFERENCES, TRIGGER i MAINTAIN na `projects` i `prompt_versions`. TRUNCATE omija RLS, ale Data API (PostgREST) tej operacji nie wykonuje. Odebranie — osobna migracja, poza zakresem v1.

## 4. Zgodność repliki harnessu z produkcją (odczyt 2026-10-16)

Metoda: to samo zapytanie katalogowe (`prod_parity.sql`, tylko odczyt) na produkcji i na replice w stanie „przed” (po rollbacku); ta sama `search_path` (`"$user", public, extensions`); `app_owner` = `postgres`.

Zakres: `projects`, `prompt_versions`, `music_generation_jobs`, tabela tokenów, `set_updated_at`, `mgj_*`:
- tabele: RLS, właściciele, ACL tabel i kolumn, kolumny i wartości domyślne, ograniczenia, indeksy, triggery, polityki,
- funkcje: md5 źródła, konfiguracja, ACL,
- publikacja `supabase_realtime` (członkostwo, właściciel), komentarze,
- domyślne ACL roli wykonującej, event triggery, atrybuty roli wykonującej.

Wynik: 214 wierszy identycznych. Różnice:

| Różnica (tylko produkcja) | Wpływ |
|---|---|
| domyślne ACL `postgres` zawierają wpis samego właściciela (12 wierszy) | brak: ACL nowych tabel i funkcji są identyczne z tym wpisem i bez niego (sprawdzone na PG 17.6) |
| 6 event triggerów platformy: `pgrst_ddl_watch`, `pgrst_drop_watch`, `issue_pg_cron_access`, `issue_pg_net_access`, `issue_pg_graphql_access`, `issue_graphql_placeholder` | uruchamiają się przy każdym DDL migracji i rollbacku (przeładowanie schematu PostgREST, obsługa rozszerzeń); w replice ich nie ma → zakres D6 |

Rola wykonująca na produkcji: `postgres` (NOSUPERUSER, BYPASSRLS) jest właścicielem tabel, `set_updated_at` i publikacji `supabase_realtime`. Wszystkie instrukcje migracji wykonuje się bez superusera. `postgres` jest członkiem `anon`, `authenticated`, `authenticator` i `service_role`.

Bezpośrednio przed wdrożeniem: ponowne `prod_parity.sql` na produkcji. Wynik identyczny z `prod_state_2026-10-16.txt` oznacza brak dryfu.

## 5. Rollback — zgodność z migracją

| Sekcja migracji | Rollback |
|---|---|
| 1. kolumny `dispatched_at`, `completed_at` | `drop column` (dane kolumn tracone) |
| 2. indeksy FK | `drop index` |
| 3. trigger `updated_at` | `drop trigger` |
| 4. tabela tokenów | `drop table` (tokeny tracone) |
| 5. granty i polityka jobs | odwołanie grantu kolumnowego, `grant all` dla `anon` i `authenticated` (= ACL produkcji), usunięcie polityki |
| 6. `prompt_versions` | `grant insert, update`; odtworzenie 2 polityk 1:1 z migracji `harden_user_rls_authz` |
| 7. Realtime | usunięcie tabeli z publikacji (warunkowo) |
| 8–9. funkcje i EXECUTE | `drop function` (4 sygnatury) |

Testy:
- M01: stan po dwukrotnym rollbacku = stan sprzed migracji. Porównanie obejmuje tabele i RLS, ACL tabel i kolumn, kolumny, ograniczenia, indeksy, triggery, polityki, funkcje (md5 źródła, ACL), publikację i komentarze; przy niezgodności zapisuje diff.
- M02: wiersze jobów i wersji są zachowane.
- M03: ponowna migracja = stan po pierwszej migracji.
- Mutacje M4 i M10 wykryte.

## 6. Harness v2 — uprawnienia, stan, czas

Uprawnienia:
- Model ról z produkcji. Migracja i rollback wykonywane jako rola bez superusera (`app_owner` = `postgres`).
- Klient i backend łączą się jako `authenticator` i wykonują `SET ROLE`, jak PostgREST.
- Sprawdzane: `PUBLIC`, `anon`, `authenticated`, `service_role` oraz obrona w głąb (R12).

Kontrola stanu:
- Każdy scenariusz ma własnego użytkownika i projekt (A–G w SQL; 2a, 2b, 2c we współbieżności).
- Testy negatywne (`tests.raises`) wykonywane w subtransakcji wycofywanej także przy nieoczekiwanym sukcesie. Błąd jednego przypadku nie zmienia danych kolejnych, więc nie ma kaskady FAIL.
- Niezmienniki V01–V08 sprawdzane na danych.
- Pełny snapshot schematu z diffem przy niezgodności.
- Kontrola liczby testów (127) i unikalności nazw.
- Nieobsłużony błąd kończy przebieg kodem 3 (fail-closed).

Czas:
- Strefa UTC wymuszona na bazie.
- Progi czasowe testowane jawnymi znacznikami (−11 / −9 min).
- Limit miesięczny testowany z oddzieleniem od okna godzinowego. W pierwszych 61 min miesiąca (UTC) test dostaje SKIP z podanym powodem, nie FAIL.

Współbieżność (2 sesje; sesja B startuje, gdy A trzyma blokady w `pg_sleep`):
- P1: dwa równoległe `mgj_complete` w jednym projekcie → wersje 1 i 2.
- P2: równoległy replay `request_id` → jeden wiersz, ten sam id.
- P3: równoległe `mgj_create` przy 1 wolnym slocie → dokładnie 2 aktywne joby.
- Brak punktu synchronizacji = FAIL, bo przebieg sekwencyjny nie dowodzi współbieżności. Sprawdzone: wymuszony brak synchronizacji → P1–P3 FAIL, exit 1.

## 7. Testy mutacyjne (PostgreSQL 17.6)

| Mutacja | Wykryta przez |
|---|---|
| M1 brak `REVOKE` na jobs | N01, R03, R05, S05 |
| M2 limit godzinowy 11 | C09 |
| M3 brak walidacji typu elementów `structure` | K04s, K04t |
| M4 rollback bez `grant all` na jobs | M01 |
| M5 sweep bez `dispatched_at` | C11a |
| M6 brak weryfikacji tokenu w `mgj_complete` | K01a, K01b, K02 |
| M7 EXECUTE dla `authenticated` | S03 |
| M8 brak blokady wiersza projektu | P1 |
| M9 brak blokady doradczej | P2, P3 |
| M10 rollback bez polityki UPDATE | M01 |

M3 pokazuje, że kontrola typu jest jedyną barierą: bez niej element bez `section` przechodzi kontrolę długości (`char_length(NULL)` daje NULL, a nie fałsz).

## 8. Ograniczenia testów lokalnych (zakres D6)

- event triggery platformy (sekcja 4),
- PostgREST: mapowanie błędów SQL na HTTP, JWT, nagłówki, ekspozycja RPC,
- Realtime: dostarczanie zmian jobów z filtrem RLS (lokalnie sprawdzane tylko członkostwo w publikacji),
- Auth: prawdziwi użytkownicy i tokeny.

## 9. Decyzje

**D6 — audyt na środowisku Supabase.** Branch działa tylko na planie Pro (25 USD/mies. plus compute brancha od 0,01344 USD/h; kredyty compute go nie obejmują).

Przyjęte (0 USD): job CI z lokalnym stosem Supabase (Supabase CLI 2.118.0, `supabase start`, PostgreSQL 17.6) obok testów PostgreSQL 16 i 17.6:
- migracja jako `postgres`,
- `prod_parity.sql`: porównanie z produkcją, w tym event triggerów,
- testy przez PostgREST z prawdziwymi JWT (`anon`, `authenticated`),
- Realtime z filtrem RLS.

Nie zmienia żadnego projektu Supabase.

**D7 — repo dla CI.** Przyjęte 2026-10-16: `PIENHS-CULT/memphis-feel-` (repo panelu MVP):
- gałąź `ai-studio/db-tests`, PR bez merge;
- repo publiczne → GitHub Actions na standardowych runnerach bez opłat;
- repo połączone z Vercel: push uruchamia preview (Hobby, 0 USD).

## 10. Kolejność prac — status

| Krok | Stan |
|---|---|
| 1. Weryfikacja migracji | wykonane, rewizja b (sekcje 1–3) |
| 2. Weryfikacja rollbacku | wykonane (sekcja 5) |
| 3. Harness: uprawnienia, stan, czas | wykonane (sekcja 6) |
| 3b. Zgodność repliki z produkcją | wykonane, tylko odczyt (sekcja 4) |
| 4. Testy PostgreSQL w CI | lokalnie PG 16.15 i 17.6 — PASS; GitHub Actions: sekcja 11 |
| 4b. Audyt na środowisku Supabase | job `supabase` w CI: sekcja 11 |
| 5. Wdrożenie | po PASS kroków 4 i 4b oraz po `prod_parity.sql` bez dryfu |

## 11. Wyniki CI (GitHub Actions)

Oczekują na pierwszy przebieg workflow `ai-studio-db-tests`.

## Pliki

| Plik | Miejsce w repo |
|---|---|
| `ai_studio_jobs_v1.sql` | `db/ai_studio_jobs_v1/` |
| `ai_studio_jobs_v1.rollback.sql` | `db/ai_studio_jobs_v1/` |
| `ai_studio_jobs_v1.tests.sql` | `db/ai_studio_jobs_v1/` |
| `run_db_tests.sh` | `db/ai_studio_jobs_v1/` |
| `prod_parity.sql`, `prod_state_2026-10-16.txt` | `db/ai_studio_jobs_v1/` |
| `baseline_prod_2026-10-16.sql` | `db/ai_studio_jobs_v1/` |
| `run_supabase_audit.sh`, `api_audit.mjs`, `package.json`, `supabase/config.toml` | `db/ai_studio_jobs_v1/supabase_audit/` |
| `REVIEW.md` (ten dokument) | `db/ai_studio_jobs_v1/` |
| `ai-studio-db-tests.yml` | `.github/workflows/` |
| logi: PG 16, PG 17, mutacje, diff produkcja/replika | `_logi/` (poza repo) |

## Źródła

- [Supabase — Deployment & Branching (branching: plan Pro)](https://supabase.com/docs/guides/deployment)
- [Supabase — Manage Branching usage (koszt brancha)](https://supabase.com/docs/guides/platform/manage-your-usage/branching)
- [Supabase — Testing Overview (CI: `supabase/setup-cli`, `supabase start`)](https://supabase.com/docs/guides/local-development/testing/overview)
- [GitHub — About billing for GitHub Actions (repo publiczne: standardowe runnery bez opłat)](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
