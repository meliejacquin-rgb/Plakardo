// PLAKARDO – application (v1, socle)
import { createStore, isDemo, displayName, resolveName, newOpId } from "./data.js";
import * as E from "./engine.js";
import { household } from "./firebase-config.js";
import { parseDateText } from "./codes.js";
import { initScanner, openScanner, closeScanner, refreshScanner } from "./scan.js";

// ───────────────────────── Référentiels ─────────────────────────
const CATS = [
  { id: "alim", name: "Alimentaire" },
  { id: "pharma", name: "Pharmacie" },
  { id: "hyg", name: "Hygiène" },
  { id: "chat", name: "Chat" },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
const UNITS = ["pièce", "boîte", "flacon", "sachet", "sac", "tube", "g", "kg", "ml", "L"];
const PLURAL = { pièce: "pièces", boîte: "boîtes", flacon: "flacons", sachet: "sachets", sac: "sacs", tube: "tubes", g: "g", kg: "kg", ml: "ml", L: "L" };

const svg = (body, size = 24, sw = 1.8) =>
  `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const I = {
  home: (s) => svg('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>', s),
  cupboard: (s) => svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 3v18M9.5 11v2M14.5 11v2"/>', s),
  scan: (s) => svg('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>', s, 2),
  bell: (s) => svg('<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>', s),
  user: (s) => svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', s),
  back: (s) => svg('<path d="M15 5l-7 7 7 7"/>', s, 2),
  close: (s) => svg('<path d="M6 6l12 12M18 6L6 18"/>', s, 2.2),
  plus: (s) => svg('<path d="M12 5v14M5 12h14"/>', s, 2.4),
  minus: (s) => svg('<path d="M5 12h14"/>', s, 2.4),
  search: (s) => svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', s),
  alim: (s) => svg('<path d="M4 10h16l-1.5 9a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7z"/><path d="M8 10l4-6 4 6"/>', s),
  pharma: (s) => svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>', s),
  hyg: (s) => svg('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>', s),
  chat: (s) => svg('<path d="M5 20v-9L4 4l5 3h6l5-3-1 7v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M9.5 13h.01M14.5 13h.01M11 16.5h2"/>', s),
  share: (s) => svg('<path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>', s, 2),
};
const catIcon = (id, size = 24) => (I[id] || I.cupboard)(size);

// ───────────────────────── Outils ─────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayMidnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d) - todayMidnight()) / 864e5);
}
function addToToday({ days = 0, months = 0, years = 0 }) {
  const d = todayMidnight();
  d.setFullYear(d.getFullYear() + years, d.getMonth() + months, d.getDate() + days);
  return localDate(d);
}
const frDate = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
function dateLabel(p) {
  if (!p.expiry) return "Sans date";
  const kind = p.categoryId === "pharma" ? "Pér." : "DLC";
  const d = daysUntil(p.expiry);
  if (d < 0) return `Périmé depuis ${-d} j`;
  if (d === 0) return `${kind} aujourd’hui`;
  if (d === 1) return `${kind} demain`;
  if (d <= 30) return `${kind} dans ${d} j`;
  const [y, m] = p.expiry.split("-");
  return `${kind} ${m}/${y}`;
}
const parseQ = (v) => { const n = Number(String(v ?? "").replace(",", ".").trim()); return Number.isFinite(n) ? Math.max(0, Math.round(n * 1000) / 1000) : 0; };
const fmtQ = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000).replace(".", ",");
const qty = (p) => E.totalQty(p);
const isLow = (p) => E.isLowStock(p);
const isUrgent = (p) => qty(p) > 0 && p.expiry && daysUntil(p.expiry) <= 7;
const STATUS_LABEL = { dispo: "Disponible", bientot: "Bientôt vide", epuise: "Épuisé" };
const unitLabel = (p, q = qty(p)) => (q > 1 ? PLURAL[p.unit] || p.unit : p.unit) || "";
const byName = (a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// ───────────────────────── État ─────────────────────────
const app = document.getElementById("app");
let store = null;
let user;              // undefined = en attente, null = déconnecté
let products = [];
let shopping = [];
let unsubShop = null;
let loaded = false;
let dataError = "";
let unsub = null;
let ops = [];
let meta = {};
let recipes = [];
let unsubExtra = [];
let online = navigator.onLine;
let lastSync = null;
const ui = {
  cook: [],
  cookConfirm: false,
  cookError: "",
  cookSearch: "",
  addSearch: "",
  stockView: "lieu",
  recFilters: { portions: 2, theme: "", maxTime: "", difficulty: "", dishType: "", mustUse: [], exclude: [], extraBuys: "1 à 2 ingrédients", antigaspi: true, days: 5, meal: "dîner" },
  recMode: "week",
  recPaste: "",
  recParsed: null,
  recPortions: {},
  shopTab: "todo",
  storeSel: null,
  lotSheet: null,
  locEdit: null,
  filter: "tout",
  swiped: null,
  toast: null,
  search: "",
  alertTab: "dates",
  shopNew: "",
  kitCat: "chat",
  kitSel: null,
  form: null,
  formKey: "",
  formError: "",
  deleteArmed: false,
  loginError: "",
  busy: false,
};
let toastTimer = null;
const me = () => displayName(user?.email);
const find = (id) => products.find((p) => p.id === id);
const locations = () => [...((meta.locations && meta.locations.list) || E.DEFAULT_LOCATIONS)].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
const locName = (id) => (locations().find((l) => l.id === id) || { name: id }).name;
const prefs = () => meta.prefs || { allergies: [], dislikes: [], equipment: [] };
function canWrite() {
  if (online || isDemo) return true;
  showToast("Hors ligne : action impossible pour le moment");
  render();
  return false;
}
// Exécute une opération de stock (une seule transaction, idempotente) et propose l'annulation.
async function op(type, label, lines, { silent = false, undo = true } = {}) {
  if (!canWrite()) return null;
  const id = newOpId();
  try {
    await store.runOp({ id, type, label, by: me(), lines });
    if (!silent) showToast(label, undo ? () => undoOp(id) : null);
    render();
    return id;
  } catch (e) {
    console.error(e);
    showToast(e?.message || "Opération impossible");
    render();
    return null;
  }
}
async function undoOp(id) {
  if (!canWrite()) return;
  try {
    await store.runOp({ id: newOpId(), type: "compensate", label: "Annulation", by: me(), compensates: id });
    showToast("Annulé");
  } catch (e) { showToast(e?.message || "Annulation impossible"); }
  render();
}

// ───────────────────────── Navigation ─────────────────────────
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  return { name: parts[0] || "accueil", arg: parts[1] ? decodeURIComponent(parts[1]) : "", params: new URLSearchParams(query) };
}
const go = (hash) => { location.hash = hash; };

// ───────────────────────── Actions ─────────────────────────
function showToast(text, undo) {
  clearTimeout(toastTimer);
  ui.toast = { text, undo };
  toastTimer = setTimeout(() => { ui.toast = null; render(); }, 5000);
}
async function change(id, delta) {
  const p = find(id);
  if (!p) return;
  ui.swiped = null;
  if (E.isStatusMode(p)) {
    const order = ["dispo", "bientot", "epuise"];
    const cur = order.indexOf(E.statusOf(p));
    const next = order[Math.max(0, Math.min(2, cur + (delta > 0 ? -2 : 1)))];
    if (next === E.statusOf(p)) return;
    await op("status", `${p.name} · ${STATUS_LABEL[next]}`, [{ kind: "status", productId: id, status: next }]);
    return;
  }
  const d = Math.max(-qty(p), delta);
  if (!d) return;
  await op(d > 0 ? "add" : "remove", `${p.name} ${d > 0 ? "+" : "−"}${fmtQ(Math.abs(d))}`,
    [d > 0 ? { kind: "add", productId: id, amount: d, loc: (E.lotsOf(p)[0] || {}).loc || E.defaultLocFor(p.categoryId) } : { kind: "remove", productId: id, amount: -d }]);
}

function openForm(r) {
  const key = `${r.name}/${r.arg}/${r.params.toString()}`;
  if (ui.formKey === key && ui.form) return;
  ui.formKey = key;
  ui.formError = "";
  ui.deleteArmed = false;
  ui.lotSheet = null;
  if (r.name === "produit") {
    const p = find(r.arg);
    if (!p) { ui.form = null; return; }
    ui.form = { id: p.id, name: p.name || "", detail: p.detail || "", categoryId: p.categoryId || "alim", unit: p.unit || "pièce",
      minQuantity: parseQ(p.minQuantity), lowAlert: p.lowAlert !== false, trackingMode: p.trackingMode || "quantity", packSize: p.packSize || "" };
    if (r.params.get("lot") === "1") ui.lotSheet = { kind: "add", toLoc: p.homeLoc || (E.fefo(E.lotsOf(p))[0] || {}).loc || E.defaultLocFor(p.categoryId), qty: parseQ(p.packSize) || 1, expiryType: "DLC", dateText: "", expiry: "" };
  } else {
    const cat = CAT[r.params.get("cat")] ? r.params.get("cat") : "alim";
    const loc = r.params.get("loc") || E.defaultLocFor(cat);
    ui.form = { name: r.params.get("name") || "", detail: "", categoryId: cat, quantity: 1, unit: cat === "chat" ? "boîte" : "pièce", expiry: "", expiryType: "DLC",
      minQuantity: 1, lowAlert: true, trackingMode: "quantity", loc, packSize: "" };
  }
}

async function saveForm() {
  const f = ui.form;
  if (!f || !canWrite()) return;
  const name = f.name.trim();
  if (!name) { ui.formError = "Donnez un nom au produit."; render(); return; }
  const metaFields = {
    name, detail: f.detail.trim(), categoryId: f.categoryId, unit: f.unit,
    minQuantity: parseQ(f.minQuantity), lowAlert: !!f.lowAlert, trackingMode: f.trackingMode,
    packSize: parseQ(f.packSize) || null,
    ...(f.id ? {} : { homeLoc: f.loc }),
  };
  ui.busy = true; render();
  try {
    if (f.id) {
      await store.updateProduct(f.id, { ...metaFields, updatedBy: me() });
      showToast(`${name} enregistré`);
      ui.form = null; ui.formKey = "";
      history.back();
    } else {
      // Doublons évités par identité : même nom dans le même placard.
      const twin = products.find((p) => p.categoryId === f.categoryId && p.name.toLowerCase() === name.toLowerCase());
      const q = parseQ(f.quantity);
      if (twin) {
        if (q) await op("add", `${name} +${fmtQ(q)} (déjà en stock)`, [{ kind: "add", productId: twin.id, amount: q, loc: f.loc, expiry: f.expiry || null, expiryType: f.expiryType }]);
      } else {
        await store.addProduct({ ...metaFields, quantity: f.trackingMode === "status" ? 0 : q, loc: f.loc, expiry: f.expiry || null, expiryType: f.expiryType, status: f.trackingMode === "status" ? "dispo" : undefined, updatedBy: me() });
        showToast(`${name} ajouté`);
      }
      ui.form = null; ui.formKey = "";
      go(`#/lieu/${f.loc}`);
    }
  } catch (e) {
    console.error(e);
    ui.formError = e?.message || "Enregistrement impossible. Réessayez.";
  } finally {
    ui.busy = false;
    render();
  }
}

async function deleteProduct() {
  const f = ui.form;
  if (!f?.id) return;
  if (!ui.deleteArmed) { ui.deleteArmed = true; render(); return; }
  store.deleteProduct(f.id);
  showToast(`${f.name} supprimé`);
  ui.form = null;
  ui.formKey = "";
  go(`#/placard/${f.categoryId}`);
}

// ───────────────────────── Kits de démarrage ─────────────────────────
const KITS = {
  alim: [
    ["Pâtes", "pièce", 2, 1], ["Riz", "pièce", 1, 1], ["Tomates en conserve", "boîte", 3, 1], ["Huile d’olive", "flacon", 1, 0],
    ["Café", "pièce", 1, 0], ["Lait", "L", 4, 2], ["Œufs", "pièce", 6, 2], ["Farine", "g", 1000, 250], ["Sucre", "g", 1000, 250], ["Sel", "pièce", 1, 0],
  ],
  pharma: [
    ["Paracétamol", "boîte", 1, 0], ["Ibuprofène", "boîte", 1, 0], ["Pansements", "boîte", 1, 0], ["Désinfectant", "flacon", 1, 0],
    ["Sérum physiologique", "boîte", 1, 0], ["Thermomètre", "pièce", 1, -1],
  ],
  hyg: [
    ["Gel douche", "flacon", 2, 1], ["Shampooing", "flacon", 1, 0], ["Dentifrice", "tube", 2, 1], ["Brosses à dents", "pièce", 2, 0],
    ["Papier toilette", "pièce", 12, 4], ["Déodorant", "pièce", 1, 0], ["Coton", "sachet", 1, 0],
  ],
  chat: [
    ["Pâtée", "boîte", 12, 6], ["Croquettes", "sac", 1, 0], ["Litière", "sac", 2, 1], ["Friandises", "sachet", 2, 0],
    ["Antiparasitaire", "boîte", 1, 0], ["Sacs à litière", "pièce", 1, 0],
  ],
};

// ───────────────────────── Liste de courses ─────────────────────────
function shoppingItems() {
  const byId = Object.fromEntries(shopping.map((d) => [d.id, d]));
  const items = [];
  const src = (d) => (d?.sources?.length ? `Pour : ${d.sources.join(", ")}` : "");
  for (const p of products) {
    const doc = byId[`p_${p.id}`];
    const st = doc?.state || (doc?.checked ? "bought" : "todo");
    const low = isLow(p);
    if (st === "stored" || st === "cancelled") {
      // Rangé ou annulé : réapparaît seulement si le produit redevient bas après coup.
      if (!low || (doc.doneQty != null ? qty(p) >= doc.doneQty : true)) continue;
    }
    const active = doc && (st === "todo" || st === "bought") && (doc.forced || low);
    if (!low && !active) continue;
    const suggest = Math.max(1, Math.round((parseQ(p.minQuantity) - qty(p) + 1) * 1000) / 1000);
    const stale = st === "stored" || st === "cancelled";
    items.push({
      id: `p_${p.id}`, product: p, label: p.name, categoryId: p.categoryId, unit: p.unit || "",
      qty: !stale && doc?.qty != null ? doc.qty : (parseQ(p.packSize) || suggest), state: stale ? "todo" : st, checked: !stale && st === "bought",
      why: [low ? (qty(p) === 0 ? "Épuisé" : `Il en reste ${fmtQ(qty(p))} · seuil ${fmtQ(parseQ(p.minQuantity))}`) : "", stale ? "" : src(doc)].filter(Boolean).join(" · ") || "Ajouté depuis le scan",
    });
  }
  for (const d of shopping) {
    if (d.productId) continue;
    const st = d.state || (d.checked ? "bought" : "todo");
    if (st === "stored" || st === "cancelled") continue;
    items.push({ id: d.id, product: null, label: d.label || "Article", categoryId: "manual", unit: d.unit || "", qty: d.qty || 1, state: st, checked: st === "bought", why: src(d) || "Ajouté à la main" });
  }
  return items;
}
async function storeChecked() {
  const done = shoppingItems().filter((it) => it.checked);
  for (const it of done) {
    if (it.product) store.changeQty(it.product.id, parseQ(it.qty) || 1, me());
    store.deleteShopping(it.id);
  }
  showToast(`${done.length} article${done.length > 1 ? "s" : ""} rangé${done.length > 1 ? "s" : ""} dans les placards`);
  render();
}
async function shareList() {
  const items = shoppingItems().filter((it) => !it.checked);
  const text = "Courses " + household.name + " :\n" + items.map((it) => `- ${it.label}${it.product ? ` ×${fmtQ(it.qty)}` : ""}`).join("\n");
  try {
    if (navigator.share) await navigator.share({ title: "Liste de courses", text });
    else { await navigator.clipboard.writeText(text); showToast("Liste copiée"); render(); }
  } catch {}
}

