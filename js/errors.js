export class ConflictError extends Error { constructor(m = 'Konflikt: dane zmieniły się na innym urządzeniu. Odśwież i spróbuj ponownie.') { super(m); this.name = 'ConflictError'; } }
export class PermissionError extends Error { constructor(m = 'Brak uprawnień do tej operacji.') { super(m); this.name = 'PermissionError'; } }
export class ValidationError extends Error { constructor(list) { super(Array.isArray(list) ? list.join('\n') : list); this.name = 'ValidationError'; this.list = list; } }
export function humanError(e) {
  const c = e?.code || '';
  if (c.includes('permission-denied')) return 'Serwer odrzucił zapis (brak uprawnień lub dokument zablokowany). Nic nie zapisano.';
  if (c.includes('unavailable') || c.includes('network')) return 'Brak połączenia z chmurą – NIE zapisano. Spróbuj ponownie po odzyskaniu sieci.';
  if (c.includes('auth/invalid-credential') || c.includes('auth/wrong-password') || c.includes('auth/user-not-found')) return 'Nieprawidłowy e-mail lub hasło.';
  if (c.includes('auth/too-many-requests')) return 'Za dużo prób logowania. Spróbuj później.';
  return e?.message || String(e);
}
