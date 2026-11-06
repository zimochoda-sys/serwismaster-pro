# Publikacja SerwisMaster (Spark, bez zdjęć) – dla właściciela

**Ten katalog nie wdraża niczego sam.** Po zielonych testach skopiuj allowlistę do repo i wykonaj poniższe.

## Wymagania CLI
- `npx -y firebase-tools@latest` z kontem mającym prawa do `service-21527`
- Albo ADC (`gcloud auth application-default login`) z quota project = `service-21527`
- `firebase login:list` na agencie mógł pokazywać brak konta Firebase CLI przy działającym ADC – na maszynie właściciela zaloguj Firebase CLI przed deployem.

## 1. Firestore rules + indexes (BEZ Storage)
```bash
cd firebase
npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes --project service-21527
```
Pliki:
- `firebase/firestore.rules`
- `firebase/firestore.indexes.json`
- `firebase/firebase.json`

Nie wdrażaj `storage` na Spark. Legacy root collections zostają denied.

## 2. Auth
- Email/Password włączone
- Authorized domains: domena GitHub Pages
- Admin UID już w `tenants/serwismaster/members/...`

## 3. Aplikacja (Pages)
- `js/config.js`: `tenantId: 'serwismaster'`, `features.photos: false`, publiczna konfiguracja web
- `git add -f js/config.js` dopiero **po** udanym deployu reguł
- Merge PR / publikacja Pages z `main`

## 4. Pierwsze logowanie
Ustawienia → VAT + stawki €/h (jawnie) → klienci/maszyny → szablony → technicy → zlecenia.

## Czego nie robić
- Nie Blaze / nie Storage w MVP
- Nie migrować / nie usuwać starych kolekcji
- Nie seedować danych DEMO do produkcji
