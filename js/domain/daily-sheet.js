// Dzienny arkusz: czas pracy + opcjonalna dieta (osobne czasy nieobecności).
import { rateFor, MEAL_SHARE, AllowanceError, round2, splitAmounts } from './allowance.js';
import { omitUndefinedDeep, hasUndefinedDeep, parseDurationToMinutes } from './trip-form.js';

export function dailyTimeId(uid, date, workOrderId) {
  return `dte_${safe(uid)}_${date}_${safe(workOrderId)}`;
}
export function dailyTripId(uid, date, workOrderId) {
  return `dtr_${safe(uid)}_${date}_${safe(workOrderId)}`;
}
function safe(s) { return String(s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64); }

/** 'HH:MM' + 'YYYY-MM-DD' → minuty od północy; end może być następnego dnia przy overnight work (rzadkie). */
export function parseHm(hm) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hm || '').trim());
  if (!m) throw new AllowanceError('Godzina: użyj HH:MM.');
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function workMinutesFromRange(date, startHm, endHm, breakHm) {
  const start = parseHm(startHm), end = parseHm(endHm);
  if (end <= start) throw new AllowanceError('Koniec pracy musi być po początku (ten sam dzień).');
  const br = breakHm ? parseDurationToMinutes(breakHm) : 0;
  if (br == null) throw new AllowanceError('Przerwa: HH:MM lub puste.');
  if (br < 0) throw new AllowanceError('Przerwa nie może być ujemna.');
  const gross = end - start;
  if (br >= gross) throw new AllowanceError('Przerwa nie może być dłuższa niż czas pracy.');
  const net = gross - br;
  if (net < 1) throw new AllowanceError('Czas pracy netto musi być ≥ 1 min.');
  if (net > 1440) throw new AllowanceError('Czas pracy netto > 24 h.');
  return { minutes: net, breakMinutes: br, workStart: `${date}T${pad(start)}`, workEnd: `${date}T${pad(end)}` };
}
function pad(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * dietMode: 'none' | 'day_gt8' | 'full24' | 'arrival_departure'
 * absenceStart/End: 'YYYY-MM-DDTHH:MM' – nieobecność w podróży (nie godziny pracy)
 */
export function validateDietAbsence({ dietMode, date, absenceStart, absenceEnd }) {
  if (dietMode === 'none') return { kind: null };
  if (!absenceStart || !absenceEnd) throw new AllowanceError('Dieta wymaga godzin nieobecności (wyjazd/powrót), osobno od czasu pracy.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(absenceStart) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(absenceEnd)) {
    throw new AllowanceError('Nieobecność: pełna data i godzina.');
  }
  const s = new Date(absenceStart + ':00Z'), e = new Date(absenceEnd + ':00Z');
  if (e <= s) throw new AllowanceError('Koniec nieobecności musi być po początku.');
  const hours = (e - s) / 3600e3;
  const startDay = absenceStart.slice(0, 10), endDay = absenceEnd.slice(0, 10);

  if (dietMode === 'day_gt8') {
    if (startDay !== date || endDay !== date) throw new AllowanceError('Dieta „dzień >8 h”: nieobecność w obrębie wybranej daty.');
    if (!(hours > 8)) throw new AllowanceError('Dieta „dzień >8 h” wymaga ponad 8 h nieobecności (nie czasu pracy).');
    return { kind: 'partial', overnight: false, hours };
  }
  if (dietMode === 'full24') {
    // Cała doba daty musi leżeć wewnątrz okna nieobecności (wymaga przejścia przez północ / zakres ≥ doby).
    const dayStart = new Date(date + 'T00:00:00Z');
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600e3);
    if (!(s <= dayStart && e >= dayEnd)) {
      throw new AllowanceError('Dieta „24 h”: nieobecność musi obejmować całą dobę wybranej daty (od 00:00 do 24:00) – zwykle z noclegiem.');
    }
    if (startDay === endDay) throw new AllowanceError('Dieta „24 h” wymaga nieobecności przez północ (różne dni kalendarzowe).');
    return { kind: 'full', overnight: true, hours };
  }
  if (dietMode === 'arrival_departure') {
    // An-/Abreisetag wielodniowej podróży: data jest dniem wyjazdu lub powrotu, z noclegiem w zakresie.
    if (startDay === endDay) throw new AllowanceError('An-/Abreisetag: zaznacz podróż z noclegiem (wyjazd i powrót w różnych dniach).');
    if (date !== startDay && date !== endDay) {
      throw new AllowanceError('An-/Abreisetag: wybrana data musi być dniem wyjazdu lub powrotu nieobecności.');
    }
    return { kind: 'partial', overnight: true, hours };
  }
  throw new AllowanceError('Nieznany tryb diety.');
}

