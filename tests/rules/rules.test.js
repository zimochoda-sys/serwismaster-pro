// Testy negatywne/pozytywne reguł w emulatorze (projekt demo-*, bez połączeń z chmurą).
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, runTransaction, increment, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { buildTripInput, hasUndefinedDeep } from '../../js/domain/trip-form.js';
import { calculateAllowance } from '../../js/domain/allowance.js';
import { buildDailySheetPayloads } from '../../js/domain/daily-sheet.js';

let env; const T = 'acme', T2 = 'other';
const p = (...s) => ['tenants', T, ...s].join('/');
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-serwismaster',
    firestore: { rules: readFileSync('../../firebase/firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('../../firebase/storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 } });
});
after(async () => env && env.cleanup());
const order = (extra = {}) => ({ title: 'W1', clientId: 'c1', siteId: 's1', machineId: 'm1', assignedTo: 'tech1', dueDate: '2026-12-01', status: 'planned',
  snapshot: { templateId: 't', templateVersion: 1, items: [{ id: 'a', label: 'A', type: 'check', required: true }], requiredItemIds: ['a'] }, results: {}, rev: 0, createdBy: 'admin1', ...extra });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'tenants', T), { name: 'Acme', vatPercent: 19 });
    await setDoc(doc(db, p('members', 'admin1')), { role: 'admin', active: true, displayName: 'A' });
    await setDoc(doc(db, p('members', 'tech1')), { role: 'tech', active: true, displayName: 'T1' });
    await setDoc(doc(db, p('members', 'tech2')), { role: 'tech', active: true, displayName: 'T2' });
    await setDoc(doc(db, p('members', 'gone')), { role: 'tech', active: false, displayName: 'G' });
    await setDoc(doc(db, p('workOrders', 'og')), order({ assignedTo: 'gone' }));
    for (const c of ['timeEntries', 'materials', 'trips']) await setDoc(doc(db, p(c, 'g1')), { workOrderId: 'og', uid: 'gone', status: 'draft', kind: 'work', minutes: 5, date: '2026-01-01', partId: 'p1', qty: 1 });
    await setDoc(doc(db, p('defects', 'g1')), { workOrderId: 'og', createdBy: 'gone', status: 'open', severity: 'low', description: 'x' });
    await setDoc(doc(db, 'tenants', T2, 'members', 'outsider'), { role: 'admin', active: true, displayName: 'O' });
    await setDoc(doc(db, p('workOrders', 'o1')), order());
    await setDoc(doc(db, p('workOrders', 'o2')), order({ status: 'approved', rev: 5, results: { a: { outcome: 'ok' } } }));
    await setDoc(doc(db, p('parts', 'p1')), { sku: 'F1', name: 'Filtr', stock: 10, unitPrice: 5 });
    await setDoc(doc(db, p('materials', 'm1')), { workOrderId: 'o1', partId: 'p1', name: 'Filtr', qty: 3, unitPrice: 5, uid: 'tech1', status: 'draft' });
  });
});
const db = uid => env.authenticatedContext(uid).firestore();

