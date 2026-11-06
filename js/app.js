// SerwisMaster – główna logika interfejsu (moduł ES, bez bundlera).
import { esc, $, $$, status, opt, formData } from './ui.js';
import { humanError, ConflictError, ValidationError } from './errors.js';
import { createDemoStore } from './demo.js';
import { ORDER_STATUSES, ITEM_TYPES, validateResult, validateSubmission, validateTemplate, snapshotFor, techCanEdit, isOutOfRange } from './domain/checklist.js';
import { TIME_KINDS, validateTimeEntry, sumTime, buildInvoiceDraft, fmtEur } from './domain/billing.js';
import { calculateAllowance, splitAmounts, listCountries, listCities, AllowanceError } from './domain/allowance.js';

let store = null, me = null, view = 'orders', current = null, cfg = null;
const app = () => $('#app');

// ---------- start ----------
async function boot() {
  window.addEventListener('online', netBadge); window.addEventListener('offline', netBadge);
  try { cfg = (await import('./config.js')).CONFIG; } catch { cfg = null; }
  const missing = !cfg || !cfg.firebase || !cfg.firebase.projectId || !cfg.firebase.apiKey || !cfg.tenantId;
  if (missing) return renderSetup(cfg ? 'Plik js/config.js istnieje, ale brakuje firebase.apiKey/projectId lub tenantId.' : 'Brak pliku js/config.js.');
  try {
    const { createCloudStore } = await import('./cloud.js');
    store = await createCloudStore(cfg);
  } catch (e) { return renderSetup('Nie udało się załadować Firebase SDK: ' + humanError(e)); }
  store.onAuth(onUser);
}

function renderSetup(reason) {
  $('#modeBadge').textContent = 'Brak konfiguracji chmury'; $('#modeBadge').className = 'badge warn';
  app().innerHTML = `<section class="panel narrow">
    <h2>Chmura nie jest skonfigurowana</h2>
    <p class="warn-box">${esc(reason)} Żadne dane nie są zapisywane w chmurze. Logowanie jest wyłączone, dopóki administrator nie skonfiguruje projektu Firebase (patrz README.md, rozdz. „Konfiguracja”).</p>
    <button class="btn" disabled title="Wymaga js/config.js z konfiguracją projektu Firebase">Zaloguj (niedostępne – brak konfiguracji)</button>
    <hr><h3>Tryb DEMO (opcjonalny)</h3>
    <p>Dane przykładowe tylko w pamięci tej karty – nic nie trafia do chmury, odświeżenie kasuje wszystko. Nie używaj do prawdziwych zleceń.</p>
    <button class="btn btn-amber" data-action="startDemo">Uruchom tryb DEMO</button></section>`;
}

function startDemo() {
  store = createDemoStore();
  document.body.classList.add('demo');
  // Hak testowy tylko w DEMO: symuluje zmianę z innego urządzenia (test konfliktu).
  window.__smTest = { remoteEdit: () => current && store._simulateRemoteEdit(current.id) };
  store.onAuth(onUser);
}

function onUser(u) {
  me = u; netBadge();
  $('#modeBadge').textContent = store.mode === 'demo' ? 'DEMO – dane przykładowe, bez chmury' : 'Chmura';
  $('#modeBadge').className = 'badge ' + (store.mode === 'demo' ? 'demo' : 'ok');
  if (!u) return renderLogin();
  if (!u.role) {
    app().innerHTML = `<section class="panel narrow"><h2>Brak dostępu do firmy</h2>
      <p>Zalogowano jako ${esc(u.email)}, ale to konto nie jest członkiem firmy „${esc(cfg?.tenantId)}” lub jest nieaktywne.</p>
      <p>Przekaż administratorowi swój UID: <code id="myUid">${esc(u.uid)}</code></p>
      <button class="btn btn-gray" data-action="logout">Wyloguj</button></section>`;
    renderNav(); return;
  }
  view = u.role === 'admin' ? 'orders' : 'orders';
  renderNav(); go(view);
}

function renderLogin() {
  renderNav();
  if (store.mode === 'demo') {
    app().innerHTML = `<section class="panel narrow"><h2>Tryb DEMO – wybierz użytkownika przykładowego</h2>
      ${store.users.map(u => `<button class="btn" data-action="demoLogin" data-uid="${u.uid}">${esc(u.displayName)} – ${u.role === 'admin' ? 'administrator' : 'technik'}</button>`).join(' ')}
      <p class="muted">W chmurze rolę nadaje wyłącznie administrator / skrypt startowy; tu jest tylko symulacja.</p></section>`;
    return;
  }
  app().innerHTML = `<section class="panel narrow"><h2>Logowanie</h2>
    <form id="loginForm"><label>E-mail<input name="email" type="email" required autocomplete="username"></label>
    <label>Hasło<input name="pw" type="password" required autocomplete="current-password"></label>
    <button class="btn">Zaloguj</button> <button type="button" class="btn btn-gray" data-action="reset">Reset hasła</button></form>
    <p class="muted">Konta zakłada administrator w konsoli Firebase (README). Rejestracja w aplikacji jest wyłączona.</p></section>`;
  $('#loginForm').onsubmit = async e => { e.preventDefault(); const f = formData(e.target);
    try { status('Logowanie…'); await store.signIn(f.email, f.pw); status('Zalogowano', 'ok'); } catch (er) { status(humanError(er), 'err'); } };
}

const TABS = {
  tech: [['orders', 'Moje zlecenia'], ['trips', 'Delegacje / diety']],
  admin: [['orders', 'Zlecenia'], ['approvals', 'Akceptacje'], ['assets', 'Klienci i maszyny'], ['templates', 'Szablony checklist'], ['parts', 'Magazyn'], ['trips', 'Diety'], ['invoices', 'Szkice rachunków'], ['team', 'Zespół'], ['settings', 'Ustawienia']],
};
function renderNav() {
  const nav = $('#nav');
  if (!me?.role) { nav.innerHTML = me ? '' : ''; $('#userBox').innerHTML = me ? `<button class="btn btn-gray" data-action="logout">Wyloguj</button>` : ''; return; }
  nav.innerHTML = TABS[me.role].map(([k, l]) => `<button class="tab-btn ${k === view ? 'active' : ''}" data-action="go" data-view="${k}">${l}</button>`).join('');
  $('#userBox').innerHTML = `<span class="muted">${esc(me.displayName || me.email)} (${me.role === 'admin' ? 'admin' : 'technik'})</span> <button class="btn btn-gray" data-action="logout">Wyloguj</button>`;
}
function netBadge() { const b = $('#netBadge'); if (!b) return; const on = navigator.onLine; b.textContent = on ? 'online' : 'OFFLINE – zapisy niemożliwe'; b.className = 'badge ' + (on ? 'ok' : 'err'); }