// ───────────────────────── Vues ─────────────────────────
function nav(current) {
  const link = (hash, key, label, icon) =>
    `<a href="${hash}" ${current === key ? 'aria-current="page"' : ""}>${icon}${label}</a>`;
  const nShop = shoppingItems().filter((it) => it.state === "todo").length;
  return `<nav class="nav" aria-label="Navigation principale">
    ${link("#/", "accueil", "Accueil", I.home(24))}
    ${link("#/placards", "placards", "Stocks", I.cupboard(24))}
    <a href="#/scan" class="scan" aria-label="Scanner un produit" ${current === "scan" ? 'aria-current="page"' : ""}>${I.scan(28)}</a>
    ${link("#/recettes", "recettes", "Recettes", svg('<path d="M6 3v8a3 3 0 0 0 3 3v7M9 3v6M12 3v8a3 3 0 0 1-3 3"/><path d="M17 21V3c-2 1-3 4-3 8h3"/>', 24))}
    <a href="#/courses" ${current === "courses" ? 'aria-current="page"' : ""} style="position:relative">${svg('<path d="M4 5h2l2 11h10l2-8H7"/><circle cx="10" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/>', 24)}Courses${nShop ? `<span class="badge" style="position:absolute;top:2px;right:calc(50% - 22px)">${nShop}</span>` : ""}</a>
  </nav>`;
}

function alertCount() {
  return products.filter((p) => isUrgent(p) || isLow(p)).length;
}

function catGrid() {
  return `<section aria-label="Mes placards" class="grid2">${CATS.map((c) => {
    const inCat = products.filter((p) => p.categoryId === c.id);
    const n = inCat.filter((p) => qty(p) > 0).length;
    const urgent = inCat.filter(isUrgent).length;
    const low = inCat.filter(isLow).length;
    const line = urgent
      ? `<span class="alert">${plural(urgent, "date proche", "dates proches")}</span>`
      : low
        ? `<span class="alert">${plural(low, "stock bas", "stocks bas")}</span>`
        : `<span class="ok">Tout est en ordre</span>`;
    return `<a class="card cat-card" href="#/placard/${c.id}">
      <span class="cat-ico c-${c.id}">${catIcon(c.id)}</span>
      <span><span class="name" style="display:block">${c.name}</span><span class="sub">${plural(n, "article", "articles")}</span></span>
      ${line}
    </a>`;
  }).join("")}</section>`;
}

function productRowCompact(p) {
  return `<div class="list-row">
    <span class="cat-ico sm c-${p.categoryId}">${catIcon(p.categoryId, 20)}</span>
    <a class="grow" href="#/produit/${p.id}" style="text-decoration:none;color:inherit">
      <span class="t">${esc(p.name)}</span>
      <span class="s">${CAT[p.categoryId]?.name || ""} · ${fmtQ(qty(p))} ${esc(unitLabel(p))}</span>
    </a>
    <button class="round-btn" data-act="inc" data-id="${p.id}" aria-label="Ajouter un ${esc(p.name)}">${I.plus(20)}</button>
  </div>`;
}

function homeBody() {
  const q = ui.search.trim().toLowerCase();
  if (q) {
    const hits = products.filter((p) => `${p.name} ${p.detail || ""}`.toLowerCase().includes(q)).sort(byName);
    return hits.length
      ? `<section class="card list" aria-label="Résultats">${hits.map(productRowCompact).join("")}</section>`
      : `<p class="empty-state">Aucun produit ne correspond. <a href="#/ajout">L’ajouter</a></p>`;
  }
  const urgent = products.filter(isUrgent).sort((a, b) => daysUntil(a.expiry) - daysUntil(b.expiry));
  const low = products.filter(isLow).sort(byName);
  let body = "";
  if (urgent.length) {
    body += `<section class="hero" aria-label="À consommer bientôt">
      <div class="row-between">
        <div><p class="eyebrow">À consommer bientôt</p><div class="title">${plural(urgent.length, "produit", "produits")} cette semaine</div></div>
        <a href="#/alertes">Tout voir</a>
      </div>
      ${urgent.slice(0, 3).map((p) => {
        const d = daysUntil(p.expiry);
        const tag = d < 0 ? "périmé" : d === 0 ? "aujourd’hui" : d === 1 ? "demain" : `dans ${d} j`;
        return `<div class="hero-row"><span>${esc(p.name)}</span><span class="pill ${d <= 3 ? "mint" : "ghost"}">${tag}</span></div>`;
      }).join("")}
    </section>`;
  }
  const nShop = shoppingItems().filter((it) => it.state === "todo").length;
  body += `<a class="card shop-entry" href="#/courses">
    <span class="cat-ico" style="background:var(--blush);color:var(--primary)">${svg('<path d="M4 5h2l2 11h10l2-8H7"/><circle cx="10" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/>', 22, 2)}</span>
    <span class="grow"><span class="t">Liste de courses</span><span class="s">${nShop ? plural(nShop, "article à acheter", "articles à acheter") : "Rien à acheter pour l’instant"}</span></span>
    ${svg('<path d="M9 5l7 7-7 7"/>', 20, 2.2)}
  </a>`;
  body += catGrid();
  if (low.length) {
    body += `<section aria-label="Bientôt épuisé" style="display:flex;flex-direction:column;gap:10px">
      <h2>Bientôt épuisé</h2>
      <div class="card list">${low.slice(0, 6).map(productRowCompact).join("")}</div>
    </section>`;
  }
  if (!products.length && loaded) {
    body += `<section class="card" style="padding:18px;display:flex;flex-direction:column;gap:10px">
      <span class="pill mint" style="align-self:flex-start">Pour bien démarrer</span>
      <span class="t">Remplissez un placard en 1 minute avec un kit prérempli : kit chat, pharmacie de base, salle de bain…</span>
      <a class="cta" href="#/kits" style="height:50px">Choisir un kit</a>
    </section>`;
  }
  return body;
}

function viewHome() {
  const count = alertCount();
  return `<main class="screen">
    ${isDemo ? `<div class="demo-banner">Mode démo : données d’exemple, enregistrées sur cet appareil seulement.</div>` : ""}
    <div class="top">
      <div class="grow"><span class="brand">Plakardo</span><h1>Mes placards</h1><span class="sub">Foyer ${esc(household.name)} · Bonjour ${esc(me())}</span></div>
      <a class="icon-btn" href="#/alertes" aria-label="Alertes${count ? `, ${count}` : ""}">${I.bell(22)}${count ? `<span class="badge">${count}</span>` : ""}</a>
      <a class="icon-btn" href="#/profil" aria-label="Profil">${I.user(22)}</a>
    </div>
    ${offlineBanner()}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <a class="cta" href="#/cuisine" style="height:56px">${svg('<path d="M4 11h16v2a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7z"/><path d="M9 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4"/>', 20, 2)} Je cuisine</a>
      <a class="cta" href="#/ajouter" style="height:56px;background:var(--surface);color:var(--primary);border:1px solid var(--primary)">${I.plus(20)} Ajouter</a>
    </div>
    <label class="search">${I.search(20)}<span class="sr">Rechercher un produit</span>
      <input id="search" type="search" data-search placeholder="Rechercher un produit…" value="${esc(ui.search)}" autocomplete="off">
    </label>
    ${dataError ? `<p class="err">${esc(dataError)}</p>` : ""}
    <div id="home-body" style="display:flex;flex-direction:column;gap:18px">${homeBody()}</div>
  </main>${nav("accueil")}`;
}

function viewPlacards() {
  return `<main class="screen">
    <h1>Placards</h1>
    ${catGrid()}
  </main>${nav("placards")}`;
}

function itemHtml(p) {
  const q = qty(p);
  const d = p.expiry ? daysUntil(p.expiry) : null;
  const dateTag = p.expiry
    ? `<span class="pill ${d <= 7 ? "warn" : "soft"}">${dateLabel(p)}</span>`
    : `<span class="pill soft">Sans date</span>`;
  const lowTag = isLow(p) ? `<span class="pill low">${q === 0 ? "Épuisé" : "Stock bas"}</span>` : q === 0 ? `<span class="pill soft">Épuisé</span>` : "";
  return `<div class="item${ui.swiped === p.id ? " swiped" : ""}${q === 0 ? " empty" : ""}" data-swipe="${p.id}">
    <div class="actions">
      <button class="minus" data-act="dec" data-id="${p.id}">−1</button>
      <button class="all" data-act="all" data-id="${p.id}">Tout<br>retirer</button>
    </div>
    <div class="front">
      <button class="info" data-act="open" data-id="${p.id}" aria-label="Modifier ${esc(p.name)}">
        <span class="t">${esc(p.name)}</span>
        ${p.detail ? `<span class="s">${esc(p.detail)}</span>` : ""}
        <span class="tags">${dateTag}${lowTag}</span>
      </button>
      <div class="stepper">
        <div class="box">
          <button class="dec" data-act="dec" data-id="${p.id}" aria-label="Retirer un ${esc(p.name)}">${I.minus(18)}</button>
          <button class="q" data-act="open" data-id="${p.id}" aria-label="Saisir la quantité de ${esc(p.name)}">${fmtQ(q)}</button>
          <button class="inc" data-act="inc" data-id="${p.id}" aria-label="Ajouter un ${esc(p.name)}">${I.plus(18)}</button>
        </div>
        <span class="u">${esc(unitLabel(p))}</span>
      </div>
    </div>
  </div>`;
}

function viewPlacard(catId) {
  const c = CAT[catId];
  if (!c) return viewPlacards();
  const all = products.filter((p) => p.categoryId === c.id);
  const lows = all.filter(isLow).length;
  let list = all;
  if (ui.filter === "bas") list = all.filter(isLow);
  if (ui.filter === "date") list = all.filter((p) => p.expiry && daysUntil(p.expiry) <= 30);
  list = [...list].sort((a, b) => (qty(b) > 0) - (qty(a) > 0) || byName(a, b));
  const chip = (key, label) => `<button class="chip" data-act="filter" data-v="${key}" aria-pressed="${ui.filter === key}">${label}</button>`;
  return `<main class="screen">
    <div class="top">
      <a class="icon-btn" href="#/" aria-label="Retour à l’accueil">${I.back(22)}</a>
      <span class="cat-ico c-${c.id}">${catIcon(c.id)}</span>
      <div class="grow"><h1 style="font-size:calc(28px * var(--fs))">${c.name}</h1>
        <span class="sub">${plural(all.filter((p) => qty(p) > 0).length, "article", "articles")} · ${lows ? plural(lows, "stock bas", "stocks bas") : "aucun stock bas"}</span></div>
    </div>
    <div class="chips" role="group" aria-label="Filtrer">${chip("tout", "Tout")}${chip("bas", "Stock bas")}${chip("date", "Date proche")}</div>
    <div class="items">${list.length ? list.map(itemHtml).join("") : `<p class="empty-state">${all.length ? "Rien dans ce filtre." : `Ce placard est vide. Touchez Ajouter, ou <a href="#/kits" data-act="kit-cat" data-v="${c.id}">utilisez le kit ${c.name}</a>.`}</p>`}</div>
    ${list.length ? `<p class="hint">Glissez un produit vers la gauche pour le retirer. Touchez son nom pour le modifier.</p>` : ""}
  </main>
  ${ui.toast ? "" : `<a class="fab" href="#/ajout?cat=${c.id}">${I.plus(20)}Ajouter</a>`}
  ${nav("placards")}`;
}

function stepper(field, value, label) {
  return `<div class="qbox">
    <button type="button" class="round-btn" style="background:var(--soft);color:var(--ink)" data-act="fstep" data-field="${field}" data-v="-1" aria-label="${label} moins">${I.minus(18)}</button>
    <label class="sr" for="f-${field}">${label}</label>
    <input id="f-${field}" class="qinput" type="text" inputmode="decimal" autocomplete="off" data-field="${field}" value="${fmtQ(value)}">
    <button type="button" class="round-btn" style="background:var(--primary);color:var(--primary-ink)" data-act="fstep" data-field="${field}" data-v="1" aria-label="${label} plus">${I.plus(18)}</button>
  </div>`;
}