test('niezalogowany nic nie czyta', async () => { await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), p('workOrders', 'o1')))); });
test('technik czyta przypisane, nie czyta cudzych', async () => {
  await assertSucceeds(getDoc(doc(db('tech1'), p('workOrders', 'o1'))));
  await assertFails(getDoc(doc(db('tech2'), p('workOrders', 'o1'))));
  await assertSucceeds(getDocs(query(collection(db('tech1'), p('workOrders')), where('assignedTo', '==', 'tech1'))));
  await assertFails(getDocs(collection(db('tech1'), p('workOrders'))));
});
test('izolacja tenantów: admin innej firmy nie ma dostępu', async () => {
  await assertFails(getDoc(doc(db('outsider'), p('workOrders', 'o1'))));
  await assertFails(setDoc(doc(db('outsider'), p('clients', 'x')), { name: 'X' }));
});
test('eskalacja ról: technik nie nadaje sobie admina; admin nie zmienia siebie', async () => {
  await assertFails(updateDoc(doc(db('tech1'), p('members', 'tech1')), { role: 'admin', active: true, displayName: 'T1', updatedBy: 'tech1' }));
  await assertFails(setDoc(doc(db('stranger'), p('members', 'stranger')), { role: 'admin', active: true, displayName: 'S', updatedBy: 'stranger' }));
  await assertFails(updateDoc(doc(db('admin1'), p('members', 'admin1')), { role: 'tech', active: true, displayName: 'A', updatedBy: 'admin1' }));
  await assertSucceeds(setDoc(doc(db('admin1'), p('members', 'tech3')), { role: 'tech', active: true, displayName: 'T3', updatedBy: 'admin1' }));
  await assertFails(setDoc(doc(db('admin1'), p('members', 'tech4')), { role: 'tech', active: true, displayName: 'T4', updatedBy: 'tech1' }));
});
test('technik zapisuje wynik z rev+1; zły rev = konflikt', async () => {
  await assertSucceeds(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { 'results.a': { outcome: 'ok' }, rev: 1, updatedBy: 'tech1' }));
  await assertFails(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { 'results.a': { outcome: 'defect' }, rev: 1, updatedBy: 'tech1' }));
  await assertFails(updateDoc(doc(db('tech2'), p('workOrders', 'o1')), { 'results.a': { outcome: 'ok' }, rev: 2, updatedBy: 'tech2' }));
});
test('podszywanie się: updatedBy musi być autorem; technik nie zmienia snapshotu/przypisania', async () => {
  await assertFails(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { 'results.a': { outcome: 'ok' }, rev: 1, updatedBy: 'admin1' }));
  await assertFails(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { assignedTo: 'tech2', rev: 1, updatedBy: 'tech1' }));
  await assertFails(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { 'snapshot.requiredItemIds': [], rev: 1, updatedBy: 'tech1' }));
});
test('zgłoszenie wymaga odpowiedzi na wymagane punkty; technik nie zatwierdza', async () => {
  await assertSucceeds(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { status: 'in_progress', rev: 1, updatedBy: 'tech1' }));
  await assertFails(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { status: 'submitted', rev: 2, updatedBy: 'tech1' }));
  await assertSucceeds(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { 'results.a': { outcome: 'ok' }, rev: 2, updatedBy: 'tech1' }));
  await assertFails(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { status: 'approved', rev: 3, updatedBy: 'tech1' }));
  await assertSucceeds(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { status: 'submitted', rev: 3, updatedBy: 'tech1' }));
  await assertFails(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { 'results.a': { outcome: 'na' }, rev: 4, updatedBy: 'tech1' }));
  await assertSucceeds(updateDoc(doc(db('admin1'), p('workOrders', 'o1')), { status: 'approved', rev: 4, updatedBy: 'admin1', decidedBy: 'admin1' }));
});
test('zatwierdzony protokół zablokowany także dla admina', async () => {
  await assertFails(updateDoc(doc(db('admin1'), p('workOrders', 'o2')), { title: 'zmiana', rev: 6, updatedBy: 'admin1' }));
  await assertFails(updateDoc(doc(db('admin1'), p('workOrders', 'o2')), { status: 'rejected', rev: 6, updatedBy: 'admin1', decidedBy: 'admin1' }));
  await assertFails(updateDoc(doc(db('tech1'), p('workOrders', 'o2')), { 'results.a': { outcome: 'defect' }, rev: 6, updatedBy: 'tech1' }));
});
test('czas pracy: tylko własny, do przypisanego zlecenia; technik nie zatwierdza', async () => {
  const te = { workOrderId: 'o1', date: '2026-01-02', kind: 'work', minutes: 60, status: 'draft' };
  await assertSucceeds(setDoc(doc(db('tech1'), p('timeEntries', 'e1')), { ...te, uid: 'tech1' }));
  await assertFails(setDoc(doc(db('tech1'), p('timeEntries', 'e2')), { ...te, uid: 'tech2' }));
  await assertFails(setDoc(doc(db('tech2'), p('timeEntries', 'e3')), { ...te, uid: 'tech2' }));
  await assertFails(setDoc(doc(db('tech1'), p('timeEntries', 'e4')), { ...te, uid: 'tech1', status: 'approved' }));
  await assertFails(setDoc(doc(db('tech1'), p('timeEntries', 'e5')), { ...te, workOrderId: 'o2', uid: 'tech1' }));
});
test('materiał: zatwierdzenie tylko z atomowym zdjęciem ze stanu', async () => {
  const a = db('admin1');
  await assertFails(updateDoc(doc(a, p('materials', 'm1')), { status: 'approved', approvedBy: 'admin1' }));
  await assertSucceeds(runTransaction(a, async tx => {
    tx.update(doc(a, p('parts', 'p1')), { stock: increment(-3) });
    tx.update(doc(a, p('materials', 'm1')), { status: 'approved', approvedBy: 'admin1' });
  }));
});
test('szkic rachunku tylko admin, tylko dla zatwierdzonego, bez numeru', async () => {
  const inv = { workOrderId: 'o2', status: 'draft', number: null, netCents: 100 };
  await assertSucceeds(setDoc(doc(db('admin1'), p('invoiceDrafts', 'i1')), inv));
  await assertFails(setDoc(doc(db('admin1'), p('invoiceDrafts', 'i2')), { ...inv, workOrderId: 'o1' }));
  await assertFails(setDoc(doc(db('admin1'), p('invoiceDrafts', 'i3')), { ...inv, status: 'issued' }));
  await assertFails(setDoc(doc(db('tech1'), p('invoiceDrafts', 'i4')), inv));
});
test('wersje szablonów niezmienne', async () => {
  const a = db('admin1');
  await assertSucceeds(setDoc(doc(a, p('templateVersions', 'v1')), { templateId: 't', version: 1, name: 'X', source: 'DEMO', items: [{ id: 'a' }], createdBy: 'admin1' }));
  await assertFails(updateDoc(doc(a, p('templateVersions', 'v1')), { name: 'Y' }));
  await assertFails(setDoc(doc(db('tech1'), p('templateVersions', 'v2')), { templateId: 't', version: 1, name: 'X', source: 'DEMO', items: [{ id: 'a' }], createdBy: 'tech1' }));
});
test('Storage: zdjęcie tylko przypisany technik, obraz <10MB, własny folder', async () => {
  const img = new Uint8Array([0xff, 0xd8, 0xff]);
  const st = uid => env.authenticatedContext(uid).storage();
  await assertSucceeds(uploadBytes(ref(st('tech1'), `tenants/${T}/workOrders/o1/tech1/abcdefgh12.jpg`), img, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(st('tech2'), `tenants/${T}/workOrders/o1/tech2/abcdefgh12.jpg`), img, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(st('tech1'), `tenants/${T}/workOrders/o1/tech2/abcdefgh12.jpg`), img, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(st('tech1'), `tenants/${T}/workOrders/o1/tech1/abcdefgh12.jpg`), img, { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(st('tech1'), `tenants/${T}/workOrders/o2/tech1/abcdefgh12.jpg`), img, { contentType: 'image/jpeg' }));
});

test('wyłączone konto: brak odczytu/zapisu/usuwania własnych danych; własny wpis członkostwa czytelny', async () => {
  const g = db('gone');
  await assertSucceeds(getDoc(doc(g, p('members', 'gone'))));
  for (const c of ['timeEntries', 'materials', 'trips', 'defects']) await assertFails(getDoc(doc(g, p(c, 'g1'))));
  await assertFails(getDoc(doc(g, p('workOrders', 'og'))));
  await assertFails(getDoc(doc(g, p('clients', 'c1'))));
  await assertFails(deleteDoc(doc(g, p('timeEntries', 'g1'))));
  await assertFails(deleteDoc(doc(g, p('materials', 'g1'))));
  await assertFails(setDoc(doc(g, p('timeEntries', 'g2')), { workOrderId: 'og', uid: 'gone', date: '2026-01-02', kind: 'work', minutes: 5, status: 'draft' }));
  await assertFails(setDoc(doc(g, p('trips', 'g2')), { uid: 'gone', workOrderId: '', input: {}, calc: { total: 0 }, status: 'draft' }));
});
test('dieta: powiązanie tylko z własnym otwartym zleceniem; walidacja pól', async () => {
  const base = { uid: 'tech2', input: { country: 'DE' }, calc: { total: 14 }, status: 'draft' };
  await assertSucceeds(setDoc(doc(db('tech2'), p('trips', 'a')), { ...base, workOrderId: '' }));
  await assertFails(setDoc(doc(db('tech2'), p('trips', 'b')), { ...base, workOrderId: 'o1' }));
  await assertFails(setDoc(doc(db('tech2'), p('trips', 'c')), { ...base, workOrderId: 'nieistnieje' }));
  await assertSucceeds(setDoc(doc(db('tech1'), p('trips', 'd')), { ...base, uid: 'tech1', workOrderId: 'o1' }));
  await assertFails(setDoc(doc(db('tech1'), p('trips', 'e')), { ...base, uid: 'tech1', workOrderId: 'o2' }));
  await assertFails(setDoc(doc(db('tech1'), p('trips', 'f')), { ...base, uid: 'tech1', workOrderId: '', approvedBy: 'tech1' }));
  await assertFails(setDoc(doc(db('tech1'), p('trips', 'g')), { ...base, uid: 'tech1', workOrderId: '', calc: { total: -5 } }));
  await assertFails(setDoc(doc(db('tech1'), p('trips', 'h')), { ...base, uid: 'tech1', workOrderId: '', status: 'approved' }));
});
test('usuwanie szkicu czasu: tylko własny, aktywny, przypisane otwarte zlecenie', async () => {
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), p('timeEntries', 't1')), { workOrderId: 'o1', uid: 'tech1', status: 'draft', kind: 'work', minutes: 5, date: '2026-01-01' });
    await setDoc(doc(c.firestore(), p('timeEntries', 't2')), { workOrderId: 'o2', uid: 'tech1', status: 'draft', kind: 'work', minutes: 5, date: '2026-01-01' }); });
  await assertFails(deleteDoc(doc(db('tech2'), p('timeEntries', 't1'))));
  await assertFails(deleteDoc(doc(db('tech1'), p('timeEntries', 't2'))));
  await assertSucceeds(deleteDoc(doc(db('tech1'), p('timeEntries', 't1'))));
});
test('członek (technik) czyta wspólny katalog klientów/maszyn – zamierzone, udokumentowane', async () => {
  await assertSucceeds(getDoc(doc(db('tech2'), p('clients', 'c1'))));
});

