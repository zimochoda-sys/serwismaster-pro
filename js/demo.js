// TRYB DEMO – wyłącznie w pamięci tej karty. Nic nie jest wysyłane ani zapisywane trwale.
// Służy do przećwiczenia przepływów. NIE jest wersją produkcyjną. Odświeżenie strony kasuje dane.
import { ConflictError, PermissionError } from './errors.js';
import { techCanEdit } from './domain/checklist.js';

const DEMO_USERS = {
  'demo-admin': { uid: 'demo-admin', email: 'admin@example.invalid', role: 'admin', active: true, displayName: 'Admin (przykład)' },
  'demo-tech': { uid: 'demo-tech', email: 'technik@example.invalid', role: 'tech', active: true, displayName: 'Technik A (przykład)' },
  'demo-tech2': { uid: 'demo-tech2', email: 'technik2@example.invalid', role: 'tech', active: true, displayName: 'Technik B (przykład)' },
};

export function createDemoStore() {
  let seq = 1; const id = p => `${p}-${seq++}`;
  const db = { members: {}, clients: {}, sites: {}, machines: {}, templates: {}, templateVersions: {}, workOrders: {}, defects: {}, timeEntries: {}, parts: {}, materials: {}, trips: {}, invoiceDrafts: {} };
  for (const u of Object.values(DEMO_USERS)) db.members[u.uid] = { role: u.role, active: true, displayName: u.displayName };
  let tenant = { name: 'Firma Przykładowa GmbH (DEMO)', vatPercent: 19, workPerHour: 85, travelPerHour: 55 };
  db.clients.c1 = { name: 'PRZYKŁAD Klient Metallbau', address: 'Musterstraße 1, 00000 Musterstadt', vatId: '' };
  db.sites.s1 = { clientId: 'c1', name: 'Hala 2 (przykład)', address: '' };
  db.machines.m1 = { clientId: 'c1', siteId: 's1', name: 'Sprężarka śrubowa (przykład)', model: 'Model-X', serial: 'DEMO-0001', machineType: 'sprężarka' };
  db.templates.t1 = { name: 'Przegląd roczny sprężarki (PRZYKŁAD)', machineType: 'sprężarka', currentVersion: 1 };
  db.templateVersions.v1 = { templateId: 't1', version: 1, name: 'Przegląd roczny sprężarki (PRZYKŁAD)',
    source: 'PRZYKŁAD DEMONSTRACYJNY – granice NIE pochodzą od producenta. Przed użyciem wpisz wartości z dokumentacji konkretnej maszyny.',
    items: [
      { id: 'lockout', label: 'Odłączenie i zabezpieczenie energii (LOTO) wykonane', type: 'check', required: true, instructions: 'Wg procedury zakładu.' },
      { id: 'guards', label: 'Osłony i zabezpieczenia kompletne', type: 'check', required: true, instructions: '' },
      { id: 'pressure', label: 'Ciśnienie robocze', type: 'measure', unit: 'bar', min: 7, max: 8, limitSource: 'PRZYKŁAD – nie wartość producenta', required: true, instructions: 'Odczyt na manometrze po 5 min pracy.' },
      { id: 'oil', label: 'Poziom oleju', type: 'check', required: true, instructions: 'Wziernik.' },
      { id: 'notes', label: 'Uwagi technika', type: 'text', required: false, instructions: '' },
    ], createdBy: 'demo-admin' };
  db.parts.p1 = { sku: 'DEMO-FLT', name: 'Filtr powietrza (przykład)', stock: 5, unitPrice: 24.9 };
  db.workOrders.o1 = { title: 'Przegląd roczny (przykład)', clientId: 'c1', siteId: 's1', machineId: 'm1', assignedTo: 'demo-tech', dueDate: '2026-11-20', status: 'planned',
    snapshot: snap(db.templateVersions.v1, 'v1'), results: {}, rev: 0, createdBy: 'demo-admin' };

  function snap(v) { const items = v.items.map(i => ({ ...i })); return { templateId: v.templateId, templateVersion: v.version, templateName: v.name, source: v.source, items, requiredItemIds: items.filter(i => i.required).map(i => i.id) }; }
  let me = null; const listeners = [];
  const clone = x => JSON.parse(JSON.stringify(x));
  const rows = name => Object.entries(db[name]).map(([k, v]) => ({ id: k, ...clone(v) }));
  const admin = () => { if (me?.role !== 'admin') throw new PermissionError(); };
  const assigned = oid => db.workOrders[oid]?.assignedTo === me.uid;

  const store = {
    mode: 'demo', photosEnabled: true, label: 'TRYB DEMO – dane przykładowe tylko w pamięci, bez chmury',
    users: Object.values(DEMO_USERS),
    onAuth(cb) { listeners.push(cb); cb(me); return () => {}; },
    async signInDemo(uid) { me = { ...DEMO_USERS[uid] }; listeners.forEach(l => l(me)); },
    async signIn() { throw new Error('W trybie demo wybierz użytkownika przykładowego.'); },
    async resetPassword() { throw new Error('Niedostępne w trybie demo.'); },
    async signOut() { me = null; listeners.forEach(l => l(null)); },
    async tenant() { return clone(tenant); },
    async saveTenant(d) { admin(); tenant = { ...tenant, ...d }; },
    async list(name) { if (['members', 'invoiceDrafts'].includes(name) || ['workOrders', 'timeEntries', 'materials', 'trips', 'defects'].includes(name)) admin(); return rows(name); },
    async listMine(name) { const f = name === 'workOrders' ? 'assignedTo' : name === 'defects' ? 'createdBy' : 'uid'; return rows(name).filter(r => r[f] === me.uid); },
    async listOrders() { return me.role === 'admin' ? rows('workOrders') : store.listMine('workOrders'); },
    async listFor(name, oid) { return rows(name).filter(r => r.workOrderId === oid && (me.role === 'admin' || r[name === 'defects' ? 'createdBy' : 'uid'] === me.uid)); },
    async get(name, k) { const v = db[name][k]; if (!v) return null; if (name === 'workOrders' && me.role !== 'admin' && !assigned(k)) throw new PermissionError(); return { id: k, ...clone(v) }; },
    async add(name, data) {
      if (['timeEntries', 'materials', 'defects'].includes(name)) {
        const o = db.workOrders[data.workOrderId];
        if (me.role !== 'admin' && (!assigned(data.workOrderId) || !techCanEdit(o.status))) throw new PermissionError('Zlecenie nieprzypisane lub zablokowane.');
        if ((data.uid || data.createdBy) !== me.uid) throw new PermissionError();
      } else if (name !== 'trips') admin();
      const k = id(name); db[name][k] = clone(data); return k;
    },
    async set(name, k, data) { admin(); db[name][k] = clone(data); },
    async update(name, k, data) {
      if (!['trips'].includes(name) || data.status) admin();
      if (name === 'invoiceDrafts' && data.status && data.status !== 'draft') throw new PermissionError('Tylko szkice.');
      Object.assign(db[name][k], clone(data));
    },
    async remove(name, k) { admin(); delete db[name][k]; },
    async upsertMember(uid, data) { admin(); if (uid === me.uid) throw new PermissionError('Nie możesz zmieniać własnej roli.'); db.members[uid] = { ...data, updatedBy: me.uid }; },
    async createTemplateVersion({ templateId, name, machineType, source, items }) {
      admin(); const tid = templateId || id('tpl'); const version = (db.templates[tid]?.currentVersion || 0) + 1; const vid = id('ver');
      db.templateVersions[vid] = clone({ templateId: tid, version, name, source, items, createdBy: me.uid });
      db.templates[tid] = { name, machineType, currentVersion: version }; return { templateId: tid, versionId: vid, version };
    },
    async createOrder(o) { admin(); const k = id('wo'); db.workOrders[k] = clone({ ...o, status: 'planned', results: {}, rev: 0, createdBy: me.uid }); return k; },
    async patchOrder(oid, expectedRev, patch) {
      const o = db.workOrders[oid];
      if (!o) throw new Error('Brak zlecenia');
      if (o.status === 'approved') throw new PermissionError('Zatwierdzony protokół jest zablokowany.');
      if (o.rev !== expectedRev) throw new ConflictError();
      const keys = Object.keys(patch);
      if (me.role === 'tech') {
        if (!assigned(oid)) throw new PermissionError();
        const isResult = keys.every(k => k.startsWith('results.'));
        if (isResult && !techCanEdit(o.status)) throw new PermissionError('Protokół przekazany – edycja zablokowana.');
        if (!isResult && !keys.every(k => ['status', 'submittedAt'].includes(k))) throw new PermissionError();
        if (patch.status === 'submitted' && !o.snapshot.requiredItemIds.every(r => o.results[r])) throw new PermissionError('Brak wymaganych odpowiedzi.');
        if (patch.status && !({ planned: ['in_progress'], in_progress: ['submitted'], rejected: ['in_progress', 'submitted'] }[o.status] || []).includes(patch.status)) throw new PermissionError('Niedozwolona zmiana statusu.');
      } else if (patch.status && !(o.status === 'submitted' && ['approved', 'rejected'].includes(patch.status))) throw new PermissionError('Niedozwolona zmiana statusu.');
      for (const [k, v] of Object.entries(clone(patch))) { if (k.startsWith('results.')) o.results[k.slice(8)] = v; else o[k] = v === '__now__' ? new Date().toISOString() : v; }
      o.rev = expectedRev + 1; o.updatedBy = me.uid; return o.rev;
    },
    async approveMaterial(mid) {
      admin(); const m = db.materials[mid]; if (m.status !== 'draft') throw new ConflictError('Już rozliczone.');
      const p = db.parts[m.partId]; if (!p || p.stock < m.qty) throw new Error('Za mały stan magazynu.');
      p.stock -= m.qty; m.status = 'approved'; m.approvedBy = me.uid;
    },
    async uploadPhoto(oid, file) { if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Dozwolone: JPG, PNG, WEBP.'); const url = URL.createObjectURL(file); return 'demo:' + url; },
    async photoUrl(path) { return path.replace(/^demo:/, ''); },
    now: () => '__now__',
    _simulateRemoteEdit(oid) { db.workOrders[oid].rev++; }, // do testu konfliktów
  };
  return store;
}
