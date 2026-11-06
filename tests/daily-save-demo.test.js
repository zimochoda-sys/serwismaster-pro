import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoStore } from '../js/demo.js';
import { buildDailySheetPayloads } from '../js/domain/daily-sheet.js';
import { ConflictError, PermissionError } from '../js/errors.js';

test('demo saveDailySheet: none, duplicate, replace diet→none bez orphan', async () => {
  const store = createDemoStore();
  await store.signInDemo('demo-tech');
  const base = {
    uid: 'demo-tech', date: '2026-11-06', workOrderId: 'o1',
    workStart: '08:00', workEnd: '17:00', breakDuration: '01:00',
  };
  const none = buildDailySheetPayloads({ ...base, dietMode: 'none' });
  await store.saveDailySheet({ ...none, replace: false });
  await assert.rejects(() => store.saveDailySheet({ ...none, replace: false }), ConflictError);

  const withDiet = buildDailySheetPayloads({
    ...base, dietMode: 'day_gt8', businessTripEligible: true,
    absenceStart: '2026-11-06T06:00', absenceEnd: '2026-11-06T16:30', country: 'DE',
  });
  await store.saveDailySheet({ ...withDiet, replace: true });
  const t = await store.get('trips', withDiet.tripId);
  assert.equal(t.status, 'draft');
  assert.ok(t.calc.total > 0);

  // diet→none bez replace = konflikt (nie kasuje cicho)
  await assert.rejects(() => store.saveDailySheet({ ...none, replace: false }), ConflictError);
  assert.ok(await store.get('trips', withDiet.tripId));

  await store.saveDailySheet({ ...none, replace: true });
  assert.equal(await store.get('trips', withDiet.tripId), null);
  const times = await store.listMine('timeEntries');
  assert.equal(times.filter(x => x.id === none.timeId).length, 1);
});

test('demo: approved time/trip nie do nadpisania – stan bez zmian', async () => {
  const store = createDemoStore();
  await store.signInDemo('demo-tech');
  const built = buildDailySheetPayloads({
    uid: 'demo-tech', date: '2026-11-06', workOrderId: 'o1',
    workStart: '08:00', workEnd: '17:00', breakDuration: '01:00',
    dietMode: 'day_gt8', businessTripEligible: true,
    absenceStart: '2026-11-06T06:00', absenceEnd: '2026-11-06T16:30', country: 'DE',
  });
  await store.saveDailySheet({ ...built, replace: false });
  // admin zatwierdza
  await store.signInDemo('demo-admin');
  await store.update('timeEntries', built.timeId, { status: 'approved', approvedBy: 'demo-admin' });
  await store.update('trips', built.tripId, { status: 'approved', approvedBy: 'demo-admin' });
  const snapT = await store.get('timeEntries', built.timeId);
  const snapTr = await store.get('trips', built.tripId);

  await store.signInDemo('demo-tech');
  const none = buildDailySheetPayloads({
    uid: 'demo-tech', date: '2026-11-06', workOrderId: 'o1',
    workStart: '09:00', workEnd: '16:00', breakDuration: '00:00', dietMode: 'none',
  });
  await assert.rejects(() => store.saveDailySheet({ ...none, replace: true }), ConflictError);
  const afterT = await store.get('timeEntries', built.timeId);
  const afterTr = await store.get('trips', built.tripId);
  assert.equal(afterT.status, 'approved');
  assert.equal(afterT.minutes, snapT.minutes);
  assert.equal(afterTr.status, 'approved');
  assert.equal(afterTr.calc.total, snapTr.calc.total);
});

test('demo: tech2 nie zapisuje na cudze zlecenie; admin własne UID', async () => {
  const store = createDemoStore();
  await store.signInDemo('demo-tech2');
  const built = buildDailySheetPayloads({
    uid: 'demo-tech2', date: '2026-11-06', workOrderId: 'o1',
    workStart: '08:00', workEnd: '12:00', breakDuration: '00:00', dietMode: 'none',
  });
  await assert.rejects(() => store.saveDailySheet({ ...built, replace: false }), PermissionError);

  await store.signInDemo('demo-admin');
  const admin = buildDailySheetPayloads({
    uid: 'demo-admin', date: '2026-11-06', workOrderId: 'o1',
    workStart: '08:00', workEnd: '12:00', breakDuration: '00:00', dietMode: 'none',
  });
  await store.saveDailySheet({ ...admin, replace: false });
  assert.equal((await store.get('timeEntries', admin.timeId)).uid, 'demo-admin');
});