test('anonim, niesczłonek i legacy root: deny; wyłączony bez danych biznesowych', async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'tenants', T)));
  await assertFails(getDoc(doc(db('stranger'), p('members', 'admin1'))));
  await assertFails(getDoc(doc(db('stranger'), 'tenants', T)));
  await assertFails(getDoc(doc(db('admin1'), 'active_orders', 'x')));
  await assertFails(setDoc(doc(db('admin1'), 'clients', 'legacy'), { name: 'no' }));
  await assertFails(getDoc(doc(db('gone'), p('workOrders', 'og'))));
});

test('admin ze świeżym tenantem (jak AZ Service: name-only) zapisuje stawki; tworzy klienta', async () => {
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), 'tenants', 'fresh'), { name: 'AZ Service' });
    await setDoc(doc(c.firestore(), 'tenants', 'fresh', 'members', 'admin1'), { role: 'admin', active: true, displayName: 'Arkadiusz' });
  });
  const a = db('admin1');
  await assertSucceeds(updateDoc(doc(a, 'tenants', 'fresh'), { name: 'AZ Service', vatPercent: 19, workPerHour: 85, travelPerHour: 55, updatedAt: new Date() }));
  await assertSucceeds(setDoc(doc(a, 'tenants', 'fresh', 'clients', 'c1'), { name: 'Klient', address: '', vatId: '', updatedAt: new Date() }));
  await assertFails(updateDoc(doc(a, 'tenants', 'fresh'), { name: 'AZ Service', vatPercent: '19', workPerHour: 85, travelPerHour: 55, updatedAt: new Date() }));
});

