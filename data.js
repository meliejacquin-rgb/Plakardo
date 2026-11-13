// Couche de données : Firebase (réel) ou démo (stockage local).
// L'interface est la même dans les deux cas.
import { firebaseConfig, household } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";

export const isDemo = !firebaseConfig.apiKey || firebaseConfig.apiKey === "A_REMPLIR";

let currentName = "";
export async function resolveName(email) {
  currentName = "";
  if (!email) return "";
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    currentName = household.members[hex] || "";
  } catch {}
  if (!currentName) currentName = email.split("@")[0];
  return currentName;
}
export function displayName() { return currentName; }

// ───────────────────────── Mode démo ─────────────────────────
function demoStore() {
  const KEY = "plakardo-demo-v1";
  const today = new Date();
  const inDays = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const seed = () => ({
    products: [
      { id: "d1", name: "Pâtée poulet en sauce", brand: "", detail: "Boîte 85 g", categoryId: "chat", unit: "boîte", quantity: 12, minQuantity: 6, expiry: inDays(140) },
      { id: "d2", name: "Pâtée saumon", detail: "Boîte 85 g", categoryId: "chat", unit: "boîte", quantity: 3, minQuantity: 6, expiry: inDays(8) },
      { id: "d3", name: "Croquettes stérilisé", detail: "Sac 1,5 kg", categoryId: "chat", unit: "sac", quantity: 2, minQuantity: 1, expiry: inDays(270) },
      { id: "d4", name: "Litière agglomérante", detail: "Sac 10 L", categoryId: "chat", unit: "sac", quantity: 1, minQuantity: 2, expiry: null },
      { id: "d5", name: "Yaourts nature ×4", detail: "", categoryId: "alim", unit: "pièce", quantity: 1, minQuantity: 0, expiry: inDays(2) },
      { id: "d6", name: "Jambon blanc", detail: "", categoryId: "alim", unit: "pièce", quantity: 1, minQuantity: 0, expiry: inDays(3) },
      { id: "d7", name: "Lait demi-écrémé", detail: "1 L", categoryId: "alim", unit: "pièce", quantity: 4, minQuantity: 2, expiry: inDays(6) },
      { id: "d8", name: "Pâtes", detail: "500 g", categoryId: "alim", unit: "pièce", quantity: 3, minQuantity: 1, expiry: inDays(300) },
      { id: "d9", name: "Paracétamol 500 mg", detail: "", categoryId: "pharma", unit: "boîte", quantity: 1, minQuantity: 1, expiry: inDays(400) },
      { id: "d10", name: "Dentifrice menthe", detail: "", categoryId: "hyg", unit: "tube", quantity: 1, minQuantity: 1, expiry: null },
      { id: "d11", name: "Gel douche amande", detail: "", categoryId: "hyg", unit: "flacon", quantity: 2, minQuantity: 1, expiry: null },
    ],
    history: [],
    barcodes: {},
  });
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
  const listeners = new Set();
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
    listeners.forEach((cb) => cb(db.products.map((p) => ({ ...p }))));
  };
  const user = { email: "demo@plakardo", demo: true };
  return {
    onUser(cb) { setTimeout(() => cb(user), 0); return () => {}; },
    async signIn() { return user; },
    async signOut() {},
    subscribe(cb) {
      listeners.add(cb);
      cb(db.products.map((p) => ({ ...p })));
      return () => listeners.delete(cb);
    },
    async addProduct(p) {
      const id = "d" + Date.now();
      db.products.push({ ...p, id });
      save();
      return id;
    },
    async updateProduct(id, fields) {
      const p = db.products.find((x) => x.id === id);
      if (p) Object.assign(p, fields);
      save();
    },
    async changeQty(id, delta, by) {
      const p = db.products.find((x) => x.id === id);
      if (!p || !delta) return;
      p.quantity = Math.max(0, (p.quantity || 0) + delta);
      db.history.push({ productId: id, delta, by, at: Date.now() });
      save();
    },
    async deleteProduct(id) {
      db.products = db.products.filter((x) => x.id !== id);
      save();
    },
    async getBarcode(key) { return (db.barcodes || {})[key] || null; },
    async saveBarcode(key, data) { db.barcodes = db.barcodes || {}; db.barcodes[key] = data; save(); },
    async resetDemo() { db = seed(); save(); },
  };
}

// ───────────────────────── Firebase ─────────────────────────
async function firebaseStore() {
  const [{ initializeApp }, authMod, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  const base = ["households", household.id];
  const productsCol = fs.collection(db, ...base, "products");
  const historyCol = fs.collection(db, ...base, "history");
  const pRef = (id) => fs.doc(db, ...base, "products", id);

  return {
    onUser(cb) { return authMod.onAuthStateChanged(auth, (u) => cb(u ? { email: u.email, uid: u.uid } : null)); },
    signIn(email, password) { return authMod.signInWithEmailAndPassword(auth, email.trim(), password); },
    signOut() { return authMod.signOut(auth); },
    subscribe(cb, onError) {
      return fs.onSnapshot(
        productsCol,
        (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => onError && onError(err)
      );
    },
    async addProduct(p) {
      const ref = await fs.addDoc(productsCol, { ...p, createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() });
      return ref.id;
    },
    updateProduct(id, fields) {
      return fs.updateDoc(pRef(id), { ...fields, updatedAt: fs.serverTimestamp() });
    },
    async changeQty(id, delta, by) {
      if (!delta) return;
      const batch = fs.writeBatch(db);
      batch.update(pRef(id), { quantity: fs.increment(delta), updatedAt: fs.serverTimestamp(), updatedBy: by });
      batch.set(fs.doc(historyCol), { productId: id, delta, by, at: fs.serverTimestamp() });
      // Pas d'attente du serveur : hors ligne, l'écriture part au retour du réseau.
      batch.commit().catch((e) => console.error("Écriture refusée", e));
    },
    deleteProduct(id) { return fs.deleteDoc(pRef(id)); },
    async getBarcode(key) {
      try {
        const snap = await fs.getDoc(fs.doc(db, ...base, "barcodes", encodeURIComponent(key)));
        return snap.exists() ? snap.data() : null;
      } catch { return null; }
    },
    saveBarcode(key, data) {
      return fs.setDoc(fs.doc(db, ...base, "barcodes", encodeURIComponent(key)), { ...data, key, updatedAt: fs.serverTimestamp() }, { merge: true }).catch(() => {});
    },
  };
}

export async function createStore() {
  return isDemo ? demoStore() : firebaseStore();
}
