#!/usr/bin/env node
// Jednorazowe utworzenie firmy (tenant) i PIERWSZEGO administratora – uruchamia właściciel projektu
// na własnym komputerze z zaufanymi poświadczeniami (Admin SDK omija reguły). Nie wdrażaj tego na stronę.
//
// Wymagania: npm i firebase-admin ; zalogowanie: `gcloud auth application-default login`
// lub GOOGLE_APPLICATION_CREDENTIALS=ścieżka/do/klucza.json (klucza NIE commituj!).
// Użycie: node tools/bootstrap-admin.mjs --project <projectId> --tenant <tenantId> --email <email-admina> --name "Nazwa firmy"
// Konto e-mail admina musi już istnieć w Firebase Authentication (utwórz je w konsoli).
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
for (const k of ['project', 'tenant', 'email', 'name']) if (!args[k]) { console.error(`Brak --${k}`); process.exit(2); }
if (!/^[a-z0-9-]{3,40}$/.test(args.tenant)) { console.error('tenant: małe litery, cyfry, myślniki (3–40)'); process.exit(2); }
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
initializeApp(emulator ? { projectId: args.project } : { projectId: args.project, credential: applicationDefault() });
const user = await getAuth().getUserByEmail(args.email);
const db = getFirestore();
const tRef = db.doc(`tenants/${args.tenant}`);
await db.runTransaction(async tx => {
  const t = await tx.get(tRef);
  if (t.exists) throw new Error('Firma już istnieje – kolejnych adminów dodaje admin w aplikacji (zakładka Zespół).');
  tx.set(tRef, { name: args.name, vatPercent: 19, workPerHour: 0, travelPerHour: 0, createdAt: FieldValue.serverTimestamp() });
  tx.set(tRef.collection('members').doc(user.uid), { role: 'admin', active: true, displayName: args.email, updatedBy: 'bootstrap', updatedAt: FieldValue.serverTimestamp() });
});
console.log(`OK: firma ${args.tenant}, admin ${args.email} (uid ${user.uid}). Sprawdź stawkę VAT w Ustawieniach.`);