async function go(v, arg) {
  view = v; renderNav();
  try {
    app().innerHTML = '<p class="muted">Ładowanie…</p>';
    await VIEWS[v](arg);
  } catch (e) { app().innerHTML = `<section class="panel"><p class="err-box">${esc(humanError(e))}</p></section>`; status(humanError(e), 'err'); }
}
async function guarded(label, fn) {
  if (store.mode === 'cloud' && !navigator.onLine) { status('Offline – NIE zapisano. Połącz się z siecią.', 'err'); return false; }
  status(label + '…', 'busy');
  try { const r = await fn(); status(store.mode === 'demo' ? label + ': zapisano (tylko DEMO w pamięci)' : label + ': zapisano w chmurze', 'ok'); return r ?? true; }
  catch (e) { status((e instanceof ConflictError ? 'KONFLIKT: ' : 'BŁĄD: ') + humanError(e), e instanceof ConflictError ? 'warn' : 'err'); return false; }
}
const byId = list => Object.fromEntries(list.map(x => [x.id, x]));
function ratesConfigured(tenant) {
  return tenant && typeof tenant.vatPercent === 'number' && typeof tenant.workPerHour === 'number' && typeof tenant.travelPerHour === 'number';
}
function photosOn() { if (store?.mode === 'demo') return true; return cfg?.features?.photos === true; }


