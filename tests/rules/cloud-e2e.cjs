// E2E: prawdziwy moduł js/cloud.js + Firebase JS SDK (CDN gstatic) przeciw LOKALNYM emulatorom (projekt demo-*).
// Uruchamiane przez: npm run test:cloud-e2e (firebase emulators:exec). Brak połączeń z produkcyjnym Firebase.
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert/strict'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', '..'); const P = 'demo-serwismaster', T = 'firma-test';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const CONFIG = `export const CONFIG = { firebase: { apiKey: 'demo-key', authDomain: '${P}.firebaseapp.com', projectId: '${P}', storageBucket: '${P}.appspot.com', appId: 'demo' }, tenantId: '${T}', authPersistence: 'session', useEmulators: true, features: { photos: false } };`;
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/js/config.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(CONFIG); }
  const p = path.join(root, u === '/' ? 'index.html' : u); if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); });
const log = []; const pass = t => { log.push('PASS ' + t); console.log('PASS', t); };
async function signUp(email) { const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Test-Haslo-123', returnSecureToken: true }) }); return (await r.json()).localId; }
const FS = `http://127.0.0.1:8080/v1/projects/${P}/databases/(default)/documents`;
function fsVal(v) { if (v === null) return { nullValue: null }; if (typeof v === 'boolean') return { booleanValue: v }; if (Number.isInteger(v)) return { integerValue: String(v) }; if (typeof v === 'number') return { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v }; if (Array.isArray(v)) return { arrayValue: { values: v.map(fsVal) } }; return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fsVal(x)])) } }; }
async function seed(docPath, data) { const r = await fetch(`${FS}/${docPath}`, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: fsVal(data).mapValue.fields }) }); if (!r.ok) throw new Error(await r.text()); }
(async () => {
  let browser;
  try {
    const admin = await signUp('admin@example.invalid'); const tech = await signUp('tech@example.invalid'); const tech2 = await signUp('tech2@example.invalid'); await signUp('nobody@example.invalid');
    const copy = path.join(__dirname, '.bootstrap-copy.mjs'); fs.copyFileSync(path.join(root, 'tools/bootstrap-admin.mjs'), copy);
    try { execFileSync('node', [copy, '--project', P, '--tenant', T, '--email', 'admin@example.invalid', '--name', 'Test GmbH'], { env: { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }, stdio: 'pipe' });
      let again = false; try { execFileSync('node', [copy, '--project', P, '--tenant', T, '--email', 'tech@example.invalid', '--name', 'X'], { env: { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }, stdio: 'pipe' }); again = true; } catch {}
      assert.equal(again, false); } finally { fs.unlinkSync(copy); }
    pass('bootstrap-admin (Admin SDK) tworzy firmę i 1. admina; drugie uruchomienie odrzucone');
    await seed(`tenants/${T}/members/${tech}`, { role: 'tech', active: true, displayName: 'Technik testowy', updatedBy: admin });
    await seed(`tenants/${T}/members/${tech2}`, { role: 'tech', active: true, displayName: 'Technik 2', updatedBy: admin });
    await seed(`tenants/${T}/machines/m1`, { clientId: 'c1', siteId: '', name: 'Maszyna testowa', model: 'X', serial: 'S1', machineType: 't' });
    const snap = { templateId: 't1', templateVersion: 1, templateName: 'Test', source: 'TEST', items: [{ id: 'a', label: 'Punkt A', type: 'check', required: true }], requiredItemIds: ['a'] };
    await seed(`tenants/${T}/workOrders/o1`, { title: 'Zlecenie T1', clientId: 'c1', siteId: '', machineId: 'm1', assignedTo: tech, dueDate: '2026-12-01', status: 'planned', snapshot: snap, results: {}, rev: 0, createdBy: admin });
    await seed(`tenants/${T}/workOrders/o2`, { title: 'Zlecenie T2 cudze', clientId: 'c1', siteId: '', machineId: 'm1', assignedTo: tech2, dueDate: '2026-12-02', status: 'planned', snapshot: snap, results: {}, rev: 0, createdBy: admin });

    await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}/`;
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    let page; const errors = [];
    const login = async email => { if (page) await page.context().close(); page = await (await browser.newContext()).newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept()); await page.goto(base); await page.waitForSelector('#loginForm', { timeout: 30000 }); await page.fill('[name=email]', email); await page.fill('[name=pw]', 'Test-Haslo-123'); await page.click('#loginForm button.btn'); };
    await login('nobody@example.invalid'); await page.waitForSelector('text=Brak dostępu do firmy'); pass('konto bez członkostwa nie ma dostępu');
    assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0); pass('brak danych logowania w localStorage (persistence=session)');
    await login('tech@example.invalid'); await page.waitForSelector('text=Moje przypisane zlecenia');
    const list = await page.textContent('main'); assert.match(list, /Zlecenie T1/); assert.doesNotMatch(list, /cudze/); pass('technik (chmura) widzi tylko przypisane zlecenia');
    await page.click('[data-action=openOrder]'); await page.click('[data-action=startOrder]'); await page.waitForSelector('[data-action=saveItem]');
    await page.check('[data-item=a] input[value=ok]');
    assert.equal(await page.locator('[data-item=a] input[type=file]').count(), 0);
    assert.match(await page.textContent('[data-item=a]'), /Zdjęcia niedostępne/);
    pass('features.photos=false: brak inputu pliku, komunikat niedostępności');
    await page.click('[data-item=a] [data-action=saveItem]'); await page.waitForSelector('[data-item=a].res-ok');
    assert.match(await page.textContent('#statusBar'), /zapisano w chmurze/); pass('zapis wyniku w Firestore przez transakcję (rev) bez Storage');
    await seed(`tenants/${T}/workOrders/o1`, { title: 'Zlecenie T1', clientId: 'c1', siteId: '', machineId: 'm1', assignedTo: tech, dueDate: '2026-12-01', status: 'in_progress', snapshot: snap, results: { a: { outcome: 'ok' } }, rev: 99, createdBy: admin });
    await page.check('[data-item=a] input[value=ok]'); await page.click('[data-item=a] [data-action=saveItem]');
    await page.waitForFunction(() => /KONFLIKT/.test(document.querySelector('#statusBar').textContent)); pass('konflikt rev wykryty w chmurze');
    await page.click('[data-view=orders]'); await page.click('[data-action=openOrder]'); await page.click('[data-action=submitOrder]'); await page.waitForSelector('text=Przekazano do akceptacji'); pass('technik przekazał protokół (reguły: wymagane odpowiedzi)');
    await page.click('[data-action=logout]');
    await login('admin@example.invalid'); await page.waitForSelector('text=Wszystkie zlecenia');
    await page.click('[data-view=approvals]'); await page.click('text=Sprawdź'); await page.click('[data-action=decide][data-to=approved]'); await page.waitForSelector('text=Protokół zatwierdzony'); pass('admin zatwierdził w chmurze');
    await page.click('[data-view=team]'); await page.waitForSelector('text=to Ty – edycja zablokowana');
    await page.fill('#memberForm [name=uid]', admin); await page.fill('#memberForm [name=displayName]', 'x'); await page.click('#memberForm button');
    await page.waitForFunction(() => /BŁĄD/.test(document.querySelector('#statusBar').textContent)); pass('zmiana własnej roli odrzucona');
    assert.deepEqual(errors, []); pass('brak błędów JS (chmura)');
  } catch (e) { console.error('FAIL', e.stack || e.message); log.push('FAIL ' + e.message); process.exitCode = 1; }
  fs.writeFileSync(path.join(__dirname, 'cloud-e2e-result.txt'), log.join('\n') + '\n');
  if (browser) await browser.close(); srv.close();
})();
