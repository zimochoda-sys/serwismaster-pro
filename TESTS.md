# Testy – wykonane vs. do wykonania ręcznie (06.11.2026)

## Wykonane automatycznie (wszystkie PASS)
1. **Domena** – `npm test` (node:test): 11/11 – `tests/domain-result.txt`
   DE 2026 14 € >8 h / 0 € ≤8 h; 14+28+14 z noclegiem; BMF Warszawa 40/27, Wrocław 34/23, reszta Polski 34/23; nieznany kraj/rok/brak miasta → blokada; posiłki 20/40/40, min. 0, dopłata pracownika; przypadki złożone → ręczna weryfikacja; podział podatkowe/zwrot/klient; walidacja szablonu (granice wymagają źródła); migawka wersji; walidacja zgłoszenia; przejścia statusów; szkic rachunku (arytmetyka w centach, VAT 19% jako parametr, tylko zatwierdzone).
2. **Reguły Firestore/Storage w emulatorze** – `cd tests/rules && npm test`: 17/17 – `tests/rules/rules-result.txt`
   niezalogowany; technik nieprzypisany; izolacja firm; eskalacja ról (technik → admin, admin → własna rola, podszycie updatedBy); konflikt rev; technik nie zmienia snapshotu/przypisania; przekazanie bez wymaganych odpowiedzi; technik nie zatwierdza; zatwierdzony protokół zablokowany dla admina; czas pracy tylko własny i do przypisanego otwartego zlecenia; materiał tylko z atomowym zdjęciem ze stanu; szkic rachunku tylko admin/zatwierdzone/bez numeru; wersje szablonów niezmienne; Storage: przypisany technik, własny folder, tylko obraz, zamknięte zlecenie odrzucone; konto wyłączone bez odczytu/zapisu/usuwania własnych rekordów (czytelny tylko własny wpis członkostwa); dieta – powiązanie tylko z własnym otwartym zleceniem, walidacja pól/typów, brak samodzielnego zatwierdzenia; usuwanie szkicu czasu tylko własny + przypisane otwarte zlecenie; technik czyta wspólny katalog (zamierzone).
   Znana luka (niezatestowana jako blokada, bo nie jest blokowana): pusty/`null` wpis wyniku przechodzi regułę kompletności.
3. **Smoke w przeglądarce (DEMO)** – `npm run test:browser`: 22/22 – `tests/browser-smoke-result.txt` (headless Chromium, lokalny serwer, zero żądań zewnętrznych, zero błędów JS).
4. **E2E chmura na emulatorach** – `cd tests/rules && npm run test:cloud-e2e`: 10/10 – `tests/rules/cloud-e2e-result.txt`
   prawdziwy `js/cloud.js` + Firebase JS SDK 13.2.0 (CDN) vs. emulatory Auth/Firestore/Storage; bootstrap pierwszego admina skryptem Admin SDK (drugie uruchomienie odrzucone); konto bez członkostwa bez dostępu; brak wpisów w localStorage; technik widzi tylko swoje; zapis transakcyjny; konflikt rev; przekazanie; zatwierdzenie przez admina.

Wymagania do uruchomienia: Node 20+, Java 11+ (emulatory), Playwright z Chromium (`PLAYWRIGHT_DIR` wskazuje moduł).

## Do sprawdzenia ręcznie (NIE wykonano)
- Prawdziwy projekt Firebase: wdrożenie reguł, logowanie, autoryzowana domena GitHub Pages, CSP z prawdziwymi domenami.
- Upload zdjęć w przeglądarce do Storage (reguły przetestowane, przepływ UI tylko w DEMO).
- Druk protokołu / szkicu rachunku na papier/PDF; telefon/tablet; Firefox/Safari.
- Weryfikacja przez księgowość: stawki diet, interpretacja przypadków złożonych, VAT.
- Wydajność przy dużej liczbie zleceń (brak paginacji).
- Audyt RODO i umowy z Google.
