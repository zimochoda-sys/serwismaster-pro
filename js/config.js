// Lokalna / Pages konfiguracja projektu service-21527 (AZ Service).
// Publiczna konfiguracja aplikacji web Firebase – NIE jest hasłem ani kluczem serwisowym.
// Ochronę danych dają reguły Firestore. features.photos=false: Spark bez Storage (Blaze wymagany do zdjęć).
export const CONFIG = {
  firebase: {
    apiKey: 'AIzaSyASTxHOjkBgGZnc-PjgZb0DHRVv2L3gMQ0',
    authDomain: 'service-21527.firebaseapp.com',
    projectId: 'service-21527',
    storageBucket: 'service-21527.firebasestorage.app',
    messagingSenderId: '609818317583',
    appId: '1:609818317583:web:14c2e0b49e26dfc993247a',
    measurementId: 'G-RK2L8JQZXD',
  },
  tenantId: 'serwismaster',
  authPersistence: 'session',
  useEmulators: false,
  features: { photos: false },
};
