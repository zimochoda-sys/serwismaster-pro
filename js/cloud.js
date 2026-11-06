// Integracja z Firebase (Auth, Firestore, opcjonalnie Storage) – modularny SDK z oficjalnego CDN.
import { ConflictError, PermissionError } from './errors.js';
const V = '13.2.0';
const CDN = m => `https://www.gstatic.com/firebasejs/${V}/firebase-${m}.js`;

export function photosEnabled(config) {
  return config?.features?.photos === true;
}

export async function createCloudStore(config) {
  const usePhotos = photosEnabled(config);
  const mods = [import(CDN('app')), import(CDN('auth')), import(CDN('firestore'))];
  if (usePhotos) mods.push(import(CDN('storage')));
  const loaded = await Promise.all(mods);
  const [{ initializeApp }, A, F] = loaded;
  const S = usePhotos ? loaded[3] : null;
  const app = initializeApp(config.firebase);
  const auth = A.getAuth(app);
  // Bez persistentLocalCache: zapis offline nie jest udawany – transakcje wymagają serwera.
  const db = F.getFirestore(app);
  const storage = usePhotos ? S.getStorage(app) : null;
  if (config.useEmulators) {
    A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    F.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    if (usePhotos && storage) S.connectStorageEmulator(storage, '127.0.0.1', 9199);
  }
  await A.setPersistence(auth, config.authPersistence === 'local' ? A.browserLocalPersistence : A.browserSessionPersistence);
  const T = config.tenantId;
  const col = name => F.collection(db, 'tenants', T, name);
  const d = (name, id) => F.doc(db, 'tenants', T, name, id);
  const now = () => F.serverTimestamp();
  const snap2 = s => s.docs.map(x => ({ id: x.id, ...x.data() }));
  let me = null;
  const noPhotos = () => { throw new Error('Zdjęcia wyłączone (features.photos=false / plan Spark bez Cloud Storage).'); };

  const store = {
    mode: 'cloud',
    label: `Chmura Firebase (projekt ${config.firebase.projectId}, firma ${T}${usePhotos ? '' : ', bez zdjęć'})`,
    photosEnabled: usePhotos,
    onAuth(cb) {
      return A.onAuthStateChanged(auth, async user => {
        if (!user) { me = null; return cb(null); }
        const m = await F.getDoc(d('members', user.uid)).catch(e => ({ error: e }));
        if (m.error || !m.exists() || !m.data().active) { me = { uid: user.uid, email: user.email, role: null }; return cb(me); }
        me = { uid: user.uid, email: user.email, ...m.data() };
        cb(me);
      });
    },
    signIn: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
    resetPassword: email => A.sendPasswordResetEmail(auth, email),
    signOut: () => A.signOut(auth),
    async tenant() { const s = await F.getDoc(F.doc(db, 'tenants', T)); return s.exists() ? s.data() : {}; },
    async saveTenant(data) { await F.updateDoc(F.doc(db, 'tenants', T), { ...data, updatedAt: now() }); },
    async list(name) { return snap2(await F.getDocs(col(name))); },
    async listMine(name) {
      const field = name === 'workOrders' ? 'assignedTo' : name === 'defects' ? 'createdBy' : 'uid';
      return snap2(await F.getDocs(F.query(col(name), F.where(field, '==', me.uid))));
    },
    async listOrders() { return me.role === 'admin' ? store.list('workOrders') : store.listMine('workOrders'); },
    async listFor(name, orderId) {
      const q = me.role === 'admin' ? F.query(col(name), F.where('workOrderId', '==', orderId))
        : F.query(col(name), F.where('workOrderId', '==', orderId), F.where(name === 'defects' ? 'createdBy' : 'uid', '==', me.uid));
      return snap2(await F.getDocs(q));
    },
    async get(name, id) { const s = await F.getDoc(d(name, id)); return s.exists() ? { id: s.id, ...s.data() } : null; },
    async add(name, data) { const ref = await F.addDoc(col(name), { ...data, ...(stamp(name)) }); return ref.id; },
    async set(name, id, data) { await F.setDoc(d(name, id), data); },
    async update(name, id, data) { await F.updateDoc(d(name, id), data); },
    async remove(name, id) { await F.deleteDoc(d(name, id)); },
    async upsertMember(uid, data) {
      if (uid === me.uid) throw new PermissionError('Nie możesz zmieniać własnej roli.');
      await F.setDoc(d('members', uid), { ...data, updatedBy: me.uid, updatedAt: now() });
    },
    async createTemplateVersion({ templateId, name, machineType, source, items }) {
      return F.runTransaction(db, async tx => {
        const tRef = templateId ? d('templates', templateId) : F.doc(col('templates'));
        const cur = templateId ? await tx.get(tRef) : null;
        const version = (cur?.exists() ? cur.data().currentVersion : 0) + 1;
        const vRef = F.doc(col('templateVersions'));
        tx.set(vRef, { templateId: tRef.id, version, name, source, items, createdBy: me.uid, createdAt: now() });
        tx.set(tRef, { name, machineType: machineType || '', currentVersion: version, updatedAt: now() });
        return { templateId: tRef.id, versionId: vRef.id, version };
      });
    },
    async createOrder(o) { const ref = await F.addDoc(col('workOrders'), { ...o, status: 'planned', results: {}, rev: 0, createdBy: me.uid, createdAt: now(), updatedAt: now(), updatedBy: me.uid }); return ref.id; },
    /** Zmiana zlecenia z kontrolą wersji (rev). patch może zawierać 'results.<id>'. */
    async patchOrder(id, expectedRev, patch) {
      return F.runTransaction(db, async tx => {
        const ref = d('workOrders', id);
        const s = await tx.get(ref);
        if (!s.exists()) throw new Error('Zlecenie nie istnieje lub brak dostępu.');
        if (s.data().rev !== expectedRev) throw new ConflictError();
        const p = { ...patch, rev: expectedRev + 1, updatedAt: now(), updatedBy: me.uid };
        for (const k of Object.keys(p)) if (p[k] === '__now__') p[k] = now();
        tx.update(ref, p);
        return expectedRev + 1;
      });
    },
    async approveMaterial(mid) {
      return F.runTransaction(db, async tx => {
        const mRef = d('materials', mid); const m = await tx.get(mRef);
        if (!m.exists() || m.data().status !== 'draft') throw new ConflictError('Pozycja już rozliczona.');
        const pRef = d('parts', m.data().partId); const p = await tx.get(pRef);
        if (!p.exists() || p.data().stock < m.data().qty) throw new Error('Za mały stan magazynu.');
        tx.update(pRef, { stock: F.increment(-m.data().qty) });
        tx.update(mRef, { status: 'approved', approvedBy: me.uid, approvedAt: now() });
      });
    },
    async uploadPhoto(orderId, file) {
      if (!usePhotos || !storage) noPhotos();
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Dozwolone: JPG, PNG, WEBP.');
      if (file.size >= 10 * 1024 * 1024) throw new Error('Maks. 10 MB.');
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
      const path = `tenants/${T}/workOrders/${orderId}/${me.uid}/${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}.${ext}`;
      await S.uploadBytes(S.ref(storage, path), file, { contentType: file.type });
      return path;
    },
    photoUrl: path => {
      if (!usePhotos || !storage) return Promise.reject(new Error('Zdjęcia wyłączone.'));
      return S.getDownloadURL(S.ref(storage, path));
    },
    /**
     * Atomowy zapis dziennika (deterministyczne ID = uid+date+workOrderId).
     * replace=false: konflikt gdy time lub trip istnieje.
     * replace=true: update treści szkicu; diet→none = delete trip w tej samej transakcji.
     * Uwaga: delete+set tego samego ID w batch = update w regułach – dlatego replace time/trip robi update, nie delete+create.
     * Approved/rejected → Conflict, transakcja bez zmian.
     */
    async saveDailySheet({ timeId, timeEntry, tripId = null, trip = null, replace = false }) {
      if (!timeId || !timeEntry) throw new Error('Brak wpisu czasu.');
      if (!tripId) throw new Error('Brak tripId (wymagane do atomowego czyszczenia diety).');
      if (timeEntry.uid !== me.uid) throw new PermissionError('Dieta/czas tylko na własne konto.');
      if (trip && trip.uid !== me.uid) throw new PermissionError('Dieta tylko na własne konto.');
      const timeRef = d('timeEntries', timeId);
      const tripRef = d('trips', tripId);
      return F.runTransaction(db, async tx => {
        const curTime = await tx.get(timeRef);
        const curTrip = await tx.get(tripRef);
        if (curTime.exists()) {
          if (curTime.data().uid !== me.uid) throw new PermissionError();
          if (curTime.data().status !== 'draft') throw new ConflictError('Wpis czasu już zatwierdzony – bez edycji.');
          if (!replace) throw new ConflictError('Wpis na ten dzień i zlecenie już istnieje (unikaj duplikatu).');
        }
        if (curTrip.exists()) {
          if (curTrip.data().uid !== me.uid) throw new PermissionError();
          if (!['draft', 'manual_review'].includes(curTrip.data().status)) {
            throw new ConflictError('Dieta już rozpatrzona – bez edycji.');
          }
          if (!replace) throw new ConflictError('Dieta na ten dzień już istnieje (zaznacz Nadpisz szkic).');
        }
        if (curTime.exists()) {
          tx.update(timeRef, {
            minutes: timeEntry.minutes,
            note: timeEntry.note || '',
            kind: timeEntry.kind,
            date: timeEntry.date,
          });
        } else {
          tx.set(timeRef, { ...timeEntry, createdAt: now() });
        }
        if (curTrip.exists()) {
          if (trip) {
            tx.update(tripRef, { input: trip.input, calc: trip.calc, status: trip.status });
          } else {
            tx.delete(tripRef); // diet → none, atomowo z update czasu
          }
        } else if (trip) {
          tx.set(tripRef, { ...trip, createdAt: now() });
        }
        return { timeId, tripId: trip ? tripId : null };
      });
    },
    now: () => '__now__',
  };
  function stamp(name) { return ['timeEntries', 'materials', 'trips', 'defects'].includes(name) ? { createdAt: now() } : { updatedAt: now() }; }
  return store;
}