/** Kwota diety za JEDEN dzień (nie zgaduje z godzin pracy). */
export function calculateDailyDiet({ date, country, city, kind, meals, employeeContributionEur }) {
  if (!kind) {
    return { total: 0, days: [], rate: null, manualReview: [], warnings: [], autoApprovable: true };
  }
  const year = Number(date.slice(0, 4));
  const rate = rateFor(year, country, city || undefined);
  const base = kind === 'full' ? rate.full : rate.partial;
  const m = meals || {};
  let reduction = 0;
  for (const meal of Object.keys(MEAL_SHARE)) if (m[meal]) reduction += round2(rate.full * MEAL_SHARE[meal]);
  const contrib = Math.max(0, Number(employeeContributionEur || 0));
  const netReduction = Math.max(0, round2(reduction - contrib));
  const amount = Math.max(0, round2(base - netReduction));
  const day = { date, type: kind === 'full' ? 'pełna doba' : 'dzień wyjazdu/powrotu / >8 h', base, reduction: netReduction, amount };
  return {
    rate, days: [day], total: amount, manualReview: [], warnings: [],
    autoApprovable: true,
  };
}

/**
 * Buduje payloady do batch save. Nie zawiera undefined.
 * dietMode none → tylko timeEntry.
 */
export function buildDailySheetPayloads(raw) {
  if (!raw?.uid) throw new AllowanceError('Brak UID.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '')) throw new AllowanceError('Podaj datę.');
  if (!raw.workOrderId) throw new AllowanceError('Wybierz zlecenie.');
  if (!raw.businessTripEligible && raw.dietMode && raw.dietMode !== 'none') {
    throw new AllowanceError('Zaznacz potwierdzenie podróży służbowej (nieobecność ≠ same godziny pracy).');
  }

  const work = workMinutesFromRange(raw.date, raw.workStart, raw.workEnd, raw.breakDuration || '00:00');
  const timeId = dailyTimeId(raw.uid, raw.date, raw.workOrderId);
  const timeEntry = omitUndefinedDeep({
    workOrderId: raw.workOrderId,
    uid: raw.uid,
    date: raw.date,
    kind: 'work',
    minutes: work.minutes,
    note: raw.privateKm != null && String(raw.privateKm).trim() !== ''
      ? `dziennik; km=${Number(raw.privateKm)}; ${work.workStart.slice(11)}-${work.workEnd.slice(11)}; przerwa ${raw.breakDuration || '00:00'}`
      : `dziennik; ${work.workStart.slice(11)}-${work.workEnd.slice(11)}; przerwa ${raw.breakDuration || '00:00'}`,
    status: 'draft',
  });

  const dietMode = raw.dietMode || 'none';
  let trip = null, calc = null;
  const tripId = dailyTripId(raw.uid, raw.date, raw.workOrderId);
  if (dietMode !== 'none') {
    const abs = validateDietAbsence({
      dietMode, date: raw.date, absenceStart: raw.absenceStart, absenceEnd: raw.absenceEnd,
    });
    const meals = {
      breakfast: !!raw.mealBreakfast, lunch: !!raw.mealLunch, dinner: !!raw.mealDinner,
    };
    const mealsMap = {};
    if (meals.breakfast || meals.lunch || meals.dinner) mealsMap[raw.date] = meals;
    calc = calculateDailyDiet({
      date: raw.date, country: raw.country || 'DE', city: (raw.city || '').trim(),
      kind: abs.kind, meals, employeeContributionEur: raw.mealContrib,
    });
    if (raw.multiCountry) {
      calc = { ...calc, manualReview: [...(calc.manualReview || []), 'Wiele krajów – weryfikacja ręczna'], autoApprovable: false };
    }
    const input = omitUndefinedDeep({
      country: raw.country || 'DE',
      start: raw.absenceStart,
      end: raw.absenceEnd,
      overnight: abs.overnight,
      crossBorderMultipleCountries: !!raw.multiCountry,
      meals: mealsMap,
      employeeContribution: raw.mealContrib ? { [raw.date]: Number(raw.mealContrib) } : {},
      dayCategory: dietMode,
      businessTripEligible: true,
      dailySheet: true,
      workDate: raw.date,
      ...(raw.city && String(raw.city).trim() ? { city: String(raw.city).trim() } : {}),
      ...(raw.privateKm != null && String(raw.privateKm).trim() !== '' ? { privateKm: Number(raw.privateKm) } : {}),
      ...(work.breakMinutes ? { breakMinutes: work.breakMinutes } : {}),
    });
    if ('city' in input && !input.city) delete input.city;
    const split = splitAmounts(calc, {});
    trip = omitUndefinedDeep({
      uid: raw.uid,
      workOrderId: raw.workOrderId,
      input,
      calc: { ...calc, split },
      status: calc.autoApprovable ? 'draft' : 'manual_review',
    });
  }

  const payload = { timeId, timeEntry, tripId, trip, work };
  const bad = hasUndefinedDeep(payload);
  if (bad) throw new AllowanceError(`undefined w polu ${bad}`);
  return payload;
}