// ---------- widoki ----------
const VIEWS = {
  async orders() {
    const orders = await store.listOrders();
    let extra = '';
    let ratesWarn = '';
    if (me.role === 'admin') {
      const [clients, machines, templates, members, tenant] = await Promise.all([store.list('clients'), store.list('machines'), store.list('templates'), store.list('members'), store.tenant()]);
      if (!ratesConfigured(tenant)) ratesWarn = `<p class="warn-box">Uzupełnij VAT i stawki €/h w zakładce <b>Ustawienia</b> (wymagane do szkiców rachunków; bez milczących domyślnych).</p>`;
      const techs = members.filter(m => m.role === 'tech' && m.active);
      extra = `<details class="panel"><summary><b>+ Nowe zlecenie</b></summary>
        <form id="newOrder" class="grid">
        <label>Tytuł<input name="title" required maxlength="160" value="Przegląd serwisowy"></label>
        <label>Maszyna<select name="machineId" required>${opt(machines, null, m => `${m.name} – ${byId(clients)[m.clientId]?.name || '?'}`)}</select></label>
        <label>Szablon (bieżąca wersja zostanie zamrożona)<select name="templateId" required>${opt(templates, null, t => `${t.name} v${t.currentVersion}`)}</select></label>
        <label>Technik<select name="assignedTo" required>${opt(techs, null, t => t.displayName || t.id)}</select></label>
        <label>Termin<input type="date" name="dueDate" required></label>
        <button class="btn btn-green" ${machines.length && templates.length && techs.length ? '' : 'disabled title="Najpierw dodaj maszynę, szablon i technika"'}>Utwórz</button></form></details>`;
    }
    app().innerHTML = `${ratesWarn}${extra}<section class="panel"><h2>${me.role === 'admin' ? 'Wszystkie zlecenia' : 'Moje przypisane zlecenia'}</h2>
      ${orders.length ? `<table class="tbl"><tr><th>Tytuł</th><th>Termin</th><th>Status</th><th>Szablon</th><th></th></tr>
      ${orders.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).map(o => `<tr><td>${esc(o.title)}</td><td>${esc(o.dueDate)}</td><td><span class="st st-${o.status}">${ORDER_STATUSES[o.status]}</span></td><td>${esc(o.snapshot?.templateName)} v${o.snapshot?.templateVersion}</td>
      <td><button class="btn" data-action="openOrder" data-id="${o.id}">Otwórz</button></td></tr>`).join('')}</table>` : '<p class="muted">Brak zleceń.</p>'}</section>`;
    const f = $('#newOrder'); if (f) f.onsubmit = async e => {
      e.preventDefault(); const d = formData(f);
      const tpl = await store.get('templates', d.templateId);
      const versions = (await store.list('templateVersions')).filter(v => v.templateId === d.templateId && v.version === tpl.currentVersion);
      if (!versions.length) return status('Nie znaleziono bieżącej wersji szablonu', 'err');
      const m = await store.get('machines', d.machineId);
      const id = await guarded('Tworzenie zlecenia', () => store.createOrder({ title: d.title, clientId: m.clientId, siteId: m.siteId || '', machineId: m.id, assignedTo: d.assignedTo, dueDate: d.dueDate, snapshot: snapshotFor(versions[0]) }));
      if (id) go('orders');
    };
  },

  async order(id) {
    const o = await store.get('workOrders', id); if (!o) throw new Error('Brak zlecenia lub dostępu.');
    current = o;
    const [time, mats, defects, parts, machine] = await Promise.all([store.listFor('timeEntries', id), store.listFor('materials', id), store.listFor('defects', id), store.list('parts'), store.get('machines', o.machineId)]);
    const isTech = me.role === 'tech', editable = isTech && techCanEdit(o.status);
    const lockMsg = o.status === 'approved' ? 'Protokół zatwierdzony – zablokowany (zmiana tylko przez nowe zlecenie/rewizję).' : o.status === 'submitted' ? 'Przekazano do akceptacji – edycja zablokowana.' : !isTech ? 'Administrator nie wypełnia checklisty za technika.' : '';
    const problems = validateSubmission(o.snapshot, o.results);
    const sums = sumTime(time);
    app().innerHTML = `<section class="panel"><button class="btn btn-gray" data-action="go" data-view="orders">← Lista</button>
      <h2>${esc(o.title)} <span class="st st-${o.status}">${ORDER_STATUSES[o.status]}</span></h2>
      <p>Maszyna: <b>${esc(machine?.name)}</b> ${esc(machine?.model)} SN ${esc(machine?.serial)} · Termin ${esc(o.dueDate)} · wersja danych rev ${o.rev}</p>
      <p class="muted">Checklista: ${esc(o.snapshot.templateName)} v${o.snapshot.templateVersion} (migawka zamrożona w zleceniu). Źródło granic: ${esc(o.snapshot.source || '—')}</p>
      ${lockMsg ? `<p class="warn-box">${esc(lockMsg)}</p>` : ''}
      ${o.decisionNote ? `<p class="warn-box">Uwaga admina: ${esc(o.decisionNote)}</p>` : ''}
      ${isTech && o.status === 'planned' ? `<button class="btn" data-action="startOrder">Rozpocznij pracę</button>` : ''}
      </section>
      <section class="panel"><h3>Checklista</h3>${o.snapshot.items.map(it => itemHtml(it, o.results[it.id], editable && o.status !== 'planned')).join('')}</section>
      <section class="panel grid2">
        <div><h3>Czas (praca ${(sums.work / 60).toFixed(2)} h · dojazd ${(sums.travel / 60).toFixed(2)} h · przerwy ${(sums.break / 60).toFixed(2)} h)</h3>
        <table class="tbl">${time.map(t => `<tr><td>${esc(t.date)}</td><td>${TIME_KINDS[t.kind]}</td><td>${t.minutes} min</td><td>${esc(t.note)}</td><td>${t.status === 'approved' ? 'zatwierdzone' : 'szkic'}</td></tr>`).join('')}</table>
        ${editable ? `<form id="timeForm" class="row"><input type="date" name="date" required><select name="kind">${Object.entries(TIME_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><input name="minutes" type="number" min="1" max="1440" placeholder="min" required><input name="note" placeholder="opis" maxlength="500"><button class="btn">+ Czas</button></form>` : ''}</div>
        <div><h3>Materiały</h3>
        <table class="tbl">${mats.map(m => `<tr><td>${esc(m.name)}</td><td>${m.qty} szt.</td><td>${m.status === 'approved' ? 'zatwierdzone' : 'szkic'}</td></tr>`).join('')}</table>
        ${editable ? `<form id="matForm" class="row"><select name="partId" required>${opt(parts, null, p => `${p.name} (${p.sku}, stan ${p.stock})`)}</select><input name="qty" type="number" min="1" max="10000" value="1" required><button class="btn" ${parts.length ? '' : 'disabled title="Magazyn pusty – admin musi dodać części"'}>+ Materiał</button></form>` : ''}</div>
      </section>
      <section class="panel"><h3>Usterki / zadania naprawcze</h3>
        ${defects.length ? `<table class="tbl">${defects.map(df => `<tr><td>${esc(df.itemId)}</td><td>${esc(df.description)}</td><td>${df.severity}</td><td>${df.status}</td></tr>`).join('')}</table>` : '<p class="muted">Brak zgłoszonych usterek.</p>'}
      </section>
      <section class="panel">
        ${isTech && ['in_progress', 'rejected'].includes(o.status) ? `${problems.length ? `<div class="err-box">Nie można przekazać:<ul>${problems.map(p => `<li>${esc(p.msg)}</li>`).join('')}</ul></div>` : ''}
          <button class="btn btn-green" data-action="submitOrder" ${problems.length ? 'disabled title="Uzupełnij wymagane punkty"' : ''}>Przekaż do akceptacji</button>` : ''}
        ${me.role === 'admin' && o.status === 'submitted' ? `<label>Uwaga do decyzji<input id="decisionNote" maxlength="1000"></label>
          <button class="btn btn-green" data-action="decide" data-to="approved">Zatwierdź (zablokuje protokół)</button> <button class="btn btn-del" data-action="decide" data-to="rejected">Odrzuć do poprawy</button>` : ''}
        <button class="btn btn-gray" data-action="printOrder">Drukuj protokół</button></section>`;
    if (photosOn()) for (const img of $$('img[data-path]')) store.photoUrl(img.dataset.path).then(u => img.src = u).catch(() => img.alt = 'brak dostępu');
    bindOrderForms(o, parts);
  },

  async approvals() {
    const [orders, time, mats, trips, members, defects] = await Promise.all([store.list('workOrders'), store.list('timeEntries'), store.list('materials'), store.list('trips'), store.list('members'), store.list('defects')]);
    const who = uid => esc(byId(members)[uid]?.displayName || uid);
    const oT = byId(orders);
    app().innerHTML = `<section class="panel"><h2>Protokoły do akceptacji</h2>${listOrEmpty(orders.filter(o => o.status === 'submitted'), o => `<tr><td>${esc(o.title)}</td><td>${who(o.assignedTo)}</td><td><button class="btn" data-action="openOrder" data-id="${o.id}">Sprawdź</button></td></tr>`)}</section>
      <section class="panel"><h2>Czas pracy (szkice)</h2>${listOrEmpty(time.filter(t => t.status === 'draft'), t => `<tr><td>${esc(oT[t.workOrderId]?.title)}</td><td>${who(t.uid)}</td><td>${t.date}</td><td>${TIME_KINDS[t.kind]} ${t.minutes} min</td><td><button class="btn btn-green" data-action="approveTime" data-id="${t.id}">Zatwierdź</button></td></tr>`)}</section>
      <section class="panel"><h2>Materiały (szkice) – zatwierdzenie zdejmuje ze stanu atomowo</h2>${listOrEmpty(mats.filter(m => m.status === 'draft'), m => `<tr><td>${esc(oT[m.workOrderId]?.title)}</td><td>${who(m.uid)}</td><td>${esc(m.name)} × ${m.qty}</td><td><button class="btn btn-green" data-action="approveMat" data-id="${m.id}">Zatwierdź</button></td></tr>`)}</section>
      <section class="panel"><h2>Diety</h2>${listOrEmpty(trips.filter(t => ['draft', 'manual_review'].includes(t.status)), t => `<tr><td>${who(t.uid)}</td><td>${esc(t.calc?.rate?.label)}</td><td>${esc(t.input.start)} → ${esc(t.input.end)}</td><td>${t.calc.total.toFixed(2)} €</td><td>${t.status === 'manual_review' ? '<b class="warn">ręczna weryfikacja</b>' : ''}</td><td><button class="btn btn-green" data-action="decideTrip" data-to="approved" data-id="${t.id}">Zatwierdź</button> <button class="btn btn-del" data-action="decideTrip" data-to="rejected" data-id="${t.id}">Odrzuć</button></td></tr>`)}</section>
      <section class="panel"><h2>Otwarte usterki</h2>${listOrEmpty(defects.filter(d => d.status !== 'closed'), d => `<tr><td>${esc(oT[d.workOrderId]?.title)}</td><td>${esc(d.description)}</td><td>${d.severity}</td><td><select data-action-change="defectStatus" data-id="${d.id}">${['open', 'in_repair', 'closed'].map(s => `<option ${s === d.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`)}</section>`;
  },

  async assets() {
    const [clients, sites, machines, orders] = await Promise.all([store.list('clients'), store.list('sites'), store.list('machines'), store.list('workOrders')]);
    app().innerHTML = `<section class="panel grid2">
      <form id="clientForm"><h3>+ Klient</h3><label>Nazwa<input name="name" required maxlength="120"></label><label>Adres<input name="address" maxlength="300"></label><label>USt-IdNr<input name="vatId" maxlength="40"></label><button class="btn">Dodaj klienta</button></form>
      <form id="siteForm"><h3>+ Zakład / lokalizacja</h3><label>Klient<select name="clientId" required>${opt(clients)}</select></label><label>Nazwa<input name="name" required maxlength="120"></label><label>Adres<input name="address" maxlength="300"></label><button class="btn" ${clients.length ? '' : 'disabled title="Najpierw dodaj klienta"'}>Dodaj zakład</button></form>
      <form id="machineForm"><h3>+ Maszyna</h3><label>Klient<select name="clientId" required>${opt(clients)}</select></label><label>Zakład<select name="siteId"><option value="">—</option>${opt(sites, null, s => s.name)}</select></label>
        <label>Nazwa<input name="name" required maxlength="120"></label><label>Model<input name="model" maxlength="120"></label><label>Nr seryjny<input name="serial" maxlength="80"></label><label>Typ (do szablonów)<input name="machineType" maxlength="80"></label><button class="btn" ${clients.length ? '' : 'disabled title="Najpierw dodaj klienta"'}>Dodaj maszynę</button></form></section>
      <section class="panel"><h2>Maszyny i historia</h2>${clients.map(c => `<h3>${esc(c.name)}</h3>${machines.filter(m => m.clientId === c.id).map(m => `<div class="card"><b>${esc(m.name)}</b> ${esc(m.model)} SN ${esc(m.serial)} <span class="muted">${esc(m.machineType)}</span>
        <ul>${orders.filter(o => o.machineId === m.id).map(o => `<li>${esc(o.dueDate)} – ${esc(o.title)} – ${ORDER_STATUSES[o.status]} <button class="btn btn-gray sm" data-action="openOrder" data-id="${o.id}">otwórz</button></li>`).join('') || '<li class="muted">brak historii</li>'}</ul></div>`).join('') || '<p class="muted">brak maszyn</p>'}`).join('')}</section>`;
    const bind = (fid, col, keys) => { $(fid).onsubmit = async e => { e.preventDefault(); const d = formData(e.target); const data = {}; for (const k of keys) data[k] = (d[k] || '').trim();
      if (await guarded('Zapis', () => store.add(col, data))) go('assets'); }; };
    bind('#clientForm', 'clients', ['name', 'address', 'vatId']); bind('#siteForm', 'sites', ['clientId', 'name', 'address']); bind('#machineForm', 'machines', ['clientId', 'siteId', 'name', 'model', 'serial', 'machineType']);
  },

  async templates(editId) {
    const [templates, versions] = await Promise.all([store.list('templates'), store.list('templateVersions')]);
    const base = editId ? versions.filter(v => v.templateId === editId).sort((a, b) => b.version - a.version)[0] : null;
    const items = base ? base.items : [{ id: 'p1', label: '', type: 'check', required: true }];
    app().innerHTML = `<section class="panel"><h2>Szablony checklist</h2><p class="muted">Każdy zapis tworzy NOWĄ, niezmienną wersję. Zlecenia trzymają własną migawkę wersji. Granice pomiarów wpisuj wyłącznie z dokumentacji producenta / instrukcji maszyny i podawaj źródło.</p>
      <table class="tbl">${templates.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.machineType)}</td><td>v${t.currentVersion}</td><td><button class="btn" data-action="editTemplate" data-id="${t.id}">Nowa wersja</button></td></tr>`).join('')}</table></section>
      <section class="panel"><h3>${base ? `Nowa wersja szablonu „${esc(base.name)}” (z v${base.version})` : 'Nowy szablon'}</h3>
      <form id="tplForm"><input type="hidden" name="templateId" value="${esc(editId || '')}">
      <div class="grid"><label>Nazwa<input name="name" required maxlength="120" value="${esc(base?.name || '')}"></label><label>Typ maszyny<input name="machineType" maxlength="80" value="${esc(templates.find(t => t.id === editId)?.machineType || '')}"></label>
      <label>Źródło (dokumentacja, wydanie)<input name="source" required maxlength="500" value="${esc(base?.source || '')}"></label></div>
      <table class="tbl" id="tplItems"><tr><th>ID</th><th>Punkt</th><th>Instrukcja</th><th>Typ</th><th>Wym.</th><th>Jedn.</th><th>Min</th><th>Max</th><th>Źródło granic</th><th></th></tr>${items.map(itemRow).join('')}</table>
      <button type="button" class="btn btn-gray" data-action="addTplRow">+ Punkt</button> <button class="btn btn-green">Zapisz wersję</button></form></section>`;
    $('#tplForm').onsubmit = async e => {
      e.preventDefault(); const d = formData(e.target);
      const its = $$('#tplItems tr.it').map(r => { const g = n => $(`[name=${n}]`, r); const num = n => g(n).value === '' ? null : Number(g(n).value);
        const it = { id: g('iid').value.trim(), label: g('label').value.trim(), instructions: g('instr').value.trim(), type: g('type').value, required: g('req').checked };
        if (it.type === 'measure') Object.assign(it, { unit: g('unit').value.trim(), min: num('min'), max: num('max'), limitSource: g('lsrc').value.trim() });
        return it; });
      const errs = validateTemplate(its); if (errs.length) return status(errs.join(' · '), 'err');
      if (await guarded('Zapis wersji szablonu', () => store.createTemplateVersion({ templateId: d.templateId || null, name: d.name.trim(), machineType: d.machineType.trim(), source: d.source.trim(), items: its }))) go('templates');
    };
  },

  async parts() {
    const parts = await store.list('parts');
    app().innerHTML = `<section class="panel"><h2>Magazyn części</h2><table class="tbl"><tr><th>SKU</th><th>Nazwa</th><th>Stan</th><th>Cena netto</th><th>Korekta stanu</th></tr>
      ${parts.map(p => `<tr><td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${p.stock}</td><td>${fmtEur(Math.round(p.unitPrice * 100))}</td><td><input type="number" class="sm" id="adj-${p.id}" placeholder="+/-"> <button class="btn sm" data-action="adjStock" data-id="${p.id}">Zmień</button></td></tr>`).join('')}</table>
      <form id="partForm" class="row"><input name="sku" placeholder="SKU" required maxlength="40"><input name="name" placeholder="Nazwa" required maxlength="120"><input name="stock" type="number" min="0" placeholder="Stan" required><input name="unitPrice" type="number" step="0.01" min="0" placeholder="Cena €" required><button class="btn">+ Część</button></form></section>`;
    $('#partForm').onsubmit = async e => { e.preventDefault(); const d = formData(e.target);
      if (await guarded('Dodanie części', () => store.add('parts', { sku: d.sku.trim(), name: d.name.trim(), stock: parseInt(d.stock, 10), unitPrice: Number(d.unitPrice) }))) go('parts'); };
  },

  async trips() {
    const trips = me.role === 'admin' ? await store.list('trips') : await store.listMine('trips');
    const countries = ['DE', ...listCountries(2026)];
    app().innerHTML = `<section class="panel"><h2>Diety (Verpflegungsmehraufwand) – zasady DE, tabela BMF 2026</h2>
      <p class="muted">Źródła: <a href="https://www.gesetze-im-internet.de/estg/__9.html" target="_blank" rel="noopener">§ 9 ust. 4a EStG</a>, <a href="https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Lohnsteuer/2025-12-05-steuerliche-behandlung-reisekosten-2026.html" target="_blank" rel="noopener">BMF 05.12.2025 (stawki od 01.01.2026)</a>. Program liczy tylko proste przypadki; złożone oznacza do ręcznej weryfikacji. Ostateczne rozliczenie zatwierdza księgowość/doradca podatkowy.</p>
      <form id="tripForm" class="grid">
        <label>Kraj<select name="country" id="tripCountry">${countries.map(c => `<option ${c === 'DE' ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label>Miasto (jeśli tabela rozróżnia)<select name="city" id="tripCity"></select></label>
        <label>Start<input type="datetime-local" name="start" required></label><label>Koniec<input type="datetime-local" name="end" required></label>
        <label><input type="checkbox" name="overnight"> Nocleg (podróż wielodniowa)</label>
        <label><input type="checkbox" name="multi"> Kilka krajów w podróży</label>
        <label>W tym miejscu pracy od (reguła 3 mies.)<input type="date" name="sameSiteSince"></label>
        <label>Przerwa w tym miejscu (tygodnie)<input type="number" name="interruptedWeeks" min="0"></label>
        <label>Posiłki zapewnione (data:ś/o/k, np. 2026-05-05:s,o)<input name="meals" placeholder="2026-05-05:s;2026-05-06:s,o,k"></label>
        <label>Dopłata pracownika do posiłków (data:€)<input name="contrib" placeholder="2026-05-05:5"></label>
        <label>Zwrot firmy €/dzień (puste = kwota wolna od podatku)<input name="reimb" type="number" step="0.01" min="0"></label>
        <label>Dla klienta €/dzień (opcjonalnie)<input name="cust" type="number" step="0.01" min="0"></label>
        <button type="button" class="btn" data-action="calcTrip">Oblicz</button></form>
      <div id="tripResult"></div></section>
      <section class="panel"><h3>${me.role === 'admin' ? 'Wszystkie rozliczenia' : 'Moje rozliczenia'}</h3>${listOrEmpty(trips, t => `<tr><td>${esc(t.calc?.rate?.label)}</td><td>${esc(t.input.start)} → ${esc(t.input.end)}</td><td>${t.calc.total.toFixed(2)} €</td><td>${esc(t.status)}</td></tr>`)}</section>`;
    const fillCities = () => { const c = $('#tripCountry').value; const cities = c === 'DE' ? [] : listCities(2026, c);
      $('#tripCity').innerHTML = cities.length ? cities.map(x => `<option value="${esc(x)}">${x === '_rest' ? 'pozostałe (im Übrigen)' : esc(x)}</option>`).join('') : '<option value="">— nie dotyczy —</option>'; };
    $('#tripCountry').onchange = fillCities; fillCities();
  },

  async invoices() {
    const [orders, time, mats, drafts, clients, tenant] = await Promise.all([store.list('workOrders'), store.list('timeEntries'), store.list('materials'), store.list('invoiceDrafts'), store.list('clients'), store.tenant()]);
    const approved = orders.filter(o => o.status === 'approved');
    app().innerHTML = `<section class="panel"><h2>Szkice rachunków</h2>
      <p class="warn-box">To wyłącznie SZKIC z zatwierdzonych godzin i materiałów. Aplikacja nie nadaje numeru faktury, nie archiwizuje zgodnie z GoBD i nie tworzy E-Rechnung (XRechnung/ZUGFeRD). Fakturę wystaw w programie księgowym. Stawka VAT jest ustawieniem firmy (${tenant.vatPercent ?? '—'}%), nie oceną prawną (np. reverse charge dla klienta z UE wymaga decyzji księgowej).</p>
      <label>Zatwierdzone zlecenie<select id="invOrder">${opt(approved, null, o => `${o.title} – ${byId(clients)[o.clientId]?.name || ''}`)}</select></label>
      ${!ratesConfigured(tenant) ? '<p class="err-box">Ustaw VAT oraz stawki €/h w <b>Ustawieniach</b> zanim utworzysz szkic – brak milczących domyślnych stawek finansowych.</p>' : ''}
      <button class="btn" data-action="buildInvoice" ${approved.length && ratesConfigured(tenant) ? '' : 'disabled title="Brak zatwierdzonych zleceń lub brak VAT/stawek w Ustawieniach"'}>Utwórz szkic</button>
      <div id="invPreview"></div></section>
      <section class="panel"><h3>Zapisane szkice</h3>${listOrEmpty(drafts, d => `<tr><td>${esc(byId(orders)[d.workOrderId]?.title)}</td><td>${fmtEur(d.netCents)} netto</td><td>${fmtEur(d.grossCents)} brutto</td><td>SZKIC</td></tr>`)}</section>`;
    VIEWS._invData = { orders, time, mats, tenant, clients };
  },

  async team() {
    const members = await store.list('members');
    app().innerHTML = `<section class="panel"><h2>Zespół</h2>
      <p class="muted">Dodanie osoby: 1) administrator zakłada konto e-mail/hasło w konsoli Firebase → Authentication (lub osoba loguje się i podaje swój UID), 2) tutaj wpisz UID i rolę. Aplikacja nie wysyła zaproszeń i nie tworzy kont – to wymaga osobnego backendu. Własnej roli nie możesz zmienić (blokada w regułach serwera).</p>
      <table class="tbl"><tr><th>UID</th><th>Nazwa</th><th>Rola</th><th>Aktywny</th><th></th></tr>${members.map(m => `<tr><td><code>${esc(m.id)}</code></td><td>${esc(m.displayName)}</td><td>${m.role}</td><td>${m.active ? 'tak' : 'nie'}</td>
        <td>${m.id === me.uid ? '<span class="muted">to Ty – edycja zablokowana</span>' : `<button class="btn sm" data-action="editMember" data-id="${esc(m.id)}" data-name="${esc(m.displayName)}" data-role="${m.role}" data-active="${m.active}">Edytuj</button>`}</td></tr>`).join('')}</table>
      <form id="memberForm" class="row"><input name="uid" placeholder="UID z Firebase Auth" required maxlength="128"><input name="displayName" placeholder="Wyświetlana nazwa" required maxlength="80">
        <select name="role"><option value="tech">technik</option><option value="admin">admin</option></select><label><input type="checkbox" name="active" checked> aktywny</label><button class="btn">Zapisz członka</button></form></section>`;
    $('#memberForm').onsubmit = async e => { e.preventDefault(); const d = formData(e.target);
      if (await guarded('Zapis członka zespołu', () => store.upsertMember(d.uid.trim(), { displayName: d.displayName.trim(), role: d.role, active: !!d.active }))) go('team'); };
  },

  async settings() {
    const t = await store.tenant();
    app().innerHTML = `<section class="panel narrow"><h2>Ustawienia firmy</h2>
      ${!ratesConfigured(t) ? '<p class="warn-box">Brak kompletnych stawek (VAT, praca €/h, dojazd €/h). Wpisz je świadomie – aplikacja nie podstawia domyślnych wartości do rachunków.</p>' : ''}
      <form id="setForm">
      <label>Nazwa<input name="name" required maxlength="120" value="${esc(t.name || '')}"></label>
      <label>Stawka VAT % (konfigurowalna)<input name="vatPercent" type="number" step="0.01" min="0" max="100" required value="${esc(t.vatPercent ?? '')}"></label>
      <label>Stawka pracy €/h<input name="workPerHour" type="number" step="0.01" min="0" required value="${esc(t.workPerHour ?? '')}"></label>
      <label>Stawka dojazdu €/h<input name="travelPerHour" type="number" step="0.01" min="0" required value="${esc(t.travelPerHour ?? '')}"></label>
      <button class="btn">Zapisz</button></form>
      <p class="muted">Tryb: ${esc(store.label)}</p>
      ${!photosOn() ? '<p class="muted">Zdjęcia protokołów: wyłączone (Spark / features.photos=false). Włączenie wymaga planu Blaze i storage.rules.</p>' : ''}</section>`;
    $('#setForm').onsubmit = async e => { e.preventDefault(); const d = formData(e.target);
      const vat = Number(d.vatPercent), wh = Number(d.workPerHour), th = Number(d.travelPerHour);
      if (![vat, wh, th].every(Number.isFinite) || vat < 0 || vat > 100 || wh < 0 || th < 0) return status('Podaj poprawne liczby: VAT 0–100 oraz stawki ≥ 0.', 'err');
      await guarded('Ustawienia', () => store.saveTenant({ name: d.name.trim(), vatPercent: vat, workPerHour: wh, travelPerHour: th })); };
  },
};

function listOrEmpty(list, row) { return list.length ? `<table class="tbl">${list.map(row).join('')}</table>` : '<p class="muted">Brak pozycji.</p>'; }

function itemRow(it) {
  return `<tr class="it"><td><input name="iid" value="${esc(it.id)}" required maxlength="40" class="sm"></td><td><input name="label" value="${esc(it.label)}" required maxlength="200"></td><td><input name="instr" value="${esc(it.instructions || '')}" maxlength="500"></td>
    <td><select name="type">${ITEM_TYPES.map(t => `<option ${t === it.type ? 'selected' : ''}>${t}</option>`).join('')}</select></td><td><input type="checkbox" name="req" ${it.required ? 'checked' : ''}></td>
    <td><input name="unit" value="${esc(it.unit || '')}" class="sm"></td><td><input name="min" type="number" step="any" value="${it.min ?? ''}" class="sm"></td><td><input name="max" type="number" step="any" value="${it.max ?? ''}" class="sm"></td>
    <td><input name="lsrc" value="${esc(it.limitSource || '')}" maxlength="200"></td><td><button type="button" class="btn btn-del sm" data-action="delTplRow">×</button></td></tr>`;
}

function itemHtml(it, r = {}, editable) {
  const dis = editable ? '' : 'disabled';
  const out = r.outcome; const range = it.type === 'measure' ? `${it.min ?? '—'} … ${it.max ?? '—'} ${esc(it.unit)}` : '';
  const warn = it.type === 'measure' && r.value != null && r.value !== '' && isOutOfRange(it, Number(r.value)) ? '<b class="warn"> poza zakresem</b>' : '';
  return `<div class="card item ${out ? 'res-' + out : ''}" data-item="${esc(it.id)}">
    <b>${esc(it.label)}</b> ${it.required ? '<span class="req">wymagane</span>' : ''} <span class="muted">[${it.type}]</span>
    ${it.instructions ? `<div class="muted">${esc(it.instructions)}</div>` : ''}
    ${it.type === 'measure' ? `<div class="muted">Zakres: ${range} · źródło: ${esc(it.limitSource || 'brak granic')}</div>` : ''}
    <div class="row">${[['ok', 'OK'], ['defect', 'Usterka'], ['na', 'Nie dotyczy']].map(([k, l]) => `<label><input type="radio" name="out-${esc(it.id)}" value="${k}" ${out === k ? 'checked' : ''} ${dis}> ${l}</label>`).join('')}
    ${it.type === 'measure' ? `<input type="number" step="any" name="val" value="${esc(r.value ?? '')}" placeholder="wartość ${esc(it.unit)}" ${dis}>${warn}` : ''}</div>
    <div class="row"><input name="note" value="${esc(r.note || '')}" placeholder="${it.type === 'text' ? 'odpowiedź' : 'opis / uwagi'}" maxlength="2000" ${dis}>
    <input name="na" value="${esc(r.naReason || '')}" placeholder="uzasadnienie „nie dotyczy”" maxlength="500" ${dis}></div>
    <div class="photos">${(r.photos || []).map(p => `<img data-path="${esc(p)}" alt="zdjęcie">`).join('')}</div>
    ${editable ? `<div class="row">${photosOn() ? `<input type="file" accept="image/jpeg,image/png,image/webp" name="photo">` : `<span class="muted" title="Cloud Storage wymaga planu Blaze">Zdjęcia niedostępne (Spark / features.photos=false)</span>`}
      <button class="btn" data-action="saveItem" data-id="${esc(it.id)}">Zapisz punkt</button>
      ${out === 'defect' ? `<select name="sev"><option value="low">niska</option><option value="medium" selected>średnia</option><option value="high">wysoka</option></select><button class="btn btn-amber" data-action="reportDefect" data-id="${esc(it.id)}">Utwórz zadanie naprawcze</button>` : ''}</div>` : ''}
    ${r.updatedAt ? '' : ''}</div>`;
}

function bindOrderForms(o, parts) {
  const tf = $('#timeForm'); if (tf) tf.onsubmit = async e => { e.preventDefault(); const d = formData(tf);
    const t = { workOrderId: o.id, uid: me.uid, date: d.date, kind: d.kind, minutes: parseInt(d.minutes, 10), note: d.note.trim(), status: 'draft' };
    const errs = validateTimeEntry(t); if (errs.length) return status(errs.join(', '), 'err');
    if (await guarded('Czas pracy', () => store.add('timeEntries', t))) go('order', o.id); };
  const mf = $('#matForm'); if (mf) mf.onsubmit = async e => { e.preventDefault(); const d = formData(mf); const p = parts.find(x => x.id === d.partId);
    const qty = parseInt(d.qty, 10); if (!(qty > 0)) return status('Ilość > 0', 'err');
    if (await guarded('Materiał', () => store.add('materials', { workOrderId: o.id, partId: p.id, name: p.name, qty, unitPrice: p.unitPrice, uid: me.uid, status: 'draft' }))) go('order', o.id); };
}

function parsePairs(s) { const out = {}; for (const part of (s || '').split(';').map(x => x.trim()).filter(Boolean)) { const [k, v] = part.split(':'); if (!/^\d{4}-\d{2}-\d{2}$/.test(k || '')) throw new AllowanceError('Zły format daty w polu posiłków/dopłat: ' + part); out[k] = v; } return out; }

// ---------- akcje ----------
const ACTIONS = {
  startDemo, logout: () => store.signOut(),
  demoLogin: b => store.signInDemo(b.dataset.uid),
  reset: async () => { const em = $('#loginForm [name=email]').value; if (!em) return status('Wpisz e-mail', 'warn'); try { await store.resetPassword(em); status('Wysłano e-mail resetu (jeśli konto istnieje).', 'ok'); } catch (e) { status(humanError(e), 'err'); } },
  go: b => go(b.dataset.view),
  openOrder: b => go('order', b.dataset.id),
  editTemplate: b => go('templates', b.dataset.id),
  addTplRow: () => $('#tplItems').insertAdjacentHTML('beforeend', itemRow({ id: 'p' + ($$('#tplItems tr.it').length + 1), label: '', type: 'check', required: true })),
  delTplRow: b => b.closest('tr').remove(),
  startOrder: async () => { if (await guarded('Start zlecenia', () => store.patchOrder(current.id, current.rev, { status: 'in_progress' }))) go('order', current.id); },
  saveItem: async b => {
    const box = b.closest('[data-item]'); const it = current.snapshot.items.find(i => i.id === b.dataset.id);
    const prev = current.results[it.id] || {};
    const r = { outcome: $(`input[type=radio]:checked`, box)?.value, note: $('[name=note]', box).value.trim(), naReason: $('[name=na]', box).value.trim(), photos: [...(prev.photos || [])] };
    if (it.type === 'measure') { const v = $('[name=val]', box).value; r.value = v === '' ? null : Number(v); }
    const errs = validateResult(it, r); if (errs.length) return status(errs.join(' · '), 'err');
    const fileInput = $('[name=photo]', box);
    const file = (photosOn() && fileInput && fileInput.files && fileInput.files[0]) ? fileInput.files[0] : null;
    const ok = await guarded('Zapis punktu', async () => {
      if (file && photosOn()) r.photos.push(await store.uploadPhoto(current.id, file));
      // Gdy zdjęcia wyłączone, obecność inputu pliku nie może przerwać zapisu wyniku.
      return store.patchOrder(current.id, current.rev, { ['results.' + it.id]: { ...r, by: me.uid } });
    });
    if (ok) go('order', current.id);
  },
  reportDefect: async b => {
    const box = b.closest('[data-item]'); const r = current.results[b.dataset.id];
    if (!r || r.outcome !== 'defect') return status('Najpierw zapisz punkt jako usterkę.', 'warn');
    if (await guarded('Zadanie naprawcze', () => store.add('defects', { workOrderId: current.id, machineId: current.machineId, itemId: b.dataset.id, description: r.note, severity: $('[name=sev]', box).value, status: 'open', createdBy: me.uid }))) go('order', current.id);
  },
  submitOrder: async () => {
    const p = validateSubmission(current.snapshot, current.results); if (p.length) return status(p.map(x => x.msg).join(' · '), 'err');
    if (await guarded('Przekazanie', () => store.patchOrder(current.id, current.rev, { status: 'submitted', submittedAt: store.now() }))) go('order', current.id);
  },
  decide: async b => {
    const to = b.dataset.to; const note = $('#decisionNote').value.trim();
    if (to === 'rejected' && !note) return status('Podaj powód odrzucenia.', 'warn');
    if (to === 'approved' && !confirm('Zatwierdzenie zablokuje protokół na stałe. Kontynuować?')) return;
    if (await guarded('Decyzja', () => store.patchOrder(current.id, current.rev, { status: to, decidedBy: me.uid, decidedAt: store.now(), decisionNote: note }))) go('order', current.id);
  },
  printOrder: () => window.print(),
  approveTime: async b => { if (await guarded('Zatwierdzenie czasu', () => store.update('timeEntries', b.dataset.id, { status: 'approved', approvedBy: me.uid, approvedAt: store.now() === '__now__' ? new Date().toISOString() : null }))) go('approvals'); },
  approveMat: async b => { if (await guarded('Zatwierdzenie materiału', () => store.approveMaterial(b.dataset.id))) go('approvals'); },
  decideTrip: async b => { if (await guarded('Decyzja diety', () => store.update('trips', b.dataset.id, { status: b.dataset.to, approvedBy: me.uid, approvedAt: new Date().toISOString() }))) go('approvals'); },
  adjStock: async b => { const delta = parseInt($('#adj-' + b.dataset.id).value, 10); if (!delta) return status('Podaj korektę', 'warn');
    const p = await store.get('parts', b.dataset.id); if (p.stock + delta < 0) return status('Stan nie może być ujemny', 'err');
    const { id, ...rest } = p; if (await guarded('Korekta stanu', () => store.update('parts', id, { ...rest, stock: p.stock + delta }))) go('parts'); },
  editMember: b => { const f = $('#memberForm'); f.uid.value = b.dataset.id; f.displayName.value = b.dataset.name; f.role.value = b.dataset.role; f.active.checked = b.dataset.active === 'true'; f.uid.focus(); },
  calcTrip: async () => {
    const d = formData($('#tripForm')); const box = $('#tripResult');
    try {
      const meals = {}; for (const [k, v] of Object.entries(parsePairs(d.meals))) meals[k] = { breakfast: /s/.test(v), lunch: /o/.test(v), dinner: /k/.test(v) };
      const contrib = parsePairs(d.contrib);
      const input = { country: d.country, city: d.city || undefined, start: d.start, end: d.end, overnight: !!d.overnight, crossBorderMultipleCountries: !!d.multi,
        sameSiteSince: d.sameSiteSince || undefined, interruptedWeeks: d.interruptedWeeks ? Number(d.interruptedWeeks) : undefined, meals, employeeContribution: contrib };
      const calc = calculateAllowance(input);
      const split = splitAmounts(calc, { reimbursePerDay: d.reimb === '' ? null : Number(d.reimb), customerPerDay: d.cust === '' ? null : Number(d.cust) });
      box.innerHTML = `<h3>${esc(calc.rate.label)}: stawka ${calc.rate.full} € / ${calc.rate.partial} €</h3>
        <table class="tbl"><tr><th>Dzień</th><th>Rodzaj</th><th>Kwota bazowa</th><th>Potrącenie posiłków</th><th>Dieta</th></tr>${calc.days.map(x => `<tr><td>${x.date}</td><td>${x.type}</td><td>${x.base.toFixed(2)}</td><td>${x.reduction.toFixed(2)}</td><td>${x.amount.toFixed(2)}</td></tr>`).join('')}</table>
        <p><b>Wolne od podatku: ${split.taxFree.toFixed(2)} €</b> · Zwrot firmy: ${split.reimbursement.toFixed(2)} € (nadwyżka opodatkowana: ${split.taxableExcess.toFixed(2)} €) · Refaktura klientowi: ${split.customerBilling.toFixed(2)} €</p>
        ${calc.manualReview.length ? `<div class="warn-box"><b>Wymaga ręcznej weryfikacji:</b><ul>${calc.manualReview.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
        ${calc.warnings.map(w => `<p class="muted">⚠ ${esc(w)}</p>`).join('')}
        <button class="btn btn-green" id="saveTrip">Zapisz rozliczenie (do akceptacji)</button>`;
      $('#saveTrip').onclick = async () => { if (await guarded('Rozliczenie diet', () => store.add('trips', { uid: me.uid, workOrderId: '', input, calc: { ...calc, split }, status: calc.autoApprovable ? 'draft' : 'manual_review' }))) go('trips'); };
    } catch (e) { box.innerHTML = `<p class="err-box">Obliczenie zablokowane: ${esc(e.message)}</p>`; }
  },
  buildInvoice: async () => {
    const { orders, time, mats, tenant, clients } = VIEWS._invData; const o = orders.find(x => x.id === $('#invOrder').value);
    try {
      const inv = buildInvoiceDraft({ order: o, timeEntries: time, materials: mats, rates: { workPerHour: tenant.workPerHour, travelPerHour: tenant.travelPerHour }, vatPercent: Number(tenant.vatPercent) });
      $('#invPreview').innerHTML = `<div class="invoice"><h3>SZKIC RACHUNKU – ${esc(tenant.name)}</h3><p>Klient: ${esc(byId(clients)[o.clientId]?.name)} · Zlecenie: ${esc(o.title)}</p>
        <table class="tbl"><tr><th>Pozycja</th><th>Ilość</th><th>Cena</th><th>Netto</th></tr>${inv.lines.map(l => `<tr><td>${esc(l.desc)}</td><td>${+l.qty.toFixed(2)} ${l.unit}</td><td>${fmtEur(l.unitCents)}</td><td>${fmtEur(l.netCents)}</td></tr>`).join('')}</table>
        <p>Netto ${fmtEur(inv.netCents)} · VAT ${inv.vatPercent}% ${fmtEur(inv.vatCents)} · <b>Brutto ${fmtEur(inv.grossCents)}</b></p><p class="muted">${esc(inv.disclaimer)}</p></div>
        <button class="btn btn-green" id="saveInv">Zapisz szkic</button> <button class="btn btn-gray" data-action="printOrder">Drukuj podgląd</button>`;
      $('#saveInv').onclick = async () => { if (await guarded('Szkic rachunku', () => store.add('invoiceDrafts', inv))) go('invoices'); };
    } catch (e) { status(e.message, 'err'); }
  },
};
document.addEventListener('click', e => { const b = e.target.closest('[data-action]'); if (!b || b.disabled) return; e.preventDefault(); ACTIONS[b.dataset.action]?.(b); });
document.addEventListener('change', async e => { const s = e.target.closest('[data-action-change=defectStatus]'); if (!s) return;
  if (await guarded('Status usterki', () => store.update('defects', s.dataset.id, { status: s.value, updatedAt: new Date().toISOString() }))) go('approvals'); });
boot();
