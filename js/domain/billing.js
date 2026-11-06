// Czas pracy i SZKIC rachunku. Kwoty liczone w centach (liczby całkowite).
export const TIME_KINDS = { work: 'Praca', travel: 'Dojazd', break: 'Przerwa' };

export function validateTimeEntry(t) {
  const e = [];
  if (!TIME_KINDS[t.kind]) e.push('Nieznany rodzaj czasu');
  if (!Number.isInteger(t.minutes) || t.minutes < 1 || t.minutes > 1440) e.push('Minuty: 1–1440');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) e.push('Data RRRR-MM-DD');
  return e;
}

export function sumTime(entries) {
  const s = { work: 0, travel: 0, break: 0 };
  for (const t of entries) s[t.kind] += t.minutes;
  return s;
}

export const toCents = eur => Math.round(Number(eur) * 100);
export const fmtEur = c => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

/**
 * Buduje szkic rachunku WYŁĄCZNIE z zatwierdzonych pozycji.
 * rates: { workPerHour, travelPerHour } EUR; vatPercent konfigurowalne (np. 19 – nie jest to porada podatkowa).
 */
export function buildInvoiceDraft({ order, timeEntries, materials, rates, vatPercent }) {
  if (order.status !== 'approved') throw new Error('Szkic rachunku tylko dla zatwierdzonego zlecenia.');
  if (!(vatPercent >= 0 && vatPercent <= 100)) throw new Error('Nieprawidłowa stawka VAT');
  const lines = [];
  const appr = timeEntries.filter(t => t.status === 'approved' && t.workOrderId === order.id);
  const sums = sumTime(appr);
  for (const kind of ['work', 'travel']) {
    if (!sums[kind]) continue;
    const per = toCents(kind === 'work' ? rates.workPerHour : rates.travelPerHour);
    lines.push({ desc: `${TIME_KINDS[kind]} (${(sums[kind] / 60).toFixed(2)} h)`, qty: sums[kind] / 60, unit: 'h', unitCents: per, netCents: Math.round(per * sums[kind] / 60) });
  }
  for (const m of materials.filter(m => m.status === 'approved' && m.workOrderId === order.id)) {
    const unit = toCents(m.unitPrice);
    lines.push({ desc: m.name, qty: m.qty, unit: 'szt.', unitCents: unit, netCents: Math.round(unit * m.qty) });
  }
  const netCents = lines.reduce((a, l) => a + l.netCents, 0);
  const vatCents = Math.round(netCents * vatPercent / 100);
  return { status: 'draft', number: null, workOrderId: order.id, clientId: order.clientId, lines, vatPercent, netCents, vatCents, grossCents: netCents + vatCents,
    disclaimer: 'SZKIC – nie jest fakturą. Brak nadawania numeru, archiwizacji GoBD ani formatu E-Rechnung (XRechnung/ZUGFeRD).' };
}