test('LUKA udokumentowana: pusty wynik z kluczem przechodzi submit w regułach (treść = UI+admin)', async () => {
  await assertSucceeds(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { status: 'in_progress', rev: 1, updatedBy: 'tech1' }));
  await assertSucceeds(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { 'results.a': { outcome: null, note: null }, rev: 2, updatedBy: 'tech1' }));
  await assertSucceeds(updateDoc(doc(db('tech1'), p('workOrders', 'o1')), { status: 'submitted', rev: 3, updatedBy: 'tech1' }));
});

test('technik listFor: zapytanie złożone workOrderId+uid (wymaga indeksu złożonego w produkcji)', async () => {
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), p('timeEntries', 'te1')), { workOrderId: 'o1', uid: 'tech1', status: 'draft', kind: 'work', minutes: 10, date: '2026-01-01' });
    await setDoc(doc(c.firestore(), p('materials', 'mat1')), { workOrderId: 'o1', uid: 'tech1', status: 'draft', partId: 'p1', name: 'F', qty: 1 });
    await setDoc(doc(c.firestore(), p('defects', 'd1')), { workOrderId: 'o1', createdBy: 'tech1', status: 'open', severity: 'low', description: 'x', machineId: 'm1', itemId: 'a' });
  });
  await assertSucceeds(getDocs(query(collection(db('tech1'), p('timeEntries')), where('workOrderId', '==', 'o1'), where('uid', '==', 'tech1'))));
  await assertSucceeds(getDocs(query(collection(db('tech1'), p('materials')), where('workOrderId', '==', 'o1'), where('uid', '==', 'tech1'))));
  await assertSucceeds(getDocs(query(collection(db('tech1'), p('defects')), where('workOrderId', '==', 'o1'), where('createdBy', '==', 'tech1'))));
  await assertFails(getDocs(query(collection(db('tech2'), p('timeEntries')), where('workOrderId', '==', 'o1'), where('uid', '==', 'tech1'))));
});


