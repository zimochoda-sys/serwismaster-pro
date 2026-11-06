// Verpflegungsmehraufwand (diety) wg niemieckich zasad (§ 9 Abs. 4a EStG) + tabela BMF 2026.
// Automatyzujemy tylko proste przypadki; reszta => manualReview (blokuje zatwierdzenie automatyczne).
import { BMF_2026 } from './bmf-2026-data.js';

export const DOMESTIC = { 2026: { full: 28, partial: 14, source: 'https://www.gesetze-im-internet.de/estg/__9.html' } };
export const FOREIGN_TABLES = { 2026: BMF_2026 };
export const MEAL_SHARE = { breakfast: 0.2, lunch: 0.4, dinner: 0.4 };

export class AllowanceError extends Error {}

export function listCountries(year) {
  const t = FOREIGN_TABLES[year];
  if (!t) return [];
  return Object.keys(t.countries).sort((a, b) => a.localeCompare(b, 'de'));
}

export function listCities(year, country) {
  const c = FOREIGN_TABLES[year]?.countries[country];
  return c?.cities ? Object.keys(c.cities) : [];
}

/** Zwraca stawkę {full, partial, source} albo rzuca AllowanceError (brak fallbacku!). */
export function rateFor(year, country, city) {
  if (country === 'DE') {
    const r = DOMESTIC[year];
    if (!r) throw new AllowanceError(`Brak stawek krajowych DE dla roku ${year}.`);
    return { ...r, label: 'Niemcy (krajowe)' };
  }
  const t = FOREIGN_TABLES[year];
  if (!t) throw new AllowanceError(`Brak tabeli BMF dla roku ${year} – obliczenie zablokowane.`);
  const c = t.countries[country];
  if (!c) throw new AllowanceError(`Kraj „${country}” nie występuje w tabeli BMF ${year}. BMF przewiduje dla krajów nieujętych stawkę Luksemburga – wymaga to ręcznej decyzji księgowości; obliczenie zablokowane.`);
  if (c.cities) {
    if (!city) throw new AllowanceError(`Dla kraju „${country}” wybierz miasto lub „_rest” (pozostałe).`);
    const r = c.cities[city];
    if (!r) throw new AllowanceError(`Miasto „${city}” nie jest w tabeli dla „${country}”. Wybierz „_rest”.`);
    return { full: r.full, partial: r.partial, lodging: r.lodging, source: t.source, label: `${country} – ${city === '_rest' ? 'pozostałe' : city}` };
  }
  return { full: c.full, partial: c.partial, lodging: c.lodging, source: t.source, label: country };
}

const MS_H = 3600e3;
function dayKey(d) { return d.toISOString().slice(0, 10); }
function parseLocal(s) { // 'YYYY-MM-DDTHH:MM' traktujemy jako czas lokalny podróży -> UTC-agnostycznie
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s || '')) throw new AllowanceError(`Nieprawidłowa data/godzina: ${s}`);
  return new Date(s + ':00Z');
}

/**
 * trip: { year?, country, city?, start:'YYYY-MM-DDTHH:MM', end, overnight:boolean,
 *         meals: { 'YYYY-MM-DD': {breakfast,lunch,dinner} }, employeeContribution: { 'YYYY-MM-DD': eur },
 *         crossBorderMultipleCountries?:boolean, sameSiteSince?:'YYYY-MM-DD', interruptedWeeks?:number }
 * Zwraca { days:[{date,hours,type,base,reduction,amount}], total, manualReview:[...], warnings:[...], rate }
 */
export function calculateAllowance(trip) {
  const start = parseLocal(trip.start), end = parseLocal(trip.end);
  if (end <= start) throw new AllowanceError('Koniec podróży musi być po początku.');
  const year = start.getUTCFullYear();
  if (trip.year && trip.year !== year) throw new AllowanceError('Rok tabeli nie zgadza się z datą podróży.');
  if (end.getUTCFullYear() !== year) throw new AllowanceError('Podróż przez przełom roku – podziel ją na dwa rozliczenia (różne tabele).');
  const rate = rateFor(year, trip.country, trip.city);
  const manualReview = [], warnings = [];
  if (trip.crossBorderMultipleCountries) manualReview.push('Kilka krajów w jednej podróży: stawka zależy od kraju osiągniętego przed 24:00 / ostatniej czynności – rozlicz ręcznie.');
  if (trip.sameSiteSince) {
    const since = parseLocal(trip.sameSiteSince + 'T00:00');
    const limit = new Date(since); limit.setUTCMonth(limit.getUTCMonth() + 3);
    if (end > limit && !(trip.interruptedWeeks >= 4)) manualReview.push('Ponad 3 miesiące w tym samym miejscu pracy (bez przerwy ≥4 tyg.) – diety mogą nie przysługiwać (§9 ust. 4a zd. 6–7 EStG).');
  } else warnings.push('Nie podano od kiedy technik pracuje w tym miejscu – reguła 3 miesięcy niesprawdzona.');

  const days = [];
  const sameDay = dayKey(start) === dayKey(end);
  const hours = (end - start) / MS_H;
  if (!trip.overnight) {
    if (!sameDay) manualReview.push('Podróż przez północ bez noclegu: godziny przypisuje się do dnia z większą częścią nieobecności – rozlicz ręcznie.');
    const base = hours > 8 ? rate.partial : 0;
    days.push({ date: dayKey(start), hours: +hours.toFixed(2), type: hours > 8 ? 'ponad 8 h' : 'do 8 h – brak diety', base });
  } else {
    if (sameDay) throw new AllowanceError('Nocleg zaznaczony, ale podróż kończy się tego samego dnia.');
    for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); d <= end; d = new Date(d.getTime() + 24 * MS_H)) {
      const k = dayKey(d);
      const type = k === dayKey(start) ? 'dzień wyjazdu' : k === dayKey(end) ? 'dzień powrotu' : 'pełna doba';
      days.push({ date: k, type, base: type === 'pełna doba' ? rate.full : rate.partial });
    }
  }
  let total = 0;
  for (const day of days) {
    const m = trip.meals?.[day.date] || {};
    let reduction = 0;
    for (const meal of Object.keys(MEAL_SHARE)) if (m[meal]) reduction += round2(rate.full * MEAL_SHARE[meal]);
    const contrib = Math.max(0, Number(trip.employeeContribution?.[day.date] || 0));
    const netReduction = Math.max(0, round2(reduction - contrib));
    day.reduction = netReduction;
    day.amount = Math.max(0, round2(day.base - netReduction));
    total = round2(total + day.amount);
  }
  return { rate, days, total, manualReview, warnings, autoApprovable: manualReview.length === 0 };
}

/** Trzy osobne kwoty – nie mieszać! */
export function splitAmounts(calc, policy = {}) {
  const taxFree = calc.total;
  const reimbursement = policy.reimbursePerDay != null ? round2(policy.reimbursePerDay * calc.days.length) : taxFree;
  const customer = policy.customerPerDay != null ? round2(policy.customerPerDay * calc.days.length) : 0;
  return { taxFree, reimbursement, taxableExcess: Math.max(0, round2(reimbursement - taxFree)), customerBilling: customer };
}

export function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
