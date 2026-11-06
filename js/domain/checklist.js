// Szablony checklist, migawki (snapshot) wersji i walidacja wyników.
export const ITEM_TYPES = ['check', 'measure', 'text'];
export const OUTCOMES = ['ok', 'defect', 'na'];

export function validateTemplateItem(it) {
  const e = [];
  if (!it.id || !/^[a-z0-9_-]{1,40}$/i.test(it.id)) e.push('Nieprawidłowe ID punktu');
  if (!it.label || it.label.length > 200) e.push('Brak/za długa nazwa punktu');
  if (!ITEM_TYPES.includes(it.type)) e.push('Nieznany typ punktu');
  if (it.type === 'measure') {
    if (!it.unit) e.push(`Punkt „${it.label}”: pomiar wymaga jednostki`);
    const hasLimit = it.min != null || it.max != null;
    if (hasLimit && !it.limitSource) e.push(`Punkt „${it.label}”: granice wymagają źródła (dokumentacja producenta)`);
    if (it.min != null && it.max != null && Number(it.min) > Number(it.max)) e.push(`Punkt „${it.label}”: min > max`);
  }
  return e;
}

export function validateTemplate(items) {
  const errs = [];
  if (!Array.isArray(items) || !items.length) return ['Szablon musi mieć co najmniej jeden punkt'];
  if (items.length > 200) errs.push('Maks. 200 punktów');
  const ids = new Set();
  for (const it of items) { if (ids.has(it.id)) errs.push(`Zduplikowane ID ${it.id}`); ids.add(it.id); errs.push(...validateTemplateItem(it)); }
  return errs;
}

/** Migawka do zlecenia – zamrożona kopia konkretnej wersji szablonu. */
export function snapshotFor(templateVersion) {
  const items = templateVersion.items.map(i => ({ ...i }));
  return {
    templateId: templateVersion.templateId, templateVersion: templateVersion.version,
    templateName: templateVersion.name, source: templateVersion.source || '',
    items, requiredItemIds: items.filter(i => i.required).map(i => i.id),
  };
}

export function validateResult(item, r) {
  const e = [];
  if (!r || !OUTCOMES.includes(r.outcome)) return ['Wybierz wynik: OK / Usterka / Nie dotyczy'];
  if (r.outcome === 'na' && !(r.naReason || '').trim()) e.push('„Nie dotyczy” wymaga uzasadnienia');
  if (r.outcome === 'defect' && !(r.note || '').trim()) e.push('Usterka wymaga opisu');
  if (item.type === 'measure' && r.outcome !== 'na') {
    if (r.value === '' || r.value == null || !Number.isFinite(Number(r.value))) e.push('Podaj wartość pomiaru');
    else if (r.outcome === 'ok' && isOutOfRange(item, Number(r.value))) e.push('Wartość poza zakresem – oznacz jako usterkę');
  }
  if (item.type === 'text' && r.outcome === 'ok' && item.required && !(r.note || '').trim()) e.push('Wpisz odpowiedź');
  if ((r.note || '').length > 2000 || (r.naReason || '').length > 500) e.push('Tekst za długi');
  return e;
}

export function isOutOfRange(item, v) {
  return (item.min != null && v < Number(item.min)) || (item.max != null && v > Number(item.max));
}

export function validateSubmission(snapshot, results) {
  const problems = [];
  for (const item of snapshot.items) {
    const r = results?.[item.id];
    if (!r) { if (item.required) problems.push({ itemId: item.id, msg: `Brak odpowiedzi: ${item.label}` }); continue; }
    for (const m of validateResult(item, r)) problems.push({ itemId: item.id, msg: `${item.label}: ${m}` });
  }
  return problems;
}

export const ORDER_STATUSES = { planned: 'Zaplanowane', in_progress: 'W trakcie', submitted: 'Do akceptacji', approved: 'Zatwierdzone (zablokowane)', rejected: 'Odrzucone – do poprawy' };
export function techCanEdit(status) { return ['planned', 'in_progress', 'rejected'].includes(status); }
export const TRANSITIONS = {
  tech: { planned: ['in_progress'], in_progress: ['submitted'], rejected: ['in_progress', 'submitted'] },
  admin: { submitted: ['approved', 'rejected'] },
};
export function canTransition(role, from, to) { return (TRANSITIONS[role]?.[from] || []).includes(to); }