test('DE trip bez city: buildTripInput → emulator save (SDK)', async () => {
  const input = buildTripInput({
    country: 'DE', city: '', start: '2026-11-02T07:33', end: '2026-11-02T19:34',
    dayCategory: 'partial_gt8', businessTripEligible: true,
  });
  assert.equal('city' in input, false);
  assert.equal(hasUndefinedDeep(input), null);
  const calc = calculateAllowance(input);
  assert.equal(calc.total, 14);
  const trip = { uid: 'tech1', workOrderId: '', input, calc: { total: calc.total, rate: { full: calc.rate.full, partial: calc.rate.partial } }, status: 'draft' };
  assert.equal(hasUndefinedDeep(trip), null);
  await assertSucceeds(setDoc(doc(db('tech1'), p('trips', 'de1')), trip));
  await assertFails(setDoc(doc(db('tech1'), p('trips', 'de2')), { ...trip, uid: 'tech2' }));
});



test('dziennik: batch create time+trip DE bez city (reguły produkcyjne)', async () => {
  const built = buildDailySheetPayloads({
    uid: 'tech1', date: '2026-11-06', workOrderId: 'o1',
    workStart: '08:00', workEnd: '17:00', breakDuration: '01:00',
    dietMode: 'day_gt8', businessTripEligible: true,
    absenceStart: '2026-11-06T06:00', absenceEnd: '2026-11-06T16:30',
    country: 'DE', mealBreakfast: true,
  });
  assert.equal(hasUndefinedDeep(built.trip), null);
  assert.equal('city' in built.trip.input, false);
  const dbf = db('tech1');
  const batch = writeBatch(dbf);
  batch.set(doc(dbf, p('timeEntries', built.timeId)), { ...built.timeEntry, createdAt: new Date().toISOString() });
  batch.set(doc(dbf, p('trips', built.tripId)), { ...built.trip, createdAt: new Date().toISOString() });
  await assertSucceeds(batch.commit());
  await assertFails(setDoc(doc(dbf, p('timeEntries', built.timeId)), { ...built.timeEntry, createdAt: new Date().toISOString() }));
});

test('dziennik: tech może usunąć własny szkic diety (OPEN order); approved nie', async () => {
  const built = buildDailySheetPayloads({
    uid: 'tech1', date: '2026-11-06', workOrderId: 'o1',
    workStart: '08:00', workEnd: '17:00', breakDuration: '01:00',
    dietMode: 'day_gt8', businessTripEligible: true,
    absenceStart: '2026-11-06T06:00', absenceEnd: '2026-11-06T16:30', country: 'DE',
  });
  const dbf = db('tech1');
  await assertSucceeds(setDoc(doc(dbf, p('timeEntries', built.timeId)), { ...built.timeEntry, createdAt: 't' }));
  await assertSucceeds(setDoc(doc(dbf, p('trips', built.tripId)), { ...built.trip, createdAt: 't' }));
  await assertSucceeds(deleteDoc(doc(dbf, p('trips', built.tripId))));
  await assertSucceeds(setDoc(doc(dbf, p('trips', built.tripId)), { ...built.trip, createdAt: 't2' }));
  // zatwierdzenie przez admina
  await assertSucceeds(updateDoc(doc(db('admin1'), p('trips', built.tripId)), {
    status: 'approved', approvedBy: 'admin1', approvedAt: 'now',
  }));
  await assertFails(deleteDoc(doc(dbf, p('trips', built.tripId))));
  // cudzy tech
  await assertFails(deleteDoc(doc(db('tech2'), p('trips', built.tripId))));
});

