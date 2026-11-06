# SerwisMaster – system serwisowy dla firmy Wartung/Service (przebudowa)

Statyczna aplikacja (HTML + moduły JS, bez bundlera) do hostowania np. na GitHub Pages, z backendem **Firebase** (Authentication, Firestore, Storage) i regułami bezpieczeństwa egzekwowanymi po stronie serwera.

> **Stan (2026-11-06):** kod MVP gotowy do publikacji (testy lokalne/emulatory). **Wdrożenie reguł / Pages / merge wykonuje właściciel** – ten katalog nie mutuje produkcji. Plan **Spark**: Auth + Firestore; **zdjęcia wyłączone** (`features.photos=false`, Cloud Storage wymaga Blaze). Stare kolekcje root pozostają niedostępne (deny). Brak certyfikacji produkcyjnej / audytu RODO.

## Co działa (zaimplementowane)
| Obszar | Zakres |
|---|---|
| Logowanie | Firebase Auth e-mail/hasło (prawdziwe SDK), reset hasła; sesja domyślnie tylko w karcie (`authPersistence: 'session'`), brak danych logowania w localStorage |
| Widoczność danych | **Zlecenia** widzi tylko przypisany technik (i admin). Czas, materiały, diety, usterki – tylko autor (aktywny technik) i admin. **Wspólny katalog (klienci, zakłady, maszyny, szablony, części, nazwa/stawki firmy) czyta każdy aktywny członek firmy, także technik** – nie jest prywatny per technik. Konto wyłączone (`active:false`) nie czyta ani nie zapisuje żadnych danych biznesowych, nawet własnych; widzi tylko własny wpis członkostwa (komunikat „brak dostępu”). |
| Role | `tenants/{firma}/members/{uid}` – `admin` / `tech`; zapis tylko przez innego admina lub Admin SDK; zakaz zmiany własnej roli; brak „pierwszy użytkownik = admin” |
| Technik | widzi tylko przypisane zlecenia; wypełnia checklistę (OK / usterka / nie dotyczy + uzasadnienie, pomiary z jednostką i zakresem, zdjęcia do Storage), czas (praca/dojazd/przerwa), materiały, zadania naprawcze, diety; przekazuje do akceptacji |
| Admin | klienci, zakłady, maszyny z historią; szablony checklist (wersje niezmienne); zlecenia z przydziałem technika i zamrożoną migawką wersji; akceptacja/odrzucenie protokołów, czasu, materiałów (atomowe zdjęcie ze stanu magazynu), diet; usterki; magazyn; zespół; ustawienia (VAT, stawki) |
| Blokady | zatwierdzony protokół – zablokowany także dla admina; po przekazaniu technik nie edytuje; przekazanie wymaga odpowiedzi na wszystkie wymagane punkty (sprawdzane też przez reguły) |
| Konflikty | każde zlecenie ma `rev`; zapis w transakcji z kontrolą wersji – zmiana z innego urządzenia daje „KONFLIKT”, nie nadpisuje; zapisy pojedynczych pól, nigdy całej bazy |
| Offline | jawny wskaźnik; offline zapis jest blokowany z komunikatem „NIE zapisano” (bez udawanego zapisu) |
| Diety | § 9 ust. 4a EStG + **pełna tabela BMF 2026** (166 krajów, sparsowana z oficjalnego PDF – `data/bmf-2026.json`); kraj/miasto/data/godzina/nocleg; posiłki 20/40/40 % z dopłatą pracownika (min. 0); osobno: kwota wolna od podatku / zwrot firmy / refaktura klienta; nieznany kraj/rok blokuje obliczenie |
| Rachunki | tylko **SZKIC** z zatwierdzonych godzin i materiałów, kwoty w centach, VAT konfigurowalny |
| Tryb DEMO | opcjonalny, oznaczony, tylko w pamięci karty, zero połączeń sieciowych; nigdy nie wysyła danych |

## Czego NIE ma (świadome ograniczenia)
- **Zakładanie kont / zaproszenia** – brak; konta tworzy admin w konsoli Firebase, a w aplikacji przypisuje UID i rolę.
- **Wystawianie faktur** – brak numeracji, archiwizacji GoBD, E-Rechnung (XRechnung/ZUGFeRD), reverse charge. Fakturę wystawia program księgowy.
- **Diety złożone** – kilka krajów, podróż przez północ bez noclegu, reguła 3 miesięcy, rok przełomowy → oznaczane „ręczna weryfikacja”, nie liczone automatycznie. Kraje nieujęte w tabeli (BMF: stawka Luksemburga) – blokada i decyzja księgowości. Ryczałt noclegowy nie jest liczony.
- **Serwerowa walidacja treści wyników – LUKA** – reguły sprawdzają autora, status, wersję i limity, a przy przekazaniu tylko **obecność kluczy** wymaganych punktów. Wpis pusty/`null` (np. bez wyniku, pomiaru czy uzasadnienia „nie dotyczy”) przejdzie przez reguły, jeśli ktoś ominie aplikację. Kompletność i treść odpowiedzi sprawdza aplikacja, a ostateczną bramką jest akceptacja admina. Pełna walidacja po stronie serwera wymagałaby Cloud Functions.
- **Katalog wspólny** – technik może odczytać wszystkich klientów/maszyny firmy; ograniczenie do maszyn z przypisanych zleceń wymagałoby osobnych kopii metadanych.
- Diety liczone w przeglądarce – zapisany wynik wymaga akceptacji admina.
- Brak tworzenia zleceń naprawczych jednym kliknięciem z usterki (usterka ma status open/in_repair/closed; zlecenie tworzy admin).
- Brak powiadomień e-mail, brak trybu offline z kolejką zapisów, brak usuwania osieroconych zdjęć.
- Przykładowa checklista w DEMO **nie zawiera wartości producenta** – granice są oznaczone jako przykład.

