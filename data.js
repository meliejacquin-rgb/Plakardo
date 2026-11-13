// Couche de données : Firebase (réel) ou démo (stockage local).
// L'interface est la même dans les deux cas.
import { firebaseConfig, household } from "./firebase-config.js";
import { applyLines, compensationLines, OpError, DEFAULT_LOCATIONS, lotsOf, round3 } from "./engine.js";

const clean = (o) => JSON.parse(JSON.stringify(o));
export function newOpId() { return "op" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

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
    shopping: {},
    ops: [],
    meta: { locations: { list: DEFAULT_LOCATIONS }, prefs: { allergies: [], dislikes: [], equipment: ["Four"] }, menu: { entries: [] } },
    recipes: {},
  });
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
  const listeners = new Set();
  const shopListeners = new Set();
  const opListeners = new Set(), metaListeners = new Set(), recListeners = new Set();
  db.ops = db.ops || []; db.meta = db.meta || seed().meta; db.recipes = db.recipes || {};
  const shopList = () => Object.entries(db.shopping || {}).map(([id, v]) => ({ id, ...v }));
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
    listeners.forEach((cb) => cb(db.products.map((p) => ({ ...p }))));
    shopListeners.forEach((cb) => cb(shopList()));
    opListeners.forEach((cb) => cb([...db.ops].reverse().slice(0, 80)));
    metaListeners.forEach((cb) => cb(clean(db.meta)));
    recListeners.forEach((cb) => cb(Object.values(db.recipes)));
  };
  const productMap = () => Object.fromEntries(db.products.map((p) => [p.id, p]));
  async function runOp(op) {
    if (db.ops.some((o) => o.id === op.id)) return { status: "duplicate" };
    let orig = null;
    if (op.compensates) {
      orig = db.ops.find((o) => o.id === op.compensates);
      if (!orig) throw new OpError("missing", "Opération introuvable.");
      if (orig.compensatedBy) throw new OpError("already", "Cette opération a déjà été annulée.");
    }
    const lines = op.compensates ? compensationLines(orig) : op.lines;
    const { writes, recorded } = applyLines(productMap(), lines, { by: op.by });
    for (const [id, doc] of Object.entries(writes)) {
      const i = db.products.findIndex((p) => p.id === id);
      if (i === -1) db.products.push({ ...doc, id }); else db.products[i] = { ...doc, id };
    }
    db.ops.push(clean({ id: op.id, type: op.type, label: op.label, by: op.by, at: Date.now(), lines: recorded, compensates: op.compensates || null }));
    if (orig) orig.compensatedBy = op.id;
    save();
    return { status: "ok", recorded };
  }
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
    runOp,
    async addProduct(p) {
      const id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const { quantity, loc, expiry, expiryType, ...meta } = p;
      if (Number(quantity) > 0) await runOp({ id: newOpId(), type: "add", label: `Ajout · ${p.name}`, by: p.updatedBy || "", lines: [{ kind: "add", productId: id, amount: Number(quantity), loc, expiry, expiryType, newProduct: { ...meta, lots: [] } }] });
      else { db.products.push({ ...meta, id, lots: [], quantity: 0 }); save(); }
      return id;
    },
    subscribeOps(cb) { opListeners.add(cb); cb([...db.ops].reverse().slice(0, 80)); return () => opListeners.delete(cb); },
    subscribeMeta(cb) { metaListeners.add(cb); cb(clean(db.meta)); return () => metaListeners.delete(cb); },
    async setMeta(key, data) { db.meta[key] = clean(data); save(); },
    subscribeRecipes(cb) { recListeners.add(cb); cb(Object.values(db.recipes)); return () => recListeners.delete(cb); },
    async saveRecipe(r) { const id = !r.id || r.id.startsWith("tmp") ? "r" + Date.now().toString(36) : r.id; db.recipes[id] = clean({ ...r, id }); save(); return id; },
    async deleteRecipe(id) { delete db.recipes[id]; save(); },
    async exportAll() { return clean(db); },
    async updateProduct(id, fields) {
      const p = db.products.find((x) => x.id === id);
      if (p) Object.assign(p, fields);
      save();
    },
    async changeQty(id, delta, by, extra = {}) {
      if (!delta) return;
      const p = db.products.find((x) => x.id === id);
      const { label, ...lotInfo } = extra;
      return runOp({ id: newOpId(), type: delta > 0 ? "add" : "remove", label: label || `${delta > 0 ? "Ajout" : "Retrait"} · ${p ? p.name : ""}`, by, lines: [{ kind: delta > 0 ? "add" : "remove", productId: id, amount: Math.abs(delta), ...(delta > 0 ? lotInfo : {}) }] });
    },
    async deleteProduct(id) {
      db.products = db.products.filter((x) => x.id !== id);
      save();
    },
    subscribeShopping(cb) { shopListeners.add(cb); cb(shopList()); return () => shopListeners.delete(cb); },
    async setShopping(id, data) { db.shopping = db.shopping || {}; db.shopping[id] = { ...(db.shopping[id] || {}), ...data }; save(); },
    async addShopping(data) { db.shopping = db.shopping || {}; db.shopping["m" + Date.now()] = data; save(); },
    async deleteShopping(id) { if (db.shopping) delete db.shopping[id]; save(); },
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
  const opsCol = fs.collection(db, ...base, "operations");
  const metaCol = fs.collection(db, ...base, "meta");
  const recCol = fs.collection(db, ...base, "recipes");

  // Opération métier atomique et idempotente (COOK-03/04/05) : transaction serveur, jamais rejouée hors ligne.
  async function runOp(op) {
    if (!navigator.onLine) throw new OpError("offline", "Hors ligne : modification impossible pour le moment.");
    const opRef = fs.doc(opsCol, op.id);
    const attempt = () => fs.runTransaction(db, async (tx) => {
      const already = await tx.get(opRef);
      if (already.exists()) return { status: "duplicate" };
      let orig = null, origRef = null;
      if (op.compensates) {
        origRef = fs.doc(opsCol, op.compensates);
        const o = await tx.get(origRef);
        if (!o.exists()) throw new OpError("missing", "Opération introuvable.");
        orig = o.data();
        if (orig.compensatedBy) throw new OpError("already", "Cette opération a déjà été annulée.");
      }
      const lines = op.compensates ? compensationLines(orig) : op.lines;
      const ids = [...new Set(lines.map((l) => l.productId))];
      const snaps = await Promise.all(ids.map((id) => tx.get(pRef(id))));
      const products = {};
      snaps.forEach((s, i) => { if (s.exists()) products[ids[i]] = { id: ids[i], ...s.data() }; });
      const { writes, recorded } = applyLines(products, lines, { by: op.by });
      for (const [id, docData] of Object.entries(writes)) {
        const { id: _drop, createdAt: _c, updatedAt: _u, ...rest } = docData;
        tx.set(pRef(id), { ...clean(rest), lastOp: op.id, updatedAt: fs.serverTimestamp(), ...(products[id] ? {} : { createdAt: fs.serverTimestamp() }) }, { merge: true });
      }
      tx.set(opRef, { ...clean({ type: op.type, label: op.label || "", by: op.by || "", lines: recorded, compensates: op.compensates || null }), at: fs.serverTimestamp() });
      if (origRef) tx.update(origRef, { compensatedBy: op.id });
      return { status: "ok", recorded };
    });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new OpError("timeout", "Le serveur ne répond pas.")), 15000));
    try {
      return await Promise.race([attempt(), timeout]);
    } catch (e) {
      if (e instanceof OpError && e.code !== "timeout") throw e;
      // OFF-03 : après une erreur réseau, on vérifie l'identifiant d'opération au lieu de retenter un retrait.
      try {
        const check = await fs.getDocFromServer(opRef);
        if (check.exists()) return { status: "ok", recovered: true };
      } catch {}
      throw new OpError("network", "Connexion instable : l’opération n’a pas été enregistrée. Réessayez.");
    }
  }

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
    runOp,
    async addProduct(p) {
      const id = fs.doc(productsCol).id;
      const { quantity, loc, expiry, expiryType, ...meta } = p;
      if (Number(quantity) > 0) await runOp({ id: newOpId(), type: "add", label: `Ajout · ${p.name}`, by: p.updatedBy || "", lines: [{ kind: "add", productId: id, amount: Number(quantity), loc, expiry, expiryType, newProduct: { ...meta, lots: [] } }] });
      else await fs.setDoc(pRef(id), clean({ ...meta, lots: [], quantity: 0 }));
      return id;
    },
    updateProduct(id, fields) {
      return fs.updateDoc(pRef(id), { ...fields, updatedAt: fs.serverTimestamp() });
    },
    changeQty(id, delta, by, extra = {}) {
      if (!delta) return Promise.resolve();
      const { label, ...lotInfo } = extra;
      return runOp({ id: newOpId(), type: delta > 0 ? "add" : "remove", label: label || `${delta > 0 ? "Ajout" : "Retrait"} (scan)`, by, lines: [{ kind: delta > 0 ? "add" : "remove", productId: id, amount: Math.abs(delta), ...(delta > 0 ? lotInfo : {}) }] });
    },
    deleteProduct(id) { return fs.deleteDoc(pRef(id)); },
    subscribeOps(cb) {
      return fs.onSnapshot(fs.query(opsCol, fs.orderBy("at", "desc"), fs.limit(80)), (snap) => cb(snap.docs.map((x) => ({ id: x.id, ...x.data(), at: x.data().at?.toMillis ? x.data().at.toMillis() : Date.now() }))), () => {});
    },
    subscribeMeta(cb) {
      return fs.onSnapshot(metaCol, (snap) => { const m = {}; snap.docs.forEach((x) => { m[x.id] = x.data(); }); cb(m); }, () => {});
    },
    setMeta(key, data) {
      if (!navigator.onLine) return Promise.reject(new OpError("offline", "Hors ligne."));
      return fs.setDoc(fs.doc(metaCol, key), clean(data));
    },
    subscribeRecipes(cb) {
      return fs.onSnapshot(recCol, (snap) => cb(snap.docs.map((x) => ({ id: x.id, ...x.data() }))), () => {});
    },
    async saveRecipe(r) {
      const id = !r.id || r.id.startsWith("tmp") ? fs.doc(recCol).id : r.id;
      await fs.setDoc(fs.doc(recCol, id), { ...clean({ ...r, id }), savedAt: fs.serverTimestamp() });
      return id;
    },
    deleteRecipe(id) { return fs.deleteDoc(fs.doc(recCol, id)); },
    async exportAll() {
      const grab = async (c) => (await fs.getDocs(c)).docs.map((x) => ({ id: x.id, ...x.data() }));
      return clean({ exportedAt: new Date().toISOString(), products: await grab(productsCol), shopping: await grab(fs.collection(db, ...base, "shopping")), recipes: await grab(recCol), meta: await grab(metaCol), operations: await grab(opsCol), barcodes: await grab(fs.collection(db, ...base, "barcodes")) });
    },
    subscribeShopping(cb) {
      return fs.onSnapshot(fs.collection(db, ...base, "shopping"), (snap) => cb(snap.docs.map((x) => ({ id: x.id, ...x.data() }))), () => {});
    },
    setShopping(id, data) {
      return fs.setDoc(fs.doc(db, ...base, "shopping", id), data, { merge: true }).catch((e) => console.error(e));
    },
    addShopping(data) {
      return fs.addDoc(fs.collection(db, ...base, "shopping"), { ...data, createdAt: fs.serverTimestamp() }).catch((e) => console.error(e));
    },
    deleteShopping(id) {
      return fs.deleteDoc(fs.doc(db, ...base, "shopping", id)).catch((e) => console.error(e));
    },
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
