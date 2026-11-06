// Budowa bezpiecznego payloadu diet do Firestore + mapowanie prostego formularza UI.
// Firestore odrzuca `undefined` – opcjonalne pola pomijamy (nie ustawiamy null/undefined).
import { AllowanceError } from './allowance.js';

/** Usuwa wyłącznie klucze o wartości undefined (rekurencyjnie). null i '' zostawia. */
export function omitUndefinedDeep(value) {
  if (Array.isArray(value)) return value.map(omitUndefinedDeep);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = omitUndefinedDeep(v);
    }
    return out;
  }
  return value;
}

export function hasUndefinedDeep(value, path = '') {
  if (value === undefined) return path || '(root)';
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = hasUndefinedDeep(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const hit = hasUndefinedDeep(v, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

/** HH:MM → minuty; puste → null (pole opcjonalne). */
export function parseDurationToMinutes(s) {
  if (s == null || String(s).trim() === '') return null;
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(String(s).trim());
  if (!m) throw new AllowanceError('Przerwa: podaj czas jako HH:MM (np. 01:00).');
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * dayCategory:
 *  - 'auto' – z dat: ten sam dzień = bez noclegu; różne dni = wielodniowa z noclegiem
 *  - 'partial_gt8' – An-/Abreisetag (>8 h), bez noclegu, tylko jeden dzień
 *  - 'full_multi' – 24h / wielodniowa z noclegiem
 */
export function resolveTripTiming({ start, end, dayCategory = 'auto' }) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start || '')) throw new AllowanceError('Podaj początek nieobecności (data i godzina).');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end || '')) throw new AllowanceError('Podaj koniec nieobecności (data i godzina).');
  const s = new Date(start + ':00Z'), e = new Date(end + ':00Z');
  if (e <= s) throw new AllowanceError('Koniec musi być po początku.');
  const sameDay = start.slice(0, 10) === end.slice(0, 10);
  const hours = (e - s) / 3600e3;
  let overnight;
  if (dayCategory === 'auto') {
    overnight = !sameDay;
  } else if (dayCategory === 'partial_gt8') {
    if (!sameDay) throw new AllowanceError('Kategoria „An-/Abreisetag (>8 h)” dotyczy jednego dnia kalendarzowego.');
    if (!(hours > 8)) throw new AllowanceError('Dla An-/Abreisetag nieobecność musi trwać ponad 8 godzin. Zwykły dzień pracy ≤8 h nie daje diety.');
    overnight = false;
  } else if (dayCategory === 'full_multi') {
    if (sameDay) throw new AllowanceError('Kategoria „24 h / wielodniowa” wymaga noclegu i daty końcowej w innym dniu.');
    overnight = true;
  } else {
    throw new AllowanceError('Nieznana kategoria dnia.');
  }
  return { overnight, sameDay, hours: +hours.toFixed(2) };
}

/**
 * Buduje obiekt input do calculateAllowance + zapisu Firestore.
 * city / sameSiteSince / interruptedWeeks / privateKm / breakMinutes – tylko gdy mają wartość.
 */
export function buildTripInput(raw) {
  if (!raw?.businessTripEligible) {
    throw new AllowanceError('Zaznacz, że to podróż służbowa / nieobecność poza miejscem zamieszkania lub pierwszą placówką – same godziny pracy nie tworzą diety.');
  }
  const { overnight } = resolveTripTiming({ start: raw.start, end: raw.end, dayCategory: raw.dayCategory || 'auto' });
  const input = {
    country: raw.country || 'DE',
    start: raw.start,
    end: raw.end,
    overnight,
    crossBorderMultipleCountries: !!raw.crossBorderMultipleCountries,
    meals: raw.meals && Object.keys(raw.meals).length ? raw.meals : {},
    employeeContribution: raw.employeeContribution && Object.keys(raw.employeeContribution).length ? raw.employeeContribution : {},
    dayCategory: raw.dayCategory || 'auto',
    businessTripEligible: true,
  };
  const city = (raw.city || '').trim();
  if (city) input.city = city;
  if (raw.sameSiteSince) input.sameSiteSince = raw.sameSiteSince;
  if (raw.interruptedWeeks != null && raw.interruptedWeeks !== '') {
    const w = Number(raw.interruptedWeeks);
    if (!Number.isFinite(w) || w < 0) throw new AllowanceError('Przerwa w miejscu pracy: podaj liczbę tygodni ≥ 0.');
    input.interruptedWeeks = w;
  }
  if (raw.breakDuration) {
    const mins = parseDurationToMinutes(raw.breakDuration);
    if (mins != null) input.breakMinutes = mins;
  }
  if (raw.privateKm != null && String(raw.privateKm).trim() !== '') {
    const km = Number(raw.privateKm);
    if (!Number.isFinite(km) || km < 0) throw new AllowanceError('Prywatne km: podaj liczbę ≥ 0.');
    input.privateKm = km;
  }
  const clean = omitUndefinedDeep(input);
  const bad = hasUndefinedDeep(clean);
  if (bad) throw new AllowanceError(`Wewnętrzny błąd: undefined w polu ${bad}`);
  return clean;
}
