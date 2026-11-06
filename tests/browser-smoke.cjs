// Smoke test w headless Chromium (Playwright). Serwuje katalog lokalnie; NIE łączy się z chmurą.
// Uruchom: PLAYWRIGHT_DIR=/ścieżka/do/node_modules/playwright node tests/browser-smoke.cjs
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  // Smoke = wyłącznie DEMO: nie serwuj produkcyjnego js/config.js (unikamy CDN/Firebase).
  if (u === '/js/config.js') { r.writeHead(404); return r.end(); }
  const p = path.join(root, u === '/' ? 'index.html' : u);
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); });
const log = [];
const pass = t => { log.push('PASS ' + t); console.log('PASS', t); };
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to fetch dynamically|config\.js/.test(m.text())) errors.push(m.text()); });
  page.on('request', r => { if (!r.url().startsWith(base)) external.push(r.url()); });
  page.on('dialog', d => d.accept());
  const st = () => page.textContent('#statusBar');
  try {
    await page.goto(base); await page.waitForSelector('text=Chmura nie jest skonfigurowana');
    assert.ok(await page.isDisabled('button:has-text("Zaloguj (niedostępne")'));
    pass('brak config.js => ekran konfiguracji, logowanie wyłączone, brak fałszywego zapisu');
    const sw = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8') + fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(!/serviceWorker/.test(sw)); pass('brak wyrejestrowywania service workera');
    await page.click('[data-action=startDemo]'); await page.waitForSelector('text=Tryb DEMO – wybierz');
    assert.match(await page.textContent('#modeBadge'), /DEMO/); pass('tryb DEMO wyraźnie oznaczony');

    // Technik
    await page.click('[data-uid=demo-tech]'); await page.waitForSelector('text=Moje przypisane zlecenia');
    assert.equal(await page.locator('nav .tab-btn').count(), 2); pass('technik widzi tylko swoje zakładki');
    await page.click('[data-action=openOrder]'); await page.waitForSelector('[data-action=startOrder]');
    await page.click('[data-action=startOrder]'); await page.waitForSelector('[data-action=saveItem]');
    const item = id => page.locator(`[data-item=${id}]`);
    // NA bez uzasadnienia -> błąd
    await item('lockout').locator('input[value=na]').check(); await item('lockout').locator('[data-action=saveItem]').click();
    assert.match(await st(), /uzasadnienia/); pass('„nie dotyczy” wymaga uzasadnienia');
    await item('lockout').locator('input[value=ok]').check(); await item('lockout').locator('[data-action=saveItem]').click();
    await page.waitForFunction(() => /zapisano/.test(document.querySelector('#statusBar').textContent));
    await item('guards').locator('input[value=ok]').check(); await item('guards').locator('[data-action=saveItem]').click(); await page.waitForSelector('[data-item=guards].res-ok');
    // pomiar poza zakresem jako OK -> odrzucony
    await item('pressure').locator('input[value=ok]').check(); await item('pressure').locator('[name=val]').fill('9'); await item('pressure').locator('[data-action=saveItem]').click();
    assert.match(await st(), /poza zakresem/); pass('pomiar poza zakresem nie może być OK');
    await item('pressure').locator('input[value=defect]').check(); await item('pressure').locator('[name=note]').fill('ciśnienie za wysokie');
    await item('pressure').locator('[data-action=saveItem]').click(); await page.waitForSelector('[data-item=pressure].res-defect');
    await item('pressure').locator('[data-action=reportDefect]').click(); await page.waitForSelector('text=ciśnienie za wysokie >> xpath=ancestor::table');
    pass('usterka -> zadanie naprawcze');
    assert.ok(await page.isDisabled('[data-action=submitOrder]')); pass('przekazanie zablokowane przy brakach');
    // konflikt
    await page.evaluate(() => 0);
    await item('oil').locator('input[value=ok]').check();
    // symulacja zmiany z innego urządzenia: brak bezpośredniego uchwytu – używamy globalnego hooka testowego
    await page.evaluate(() => window.__smTest && window.__smTest.remoteEdit());
    await item('oil').locator('[data-action=saveItem]').click();
    await page.waitForFunction(() => /KONFLIKT/.test(document.querySelector('#statusBar').textContent));
    pass('konflikt wersji wykryty, brak nadpisania');
    await page.click('[data-action=openOrder]').catch(() => {});
    await page.click('[data-view=orders]'); await page.click('[data-action=openOrder]'); await page.waitForSelector('[data-item=oil]');
    await item('oil').locator('input[value=ok]').check(); await item('oil').locator('[data-action=saveItem]').click(); await page.waitForSelector('[data-item=oil].res-ok');
    await page.fill('#timeForm [name=date]', '2026-11-20'); await page.selectOption('#timeForm [name=kind]', 'work'); await page.fill('#timeForm [name=minutes]', '90'); await page.click('#timeForm button');
    await page.waitForSelector('text=90 min');
    await page.fill('#timeForm [name=date]', '2026-11-20'); await page.selectOption('#timeForm [name=kind]', 'travel'); await page.fill('#timeForm [name=minutes]', '30'); await page.click('#timeForm button');
    await page.waitForSelector('text=30 min');
    await page.fill('#matForm [name=qty]', '2'); await page.click('#matForm button'); await page.waitForSelector('text=2 szt.');
    pass('czas pracy/dojazdu i materiał dodane');
    // Dziennik PRZED przekazaniem (otwarte zlecenie)
    await page.click('[data-view=trips]');
    assert.ok(await page.locator('.diet-card').count());
    assert.match(await page.textContent('.diet-card-head'), /Wpis dzienny/);
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.diet-card')).backgroundColor);
    assert.ok(!/^rgb\(255/.test(bg)); pass('UI dziennik: ciemna karta diet-card');
    await page.fill('[name=date]', '2026-11-06');
    await page.fill('[name=workStart]', '08:00');
    await page.fill('[name=workEnd]', '17:00');
    await page.fill('[name=breakDuration]', '01:00');
    await page.check('[name=dietMode][value=day_gt8]');
    await page.check('[name=eligible]');
    await page.fill('[name=absenceStart]', '2026-11-06T06:00');
    await page.fill('[name=absenceEnd]', '2026-11-06T16:30');
    await page.selectOption('#tripCountry', 'DE');
    await page.check('[name=mealBreakfast]');
    await page.click('[data-action=previewDaily]');
    await page.waitForSelector('#tripResult .diet-summary');
    let dailyTxt = await page.textContent('#tripResult');
    assert.match(dailyTxt, /480 min/); assert.match(dailyTxt, /8\.40/); pass('dziennik: 8h pracy + DE śniadanie 8.40 €');
    await page.click('[data-action=saveDaily]');
    await page.waitForSelector('text=Historia');
    assert.match(await page.textContent('main'), /dziennik/); pass('dziennik zapisany (czas+dieta szkic)');
    await page.fill('[name=date]', '2026-11-06');
    await page.fill('[name=workStart]', '08:00');
    await page.fill('[name=workEnd]', '17:00');
    await page.check('[name=dietMode][value=none]');
    await page.click('[data-action=previewDaily]');
    await page.click('[data-action=saveDaily]');
    await page.waitForFunction(() => /duplikatu|już istnieje|Konflikt|konflikt/i.test(document.querySelector('#statusBar').textContent));
    pass('duplikat dziennika zablokowany');
    await page.click('[data-view=orders]'); await page.click('[data-action=openOrder]'); await page.waitForSelector('[data-action=submitOrder]');
    await page.click('[data-action=submitOrder]'); await page.waitForSelector('text=Przekazano do akceptacji');
    assert.equal(await page.locator('[data-action=saveItem]').count(), 0); pass('po przekazaniu checklista zablokowana dla technika');
    await page.click('[data-action=logout]');

    // Admin
    await page.click('[data-uid=demo-admin]'); await page.waitForSelector('text=Wszystkie zlecenia');
    await page.click('[data-view=approvals]'); await page.waitForSelector('text=Protokoły do akceptacji');
    await page.click('[data-action=approveTime]'); await page.waitForSelector('[data-action=approveTime]');
    await page.click('[data-action=approveTime]'); await page.waitForSelector('[data-action=approveTime]');
    await page.click('[data-action=approveTime]'); await page.waitForFunction(() => !document.querySelector('[data-action=approveTime]'));
    await page.click('[data-action=approveMat]'); await page.waitForFunction(() => !document.querySelector('[data-action=approveMat]'));
    await page.click('[data-action=decideTrip][data-to=approved]'); await page.waitForFunction(() => !document.querySelector('[data-action=decideTrip]'));
    pass('admin zatwierdza czas, materiał (stan magazynu), dietę');
    await page.click('[data-view=parts]'); await page.waitForSelector('text=Filtr powietrza'); assert.match(await page.textContent('main'), /DEMO-FLT\s*Filtr powietrza \(przykład\)\s*3/); pass('stan magazynu 5-2=3');
    await page.click('[data-view=trips]');
    await page.fill('[name=date]', '2026-11-07');
    await page.fill('[name=workStart]', '08:00');
    await page.fill('[name=workEnd]', '17:00');
    await page.fill('[name=breakDuration]', '01:00');
    await page.check('[name=dietMode][value=day_gt8]');
    await page.check('[name=eligible]');
    await page.fill('[name=absenceStart]', '2026-11-07T06:00');
    await page.fill('[name=absenceEnd]', '2026-11-07T16:30');
    await page.evaluate(() => { const s = document.querySelector('#tripCountry'); const o = new Option('Atlantis', 'Atlantis'); s.add(o); s.value = 'Atlantis'; });
    await page.click('[data-action=previewDaily]');
    await page.waitForSelector('#tripResult .err-box'); pass('nieznany kraj blokuje obliczenie');
    await page.evaluate(() => { const s = document.querySelector('#tripCountry'); s.value = 'DE'; s.dispatchEvent(new Event('change')); });
    await page.check('[name=dietMode][value=day_gt8]');
    await page.fill('[name=absenceStart]', '2026-11-07T08:00');
    await page.fill('[name=absenceEnd]', '2026-11-07T16:00');
    await page.check('[name=eligible]');
    await page.click('[data-action=previewDaily]');
    await page.waitForSelector('#tripResult .err-box');
    assert.match(await page.textContent('#tripResult'), /ponad 8/); pass('≤8 h nieobecności: dieta zablokowana');

    await page.click('[data-view=approvals]'); await page.click('text=Sprawdź'); await page.fill('#decisionNote', 'OK');
    await page.click('[data-action=decide][data-to=approved]'); await page.waitForSelector('text=Protokół zatwierdzony');
    pass('admin zatwierdził protokół -> zablokowany');
    await page.click('[data-view=invoices]'); await page.click('[data-action=buildInvoice]'); await page.waitForSelector('.invoice');
    const inv = await page.textContent('.invoice');
    // +8h dziennik: 1.5*85 + 0.5*55 + 8*85 + 2*24.90 = 884.80 netto; VAT 19% 168.11; brutto 1052.91
    assert.match(inv, /884,80/); assert.match(inv, /168,11/); assert.match(inv, /1\.?052,91/); pass('szkic rachunku: arytmetyka z dziennikiem 884,80');
    await page.click('#saveInv'); await page.waitForSelector('text=Zapisane szkice'); assert.match(await page.textContent('main'), /SZKIC/);
    await page.click('[data-view=team]'); assert.match(await page.textContent('main'), /to Ty – edycja zablokowana/); pass('admin nie edytuje własnej roli');
    await page.click('[data-view=templates]'); await page.click('[data-action=editTemplate]'); await page.fill('#tplItems tr.it:nth-child(4) [name=lsrc]', '');
    await page.click('#tplForm button.btn-green'); assert.match(await st(), /źródła/); pass('granice bez źródła blokują zapis szablonu');
    await page.click('[data-view=assets]'); await page.fill('#clientForm [name=name]', 'Test Klient'); await page.click('#clientForm button'); await page.waitForSelector('h3:has-text("Test Klient")'); pass('dodanie klienta');
    assert.deepEqual(external, []); pass('zero żądań zewnętrznych (brak chmury w demo)');
    assert.deepEqual(errors, []); pass('brak błędów JS');
  } catch (e) { console.error('FAIL', e.message); log.push('FAIL ' + e.message); await page.screenshot({ path: path.join(__dirname, 'smoke-fail.png') }); process.exitCode = 1; }
  fs.writeFileSync(path.join(__dirname, 'browser-smoke-result.txt'), log.join('\n') + '\n');
  await browser.close(); srv.close();
})();