function viewForm(r) {
  openForm(r);
  const f = ui.form;
  if (!f) return `<main class="screen"><div class="top"><a class="icon-btn" href="#/" aria-label="Retour">${I.back(22)}</a><h1>Produit introuvable</h1></div><p class="empty-state">Il a peut-être été supprimé sur l’autre téléphone.</p></main>`;
  const p = f.id ? find(f.id) : null;
  const isFood = f.categoryId === "alim" || f.categoryId === "chat";
  const shortcuts = [["", "Aucune"], [addToToday({ days: 7 }), "+1 sem."], [addToToday({ months: 1 }), "+1 mois"], [addToToday({ years: 1 }), "+1 an"]];
  const unitChips = `<div class="chips" role="group" aria-label="Unité">${UNITS.map((u) => `<button type="button" class="chip sm" data-act="fset" data-field="unit" data-v="${u}" aria-pressed="${f.unit === u}">${u}</button>`).join("")}</div>`;
  const modeSeg = `<div class="seg" role="group" aria-label="Mode de suivi">
      <button type="button" data-act="fset" data-field="trackingMode" data-v="quantity" aria-pressed="${f.trackingMode !== "status"}">Quantité</button>
      <button type="button" data-act="fset" data-field="trackingMode" data-v="status" aria-pressed="${f.trackingMode === "status"}">Statut (dispo / bientôt vide / épuisé)</button></div>`;
  // ---- Lots (fiche existante) ----
  let lotsHtml = "";
  if (p) {
    if (E.isStatusMode(p)) {
      const st = E.statusOf(p);
      lotsHtml = `<section class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
        <span class="t">État actuel</span>
        <div class="chips">${["dispo", "bientot", "epuise"].map((s) => `<button class="chip" data-act="pstatus" data-id="${p.id}" data-v="${s}" aria-pressed="${st === s}">${STATUS_LABEL[s]}</button>`).join("")}</div>
        <span class="s">Aucune quantité chiffrée n’est inventée : les recettes indiquent « quantité à vérifier ».</span></section>`;
    } else {
      const lots = E.fefo(E.lotsOf(p));
      lotsHtml = `<section style="display:flex;flex-direction:column;gap:8px">
        <div class="row-between"><h2 class="eyebrow">Lots · date la plus proche d’abord</h2><span class="sub">Total ${fmtQ(qty(p))} ${esc(p.unit || "")}</span></div>
        ${lots.length ? lots.map((l, idx) => `<div class="card" style="padding:10px 12px;display:flex;flex-direction:column;gap:6px">
          <div class="row-between"><span class="t">${esc(locName(l.loc))}</span>${idx === 0 ? `<span class="pill mint">Utilisé en premier</span>` : ""}</div>
          <div class="row-between"><span class="h" style="font-size:18px">${fmtQ(l.qty)} ${esc(p.unit || "")}</span>
            <span style="display:flex;gap:4px;flex-wrap:wrap">${l.expiry ? `<span class="pill ${E.lotExpired(l) ? "warn" : "soft"}">${l.expiryType === "DDM" ? "DDM" : "DLC"} ${frDate(l.expiry)}</span>` : `<span class="pill soft">Date inconnue</span>`}${l.opened ? `<span class="pill soft">Ouvert</span>` : ""}</span></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="chip sm" data-act="lot-transfer" data-v="${l.id}">Transférer</button>
            <button class="chip sm" data-act="lot-correct" data-v="${l.id}">Corriger</button>
          </div></div>`).join("") : `<p class="empty-state">Aucun lot : produit épuisé.</p>`}
        <button class="chip" data-act="lot-add">+ Ajouter un lot</button>
      </section>`;
    }
  }
  const sheet = p && ui.lotSheet ? lotSheetHtml(p) : "";
  return `<main class="screen no-nav">
    <div class="top">
      <a class="icon-btn" href="javascript:history.back()" aria-label="Retour">${f.id ? I.back(22) : I.close(20)}</a>
      <h1 style="font-size:calc(26px * var(--fs))">${f.id ? esc(f.name || "Produit") : "Nouveau produit"}</h1>
      ${f.id ? `<a class="icon-btn" href="#/historique?p=${f.id}" aria-label="Historique du produit">${svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', 20)}</a>` : ""}
    </div>
    ${lotsHtml}
    <div class="field"><label for="f-name">Nom du produit</label>
      <input id="f-name" class="input" data-field="name" value="${esc(f.name)}" placeholder="Ex. : riz basmati" autocomplete="off" enterkeyhint="done"></div>
    <div class="field"><label for="f-detail">Précision <span class="sub">(facultatif)</span></label>
      <input id="f-detail" class="input" data-field="detail" value="${esc(f.detail)}" placeholder="Ex. : marque, variété…" autocomplete="off"></div>
    <div class="field"><span class="label" id="lbl-cat">Catégorie</span>
      <div class="cat-pick" role="group" aria-labelledby="lbl-cat">${CATS.map((c) => `<button type="button" data-act="fset" data-field="categoryId" data-v="${c.id}" aria-pressed="${f.categoryId === c.id}">${c.name}</button>`).join("")}</div></div>
    <div class="field"><span class="label">Suivi</span>${modeSeg}</div>
    ${!f.id ? `<div class="field"><span class="label">Lieu</span><div class="chips">${locations().map((l) => `<button type="button" class="chip sm" data-act="fset" data-field="loc" data-v="${l.id}" aria-pressed="${f.loc === l.id}">${esc(l.name)}</button>`).join("")}</div></div>` : ""}
    ${!f.id && f.trackingMode !== "status" ? `<div class="field"><div class="row-between"><span class="label">Quantité</span>${stepper("quantity", f.quantity, "Quantité")}</div>${unitChips}</div>` : `<div class="field"><span class="label">Unité de référence</span>${unitChips}</div>`}
    ${f.trackingMode !== "status" ? `<div class="field"><div class="row-between"><span class="label">Conditionnement habituel <span class="sub">(ex. 500 pour un paquet de 500 g)</span></span>
      <input class="qinput" style="border:1px solid var(--border);width:90px" inputmode="decimal" data-field="packSize" value="${esc(f.packSize ? fmtQ(f.packSize) : "")}" placeholder="—" aria-label="Conditionnement"></div></div>` : ""}
    ${!f.id && f.trackingMode !== "status" ? `<div class="field">
      <div class="row-between"><span class="label">${isFood ? "Date (facultative)" : "Péremption (facultative)"}</span><span id="f-date-res" class="sub" style="font-weight:700;color:var(--mint-ink)">${f.expiry ? frDate(f.expiry) : "Sans date"}</span></div>
      <div class="seg" role="group" aria-label="Type de date" style="grid-auto-columns:1fr">
        <button type="button" data-act="fset" data-field="expiryType" data-v="DLC" aria-pressed="${f.expiryType !== "DDM"}">DLC (à consommer jusqu’au)</button>
        <button type="button" data-act="fset" data-field="expiryType" data-v="DDM" aria-pressed="${f.expiryType === "DDM"}">DDM (de préférence avant)</button></div>
      <div class="chips" role="group" aria-label="Raccourcis de date">${shortcuts.map(([v, l]) => `<button type="button" class="chip sm" data-act="fset" data-field="expiry" data-v="${v}" aria-pressed="${f.expiry === v}">${l}</button>`).join("")}</div>
      <input id="f-date" class="input" type="text" inputmode="numeric" autocomplete="off" data-date placeholder="JJ/MM/AA — ou « Scanner du texte »" value="${esc(f.expiryText ?? (f.expiry ? frDate(f.expiry) : ""))}" aria-label="Saisir ou scanner la date">
    </div>` : ""}
    <div class="card" style="overflow:hidden">
      <button type="button" class="toggle" data-act="falert" aria-pressed="${!!f.lowAlert}">
        <span style="display:flex;flex-direction:column;gap:2px"><span class="t">Alerte de stock bas</span>
          <span class="s">${f.lowAlert ? (f.trackingMode === "status" ? "Alerte dès « bientôt vide »" : "Passe en « Bientôt épuisé » et dans la liste de courses") : "Aucune alerte, même à 0"}</span></span>
        <span class="switch"></span>
      </button>
      ${f.lowAlert && f.trackingMode !== "status" ? `<div class="row-between" style="padding:8px 8px 10px 16px;border-top:1px solid var(--soft)"><span class="t">M’alerter quand il en reste</span>${stepper("minQuantity", f.minQuantity, "Seuil")}</div>` : ""}
    </div>
    ${ui.formError ? `<p class="err" role="alert">${esc(ui.formError)}</p>` : ""}
    ${f.id ? `<button type="button" class="danger-btn${ui.deleteArmed ? " armed" : ""}" data-act="delete">${ui.deleteArmed ? "Touchez encore pour supprimer" : "Supprimer ce produit"}</button>` : ""}
  </main>
  <div class="cta-bar"><button class="cta" data-act="save" ${ui.busy ? "disabled" : ""}>${f.id ? "Enregistrer la fiche" : "Ajouter"}</button></div>
  ${sheet}`;
}

function lotSheetHtml(p) {
  const s = ui.lotSheet;
  const lot = E.lotsOf(p).find((l) => l.id === s.lotId);
  let body = "";
  if (s.kind === "transfer" && lot) {
    body = `<h2>Transférer un lot</h2><p class="s">${esc(p.name)} · ${esc(locName(lot.loc))} · ${fmtQ(lot.qty)} ${esc(p.unit || "")}</p>
      <span class="label">Vers</span><div class="chips">${locations().filter((l) => l.id !== lot.loc).map((l) => `<button class="chip sm" data-act="ls-set" data-field="toLoc" data-v="${l.id}" aria-pressed="${s.toLoc === l.id}">${esc(l.name)}</button>`).join("")}</div>
      <div class="row-between"><span class="label">Quantité (max ${fmtQ(lot.qty)})</span><input id="ls-qty" class="qinput" style="border:1px solid var(--border);width:100px" inputmode="decimal" data-ls="qty" value="${esc(fmtQ(s.qty))}"></div>
      <p class="s" style="color:var(--mint-ink);font-weight:600">Total inchangé : ${fmtQ(qty(p))} ${esc(p.unit || "")}</p>
      <button class="cta" data-act="ls-go">Transférer</button>`;
  } else if (s.kind === "correct" && lot) {
    body = `<h2>Corriger l’inventaire</h2><p class="s">${esc(p.name)} · ${esc(locName(lot.loc))}. Une correction n’est pas une consommation : elle est notée à part dans l’historique.</p>
      <div class="row-between"><span class="label">Quantité réelle</span><input id="ls-qty" class="qinput" style="border:1px solid var(--border);width:100px" inputmode="decimal" data-ls="qty" value="${esc(fmtQ(s.qty))}"></div>
      <button class="cta" data-act="ls-go">Corriger</button>`;
  } else if (s.kind === "add") {
    body = `<h2>Ajouter un lot</h2>
      <span class="label">Lieu</span><div class="chips">${locations().map((l) => `<button class="chip sm" data-act="ls-set" data-field="toLoc" data-v="${l.id}" aria-pressed="${s.toLoc === l.id}">${esc(l.name)}</button>`).join("")}</div>
      <div class="row-between"><span class="label">Quantité (${esc(p.unit || "")})</span><input id="ls-qty" class="qinput" style="border:1px solid var(--border);width:100px" inputmode="decimal" data-ls="qty" value="${esc(fmtQ(s.qty))}"></div>
      <div class="seg" style="grid-auto-columns:1fr"><button data-act="ls-set" data-field="expiryType" data-v="DLC" aria-pressed="${s.expiryType !== "DDM"}">DLC</button><button data-act="ls-set" data-field="expiryType" data-v="DDM" aria-pressed="${s.expiryType === "DDM"}">DDM</button></div>
      <input class="input" inputmode="numeric" data-ls="date" value="${esc(s.dateText || "")}" placeholder="Date facultative : JJ/MM/AA" aria-label="Date">
      <button class="cta" data-act="ls-go">Ajouter le lot</button>`;
  }
  return `<div class="sheet-dim" data-act="ls-close"></div><div class="sheet" role="dialog" aria-modal="true">${body}<button class="link-btn" data-act="ls-close">Fermer</button></div>`;
}

function viewAlertes() {
  const live = products.filter((p) => qty(p) > 0 && p.expiry);
  const groups = [
    { title: "Périmé", rows: live.filter((p) => daysUntil(p.expiry) < 0), act: "all", label: "Jeté" },
    { title: "Dans les 7 jours", rows: live.filter((p) => { const d = daysUntil(p.expiry); return d >= 0 && d <= 7; }), act: "dec", label: "Consommé" },
    { title: "Ce mois-ci", rows: live.filter((p) => { const d = daysUntil(p.expiry); return d > 7 && d <= 30; }), act: "dec", label: "Consommé" },
  ];
  groups.forEach((g) => g.rows.sort((a, b) => daysUntil(a.expiry) - daysUntil(b.expiry)));
  const nDates = groups.reduce((n, g) => n + g.rows.length, 0);
  const lows = products.filter(isLow).sort(byName);
  const row = (p, act, label, warn) => `<div class="list-row">
    <span class="cat-ico sm c-${p.categoryId}">${catIcon(p.categoryId, 20)}</span>
    <a class="grow" href="#/produit/${p.id}" style="text-decoration:none;color:inherit"><span class="t">${esc(p.name)}</span><span class="s${warn ? " warn" : ""}">${act === "inc" ? `${qty(p)} ${esc(unitLabel(p))} · seuil ${Number(p.minQuantity) || 0}` : dateLabel(p)}</span></a>
    <button class="out-btn" data-act="${act}" data-id="${p.id}">${label}</button>
  </div>`;
  let body;
  if (ui.alertTab === "dates") {
    const shown = groups.filter((g) => g.rows.length);
    body = shown.length
      ? shown.map((g) => `<section style="display:flex;flex-direction:column;gap:8px"><h2 class="eyebrow">${g.title} (${g.rows.length})</h2>
          <div class="card list">${g.rows.map((p) => row(p, g.act, g.label, g.title !== "Ce mois-ci")).join("")}</div></section>`).join("")
      : `<p class="empty-state">Aucune date proche. Tout va bien.</p>`;
  } else {
    body = lows.length
      ? `<a class="out-btn" href="#/courses" style="align-self:flex-start;display:inline-flex;align-items:center;text-decoration:none">Voir la liste de courses</a><section style="display:flex;flex-direction:column;gap:8px"><h2 class="eyebrow">Sous le seuil (${lows.length})</h2><div class="card list">${lows.map((p) => row(p, "inc", "+1", qty(p) === 0)).join("")}</div></section>`
      : `<p class="empty-state">Aucun stock bas.</p>`;
  }
  return `<main class="screen">
    <h1>Alertes</h1>
    <div class="seg" role="tablist" aria-label="Type d’alerte">
      <button role="tab" data-act="atab" data-v="dates" aria-selected="${ui.alertTab === "dates"}">Dates (${nDates})</button>
      <button role="tab" data-act="atab" data-v="stock" aria-selected="${ui.alertTab === "stock"}">Stock bas (${lows.length})</button>
    </div>
    ${body}
  </main>${nav("alertes")}`;
}

function viewProfil() {
  const theme = localStorage.getItem("plakardo-theme") || "auto";
  const big = localStorage.getItem("plakardo-big") === "1";
  const names = household.memberNames || Object.values(household.members);
  const online = navigator.onLine;
  return `<main class="screen no-nav">
    <div class="top"><a class="icon-btn" href="#/" aria-label="Retour">${I.back(22)}</a><h1 class="grow">Profil</h1></div>
    <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <div class="row-between"><span class="t">Foyer ${esc(household.name)}</span>
        <span class="s" style="font-weight:600;color:${online ? "var(--mint-ink)" : "var(--warn)"}">${isDemo ? "Démo" : online ? "Synchronisé" : "Hors ligne"}</span></div>
      <div class="avatars">${names.map((n) => `<span class="avatar"><span>${esc(n.slice(0, 1))}</span>${esc(n)}</span>`).join("")}</div>
      <span class="s">Connectée en tant que ${esc(me())}${online || isDemo ? "" : " · hors ligne, consultation seule"}.</span>
    </section>
    <section style="display:flex;flex-direction:column;gap:8px">
      <h2 class="eyebrow">Confort</h2>
      <div class="card" style="overflow:hidden">
        <div class="row-between" style="padding:8px 8px 8px 16px;border-bottom:1px solid var(--soft)">
          <span class="t">Apparence</span>
          <div class="seg" role="group" aria-label="Apparence" style="width:220px">
            ${[["auto", "Auto"], ["light", "Clair"], ["dark", "Sombre"]].map(([v, l]) => `<button data-act="theme" data-v="${v}" aria-pressed="${theme === v}" style="height:38px">${l}</button>`).join("")}
          </div>
        </div>
        <button class="toggle" data-act="big" aria-pressed="${big}"><span style="display:flex;flex-direction:column;gap:2px"><span class="t">Texte agrandi</span><span class="s">Pour lire plus facilement</span></span><span class="switch"></span></button>
      </div>
    </section>
    ${prefsSection()}
    <a class="card shop-entry" href="#/kits"><span class="grow"><span class="t">Kits de démarrage</span><span class="s">Ajouter d’un coup les produits courants d’un placard</span></span>${svg('<path d="M9 5l7 7-7 7"/>', 20, 2.2)}</a>
    <section class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:center">
      <span style="color:var(--primary)">${I.share(22)}</span>
      <span style="display:flex;flex-direction:column;gap:2px"><span class="t">Installer sur un autre iPhone</span><span class="s">Ouvrir le lien dans Safari › Partager › Sur l’écran d’accueil</span></span>
    </section>
    ${isDemo
      ? `<button class="danger-btn" data-act="reset-demo">Remettre les données d’exemple</button>`
      : `<button class="danger-btn" data-act="logout">Se déconnecter</button>`}
  </main>`;
}

function viewKits() {
  const cat = ui.kitCat;
  const kit = KITS[cat] || [];
  if (!ui.kitSel || ui.kitSel.cat !== cat) {
    ui.kitSel = { cat, items: kit.map(([name, unit, q, min]) => ({ name, unit, q, min, on: !products.some((p) => p.categoryId === cat && p.name.toLowerCase() === name.toLowerCase()) })) };
  }
  const sel = ui.kitSel.items;
  const n = sel.filter((x) => x.on).length;
  return `<main class="screen">
    <div class="top">
      <a class="icon-btn" href="#/" aria-label="Retour">${I.back(22)}</a>
      <div class="grow"><h1 style="font-size:calc(26px * var(--fs))">Kits de démarrage</h1><span class="sub">Cochez ce que vous avez, ajustez les quantités</span></div>
    </div>
    <div class="chips" role="group" aria-label="Placard">${CATS.map((c) => `<button class="chip" data-act="kit-cat" data-v="${c.id}" aria-pressed="${cat === c.id}">${c.name}</button>`).join("")}</div>
    <div class="card">${sel.map((x, i) => {
      const exists = products.some((p) => p.categoryId === cat && p.name.toLowerCase() === x.name.toLowerCase());
      return `<div class="kit-row">
        <button type="button" class="check${x.on ? " on" : ""}" style="background-clip:padding-box" data-act="kit-toggle" data-i="${i}" aria-pressed="${x.on}" aria-label="${esc(x.name)}">${x.on ? svg('<path d="M5 12.5l4.5 4.5L19 7"/>', 16, 3) : ""}</button>
        <span class="grow"><span class="t" style="display:block">${esc(x.name)}</span><span class="s">${exists ? "Déjà dans le placard" : x.min < 0 ? "Sans alerte" : x.min ? `Alerte sous ${fmtQ(x.min)}` : "Alerte à 0"}</span></span>
        <input class="qinput sm" type="text" inputmode="decimal" data-kitq data-i="${i}" value="${fmtQ(x.q)}" aria-label="Quantité de ${esc(x.name)}">
        <span class="s" style="min-width:42px">${esc(x.q > 1 ? PLURAL[x.unit] || x.unit : x.unit)}</span>
      </div>`;
    }).join("")}</div>
    <p class="hint">Vous pourrez tout modifier ensuite produit par produit.</p>
  </main>
  <div class="cta-bar"><button class="cta" data-act="kit-add" ${n ? "" : "disabled"}>Ajouter ${n} produit${n > 1 ? "s" : ""} au placard ${CAT[cat].name}</button></div>`;
}

async function addKit() {
  const cat = ui.kitCat;
  const chosen = (ui.kitSel?.items || []).filter((x) => x.on);
  for (const x of chosen) {
    const twin = products.find((p) => p.categoryId === cat && p.name.toLowerCase() === x.name.toLowerCase());
    if (twin) { const d = parseQ(x.q); if (d) store.changeQty(twin.id, d, me()); continue; }
    await store.addProduct({ name: x.name, detail: "", categoryId: cat, unit: x.unit, quantity: parseQ(x.q), expiry: null, minQuantity: Math.max(0, x.min), lowAlert: x.min >= 0, updatedBy: me() });
  }
  showToast(`${chosen.length} produit${chosen.length > 1 ? "s" : ""} ajouté${chosen.length > 1 ? "s" : ""}`);
  ui.kitSel = null;
  go(`#/placard/${cat}`);
}

function viewLogin() {
  return `<main class="login">
    <img src="icons/icon-192.png" alt="" width="96" height="96">
    <h1 class="h">Plakardo</h1>
    <p class="sub" style="text-align:center;margin:-12px 0 0">Foyer ${esc(household.name)}</p>
    <form id="login" class="card" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="field"><label for="l-email">E-mail</label><input id="l-email" class="input" type="email" name="email" autocomplete="username" required></div>
      <div class="field"><label for="l-pass">Mot de passe</label><input id="l-pass" class="input" type="password" name="password" autocomplete="current-password" required></div>
      ${ui.loginError ? `<p class="err" role="alert">${esc(ui.loginError)}</p>` : ""}
      <button class="cta" type="submit" ${ui.busy ? "disabled" : ""}>Se connecter</button>
    </form>
  </main>`;
}

function toastHtml() {
  if (!ui.toast) return "";
  return `<div class="toast${ui.toast.undo ? "" : " plain"}" role="status"><span>${esc(ui.toast.text)}</span>${ui.toast.undo ? `<button data-act="undo">Annuler</button>` : ""}</div>`;
}

// ───────────────────────── V2.2 — Lot 1 : lieux, ajout, Je cuisine, historique ─────────────────────────
const LOC_ICON = {
  stock: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 3v18M9.5 11v2M14.5 11v2"/>',
  fridge: '<rect x="6" y="2.5" width="12" height="19" rx="2"/><path d="M6 10h12M9 6v2M9 13v3"/>',
  snow: '<path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
};
const locIcon = (l, size = 22) => svg(LOC_ICON[l.icon] || LOC_ICON.box, size);
function inLoc(p, locId) {
  return E.isStatusMode(p) ? E.guessLoc(p) === locId : E.lotsOf(p).some((l) => l.loc === locId);
}
function offlineBanner() {
  if (online || isDemo) return "";
  const t = lastSync ? new Date(lastSync).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "inconnue";
  return `<div class="offline">${svg('<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><path d="M3 3l18 18"/>', 18, 2)}
    <span>Hors ligne — données potentiellement anciennes · synchro ${t}. Consultation seule.</span></div>`;
}

function viewStocks() {
  const seg = `<div class="seg" role="group" aria-label="Affichage"><button data-act="stockview" data-v="lieu" aria-pressed="${ui.stockView === "lieu"}">Par lieu</button><button data-act="stockview" data-v="cat" aria-pressed="${ui.stockView === "cat"}">Par catégorie</button></div>`;
  let body;
  if (ui.stockView === "cat") body = catGrid();
  else {
    body = locations().map((l) => {
      const list = products.filter((p) => inLoc(p, l.id));
      const n = list.filter((p) => E.isAvailable(p)).length;
      const urgent = list.filter((p) => E.lotsOf(p).some((x) => x.loc === l.id && x.expiry && daysUntil(x.expiry) <= 3 && !E.lotExpired(x))).length;
      const low = list.filter(isLow).length;
      const tag = urgent ? `<span class="pill warn">${urgent} date${urgent > 1 ? "s" : ""} ≤ 3 j</span>` : low ? `<span class="pill low">${plural(low, "stock bas", "stocks bas")}</span>` : "";
      return `<a class="card shop-entry" href="#/lieu/${l.id}"><span class="cat-ico c-alim" style="background:var(--soft);color:var(--primary)">${locIcon(l)}</span>
        <span class="grow"><span class="t" style="font-family:Nunito,sans-serif;font-weight:900;font-size:17px">${esc(l.name)}</span><span class="s">${plural(n, "produit", "produits")}</span></span>${tag}</a>`;
    }).join("") + `<a class="chip" href="#/lieux" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none">Gérer les lieux</a>`;
  }
  return `<main class="screen">${offlineBanner()}
    <div class="top"><div class="grow"><h1>Stocks</h1><span class="sub">${plural(locations().length, "lieu", "lieux")} · ${plural(products.filter(E.isAvailable).length, "produit", "produits")}</span></div>
      <a class="icon-btn" href="#/ajouter" aria-label="Ajouter">${I.plus(20)}</a></div>
    ${seg}${body}
  </main>${nav("placards")}`;
}

function viewLieu(locId) {
  const l = locations().find((x) => x.id === locId);
  if (!l) return viewStocks();
  let list = products.filter((p) => inLoc(p, locId));
  if (ui.filter === "date") list = list.filter((p) => E.lotsOf(p).some((x) => x.loc === locId && x.expiry && daysUntil(x.expiry) <= 7));
  if (ui.filter === "ouverts") list = list.filter((p) => E.lotsOf(p).some((x) => x.loc === locId && x.opened));
  if (ui.filter === "statut") list = list.filter(E.isStatusMode);
  const near = (p) => E.fefo(E.lotsOf(p).filter((x) => x.loc === locId))[0];
  list.sort((a, b) => ((near(a) || {}).expiry || "9999").localeCompare((near(b) || {}).expiry || "9999") || byName(a, b));
  const chip = (k, t) => `<button class="chip sm" data-act="filter" data-v="${k}" aria-pressed="${ui.filter === k}">${t}</button>`;
  const row = (p) => {
    if (E.isStatusMode(p)) {
      const st = E.statusOf(p);
      return `<div class="list-row"><a class="grow" href="#/produit/${p.id}" style="text-decoration:none;color:inherit"><span class="t">${esc(p.name)}</span><span class="s">Suivi par statut</span></a>
        <div style="display:flex;gap:4px">${["dispo", "bientot", "epuise"].map((s) => `<button class="chip sm" style="padding:0 9px" data-act="pstatus" data-id="${p.id}" data-v="${s}" aria-pressed="${st === s}">${{ dispo: "Dispo", bientot: "Bientôt", epuise: "Épuisé" }[s]}</button>`).join("")}</div></div>`;
    }
    const lots = E.lotsOf(p).filter((x) => x.loc === locId);
    const q = E.qtyIn(p, locId);
    const n0 = near(p);
    const date = n0 && n0.expiry ? `<span class="pill ${daysUntil(n0.expiry) <= 3 ? "warn" : "soft"}">${n0.expiryType === "DDM" ? "DDM" : "DLC"} ${frDate(n0.expiry).slice(0, 5)}</span>` : "";
    return `<div class="list-row"><a class="grow" href="#/produit/${p.id}" style="text-decoration:none;color:inherit"><span class="t">${esc(p.name)}</span>
        <span class="s">${plural(lots.length, "lot", "lots")}${E.lotsOf(p).length > lots.length ? ` · ${fmtQ(qty(p))} ${esc(p.unit)} au total` : ""}</span><span style="display:flex;gap:4px">${date}${isLow(p) ? `<span class="pill low">Stock bas</span>` : ""}</span></a>
      <div class="stepper"><div class="box">
        <button class="dec" data-act="ldec" data-id="${p.id}" data-loc="${locId}" aria-label="Retirer">${I.minus(16)}</button>
        <span class="q" style="font-size:16px;min-width:46px">${fmtQ(q)}</span>
        <button class="inc" data-act="linc" data-id="${p.id}" data-loc="${locId}" aria-label="Ajouter">${I.plus(16)}</button></div><span class="u">${esc(unitLabel(p, q))}</span></div></div>`;
  };
  return `<main class="screen">${offlineBanner()}
    <div class="top"><a class="icon-btn" href="#/placards" aria-label="Retour">${I.back(22)}</a>
      <div class="grow"><h1 style="font-size:26px">${esc(l.name)}</h1><span class="sub">${plural(list.length, "produit", "produits")} · date la plus proche d’abord</span></div></div>
    <div class="chips">${chip("tout", "Tout")}${chip("date", "Date proche")}${chip("ouverts", "Ouverts")}${chip("statut", "Suivi par statut")}</div>
    <div class="card list">${list.length ? list.map(row).join("") : `<p class="empty-state">Rien ici pour l’instant.</p>`}</div>
  </main>${ui.toast ? "" : `<a class="fab" href="#/ajout?loc=${locId}">${I.plus(20)}Ajouter</a>`}${nav("placards")}`;
}

function viewLieux() {
  const locs = locations();
  return `<main class="screen no-nav">${offlineBanner()}
    <div class="top"><a class="icon-btn" href="#/placards" aria-label="Retour">${I.back(22)}</a><div class="grow"><h1 style="font-size:26px">Lieux</h1><span class="sub">Créer, renommer, réordonner</span></div></div>
    <div class="card" style="padding:4px 10px">${locs.map((l, i) => {
      const used = products.some((p) => inLoc(p, l.id) && E.isAvailable(p));
      return `<div class="list-row" style="padding-left:4px"><span style="color:var(--primary)">${locIcon(l)}</span>
        <input class="input sm" style="flex:1" data-locname="${l.id}" value="${esc(l.name)}" aria-label="Nom du lieu">
        <button class="sc-x" data-act="loc-up" data-v="${l.id}" aria-label="Monter" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="sc-x" data-act="loc-del" data-v="${l.id}" aria-label="Supprimer ${esc(l.name)}" title="${used ? "Transférez d’abord son contenu" : "Supprimer"}" ${used ? 'style="opacity:.35"' : ""}>×</button></div>`;
    }).join("")}</div>
    <form id="loc-add" class="search" style="padding-right:6px"><input id="loc-new" placeholder="Nouveau lieu (ex. Garage)" autocomplete="off" aria-label="Nouveau lieu">
      <button class="round-btn" style="background:var(--primary);color:var(--primary-ink)" aria-label="Ajouter">${I.plus(18)}</button></form>
    <p class="hint">Un lieu qui contient des produits ne peut pas être supprimé : transférez d’abord ses lots.</p>
  </main><div class="cta-bar"><button class="cta" data-act="loc-save">Enregistrer les noms</button></div>`;
}

function recentAdds() {
  const seen = new Map();
  for (const o of ops) {
    if (o.type !== "add" && o.type !== "store") continue;
    for (const l of o.lines || []) {
      if (l.delta > 0 && !seen.has(l.productId) && find(l.productId)) seen.set(l.productId, l.delta);
    }
    if (seen.size >= 8) break;
  }
  return [...seen.entries()].map(([id, d]) => ({ p: find(id), d }));
}
function quickAddChips(p) {
  const pack = parseQ(p.packSize);
  const unit = p.unit || "";
  const opts = pack ? [[pack, `+1 conditionnement (${fmtQ(pack)} ${unit})`], [pack * 2, "+2"]] : [[1, `+1 ${unit}`], [2, "+2"]];
  return opts.map(([q, t]) => `<button class="chip sm" style="background:var(--mint-soft);color:var(--mint-ink);border:0;font-weight:700" data-act="qadd" data-id="${p.id}" data-v="${q}">${esc(t)}</button>`).join("")
    + `<a class="chip sm" style="display:inline-flex;align-items:center;text-decoration:none" href="#/produit/${p.id}?lot=1">Autre…</a>`;
}
function viewAjouter() {
  const q = ui.addSearch.trim().toLowerCase();
  const hits = q ? products.filter((p) => `${p.name} ${p.detail || ""}`.toLowerCase().includes(q)).sort(byName).slice(0, 8) : [];
  const rec = recentAdds();
  return `<main class="screen no-nav">${offlineBanner()}
    <div class="top"><a class="icon-btn" href="javascript:history.back()" aria-label="Retour">${I.back(22)}</a><div class="grow"><h1 style="font-size:26px">Ajouter</h1><span class="sub">Recherche, récents ou scan</span></div></div>
    <label class="search">${I.search(18)}<input id="add-search" type="search" data-addsearch placeholder="Rechercher ou créer un produit…" value="${esc(ui.addSearch)}" autocomplete="off" aria-label="Rechercher un produit"></label>
    <div id="add-results" style="display:flex;flex-direction:column;gap:10px">${addResults(hits, q)}</div>
    ${rec.length ? `<section style="display:flex;flex-direction:column;gap:8px"><h2 class="eyebrow">Récents</h2><div class="chips">${rec.map(({ p, d }) => `<button class="chip sm" style="background:var(--mint-soft);color:var(--mint-ink);border:0;font-weight:700" data-act="qadd" data-id="${p.id}" data-v="${d}">${esc(p.name)} +${fmtQ(d)} ${esc(p.unit || "")}</button>`).join("")}</div></section>` : ""}
    <a class="cta" href="#/scan?mode=batch" style="background:var(--ink);color:var(--bg)">Scanner plusieurs produits</a>
    <a class="cta" href="#/ajout" style="background:var(--surface);color:var(--primary);border:1px solid var(--primary)">Nouveau produit (fiche complète)</a>
  </main>`;
}
function addResults(hits, q) {
  if (!q) return "";
  return `<div class="card" style="padding:4px 14px">${hits.map((p) => `<div style="padding:8px 0;border-bottom:1px solid var(--soft);display:flex;flex-direction:column;gap:6px">
      <span><span class="t">${esc(p.name)}</span> <span class="s">· ${E.isStatusMode(p) ? STATUS_LABEL[E.statusOf(p)] : `${fmtQ(qty(p))} ${esc(p.unit || "")}`}</span></span>
      <div class="chips">${E.isStatusMode(p) ? `<button class="chip sm" data-act="pstatus" data-id="${p.id}" data-v="dispo">Marquer disponible</button>` : quickAddChips(p)}</div></div>`).join("")}
    <a href="#/ajout?name=${encodeURIComponent(ui.addSearch.trim())}" class="list-row" style="text-decoration:none;color:inherit;border:0"><span class="round-btn" style="background:var(--soft);color:var(--primary)">${I.plus(18)}</span>
      <span class="grow"><span class="t">Créer « ${esc(ui.addSearch.trim())} »</span><span class="s">Fiche minimale : nom, catégorie, lieu</span></span></a></div>`;
}

// ---- Je cuisine ----
function cookStep(p) { const u = (p.unit || "").toLowerCase(); return u === "g" || u === "ml" ? 50 : u === "kg" || u === "l" ? 0.1 : 1; }
function cookAdd(id, q) {
  const p = find(id);
  if (!p || ui.cook.some((c) => c.productId === id)) return;
  ui.cook.push(E.isStatusMode(p) ? { productId: id, status: "dispo", used: true } : { productId: id, qty: q ?? Math.min(qty(p), cookStep(p) === 50 ? 100 : 1) });
}
function viewCuisine() {
  const q = ui.cookSearch.trim().toLowerCase();
  const hits = q ? products.filter((p) => E.isAvailable(p) && p.name.toLowerCase().includes(q) && !ui.cook.some((c) => c.productId === p.id)).slice(0, 6) : [];
  const preps = recipes.filter((r) => r.kind === "prep");
  const lines = ui.cook.map((c, i) => {
    const p = find(c.productId);
    if (!p) return "";
    if (E.isStatusMode(p)) {
      return `<div class="list-row"><span class="grow"><span class="t">${esc(p.name)}</span><span class="s">Suivi par statut · après utilisation :</span>
        <span class="chips">${["dispo", "bientot", "epuise"].map((s) => `<button class="chip sm" data-act="cook-status" data-i="${i}" data-v="${s}" aria-pressed="${c.status === s}">${STATUS_LABEL[s]}</button>`).join("")}</span></span>
        <button class="sc-x" data-act="cook-del" data-i="${i}" aria-label="Retirer de la préparation">×</button></div>`;
    }
    const lot = E.fefo(E.lotsOf(p))[0];
    const over = parseQ(c.qty) > qty(p);
    return `<div class="list-row"><span class="grow"><span class="t">${esc(p.name)}</span><span class="s${over ? " warn" : ""}">Stock ${fmtQ(qty(p))} ${esc(p.unit || "")}${over ? " · insuffisant" : ""}</span>
        ${lot ? `<span><span class="pill mintsoft" style="background:var(--mint-soft);color:var(--mint-ink)">${esc(locName(lot.loc))}${lot.expiry ? ` · ${lot.expiryType === "DDM" ? "DDM" : "DLC"} ${frDate(lot.expiry).slice(0, 5)}` : ""}${lot.opened ? " · ouvert" : ""}</span></span>` : ""}</span>
      <div class="qbox" style="padding:2px"><button class="round-btn" style="width:36px;height:36px;background:var(--soft);color:var(--ink)" data-act="cook-step" data-i="${i}" data-v="-1" aria-label="Moins">${I.minus(14)}</button>
        <input class="qinput sm" style="width:56px" inputmode="decimal" data-cookq="${i}" value="${fmtQ(c.qty)}" aria-label="Quantité utilisée de ${esc(p.name)}">
        <button class="round-btn" style="width:36px;height:36px;background:var(--primary);color:var(--primary-ink)" data-act="cook-step" data-i="${i}" data-v="1" aria-label="Plus">${I.plus(14)}</button></div>
      <span class="s" style="min-width:22px">${esc(p.unit || "")}</span>
      <button class="sc-x" data-act="cook-del" data-i="${i}" aria-label="Retirer de la préparation">×</button></div>`;
  }).join("");
  return `<main class="screen no-nav">${offlineBanner()}
    <div class="top"><a class="icon-btn" href="#/" aria-label="Retour">${I.back(22)}</a><div class="grow"><h1 style="font-size:26px">Je cuisine</h1><span class="sub">Rien n’est retiré avant « Terminer la préparation »</span></div></div>
    <label class="search">${I.search(18)}<input id="cook-search" type="search" data-cooksearch placeholder="Ajouter un ingrédient…" value="${esc(ui.cookSearch)}" autocomplete="off" aria-label="Ajouter un ingrédient"></label>
    <div id="cook-hits">${cookHits(hits)}</div>
    ${preps.length ? `<div class="chips"><span class="s" style="align-self:center">Préparations favorites :</span>${preps.map((r) => `<button class="chip sm" data-act="prep-load" data-v="${r.id}">${esc(r.title)}</button>`).join("")}</div>` : ""}
    ${ui.cook.length ? `<div class="card list">${lines}</div>` : `<p class="empty-state">Cherchez les ingrédients utilisés, ou partez d’une recette (onglet Recettes).</p>`}
  </main>
  <div class="cta-bar"><button class="cta" data-act="cook-review" ${ui.cook.length ? "" : "disabled"}>Terminer la préparation${ui.cook.length ? ` · ${plural(ui.cook.length, "ingrédient", "ingrédients")}` : ""}</button></div>
  ${ui.cookConfirm ? cookConfirmHtml() : ""}`;
}
function cookHits(hits) {
  if (!hits.length) return "";
  return `<div class="card" style="padding:2px 12px">${hits.map((p) => `<button class="list-row" style="width:100%;border:0;background:none;text-align:left;border-bottom:1px solid var(--soft)" data-act="cook-add" data-id="${p.id}">
    <span class="grow"><span class="t">${esc(p.name)}</span><span class="s">${E.isStatusMode(p) ? STATUS_LABEL[E.statusOf(p)] : `${fmtQ(qty(p))} ${esc(p.unit || "")}`}</span></span>${I.plus(18)}</button>`).join("")}</div>`;
}
function cookLines() {
  return ui.cook.map((c) => {
    const p = find(c.productId);
    if (!p) return null;
    if (E.isStatusMode(p)) return c.status && c.status !== E.statusOf(p) ? { kind: "status", productId: p.id, status: c.status } : null;
    const q = parseQ(c.qty);
    return q > 0 ? { kind: "remove", productId: p.id, amount: q } : null;
  }).filter(Boolean);
}
function cookConfirmHtml() {
  const rows = ui.cook.map((c) => {
    const p = find(c.productId);
    if (!p) return "";
    if (E.isStatusMode(p)) return `<div class="list-row"><span class="grow t">${esc(p.name)}</span><span class="s">${STATUS_LABEL[E.statusOf(p)]} → <strong>${STATUS_LABEL[c.status]}</strong></span></div>`;
    const after = Math.round((qty(p) - parseQ(c.qty)) * 1000) / 1000;
    return `<div class="list-row"><span class="grow t">${esc(p.name)}</span><span class="s">${fmtQ(qty(p))} → </span><strong class="h" style="font-size:15px;${after < 0 ? "color:var(--warn)" : ""}">${fmtQ(Math.max(after, 0))} ${esc(p.unit || "")}</strong></div>`;
  }).join("");
  return `<div class="sheet-dim" data-act="cook-cancel"></div><div class="sheet" role="dialog" aria-modal="true">
    <h2>Confirmer les quantités utilisées</h2><p class="s">${esc(ui.cookLabel || "Préparation")} · par ${esc(me())} · 1 opération</p>
    <div class="card list" style="padding:0 12px">${rows}</div>
    ${ui.cookError ? `<div class="card" style="padding:12px;border-color:var(--warn)"><span class="err">${esc(ui.cookError)}</span><span class="s">Rien n’a été retiré. Ajustez la quantité ou corrigez l’inventaire.</span></div>` : ""}
    <button class="cta" data-act="cook-go" ${ui.busy ? "disabled" : ""}>Valider · tout ou rien</button>
    <div class="row-between"><button class="link-btn" data-act="cook-cancel">Modifier</button><button class="link-btn" data-act="prep-save">Enregistrer comme préparation favorite</button></div>
  </div>`;
}
async function cookGo() {
  if (!canWrite()) return;
  const lines = cookLines();
  if (!lines.length) { ui.cookError = "Aucune quantité à retirer."; render(); return; }
  ui.busy = true; ui.cookError = ""; render();
  const id = newOpId();
  try {
    await store.runOp({ id, type: "cook", label: `Je cuisine · ${ui.cookLabel || "Préparation"}`, by: me(), lines });
    ui.cook = []; ui.cookConfirm = false; ui.cookLabel = "";
    showToast("Préparation enregistrée, stocks mis à jour", () => undoOp(id));
    go("#/");
  } catch (e) {
    ui.cookError = e?.message || "Validation impossible.";
  } finally { ui.busy = false; render(); }
}

function viewHistorique(r) {
  const pid = r.params.get("p");
  const list = pid ? ops.filter((o) => (o.lines || []).some((l) => l.productId === pid)) : ops;
  const fmtTime = (ms) => new Date(ms).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const val = (v, u) => typeof v === "number" ? `${fmtQ(v)} ${esc(u || "")}` : STATUS_LABEL[v] || v || "—";
  return `<main class="screen no-nav">${offlineBanner()}
    <div class="top"><a class="icon-btn" href="javascript:history.back()" aria-label="Retour">${I.back(22)}</a><div class="grow"><h1 style="font-size:26px">Historique</h1><span class="sub">${pid && find(pid) ? esc(find(pid).name) + " · " : ""}le journal n’est jamais effacé</span></div></div>
    ${list.length ? list.map((o) => `<div class="card" style="padding:10px 14px;display:flex;flex-direction:column;gap:6px">
      <div class="row-between"><span class="s">${fmtTime(o.at)} · ${esc(o.by || "")}</span>${o.type === "compensate" ? `<span class="pill" style="background:var(--cat-chat-bg);color:var(--cat-chat)">Annulation</span>` : o.compensatedBy ? `<span class="pill soft">Annulée</span>` : ""}</div>
      <span class="t">${esc(o.label || o.type)}</span>
      <span class="s">${(o.lines || []).slice(0, 4).map((l) => `${esc(l.name)} ${val(l.before, l.unit)} → ${val(l.after, l.unit)}`).join(" · ")}${(o.lines || []).length > 4 ? ` · +${o.lines.length - 4}` : ""}</span>
      ${o.type !== "compensate" && !o.compensatedBy ? `<div><button class="out-btn" style="height:36px" data-act="op-undo" data-v="${o.id}">Annuler</button></div>` : ""}
    </div>`).join("") : `<p class="empty-state">Aucune opération pour l’instant.</p>`}
  </main>`;
}


// ───────────────────────── V2.2 — Lots 2 et 3 : recettes, menu, besoins, courses, rangement ─────────────────────────
const hashStr = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const VIG_COLORS = [["#F6D7C3", "#C2562F"], ["#DDEBD5", "#4E7A3A"], ["#F3E3B5", "#A9781C"], ["#E5DAF0", "#6B4A8E"], ["#D7E8EE", "#2F6E85"], ["#F5D5DC", "#A53D5A"]];
// Vignette illustrative dessinée par l'app (pas une photo du plat).
function vignette(r, size = 64) {
  if (r.drawing) return `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.drawing)}" width="${size}" height="${size}" alt="" style="border-radius:${size / 4}px;flex:none;background:var(--soft)">`;
  const h = hashStr(r.title || "");
  const [bg, fg] = VIG_COLORS[h % VIG_COLORS.length];
  const t = (r.type || "Plat").toLowerCase();
  const dots = Array.from({ length: 5 }, (_, i) => {
    const a = ((h >> (i * 3)) % 360) * Math.PI / 180, d = 6 + ((h >> (i * 2)) % 7);
    return `<circle cx="${(32 + Math.cos(a) * d).toFixed(1)}" cy="${(34 + Math.sin(a) * d * 0.7).toFixed(1)}" r="${2.5 + (i % 3)}" fill="${fg}" opacity="${0.45 + (i % 3) * 0.2}"/>`;
  }).join("");
  let dish;
  if (t.includes("dessert")) dish = `<path d="M18 40h28l-4 10H22z" fill="#fff"/><path d="M20 40c0-9 5-15 12-15s12 6 12 15z" fill="${fg}" opacity=".75"/><circle cx="32" cy="22" r="3" fill="${fg}"/>`;
  else if (t.includes("petit")) dish = `<rect x="18" y="26" width="28" height="22" rx="5" fill="#fff"/><path d="M46 31h4a4 4 0 0 1 0 8h-4" stroke="#fff" stroke-width="3" fill="none"/><ellipse cx="32" cy="30" rx="11" ry="3" fill="${fg}" opacity=".6"/>`;
  else if (t.includes("entr")) dish = `<path d="M12 34h40a20 14 0 0 1-40 0z" fill="#fff"/>${dots}<path d="M24 28c3-5 8-6 12-2" stroke="${fg}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
  else dish = `<ellipse cx="32" cy="36" rx="22" ry="15" fill="#fff"/><ellipse cx="32" cy="36" rx="15" ry="9.5" fill="${bg}"/>${dots}`;
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 64 64" style="border-radius:${size / 4}px;flex:none"><rect width="64" height="64" fill="${bg}"/>${dish}</svg>`;
}
const isFav = (r) => (r.kind || "recipe") === "recipe";
const recTime = (r) => (r.prepMin || 0) + (r.cookMin || 0);
function loadParsed() {
  if (ui.recParsed) return ui.recParsed;
  try { ui.recParsed = JSON.parse(sessionStorage.getItem("plakardo-rec") || "null"); } catch { ui.recParsed = null; }
  return ui.recParsed;
}
function saveParsed() { try { sessionStorage.setItem("plakardo-rec", JSON.stringify(ui.recParsed)); } catch {} }
const recAlias = {};
function findRecipe(id) {
  if (recAlias[id]) id = recAlias[id];
  return recipes.find((r) => r.id === id) || (loadParsed()?.recipes || []).find((r) => r.id === id);
}
const listTxt = (a) => (a || []).join(", ");
const splitList = (s) => String(s || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
const tagPill = (t) => `<span class="pill" style="${t.kind === "prio" ? "background:var(--mint-soft);color:var(--mint-ink)" : t.kind === "ok" ? "background:var(--mint-soft);color:var(--mint-ink)" : t.kind === "miss" ? "background:var(--blush);color:var(--warn)" : "background:var(--soft);color:var(--muted-2)"}">${esc(t.text)}</span>`;

function recipeCard(r) {
  const sc = E.scoreRecipe(r, products);
  const fav = recipes.some((x) => x.id === r.id && isFav(x));
  return `<a class="card" href="#/recette/${encodeURIComponent(r.id)}" style="padding:12px;display:flex;gap:12px;text-decoration:none;color:inherit;align-items:flex-start">
    ${vignette(r, 64)}
    <span class="grow" style="display:flex;flex-direction:column;gap:4px;min-width:0">
      <span class="t" style="font-family:Nunito,sans-serif;font-weight:900;font-size:16px">${fav ? "★ " : ""}${esc(r.title)}</span>
      <span class="s">${esc([r.type, r.theme, recTime(r) ? `${recTime(r)} min` : "", r.difficulty, `${r.portions} pers.`].filter(Boolean).join(" · "))}</span>
      <span style="display:flex;flex-wrap:wrap;gap:4px">${sc.tags.slice(0, 3).map(tagPill).join("")}</span>
    </span></a>`;
}

function viewRecettes() {
  const f = ui.recFilters;
  const parsed = loadParsed();
  const prio = E.priorityList(products.filter((p) => p.categoryId === "alim")).slice(0, 5);
  const favs = recipes.filter(isFav);
  const chip = (field, v, label) => `<button class="chip sm" data-act="rf" data-field="${field}" data-v="${esc(v)}" aria-pressed="${String(f[field]) === String(v)}">${esc(label)}</button>`;
  const sorted = parsed ? [...parsed.recipes].sort((a, b) => E.scoreRecipe(b, products).score - E.scoreRecipe(a, products).score) : [];
  return `<main class="screen">${offlineBanner()}
    <div class="top"><div class="grow"><h1>Recettes</h1><span class="sub">Claude propose, Plakardo vérifie le stock</span></div>
      <a class="icon-btn" href="#/menu" aria-label="Menu de la semaine">${svg('<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M4 9h16M9 3v3M15 3v3"/>', 20)}</a></div>
    <div class="seg" role="group" aria-label="Mode"><button data-act="recmode" data-v="week" aria-pressed="${ui.recMode === "week"}">Ma semaine</button><button data-act="recmode" data-v="stock" aria-pressed="${ui.recMode === "stock"}">Avec mes stocks</button><button data-act="recmode" data-v="inspiration" aria-pressed="${ui.recMode === "inspiration"}">Inspiration</button></div>
    ${prio.length ? `<section class="card" style="padding:12px 14px;display:flex;flex-direction:column;gap:6px"><span class="eyebrow">À utiliser en priorité</span>
      <span style="display:flex;flex-wrap:wrap;gap:4px">${prio.map((x) => `<span class="pill" style="background:var(--mint-soft);color:var(--mint-ink)">${esc(x.product.name)} · ${frDate(x.lot.expiry).slice(0, 5)}</span>`).join("")}</span></section>` : ""}
    <details class="card" style="padding:12px 14px" ${parsed ? "" : "open"}><summary class="t" style="cursor:pointer">Filtres · ${ui.recMode === "week" ? `${f.days} jours · ${esc(f.meal)} · ` : ""}${f.portions} pers.${f.theme ? " · " + esc(f.theme) : ""}${f.dishType ? " · " + esc(f.dishType) : ""}${f.maxTime ? ` · ≤ ${f.maxTime} min` : ""}</summary>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        <div class="row-between"><span class="label">Portions</span><div class="qbox" style="padding:2px">
          <button class="round-btn" style="width:36px;height:36px;background:var(--soft);color:var(--ink)" data-act="rf-port" data-v="-1" aria-label="Moins">${I.minus(14)}</button>
          <strong class="h" style="min-width:30px;text-align:center">${f.portions}</strong>
          <button class="round-btn" style="width:36px;height:36px;background:var(--primary);color:var(--primary-ink)" data-act="rf-port" data-v="1" aria-label="Plus">${I.plus(14)}</button></div></div>
        ${ui.recMode === "week" ? `<span class="label">Nombre de jours</span><div class="chips">${[3, 4, 5, 6, 7].map((n) => chip("days", n, `${n} jours`)).join("")}</div>
        <span class="label">Repas</span><div class="chips">${["dîner", "déjeuner", "déjeuner et dîner (2 recettes par jour)"].map((m) => chip("meal", m, m.split(" (")[0])).join("")}</div>` : ""}
        <span class="label">Type</span><div class="chips">${chip("dishType", "", "Tous")}${E.DISH_TYPES.map((d) => chip("dishType", d, d)).join("")}</div>
        <span class="label">Thème</span><select class="input" data-rf="theme" aria-label="Thème"><option value="">Libre</option>${E.THEMES.map((t) => `<option ${f.theme === t ? "selected" : ""}>${t}</option>`).join("")}</select>
        <span class="label">Temps total</span><div class="chips">${chip("maxTime", "", "Peu importe")}${[20, 30, 45, 60].map((m) => chip("maxTime", m, `≤ ${m} min`)).join("")}</div>
        <span class="label">Difficulté</span><div class="chips">${chip("difficulty", "", "Peu importe")}${["Facile", "Moyenne", "Avancée"].map((d) => chip("difficulty", d, d)).join("")}</div>
        <span class="label">Achats tolérés</span><div class="chips">${["Aucun", "1 à 2 ingrédients", "Libre"].map((d) => chip("extraBuys", d, d)).join("")}</div>
        <input class="input" data-rf="mustUse" value="${esc(listTxt(f.mustUse))}" placeholder="À utiliser absolument (séparés par des virgules)" aria-label="Ingrédients imposés">
        <input class="input" data-rf="exclude" value="${esc(listTxt(f.exclude))}" placeholder="À exclure (séparés par des virgules)" aria-label="Ingrédients exclus">
        <button class="chip" data-act="rf-gaspi" aria-pressed="${f.antigaspi !== false}">Priorité anti-gaspi ${f.antigaspi !== false ? "activée" : "désactivée"}</button>
        ${prefs().allergies?.length ? `<span class="s">Allergies exclues : ${esc(listTxt(prefs().allergies))} · <a href="#/profil">modifier</a></span>` : `<span class="s">Allergies, refus, équipements : <a href="#/profil">à régler dans Profil</a></span>`}
      </div></details>
    <section class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <span class="eyebrow">1 · Demander à Claude</span>
      <span class="s">${ui.recMode === "week" ? `Plakardo prépare la demande (stock, dates, filtres). Dans Claude : collez, envoyez, puis copiez sa réponse avec le bouton Copier.` : "La demande (stock, dates, filtres) est copiée. Collez-la dans Claude, envoyez, puis copiez sa réponse."}</span>
      <button class="cta" data-act="rec-ask">${ui.recMode === "week" ? "Préparer ma semaine avec Claude" : "Copier la demande et ouvrir Claude"}</button>
      <span class="eyebrow" style="margin-top:4px">2 · Revenir ici</span>
      <button class="cta" style="background:var(--ink);color:var(--bg)" data-act="rec-clip" ${ui.busy ? "disabled" : ""}>Coller la réponse de Claude</button>
      ${ui.recMode === "week" ? `<span class="s">Plakardo range les recettes jour par jour et ajoute ce qui manque à la liste de courses.</span>` : ""}
      <details><summary class="s" style="cursor:pointer;text-decoration:underline">Coller à la main</summary>
        <textarea id="rec-paste" class="input" data-recpaste rows="4" placeholder="Collez ici toute la réponse de Claude" style="min-height:96px;padding:10px;font-family:inherit;margin-top:8px" aria-label="Réponse de Claude">${esc(ui.recPaste)}</textarea>
        <button class="out-btn" style="width:100%;margin-top:8px" data-act="rec-read">Lire la réponse</button></details>
    </section>
    ${parsed ? `<section style="display:flex;flex-direction:column;gap:10px"><div class="row-between"><h2 class="eyebrow">Propositions (${sorted.length})</h2><button class="link-btn" data-act="rec-clear">Effacer</button></div>
      ${parsed.blocage ? `<div class="card" style="padding:12px"><span class="err">Claude n’a rien trouvé : ${esc(parsed.blocage)}</span><span class="s">Assouplissez un filtre puis redemandez.</span></div>` : ""}
      ${(parsed.errors || []).map((e) => `<p class="s warn">${esc(e)}</p>`).join("")}
      ${sorted.map(recipeCard).join("")}
      <p class="s">Classement calculé par Plakardo (dates, disponibilité). Dessins faits par Claude, à titre d’illustration.</p></section>` : ""}
    ${favs.length ? `<section style="display:flex;flex-direction:column;gap:10px"><h2 class="eyebrow">Favoris (${favs.length})</h2>${favs.map(recipeCard).join("")}</section>` : ""}
  </main>${nav("recettes")}`;
}

function viewRecette(id) {
  const r = findRecipe(id);
  if (!r) return `<main class="screen"><div class="top"><a class="icon-btn" href="#/recettes" aria-label="Retour">${I.back(22)}</a><h1 style="font-size:24px">Recette introuvable</h1></div><p class="empty-state">Elle a peut-être été effacée. Redemandez à Claude.</p></main>`;
  const portions = ui.recPortions[r.id] || r.portions;
  const ings = E.scaleRecipe(r, portions);
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const fav = recipes.some((x) => x.id === r.id && isFav(x));
  const inMenu = (meta.menu?.entries || []).some((e) => e.recipeId === r.id);
  const pr = prefs();
  const allergyHit = (r.allergens || []).filter((a) => (pr.allergies || []).some((x) => a.toLowerCase().includes(x.toLowerCase())));
  const ST = { ok: ["var(--mint-ink)", "●"], partial: ["var(--warn)", "◐"], missing: ["var(--warn)", "○"], check: ["var(--muted-2)", "?"] };
  const states = ings.map((g) => E.ingredientState(g, byId));
  const nMiss = states.filter((s) => s.state === "missing" || s.state === "partial").length;
  return `<main class="screen no-nav">${offlineBanner()}
    <div class="top"><a class="icon-btn" href="javascript:history.back()" aria-label="Retour">${I.back(22)}</a><div class="grow"></div>
      <button class="icon-btn" data-act="rec-fav" data-v="${esc(r.id)}" aria-label="${fav ? "Retirer des favoris" : "Ajouter aux favoris"}" aria-pressed="${fav}" style="font-size:20px;color:var(--primary)">${fav ? "★" : "☆"}</button></div>
    <div style="display:flex;gap:14px;align-items:center">${vignette(r, 84)}<div><h1 style="font-size:24px;line-height:1.15">${esc(r.title)}</h1>
      <span class="sub">${esc([r.type, r.theme, r.difficulty].filter(Boolean).join(" · "))}</span></div></div>
    ${r.description ? `<p class="s" style="font-size:15px">${esc(r.description)}</p>` : ""}
    <div class="card" style="padding:10px 14px;display:flex;justify-content:space-around;text-align:center">
      <span><strong class="h">${r.prepMin || 0}</strong><br><span class="s">min prép.</span></span>
      <span><strong class="h">${r.cookMin || 0}</strong><br><span class="s">min cuisson</span></span>
      <span><span class="qbox" style="padding:2px;display:inline-flex"><button class="round-btn" style="width:32px;height:32px;background:var(--soft);color:var(--ink)" data-act="rec-port" data-id="${esc(r.id)}" data-v="-1" aria-label="Moins de portions">${I.minus(12)}</button>
        <strong class="h" style="min-width:26px;display:inline-block">${portions}</strong><button class="round-btn" style="width:32px;height:32px;background:var(--primary);color:var(--primary-ink)" data-act="rec-port" data-id="${esc(r.id)}" data-v="1" aria-label="Plus de portions">${I.plus(12)}</button></span><br><span class="s">portions</span></span></div>
    ${allergyHit.length ? `<div class="card" style="padding:12px;border-color:var(--warn)"><span class="err">Attention allergie : ${esc(allergyHit.join(", "))}</span></div>` : ""}
    <section style="display:flex;flex-direction:column;gap:6px"><h2 class="eyebrow">Ingrédients</h2><div class="card list">${ings.map((g, i) => {
      const s = states[i];
      return `<div class="list-row"><span style="color:${ST[s.state][0]};font-weight:900;width:14px">${ST[s.state][1]}</span>
        <span class="grow"><span class="t">${esc(g.name)}</span><span class="s" style="color:${ST[s.state][0]}">${esc(s.label)}${g.note ? ` · ${esc(g.note)}` : ""}</span></span>
        <strong>${g.qty == null ? "—" : `${fmtQ(g.qty)} ${esc(g.unit)}`}</strong></div>`;
    }).join("")}</div>
    <span class="s">● disponible · ◐ partiel · ○ manquant · ? à vérifier</span></section>
    <section style="display:flex;flex-direction:column;gap:6px"><h2 class="eyebrow">Étapes</h2><ol class="card" style="padding:12px 14px 12px 34px;margin:0;display:flex;flex-direction:column;gap:8px">${r.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></section>
    ${r.substitutions?.length ? `<section class="card" style="padding:12px 14px"><span class="eyebrow">Substitutions</span><ul style="margin:6px 0 0 18px;padding:0">${r.substitutions.map((s) => `<li class="s">${esc(s)}</li>`).join("")}</ul></section>` : ""}
    ${r.allergens?.length ? `<p class="s">Allergènes signalés : ${esc(r.allergens.join(", "))}. Vérifiez toujours les étiquettes.</p>` : ""}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="out-btn" data-act="rec-shop" data-v="${esc(r.id)}" ${nMiss ? "" : "disabled"}>Manquants aux courses${nMiss ? ` (${nMiss})` : ""}</button>
      <button class="out-btn" data-act="rec-menu" data-v="${esc(r.id)}" ${inMenu ? "disabled" : ""}>${inMenu ? "Dans le menu" : "Ajouter au menu"}</button></div>
  </main><div class="cta-bar"><button class="cta" data-act="rec-cook" data-v="${esc(r.id)}">Je cuisine cette recette</button></div>`;
}

async function ensureSaved(r) {
  if (!r.id.startsWith("tmp")) return r.id;
  const old = r.id;
  const id = await store.saveRecipe({ ...r, id: undefined, kind: "recipe", savedBy: me(), savedAt: Date.now() });
  const p = loadParsed();
  if (p) { p.recipes.forEach((x) => { if (x.id === old) x.id = id; }); saveParsed(); }
  if (ui.recPortions[old]) ui.recPortions[id] = ui.recPortions[old];
  recAlias[old] = id;
  if (route().name === "recette" && route().arg === old) location.replace(`#/recette/${encodeURIComponent(id)}`);
  return id;
}
function addNeedsToShopping(needLines, sourceLabel) {
  let n = 0;
  for (const L of needLines) {
    if (L.mode !== "buy" && L.mode !== "suggest") continue;
    const countable = !["g", "kg", "ml", "cl", "l"].includes(String(L.unit || "").toLowerCase());
    const q = L.suggestion ? L.suggestion.qty : countable ? Math.ceil(L.missing || 1) : (L.missing || 1);
    const sources = L.sources || [sourceLabel];
    if (L.product) {
      const cur = shopping.find((d) => d.id === `p_${L.product.id}`);
      store.setShopping(`p_${L.product.id}`, { productId: L.product.id, forced: true, qty: q, unit: L.unit, state: "todo", checked: false, sources: [...new Set([...(cur?.state === "todo" ? cur.sources || [] : []), ...sources])] });
    } else {
      const dup = shopping.find((d) => !d.productId && (d.state || "todo") === "todo" && (d.label || "").toLowerCase() === L.name.toLowerCase());
      if (dup) store.setShopping(dup.id, { sources: [...new Set([...(dup.sources || []), ...sources])] });
      else store.addShopping({ label: L.name, qty: q || 1, unit: L.unit || "", state: "todo", checked: false, sources });
    }
    n += 1;
  }
  return n;
}
function cookFromRecipe(r) {
  const portions = ui.recPortions[r.id] || r.portions;
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  ui.cook = [];
  for (const g of E.scaleRecipe(r, portions)) {
    const p = g.productId && byId[g.productId];
    if (!p || !E.isAvailable(p)) continue;
    if (E.isStatusMode(p)) { ui.cook.push({ productId: p.id, status: E.statusOf(p), used: true }); continue; }
    const q = g.qty == null ? null : E.convert(g.qty, g.unit, p.unit || "pièce");
    ui.cook.push({ productId: p.id, qty: q == null ? 0 : Math.min(E.round3(q), qty(p)) });
  }
  ui.cookLabel = r.title;
  go("#/cuisine");
}

function menuEntries() {
  return (meta.menu?.entries || []).map((e, i) => ({ ...e, i, recipe: recipes.find((r) => r.id === e.recipeId) })).filter((e) => e.recipe);
}
function setMenu(entries) { return store.setMeta("menu", { entries: entries.map(({ recipeId, portions, day }) => ({ recipeId, portions, day: day || "" })) }); }
function viewMenu() {
  const entries = menuEntries();
  const needs = E.computeNeeds(entries.map((e) => ({ recipe: e.recipe, portions: e.portions })), products);
  const buy = needs.filter((L) => L.mode === "buy" || L.mode === "suggest");
  const other = needs.filter((L) => L.mode === "check");
  const okN = needs.filter((L) => L.mode === "ok").length;
  const needRow = (L) => `<div class="list-row"><span class="grow"><span class="t">${esc(L.name)}</span>
      <span class="s">${L.mode === "suggest" ? "Bientôt vide : à prévoir" : L.mode === "check" ? "Quantité à vérifier" : L.product ? `Besoin ${fmtQ(L.need)} · dispo ${fmtQ(L.avail)} ${esc(L.unit)}` : "Absent du stock"} · ${esc(L.sources.join(", "))}</span></span>
      <strong style="color:var(--warn)">${L.missing ? `${fmtQ(L.missing)} ${esc(L.unit)}` : ""}</strong>${L.suggestion ? `<span class="s"> · ${plural(L.suggestion.packs, "paquet", "paquets")}</span>` : ""}</div>`;
  return `<main class="screen no-nav">${offlineBanner()}
    <div class="top"><a class="icon-btn" href="#/recettes" aria-label="Retour">${I.back(22)}</a><div class="grow"><h1 style="font-size:26px">Menu de la semaine</h1><span class="sub">Besoins calculés sans compter deux fois le même stock</span></div></div>
    ${entries.length ? `<div class="card list">${entries.map((e, i) => `<div class="list-row">${vignette(e.recipe, 40)}
      <a class="grow" href="#/recette/${encodeURIComponent(e.recipe.id)}" style="text-decoration:none;color:inherit">${e.day ? `<span class="eyebrow">${esc(e.day)}</span>` : ""}<span class="t">${esc(e.recipe.title)}</span><span class="s">${plural(e.portions, "portion", "portions")}</span></a>
      <button class="sc-x" data-act="menu-port" data-i="${e.i}" data-v="-1" aria-label="Moins">−</button><button class="sc-x" data-act="menu-port" data-i="${e.i}" data-v="1" aria-label="Plus">+</button>
      <button class="sc-x" data-act="menu-del" data-i="${e.i}" aria-label="Retirer du menu">×</button></div>`).join("")}</div>`
      : `<p class="empty-state">Menu vide. Depuis une recette, touchez « Ajouter au menu ».</p>`}
    ${entries.length ? `<section style="display:flex;flex-direction:column;gap:6px"><h2 class="eyebrow">À acheter (${buy.length})</h2>
      ${buy.length ? `<div class="card list">${buy.map(needRow).join("")}</div>` : `<p class="s">Tout est en stock${okN ? ` (${plural(okN, "ingrédient", "ingrédients")})` : ""}.</p>`}
      ${other.length ? `<h2 class="eyebrow">À vérifier (${other.length})</h2><div class="card list">${other.map(needRow).join("")}</div>` : ""}
      <button class="link-btn" data-act="menu-clear">Vider le menu</button></section>` : ""}
  </main>${buy.length ? `<div class="cta-bar"><button class="cta" data-act="menu-shop">Ajouter ${plural(buy.length, "besoin", "besoins")} aux courses</button></div>` : ""}`;
}

// ---- Courses à états + rangement ----
const shopState = (it) => it.state || (it.checked ? "bought" : "todo");
function viewCourses() {
  const items = shoppingItems();
  const todo = items.filter((it) => shopState(it) === "todo");
  const bought = items.filter((it) => shopState(it) === "bought");
  const hist = shopping.filter((d) => d.state === "stored" || d.state === "cancelled").sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 20);
  const tab = ui.shopTab;
  const row = (it) => `<div class="row-btn${shopState(it) === "bought" ? " done" : ""}" style="padding-right:0">
      <button type="button" class="row-btn" style="border:0;padding:0;min-height:56px;flex:1" data-act="shop-toggle" data-id="${it.id}" aria-pressed="${shopState(it) === "bought"}">
        <span class="check${shopState(it) === "bought" ? " on" : ""}">${shopState(it) === "bought" ? svg('<path d="M5 12.5l4.5 4.5L19 7"/>', 16, 3) : ""}</span>
        <span class="grow"><span class="t">${esc(it.label)}</span><span class="s">${esc(it.why)}</span></span>
        <span class="qty-tag">×${fmtQ(it.qty)}${it.unit && !["pièce", ""].includes(it.unit) ? " " + esc(it.unit) : ""}</span>
      </button>
      <button class="sc-x" data-act="shop-cancel" data-id="${it.id}" aria-label="Annuler ${esc(it.label)}">×</button>
    </div>`;
  const groups = (list) => [...CATS.map((c) => ({ title: c.name, id: c.id })), { title: "Autres", id: "manual" }]
    .map((g) => ({ ...g, rows: list.filter((it) => it.categoryId === g.id).sort((a, b) => a.label.localeCompare(b.label, "fr")) }))
    .filter((g) => g.rows.length)
    .map((g) => `<section style="display:flex;flex-direction:column;gap:6px"><h2 class="eyebrow">${g.title}</h2><div class="card list">${g.rows.map(row).join("")}</div></section>`).join("");
  let body;
  if (tab === "todo") body = todo.length ? groups(todo) : `<p class="empty-state">Rien à acheter. Les stocks bas, recettes et menus ajoutent ici leurs manquants.</p>`;
  else if (tab === "bought") body = bought.length ? groups(bought) : `<p class="empty-state">Cochez les articles en magasin : ils arrivent ici, prêts à ranger.</p>`;
  else body = hist.length ? `<div class="card list">${hist.map((d) => `<div class="list-row"><span class="grow"><span class="t">${esc(d.label || (find(d.productId)?.name) || "Article")}</span><span class="s">${d.state === "stored" ? "Rangé" : "Annulé"}${d.doneBy ? " · " + esc(d.doneBy) : ""}</span></span>
      ${d.state === "cancelled" ? `<button class="out-btn" style="height:36px" data-act="shop-restore" data-id="${d.id}">Remettre</button>` : ""}</div>`).join("")}</div>` : `<p class="empty-state">Aucun historique.</p>`;
  const tabBtn = (k, t, n) => `<button data-act="shoptab" data-v="${k}" aria-pressed="${tab === k}">${t}${n ? ` (${n})` : ""}</button>`;
  return `<main class="screen tall">${offlineBanner()}
    <div class="top"><div class="grow"><h1>Courses</h1><span class="sub">Partagée avec le foyer</span></div>
      <button class="icon-btn" data-act="shop-share" aria-label="Partager la liste">${I.share(20)}</button></div>
    <div class="seg" role="group">${tabBtn("todo", "À acheter", todo.length)}${tabBtn("bought", "Acheté", bought.length)}${tabBtn("hist", "Historique", 0)}</div>
    ${tab === "todo" ? `<form id="shop-add" class="search" style="padding-right:6px"><label class="sr" for="shop-new">Ajouter un article</label>
      <input id="shop-new" placeholder="Ajouter un article…" autocomplete="off" value="${esc(ui.shopNew)}" data-shopnew>
      <button class="round-btn" style="background:var(--primary);color:var(--primary-ink)" aria-label="Ajouter">${I.plus(18)}</button></form>` : ""}
    ${body}
  </main>${bought.length ? `<div class="cta-bar over-nav"><button class="cta" data-act="store-open">Ranger ${plural(bought.length, "achat", "achats")}</button></div>` : ""}${nav("courses")}
  ${ui.storeSel ? storeSheetHtml() : ""}`;
}
function openStore() {
  const bought = shoppingItems().filter((it) => shopState(it) === "bought");
  ui.storeSel = bought.map((it) => {
    const p = it.product;
    const loc = p ? (p.homeLoc || (E.fefo(E.lotsOf(p))[0] || {}).loc || E.defaultLocFor(p.categoryId)) : "";
    return { id: it.id, productId: p?.id || null, label: it.label, qty: it.qty, loc, dateText: "", expiry: "", on: true };
  });
  ui.storeError = "";
  render();
}
function storeSheetHtml() {
  return `<div class="sheet-dim" data-act="store-close"></div><div class="sheet" role="dialog" aria-modal="true" style="max-height:85vh;overflow:auto">
    <h2>Ranger les achats</h2><p class="s">Quantité réellement achetée, lieu, date si vous l’avez sous les yeux. Une seule opération.</p>
    ${ui.storeSel.map((s, i) => {
      const p = s.productId && find(s.productId);
      if (!p) return `<div class="card" style="padding:10px 12px"><span class="t">${esc(s.label)}</span><span class="s">Article libre : marqué rangé, sans stock.</span></div>`;
      return `<div class="card" style="padding:10px 12px;display:flex;flex-direction:column;gap:8px">
        <div class="row-between"><span class="t">${esc(p.name)}</span>${E.isStatusMode(p) ? `<span class="s">→ Disponible</span>` : `<span style="display:flex;align-items:center;gap:6px"><input class="qinput sm" style="width:64px;border:1px solid var(--border)" inputmode="decimal" data-storeq="${i}" value="${fmtQ(s.qty)}" aria-label="Quantité achetée"><span class="s">${esc(p.unit || "")}</span></span>`}</div>
        ${E.isStatusMode(p) ? "" : `<div class="chips">${locations().map((l) => `<button class="chip sm" data-act="store-loc" data-i="${i}" data-v="${l.id}" aria-pressed="${s.loc === l.id}">${esc(l.name)}</button>`).join("")}</div>
        <input class="input sm" inputmode="numeric" data-stored="${i}" value="${esc(s.dateText)}" placeholder="Date facultative : JJ/MM/AA" aria-label="Date de ${esc(p.name)}">`}
      </div>`;
    }).join("")}
    ${ui.storeError ? `<p class="err">${esc(ui.storeError)}</p>` : ""}
    <button class="cta" data-act="store-go" ${ui.busy ? "disabled" : ""}>Tout ranger</button>
    <button class="link-btn" data-act="store-close">Fermer</button></div>`;
}
async function storeGo() {
  if (!canWrite()) return;
  const lines = [];
  for (const s of ui.storeSel) {
    const p = s.productId && find(s.productId);
    if (!p) continue;
    if (E.isStatusMode(p)) { if (E.statusOf(p) !== "dispo") lines.push({ kind: "status", productId: p.id, status: "dispo" }); continue; }
    const q = parseQ(s.qty);
    if (q > 0) lines.push({ kind: "add", productId: p.id, amount: q, loc: s.loc || E.defaultLocFor(p.categoryId), ...(s.expiry ? { expiry: s.expiry, expiryType: p.categoryId === "alim" ? "DLC" : "unknown" } : {}) });
  }
  const expected = Object.fromEntries(ui.storeSel.map((s) => { const p = s.productId && find(s.productId); return [s.id, p ? qty(p) + (E.isStatusMode(p) ? 0 : parseQ(s.qty)) : null]; }));
  ui.busy = true; render();
  const id = newOpId();
  try {
    if (lines.length) await store.runOp({ id, type: "store", label: `Rangement des courses · ${plural(lines.length, "article", "articles")}`, by: me(), lines });
    const now = Date.now();
    for (const s of ui.storeSel) store.setShopping(s.id, { state: "stored", checked: false, forced: false, doneAt: now, doneBy: me(), label: s.label, doneQty: expected[s.id], ...(s.productId ? { productId: s.productId } : {}) });
    ui.storeSel = null;
    showToast("Courses rangées", lines.length ? () => undoOp(id) : null);
  } catch (e) { ui.storeError = e?.message || "Rangement impossible."; }
  finally { ui.busy = false; render(); }
}

function prefsSection() {
  const pr = prefs();
  return `<section class="card" style="padding:14px;display:flex;flex-direction:column;gap:8px">
    <span class="eyebrow">Préférences recettes (foyer)</span>
    <input class="input" id="pf-allergies" value="${esc(listTxt(pr.allergies))}" placeholder="Allergies : arachide, lactose…" aria-label="Allergies">
    <input class="input" id="pf-dislikes" value="${esc(listTxt(pr.dislikes))}" placeholder="Refus : coriandre, abats…" aria-label="Aliments refusés">
    <input class="input" id="pf-equipment" value="${esc(listTxt(pr.equipment))}" placeholder="Équipements : four, micro-ondes, airfryer…" aria-label="Équipements">
    <button class="out-btn" data-act="prefs-save">Enregistrer les préférences</button>
  </section>
  <section class="card" style="padding:14px;display:flex;flex-direction:column;gap:8px">
    <span class="eyebrow">Données</span>
    <a class="out-btn" href="#/historique" style="display:flex;align-items:center;justify-content:center;text-decoration:none">Historique des opérations</a>
    <a class="out-btn" href="#/lieux" style="display:flex;align-items:center;justify-content:center;text-decoration:none">Gérer les lieux</a>
    <button class="out-btn" data-act="backup">Télécharger une sauvegarde</button>
  </section>`;
}
async function backup() {
  try {
    const data = await store.exportAll();
    const blob = new Blob([JSON.stringify({ app: "plakardo", version: "2.2", exportedAt: new Date().toISOString(), by: me(), data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `plakardo-sauvegarde-${E.todayIso()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    showToast("Sauvegarde téléchargée");
  } catch (e) { showToast("Sauvegarde impossible"); }
  render();
}

async function lotSheetGo() {
  const s = ui.lotSheet;
  const p = ui.form && find(ui.form.id);
  if (!s || !p) return;
  const q = parseQ(s.qty);
  let r = null;
  if (s.kind === "transfer") {
    const lot = E.lotsOf(p).find((l) => l.id === s.lotId);
    if (!s.toLoc || !lot || !(q > 0) || q > Number(lot.qty)) { showToast("Choisissez un lieu et une quantité valide"); render(); return; }
    r = await op("transfer", `${p.name} : ${fmtQ(q)} ${p.unit || ""} ${locName(lot.loc)} → ${locName(s.toLoc)}`, [{ kind: "transfer", productId: p.id, lotId: lot.id, amount: q, toLoc: s.toLoc }]);
  } else if (s.kind === "correct") {
    r = await op("correct", `Correction d’inventaire · ${p.name}`, [{ kind: "correct", productId: p.id, lotId: s.lotId, qty: q }]);
  } else if (s.kind === "add") {
    if (!(q > 0)) { showToast("Indiquez une quantité"); render(); return; }
    if (s.dateText && !s.expiry) { showToast("Date non reconnue (JJ/MM/AA)"); render(); return; }
    r = await op("add", `${p.name} +${fmtQ(q)} · ${locName(s.toLoc)}`, [{ kind: "add", productId: p.id, amount: q, loc: s.toLoc, ...(s.expiry ? { expiry: s.expiry, expiryType: s.expiryType || "DLC" } : {}) }]);
  }
  if (r) { ui.lotSheet = null; render(); }
}

async function readRecipes() {
  const res = E.parseRecipes(ui.recPaste, products);
  if (!res.recipes.length && !res.blocage) {
    showToast(/recettes/.test(ui.recPaste) ? (res.errors[0] || "Réponse illisible") : "Le presse-papiers ne contient pas la réponse de Claude : copiez-la d’abord");
    if (res.errors.length > 1) ui.recParsed = res;
    render(); return;
  }
  ui.recPaste = "";
  if (ui.recMode === "week" && res.recipes.length) { await applyWeek(res); return; }
  ui.recParsed = res; saveParsed(); render();
}
// Menu de la semaine : recettes enregistrées, menu remplacé, manquants ajoutés aux courses.
async function applyWeek(res) {
  if (!canWrite()) return;
  ui.busy = true; render();
  try {
    const order = E.weekDays(7);
    const port = ui.recFilters.portions || 2;
    const list = [...res.recipes].sort((x, y) => (order.indexOf(x.day) + 9) % 9 - (order.indexOf(y.day) + 9) % 9);
    const keep = new Set(recipes.filter(isFav).map((r) => r.id));
    const old = (meta.menu?.entries || []).map((e2) => e2.recipeId).filter((id) => !keep.has(id));
    const entries = [];
    for (const r of list) {
      const id = await store.saveRecipe({ ...r, id: undefined, kind: "plan", savedBy: me(), savedAt: Date.now() });
      entries.push({ recipeId: id, portions: port, day: r.day || "", recipe: { ...r, id } });
    }
    await setMenu(entries);
    for (const id of old) store.deleteRecipe(id);
    const needs = E.computeNeeds(entries.map((e2) => ({ recipe: e2.recipe, portions: e2.portions })), products);
    const n = addNeedsToShopping(needs, "Menu");
    ui.recParsed = res.errors.length ? { recipes: [], errors: res.errors, blocage: null } : null; saveParsed();
    showToast(`Menu prêt : ${plural(entries.length, "recette", "recettes")}${n ? ` · ${plural(n, "article ajouté", "articles ajoutés")} aux courses` : ""}`);
    go("#/menu");
  } catch (e) { showToast(e?.message || "Impossible d’enregistrer le menu"); }
  finally { ui.busy = false; render(); }
}
// ───────────────────────── Rendu ─────────────────────────
function render() {
  const active = document.activeElement;
  const focusId = active && active.id;
  const caret = active && "selectionStart" in active ? active.selectionStart : null;
  let html;
  if (user === undefined) {
    html = `<div class="splash"><img src="icons/icon-192.png" alt="" width="96" height="96"><p>Ouverture des placards…</p></div>`;
  } else if (!user) {
    html = viewLogin();
  } else {
    const r = route();
    if (r.name !== "ajout" && r.name !== "produit") { ui.form = null; ui.formKey = ""; }
    switch (r.name) {
      case "placards": html = viewStocks(); break;
      case "lieu": html = viewLieu(r.arg); break;
      case "lieux": html = viewLieux(); break;
      case "ajouter": html = viewAjouter(); break;
      case "cuisine": html = viewCuisine(); break;
      case "historique": html = viewHistorique(r); break;
      case "recettes": html = viewRecettes(); break;
      case "recette": html = viewRecette(r.arg); break;
      case "menu": html = viewMenu(); break;
      case "placard": html = viewPlacard(r.arg); break;
      case "ajout":
      case "produit": html = viewForm(r); break;
      case "alertes": html = viewAlertes(); break;
      case "courses": html = viewCourses(); break;
      case "kits": html = viewKits(); break;
      case "profil": html = viewProfil(); break;
      case "scan": html = viewHome(); break;
      default: html = viewHome();
    }
    html += toastHtml();
  }
  const sy = window.scrollY;
  app.innerHTML = html;
  if (window.scrollY !== sy) window.scrollTo(0, sy);
  if (user && route().name === "scan") openScanner(); else closeScanner();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      if (caret !== null && el.setSelectionRange && el.type !== "date" && el.type !== "email") {
        try { el.setSelectionRange(caret, caret); } catch {}
      }
    }
  }
}

// ───────────────────────── Événements ─────────────────────────
app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) {
    if (ui.swiped && !e.target.closest(".item")) { ui.swiped = null; render(); }
    return;
  }
  const { act, id, v, field } = t.dataset;
  switch (act) {
    case "inc": change(id, 1); break;
    case "dec": change(id, -1); break;
    case "all": { const p = find(id); if (p) change(id, -qty(p)); break; }
    case "open":
      if (ui.swiped) { ui.swiped = null; render(); } else { go(`#/produit/${id}`); if (t.classList.contains("q")) setTimeout(() => { const el = document.getElementById("f-quantity"); if (el) { el.focus(); el.select(); } }, 60); }
      break;
    case "filter": ui.filter = v; render(); break;
    case "atab": ui.alertTab = v; render(); break;
    case "undo": { const u = ui.toast?.undo; ui.toast = null; clearTimeout(toastTimer); if (u) u(); render(); break; }
    case "fset": if (ui.form) { ui.form[field] = v; if (field === "expiry") ui.form.expiryText = v ? frDate(v) : ""; ui.deleteArmed = false; render(); } break;
    case "fstep": if (ui.form) {
      const n = Math.max(0, parseQ(ui.form[field]) + Number(v));
      ui.form[field] = n;
      const el = document.getElementById(`f-${field}`);
      if (el) el.value = fmtQ(n); else render();
    } break;
    case "shop-toggle": {
      const it = shoppingItems().find((x) => x.id === id);
      if (it) { const nb = it.state !== "bought"; store.setShopping(id, { ...(it.product ? { productId: it.product.id, forced: true, qty: it.qty } : {}), state: nb ? "bought" : "todo", checked: nb }); }
      break;
    }
    case "shop-del": store.deleteShopping(id); break;
    case "shop-store": storeChecked(); break;
    case "shop-share": shareList(); break;
    case "kit-cat": ui.kitCat = v; ui.kitSel = null; if (route().name === "kits") render(); break;
    case "kit-toggle": { const x = ui.kitSel?.items[Number(t.dataset.i)]; if (x) { x.on = !x.on; render(); } break; }
    case "kit-add": addKit(); break;
    case "falert": if (ui.form) { ui.form.lowAlert = !ui.form.lowAlert; render(); } break;
    case "save": saveForm(); break;
    case "delete": deleteProduct(); break;
    case "theme": localStorage.setItem("plakardo-theme", v); applyPrefs(); render(); break;
    case "big": localStorage.setItem("plakardo-big", localStorage.getItem("plakardo-big") === "1" ? "0" : "1"); applyPrefs(); render(); break;
    case "logout": store.signOut(); break;
    // ---- V2.2 ----
    case "stockview": ui.stockView = v; render(); break;
    case "linc": case "ldec": {
      const p = find(id); if (!p) break;
      const step = parseQ(p.packSize) || (["g", "ml"].includes(p.unit) ? 100 : 1);
      if (act === "linc") op("add", `${p.name} +${fmtQ(step)} · ${locName(t.dataset.loc)}`, [{ kind: "add", productId: id, amount: step, loc: t.dataset.loc }]);
      else { const have = E.qtyIn(p, t.dataset.loc); const r = Math.min(step, have); if (r > 0) op("remove", `${p.name} −${fmtQ(r)} · ${locName(t.dataset.loc)}`, [{ kind: "remove", productId: id, amount: r, loc: t.dataset.loc }]); }
      break;
    }
    case "pstatus": { const p = find(id); if (p && E.statusOf(p) !== v) op("status", `${p.name} · ${STATUS_LABEL[v]}`, [{ kind: "status", productId: id, status: v }]); break; }
    case "qadd": { const p = find(id); if (p) { const loc = p.homeLoc || (E.fefo(E.lotsOf(p))[0] || {}).loc || E.defaultLocFor(p.categoryId); op("add", `${p.name} +${fmtQ(parseQ(v))} · ${locName(loc)}`, [{ kind: "add", productId: id, amount: parseQ(v), loc }]); } break; }
    case "lot-transfer": case "lot-correct": {
      const p = ui.form && find(ui.form.id); const lot = p && E.lotsOf(p).find((l) => l.id === v); if (!lot) break;
      ui.lotSheet = { kind: act === "lot-transfer" ? "transfer" : "correct", lotId: v, qty: lot.qty, toLoc: act === "lot-transfer" ? (locations().find((l) => l.id !== lot.loc) || {}).id : "" };
      render(); break;
    }
    case "lot-add": { const p = ui.form && find(ui.form.id); if (!p) break;
      ui.lotSheet = { kind: "add", toLoc: p.homeLoc || (E.fefo(E.lotsOf(p))[0] || {}).loc || E.defaultLocFor(p.categoryId), qty: parseQ(p.packSize) || 1, expiryType: "DLC", dateText: "", expiry: "" };
      render(); break; }
    case "ls-set": if (ui.lotSheet) { ui.lotSheet[field] = v; render(); } break;
    case "ls-close": ui.lotSheet = null; render(); break;
    case "ls-go": lotSheetGo(); break;
    case "loc-up": { const list = locations().map((l, i) => ({ ...l, order: i })); const i = list.findIndex((l) => l.id === v); if (i > 0) { [list[i - 1].order, list[i].order] = [i, i - 1]; store.setMeta("locations", { list }); } break; }
    case "loc-del": {
      if (products.some((p) => inLoc(p, v) && E.isAvailable(p))) { showToast("Ce lieu contient des produits : transférez-les d’abord"); render(); break; }
      store.setMeta("locations", { list: locations().filter((l) => l.id !== v) }); break;
    }
    case "loc-save": {
      const list = locations().map((l, i) => { const el = app.querySelector(`[data-locname="${l.id}"]`); return { ...l, order: i, name: (el && el.value.trim()) || l.name }; });
      store.setMeta("locations", { list }); showToast("Lieux enregistrés"); go("#/placards"); break;
    }
    case "cook-add": cookAdd(id); ui.cookSearch = ""; render(); break;
    case "cook-del": ui.cook.splice(Number(t.dataset.i), 1); render(); break;
    case "cook-step": { const c = ui.cook[Number(t.dataset.i)]; const p = c && find(c.productId); if (p) { c.qty = Math.max(0, E.round3(parseQ(c.qty) + Number(v) * cookStep(p))); render(); } break; }
    case "cook-status": { const c = ui.cook[Number(t.dataset.i)]; if (c) { c.status = v; render(); } break; }
    case "cook-review": ui.cookConfirm = true; ui.cookError = ""; render(); break;
    case "cook-cancel": ui.cookConfirm = false; render(); break;
    case "cook-go": cookGo(); break;
    case "prep-save": {
      const title = prompt("Nom de la préparation favorite", ui.cookLabel || "Ma préparation");
      if (title) store.saveRecipe({ kind: "prep", title: title.trim(), portions: 1, type: "Plat", steps: [], ingredients: ui.cook.map((c) => { const p = find(c.productId); return { name: p?.name || "", productId: c.productId, qty: c.qty ?? null, unit: p?.unit || "pièce" }; }), savedBy: me(), savedAt: Date.now() }).then(() => { showToast("Préparation favorite enregistrée"); render(); });
      break;
    }
    case "prep-load": { const r = recipes.find((x) => x.id === v); if (r) { ui.cook = []; r.ingredients.forEach((g) => { if (find(g.productId)) cookAdd(g.productId, g.qty ?? undefined); }); ui.cookLabel = r.title; render(); } break; }
    case "op-undo": undoOp(v); break;
    case "recmode": ui.recMode = v; render(); break;
    case "rf": ui.recFilters[field] = (field === "maxTime" || field === "days") && v ? Number(v) : v; render(); break;
    case "rf-port": ui.recFilters.portions = Math.max(1, Math.min(12, ui.recFilters.portions + Number(v))); render(); break;
    case "rf-gaspi": ui.recFilters.antigaspi = ui.recFilters.antigaspi === false; render(); break;
    case "rec-ask": {
      const text = E.buildPrompt({ products, locations: locations(), filters: ui.recFilters, prefs: prefs(), mode: ui.recMode });
      const done = () => { showToast("Demande copiée : collez-la dans Claude"); render(); };
      const fallback = () => { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch {} ta.remove(); };
      (navigator.clipboard ? navigator.clipboard.writeText(text).catch(fallback) : Promise.resolve(fallback())).then(done);
      setTimeout(() => window.open("https://claude.ai/new", "_blank"), 150);
      break;
    }
    case "rec-clip":
      if (!navigator.clipboard?.readText) { showToast("Collage automatique indisponible : utilisez « Coller à la main »"); render(); break; }
      navigator.clipboard.readText().then((txt) => { ui.recPaste = txt || ""; readRecipes(); }).catch(() => { showToast("Autorisez le collage, ou utilisez « Coller à la main »"); render(); });
      break;
    case "rec-read": readRecipes(); break;
    case "rec-clear": ui.recParsed = null; saveParsed(); render(); break;
    case "rec-port": { const r = findRecipe(id); if (r) { ui.recPortions[r.id] = Math.max(1, Math.min(30, (ui.recPortions[r.id] || r.portions) + Number(v))); render(); } break; }
    case "rec-fav": {
      const r = findRecipe(v); if (!r) break;
      const saved = recipes.find((x) => x.id === r.id);
      const inMenu = (meta.menu?.entries || []).some((e2) => e2.recipeId === r.id);
      if (saved && isFav(saved)) {
        if (inMenu) store.saveRecipe({ ...saved, kind: "plan" }); else store.deleteRecipe(r.id);
        showToast("Retirée des favoris");
      } else if (saved) { store.saveRecipe({ ...saved, kind: "recipe" }); showToast("Ajoutée aux favoris"); }
      else ensureSaved(r).then(() => { showToast("Ajoutée aux favoris"); render(); });
      render();
      break;
    }
    case "rec-shop": {
      const r = findRecipe(v); if (!r) break;
      const needs = E.computeNeeds([{ recipe: r, portions: ui.recPortions[r.id] || r.portions }], products);
      const n = addNeedsToShopping(needs, r.title);
      showToast(n ? `${plural(n, "article ajouté", "articles ajoutés")} aux courses` : "Rien à ajouter"); render(); break;
    }
    case "rec-menu": {
      const r = findRecipe(v); if (!r) break;
      ensureSaved(r).then((nid) => { setMenu([...(meta.menu?.entries || []), { recipeId: nid, portions: ui.recPortions[r.id] || r.portions }]); showToast("Ajoutée au menu"); render(); });
      break;
    }
    case "rec-cook": { const r = findRecipe(v); if (r) cookFromRecipe(r); break; }
    case "menu-port": { const list = [...(meta.menu?.entries || [])]; const e2 = list[Number(t.dataset.i)]; if (e2) { e2.portions = Math.max(1, (e2.portions || 2) + Number(v)); setMenu(list); } break; }
    case "menu-del": { const list = [...(meta.menu?.entries || [])]; list.splice(Number(t.dataset.i), 1); setMenu(list); break; }
    case "menu-clear": setMenu([]); break;
    case "menu-shop": {
      const entries = menuEntries();
      const n = addNeedsToShopping(E.computeNeeds(entries.map((e2) => ({ recipe: e2.recipe, portions: e2.portions })), products), "Menu");
      showToast(`${plural(n, "besoin ajouté", "besoins ajoutés")} aux courses`); go("#/courses"); break;
    }
    case "shoptab": ui.shopTab = v; render(); break;
    case "shop-cancel": {
      const it = shoppingItems().find((x) => x.id === id); if (!it) break;
      store.setShopping(id, { state: "cancelled", checked: false, forced: false, doneAt: Date.now(), doneBy: me(), label: it.label, ...(it.product ? { productId: it.product.id, doneQty: qty(it.product) } : {}) });
      showToast("Article annulé"); render(); break;
    }
    case "shop-restore": store.setShopping(id, { state: "todo", forced: true, checked: false }); break;
    case "store-open": openStore(); break;
    case "store-close": ui.storeSel = null; render(); break;
    case "store-loc": { const s = ui.storeSel?.[Number(t.dataset.i)]; if (s) { s.loc = v; render(); } break; }
    case "store-go": storeGo(); break;
    case "prefs-save": {
      const g = (k) => splitList(document.getElementById(`pf-${k}`)?.value);
      store.setMeta("prefs", { allergies: g("allergies"), dislikes: g("dislikes"), equipment: g("equipment") });
      showToast("Préférences enregistrées"); render(); break;
    }
    case "backup": backup(); break;
    case "reset-demo": store.resetDemo && store.resetDemo(); showToast("Données d’exemple remises"); break;
  }
});

app.addEventListener("input", (e) => {
  const t = e.target;
  if (t.matches("[data-search]")) {
    ui.search = t.value;
    const box = document.getElementById("home-body");
    if (box) box.innerHTML = homeBody(); else render();
    return;
  }
  if (t.matches("[data-shopnew]")) { ui.shopNew = t.value; return; }
  if (t.matches("[data-addsearch]")) {
    ui.addSearch = t.value;
    const q = t.value.trim().toLowerCase();
    const box = document.getElementById("add-results");
    if (box) box.innerHTML = addResults(q ? products.filter((p) => `${p.name} ${p.detail || ""}`.toLowerCase().includes(q)).sort(byName).slice(0, 8) : [], q);
    return;
  }
  if (t.matches("[data-cooksearch]")) {
    ui.cookSearch = t.value;
    const q = t.value.trim().toLowerCase();
    const box = document.getElementById("cook-hits");
    if (box) box.innerHTML = cookHits(q ? products.filter((p) => E.isAvailable(p) && p.name.toLowerCase().includes(q) && !ui.cook.some((c) => c.productId === p.id)).slice(0, 6) : []);
    return;
  }
  if (t.matches("[data-cookq]")) { const c = ui.cook[Number(t.dataset.cookq)]; if (c) c.qty = parseQ(t.value); return; }
  if (t.matches("[data-recpaste]")) { ui.recPaste = t.value; return; }
  if (t.matches("[data-rf]")) { const k = t.dataset.rf; ui.recFilters[k] = k === "mustUse" || k === "exclude" ? splitList(t.value) : t.value; return; }
  if (t.matches("[data-storeq]")) { const s = ui.storeSel?.[Number(t.dataset.storeq)]; if (s) s.qty = parseQ(t.value); return; }
  if (t.matches("[data-stored]")) { const s = ui.storeSel?.[Number(t.dataset.stored)]; if (s) { s.dateText = t.value; s.expiry = parseDateText(t.value) || ""; } return; }
  if (t.matches("[data-ls]") && ui.lotSheet) {
    if (t.dataset.ls === "qty") ui.lotSheet.qty = parseQ(t.value);
    else { ui.lotSheet.dateText = t.value; ui.lotSheet.expiry = parseDateText(t.value) || ""; }
    return;
  }
  if (t.matches("[data-kitq]")) { const x = ui.kitSel?.items[Number(t.dataset.i)]; if (x) x.q = parseQ(t.value); return; }
  if (t.matches("[data-date]") && ui.form) {
    ui.form.expiryText = t.value;
    const iso = parseDateText(t.value);
    const res = document.getElementById("f-date-res");
    if (!t.value.trim()) { ui.form.expiry = ""; if (res) { res.textContent = "Sans date"; res.style.color = "var(--mint-ink)"; } }
    else if (iso) { ui.form.expiry = iso; if (res) { res.textContent = frDate(iso); res.style.color = "var(--mint-ink)"; } }
    else if (res) { res.textContent = "Date non reconnue"; res.style.color = "var(--warn)"; }
    return;
  }
  if (t.matches("[data-field]") && ui.form) {
    ui.form[t.dataset.field] = t.value;
    if (t.type === "date") render();
  }
});

app.addEventListener("submit", async (e) => {
  if (e.target.id === "shop-add") {
    e.preventDefault();
    const label = ui.shopNew.trim();
    if (label) { store.addShopping({ label, qty: 1, checked: false, state: "todo", sources: [] }); ui.shopNew = ""; render(); }
    return;
  }
  if (e.target.id === "loc-add") {
    e.preventDefault();
    const name = (document.getElementById("loc-new")?.value || "").trim();
    if (!name) return;
    const list = locations().map((l, i) => ({ ...l, order: i }));
    if (list.some((l) => l.name.toLowerCase() === name.toLowerCase())) { showToast("Ce lieu existe déjà"); render(); return; }
    list.push({ id: "loc" + Date.now().toString(36), name, icon: "box", order: list.length });
    store.setMeta("locations", { list });
    return;
  }
  if (e.target.id !== "login") return;
  e.preventDefault();
  const fd = new FormData(e.target);
  ui.busy = true; ui.loginError = ""; render();
  try {
    await store.signIn(String(fd.get("email")), String(fd.get("password")));
  } catch (err) {
    const code = err?.code || "";
    ui.loginError = code.includes("network") ? "Pas de réseau. Réessayez une fois connecté."
      : code.includes("too-many") ? "Trop d’essais. Patientez quelques minutes."
      : "E-mail ou mot de passe incorrect.";
  } finally { ui.busy = false; render(); }
});

// Glisser vers la gauche pour retirer
let sx = 0, sy = 0, sid = null;
app.addEventListener("touchstart", (e) => {
  const it = e.target.closest("[data-swipe]");
  sid = it ? it.dataset.swipe : null;
  sx = e.touches[0].clientX; sy = e.touches[0].clientY;
}, { passive: true });
app.addEventListener("touchend", (e) => {
  if (!sid) return;
  const dx = e.changedTouches[0].clientX - sx;
  const dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
  if (dx < 0 && ui.swiped !== sid) { ui.swiped = sid; render(); }
  else if (dx > 0 && ui.swiped) { ui.swiped = null; render(); }
  sid = null;
}, { passive: true });

window.addEventListener("hashchange", () => { ui.swiped = null; ui.cookConfirm = false; ui.storeSel = null; ui.filter = ["placard", "lieu"].includes(route().name) ? ui.filter : "tout"; render(); window.scrollTo(0, 0); });
window.addEventListener("online", () => { online = true; lastSync = Date.now(); render(); });
window.addEventListener("offline", () => { online = false; render(); });

function applyPrefs() {
  const theme = localStorage.getItem("plakardo-theme") || "auto";
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.big = localStorage.getItem("plakardo-big") === "1" ? "1" : "0";
}

// ───────────────────────── Démarrage ─────────────────────────
async function start() {
  applyPrefs();
  try {
    store = await createStore();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<main class="login"><h1 class="h">Plakardo</h1><p class="err">Impossible de charger l’app. Vérifiez la connexion puis rouvrez-la.</p></main>`;
    return;
  }
  initScanner({
    store,
    getProducts: () => products,
    me,
    cats: CATS,
    units: UNITS,
    plural: PLURAL,
    catIcon: (id) => catIcon(id),
    onClose: (hash) => go(hash || "#/"),
    onError: (m) => { showToast(m); render(); },
  });
  store.onUser(async (u) => {
    if (u) await resolveName(u.email);
    user = u;
    if (unsub) { unsub(); unsub = null; }
    if (unsubShop) { unsubShop(); unsubShop = null; }
    unsubExtra.forEach((f) => f && f()); unsubExtra = [];
    ops = []; meta = {}; recipes = [];
    shopping = [];
    products = [];
    loaded = false;
    dataError = "";
    if (u) {
      unsubShop = store.subscribeShopping((list) => { shopping = list; render(); });
      unsubExtra = [
        store.subscribeOps((list) => { ops = list; render(); }),
        store.subscribeMeta((m) => { meta = m || {}; render(); }),
        store.subscribeRecipes((list) => { recipes = list; render(); }),
      ];
      unsub = store.subscribe(
        (list) => { products = list; loaded = true; if (navigator.onLine) lastSync = Date.now(); render(); refreshScanner(); },
        (err) => {
          dataError = err?.code === "permission-denied"
            ? "Accès refusé : cette adresse e-mail n’est pas autorisée dans les règles du foyer."
            : "Données indisponibles pour le moment.";
          render();
        }
      );
    }
    render();
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
      reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
    }).catch(() => {});
    // Une nouvelle version vient de prendre la main : on recharge une fois.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
}
start();
