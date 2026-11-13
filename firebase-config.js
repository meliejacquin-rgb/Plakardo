// ─────────────────────────────────────────────────────────────
//  PLAKARDO – paramètres à remplir (une seule fois)
// ─────────────────────────────────────────────────────────────
//
// 1. Collez ici le bloc « firebaseConfig » donné par la console Firebase
//    (Paramètres du projet › Vos applications › Application Web).
//    Tant que apiKey vaut "A_REMPLIR", l'app tourne en MODE DÉMO :
//    données d'exemple, enregistrées seulement sur l'appareil.
//
// 2. Indiquez les adresses e-mail des 2 comptes et le prénom affiché.
//    Ce sont les mêmes adresses que dans firestore.rules.

export const firebaseConfig = {
  apiKey: "AIzaSyCp11qfi-mZubVzvNf0g4ttlfU9EGG_tc4",
  authDomain: "plakardo.firebaseapp.com",
  projectId: "plakardo",
  storageBucket: "plakardo.firebasestorage.app",
  messagingSenderId: "782071800653",
  appId: "1:782071800653:web:e015296e50d2659fdbcd04",
};

export const household = {
  id: "chatpito",
  name: "ChatPito",
  // Empreintes (SHA-256) des 2 adresses e-mail : les adresses ne sont pas lisibles ici.
  memberNames: ["Mélie", "Selina"],
  members: {
    "d5bdbfc2ef9aa8e253c23e0687b66fb958da0e82219a770ff373aae72a86f0c6": "Mélie",
    "4c107b2a9ecf978e20a177492e7382329bda27d478e93f31f02818088bb9546a": "Selina",
  },
};
