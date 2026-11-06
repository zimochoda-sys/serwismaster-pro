import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAllowance, rateFor, splitAmounts, AllowanceError, listCountries } from '../js/domain/allowance.js';
import { validateTemplate, snapshotFor, validateSubmission, validateResult, canTransition } from '../js/domain/checklist.js';
import { buildInvoiceDraft, validateTimeEntry, sumTime } from '../js/domain/billing.js';

test('DE krajowe 2026: >8h = 14 €, ≤8h = 0', () => {
  assert.equal(calculateAllowance({ country: 'DE', start: '2026-03-02T06:00', end: '2026-03-02T14:30', overnight: false }).total, 14);
  assert.equal(calculateAllowance({ country: 'DE', start: '2026-03-02T06:00', end: '2026-03-02T14:00', overnight: false }).total, 0);
});
test('DE z noclegiem: 14 + 28 + 14', () => {
  const r = calculateAllowance({ country: 'DE', start: '2026-03-02T15:00', end: '2026-03-04T10:00', overnight: true });
  assert.deepEqual(r.days.map(d => d.amount), [14, 28, 14]);
  assert.equal(r.total, 56);
});
test('BMF 2026: Warszawa 40/27, Wrocław 34/23, reszta Polski 34/23', () => {
  assert.deepEqual([rateFor(2026, 'Polen', 'Warschau').full, rateFor(2026, 'Polen', 'Warschau').partial], [40, 27]);
  assert.deepEqual([rateFor(2026, 'Polen', 'Breslau').full, rateFor(2026, 'Polen', 'Breslau').partial], [34, 23]);
  assert.deepEqual([rateFor(2026, 'Polen', '_rest').full, rateFor(2026, 'Polen', '_rest').partial], [34, 23]);
  assert.ok(listCountries(2026).length > 150);
});
test('Nieznany kraj / rok / brak miasta blokuje (bez fallbacku)', () => {
  assert.throws(() => rateFor(2026, 'Atlantis'), AllowanceError);
  assert.throws(() => rateFor(2025, 'DE'), AllowanceError);
  assert.throws(() => rateFor(2026, 'Polen'), AllowanceError);
  assert.throws(() => calculateAllowance({ country: 'Atlantis', start: '2026-01-05T06:00', end: '2026-01-05T18:00' }), AllowanceError);
});
test('Posiłki 20/40/40 od stawki dobowej, min. 0, dopłata pracownika', () => {
  const base = { country: 'Polen', city: 'Warschau', start: '2026-05-04T06:00', end: '2026-05-06T20:00', overnight: true };
  const r = calculateAllowance({ ...base, meals: { '2026-05-05': { breakfast: true } } });
  assert.equal(r.days[1].amount, 32); // 40 - 8
  const r2 = calculateAllowance({ ...base, meals: { '2026-05-04': { breakfast: true, lunch: true, dinner: true } } });
  assert.equal(r2.days[0].amount, 0); // 27 - 40 -> 0
  const r3 = calculateAllowance({ ...base, meals: { '2026-05-05': { lunch: true } }, employeeContribution: { '2026-05-05': 5 } });
  assert.equal(r3.days[1].amount, 29); // 40 - (16-5)
});
test('Przypadki złożone => ręczna weryfikacja', () => {
  assert.equal(calculateAllowance({ country: 'DE', start: '2026-02-02T18:00', end: '2026-02-03T04:00', overnight: false }).autoApprovable, false);
  assert.equal(calculateAllowance({ country: 'DE', start: '2026-02-02T06:00', end: '2026-02-02T18:00', crossBorderMultipleCountries: true }).autoApprovable, false);
  assert.equal(calculateAllowance({ country: 'DE', start: '2026-06-02T06:00', end: '2026-06-02T18:00', sameSiteSince: '2026-01-10' }).autoApprovable, false);
  assert.equal(calculateAllowance({ country: 'DE', start: '2026-06-02T06:00', end: '2026-06-02T18:00', sameSiteSince: '2026-01-10', interruptedWeeks: 4 }).autoApprovable, true);
});
test('Rozdzielenie: podatkowe / zwrot firmy / klient', () => {
  const c = calculateAllowance({ country: 'DE', start: '2026-03-02T15:00', end: '2026-03-04T10:00', overnight: true });
  assert.deepEqual(splitAmounts(c, { reimbursePerDay: 30, customerPerDay: 45 }), { taxFree: 56, reimbursement: 90, taxableExcess: 34, customerBilling: 135 });
});
const tv = { templateId: 't1', version: 2, name: 'Demo', items: [
  { id: 'a', label: 'Osłony', type: 'check', required: true },
  { id: 'b', label: 'Ciśnienie', type: 'measure', unit: 'bar', min: 5, max: 7, limitSource: 'DEMO', required: true },
  { id: 'c', label: 'Uwagi', type: 'text', required: false }] };
test('Szablon: walidacja granic wymaga źródła', () => {
  assert.deepEqual(validateTemplate(tv.items), []);
  assert.ok(validateTemplate([{ id: 'x', label: 'P', type: 'measure', unit: 'bar', max: 3 }]).length);
});
test('Snapshot + walidacja zgłoszenia', () => {
  const s = snapshotFor(tv);
  assert.deepEqual(s.requiredItemIds, ['a', 'b']);
  tv.items[0].label = 'zmienione'; assert.equal(s.items[0].label, 'Osłony');
  assert.equal(validateSubmission(s, {}).length, 2);
  assert.ok(validateResult(s.items[1], { outcome: 'ok', value: 9 }).length);
  assert.deepEqual(validateResult(s.items[1], { outcome: 'defect', value: 9, note: 'za wysoko' }), []);
  assert.ok(validateResult(s.items[0], { outcome: 'na' }).length);
  assert.deepEqual(validateSubmission(s, { a: { outcome: 'na', naReason: 'brak osłon w tej wersji' }, b: { outcome: 'ok', value: 6 } }), []);
});
test('Przejścia statusów', () => {
  assert.ok(canTransition('tech', 'in_progress', 'submitted'));
  assert.ok(!canTransition('tech', 'submitted', 'approved'));
  assert.ok(!canTransition('admin', 'approved', 'rejected'));
});
test('Czas i szkic rachunku tylko z zatwierdzonych, VAT konfigurowalny', () => {
  assert.ok(validateTimeEntry({ kind: 'work', minutes: 0, date: '2026-01-01' }).length);
  const order = { id: 'o1', status: 'approved', clientId: 'c' };
  const te = [{ workOrderId: 'o1', kind: 'work', minutes: 90, status: 'approved' }, { workOrderId: 'o1', kind: 'travel', minutes: 30, status: 'approved' },
    { workOrderId: 'o1', kind: 'work', minutes: 600, status: 'draft' }];
  assert.deepEqual(sumTime(te), { work: 690, travel: 30, break: 0 });
  const inv = buildInvoiceDraft({ order, timeEntries: te, materials: [{ workOrderId: 'o1', name: 'Filtr', qty: 2, unitPrice: 12.35, status: 'approved' }], rates: { workPerHour: 80, travelPerHour: 50 }, vatPercent: 19 });
  assert.equal(inv.netCents, 12000 + 2500 + 2470);
  assert.equal(inv.vatCents, Math.round(16970 * 0.19));
  assert.equal(inv.grossCents, 16970 + 3224);
  assert.equal(inv.number, null);
  assert.throws(() => buildInvoiceDraft({ order: { ...order, status: 'submitted' }, timeEntries: [], materials: [], rates: {}, vatPercent: 19 }));
});