## Konfiguracja (wykonuje właściciel – publikacja)
1. **Projekt Firebase** – dla AZ Service: `service-21527` (Firestore `europe-west3`). Nowy projekt: lokalizacja UE. Uwaga RODO/DSGVO: Firebase to usługa Google; zawrzyj umowę powierzenia (Data Processing Terms), wpisz do rejestru czynności przetwarzania, poinformuj pracowników. Niektóre usługi Firebase (np. Authentication) mogą przetwarzać dane poza UE – sprawdź aktualną dokumentację Google.
2. **Authentication** → włącz dostawcę *E-mail/Hasło*. Aplikacja nie oferuje rejestracji; konto bez wpisu w `members` i tak nic nie widzi.
3. **Firestore** – już istnieje. **Storage pomiń na Spark** (zdjęcia wyłączone w `js/config.js`).
4. **Reguły + indeksy (bez Storage)**: z katalogu `firebase/`:
   `npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes --project service-21527`
   (opcjonalnie później z Blaze: dodaj `storage`).
5. **Aplikacja web**: Ustawienia projektu → Dodaj aplikację web → skopiuj konfigurację do `js/config.js` (wzór: `js/config.example.js`) i ustaw `tenantId`. Dodaj domenę `<user>.github.io` w Authentication → Ustawienia → Autoryzowane domeny.
6. **Pierwszy admin**: dla `serwismaster` / UID `BXFgv0nQmFPBuVpdYsByymsr2Xv1` już przygotowany. Nowy tenant:
   ```
   npm i firebase-admin
   gcloud auth application-default login     # albo GOOGLE_APPLICATION_CREDENTIALS (klucza nie commituj!)
   node tools/bootstrap-admin.mjs --project <id> --tenant firma-gmbh --email admin@twojafirma.de --name "Twoja Firma GmbH"
   ```
   Skrypt odmówi, jeśli firma już istnieje. Kolejnych adminów i techników dodaje admin w zakładce **Zespół** (UID z konsoli).
7. W aplikacji: **Ustawienia (VAT + stawki €/h – wymagane jawnie, bez milczących domyślnych)** → Klienci i maszyny → Szablony → Magazyn → Zespół (technicy) → Zlecenia.
8. GitHub Pages: `js/config.js` jest w `.gitignore`. Dodaj go **świadomie i ręcznie** dopiero po wdrożeniu reguł i utworzeniu admina (np. `git add -f js/config.js`) – trafi do publicznego repo. Zawiera tylko publiczną konfigurację aplikacji web (apiKey web nie jest sekretem; ochronę dają reguły; rozważ App Check i ograniczenie klucza do domeny).
   **Nigdy** nie umieszczaj w repozytorium kluczy konta serwisowego (`service-account*.json`), plików ADC (`application_default_credentials.json`), `.env` ani eksportów emulatora z danymi.

## Uruchomienie lokalne
Moduły ES wymagają serwera HTTP (nie `file://`): `npx serve .` lub `python3 -m http.server`. Bez `js/config.js` aplikacja pokaże ekran „Chmura nie jest skonfigurowana” i opcjonalny tryb DEMO.

## Testy
Zob. `TESTS.md`.

## Struktura
```
index.html, css/app.css
js/app.js (UI), js/cloud.js (Firebase SDK 13.2.0 z gstatic), js/demo.js (DEMO w pamięci), js/errors.js, js/ui.js
js/domain/{allowance,checklist,billing}.js – czysta logika (testowana w Node)
js/domain/bmf-2026-data.js – wygenerowane z data/bmf-2026.json
js/config.example.js – wzór konfiguracji
firebase/{firestore.rules,storage.rules,firebase.json,firestore.indexes.json}
tools/bootstrap-admin.mjs (Admin SDK, 1. admin), tools/parse-bmf.cjs (parser PDF BMF)
data/bmf-2026-source.txt (tekst oficjalnego PDF), data/bmf-2026.json
tests/domain.test.js, tests/browser-smoke.cjs, tests/rules/{rules.test.js,cloud-e2e.cjs}
```
