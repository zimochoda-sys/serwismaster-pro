// SKOPIUJ ten plik jako js/config.js i wpisz konfigurację SWOJEGO projektu Firebase
// (Konsola Firebase > Ustawienia projektu > Twoje aplikacje > Aplikacja internetowa).
// Konfiguracja aplikacji web nie jest hasłem, ale bez reguł bezpieczeństwa NIE chroni danych – wdroż firebase/*.rules.
// NIE wpisuj tu kluczy konta serwisowego ani haseł.
export const CONFIG = {
  firebase: null, // np. { apiKey: '...', authDomain: '<projekt>.firebaseapp.com', projectId: '<projekt>', storageBucket: '<projekt>.firebasestorage.app', appId: '...' }
  tenantId: null, // ID firmy utworzone skryptem tools/bootstrap-admin.mjs, np. 'firma-gmbh'
  authPersistence: 'session', // 'session' = sesja tylko w tej karcie; 'local' = zapamiętaj (IndexedDB SDK Firebase)
  useEmulators: false, // true tylko do testów lokalnych z Firebase Emulator Suite
};
