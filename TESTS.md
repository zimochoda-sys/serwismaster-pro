# Testy – release readiness dziennik (2026-11-06 Europe/Berlin)

Bez remote deploy w tej fazie. Scratch: `/workspace/serwismaster-rebuild`.

## PASS
| Suite | Count |
|-------|-------|
| domain + daily-save-demo | 32/32 |
| rules emulator | 27/27 |
| browser smoke DEMO | 26/26 |
| cloud-e2e (saveDailySheet SDK) | 13 PASS |

## Bezpieczeństwo zapisu
- Duplikat: konflikt bez `Nadpisz` (time lub trip).
- Nadpisz: update szkicu; diet→none kasuje trip w tej samej transakcji.
- Approved: Conflict, stan bez zmian.
- Reguły: owner draft update/delete scoped; admin approve cudzych bez wymogu uid==auth.

Zob. `RELEASE-ALLOWLIST.md`, `firebase/RULES-DIFF-DAILY.md`.
