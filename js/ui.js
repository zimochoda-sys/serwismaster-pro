export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function status(msg, kind = 'info') {
  const el = $('#statusBar'); if (!el) return;
  el.textContent = msg; el.className = 'status ' + kind; el.dataset.kind = kind;
}
export function opt(list, val, labelFn = x => x.name, valFn = x => x.id) {
  return list.map(x => `<option value="${esc(valFn(x))}" ${valFn(x) === val ? 'selected' : ''}>${esc(labelFn(x))}</option>`).join('');
}
export function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