test('dziennik: atomowy replace diet→none (batch); approved blokuje i nic nie zmienia', async () => {
  const built = buildDailySheetPayloads({
    uid: 'tech1', date: '2026-11-09', workOrderId: 'o1',
    workStart: '08:00', workEnd: '17:00', breakDuration: '01:00',
    dietMode: 'day_gt8', businessTripEligible: true,
    absenceStart: '2026-11-09T06:00', absenceEnd: '2026-11-09T16:30', country: 'DE',
  });
  const dbf = db('tech1');
  await assertSucceeds(setDoc(doc(dbf, p('timeEntries', built.timeId)), { ...built.timeEntry, createdAt: 't' }));
  await assertSucceeds(setDoc(doc(dbf, p('trips', built.tripId)), { ...built.trip, createdAt: 't' }));
  const none = buildDailySheetPayloads({
    uid: 'tech1', date: '2026-11-09', workOrderId: 'o1',
    workStart: '09:00', workEnd: '17:00', breakDuration: '00:30', dietMode: 'none',
  });
  // Atomowo: update czasu + delete diety (bez delete+set tego samego ID)
  const batch = writeBatch(dbf);
  batch.update(doc(dbf, p('timeEntries', built.timeId)), {
    minutes: none.timeEntry.minutes, note: none.timeEntry.note, kind: 'work', date: none.timeEntry.date,
  });
  batch.delete(doc(dbf, p('trips', built.tripId)));
  await assertSucceeds(batch.commit());
  await env.withSecurityRulesDisabled(async c => {
    assert.equal((await getDoc(doc(c.firestore(), p('trips', built.tripId)))).exists(), false);
    assert.equal((await getDoc(doc(c.firestore(), p('timeEntries', none.timeId)))).data().minutes, none.timeEntry.minutes);
  });

  await assertSucceeds(setDoc(doc(dbf, p('trips', built.tripId)), { ...built.trip, createdAt: 't4' }));
  await assertSucceeds(updateDoc(doc(db('admin1'), p('timeEntries', none.timeId)), {
    status: 'approved', approvedBy: 'admin1', approvedAt: 'now',
  }));
  await assertSucceeds(updateDoc(doc(db('admin1'), p('trips', built.tripId)), {
    status: 'approved', approvedBy: 'admin1', approvedAt: 'now',
  }));
  const beforeMin = none.timeEntry.minutes;
  const bad = writeBatch(dbf);
  bad.update(doc(dbf, p('timeEntries', none.timeId)), { minutes: 1, note: 'x', kind: 'work', date: none.timeEntry.date });
  bad.delete(doc(dbf, p('trips', built.tripId)));
  await assertFails(bad.commit());
  await env.withSecurityRulesDisabled(async c => {
    const te = await getDoc(doc(c.firestore(), p('timeEntries', none.timeId)));
    const tr = await getDoc(doc(c.firestore(), p('trips', built.tripId)));
    assert.equal(te.data().status, 'approved');
    assert.equal(te.data().minutes, beforeMin);
    assert.equal(tr.data().status, 'approved');
  });
});

test('dziennik: tech bez przypisania / zamówienie approved – brak delete trip', async () => {
  await env.withSecurityRulesDisabled(async c => {
    const dbx = c.firestore();
    await setDoc(doc(dbx, p('trips', 'tx1')), {
      uid: 'tech1', workOrderId: 'o2', status: 'draft',
      input: { country: 'DE', start: '2026-11-01T08:00', end: '2026-11-01T18:00', overnight: false, meals: {}, employeeContribution: {} },
      calc: { total: 14 }, createdAt: 't',
    });
  });
  // o2 is approved – orderOpen false
  await assertFails(deleteDoc(doc(db('tech1'), p('trips', 'tx1'))));
});

test('dziennik: bez diety tylko time; partial fail nie zostawia trip', async () => {
  const built = buildDailySheetPayloads({
    uid: 'tech1', date: '2026-11-08', workOrderId: 'o1',
    workStart: '08:00', workEnd: '17:00', breakDuration: '01:00', dietMode: 'none',
  });
  const dbf = db('tech1');
  await assertSucceeds(setDoc(doc(dbf, p('timeEntries', built.timeId)), { ...built.timeEntry, createdAt: new Date().toISOString() }));
  await assertFails(setDoc(doc(dbf, p('trips', 'x')), { uid: 'tech2', workOrderId: 'o1', input: {}, calc: { total: 1 }, status: 'draft', createdAt: new Date().toISOString() }));
});
