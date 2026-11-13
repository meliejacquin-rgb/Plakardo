// PLAKARDO – application (v1, socle)
import { createStore, isDemo, displayName, resolveName } from "./data.js";
import { household } from "./firebase-config.js";
import { initScanner, openScanner, closeScanner, refreshScanner } from "./scan.js";

// ───────────────────────── Référentiels ─────────────────────────
const CATS = [
  { id: "alim", name: "Alimentaire" },
  { id: "pharma", name: "Pharmacie" },
  { id: "hyg", name: "Hygiène" },
  { id: "chat", name: "Chat" },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
const UNITS = ["pièce", "boîte", "flacon", "sachet", "sac", "tube", "kg", "L"];
const PLURAL = { pièce: "pièces", boîte: "boîtes", flacon: "flacons", sachet: "sachets", sac: "sacs", tube: "tubes", kg: "kg", L: "L" };

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
const qty = (p) => Math.max(0, Number(p.quantity) || 0);
const isLow = (p) => qty(p) <= (Number(p.minQuantity) || 0);
const isUrgent = (p) => qty(p) > 0 && p.expiry && daysUntil(p.expiry) <= 7;
const unitLabel = (p, q = qty(p)) => (q > 1 ? PLURAL[p.unit] || p.unit : p.unit) || "";
const byName = (a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// ───────────────────────── État ─────────────────────────
const app = document.getElementById("app");
let store = null;
let user;              // undefined = en attente, null = déconnecté
let products = [];
let loaded = false;
let dataError = "";
let unsub = null;
const ui = {
  filter: "tout",
  swiped: null,
  toast: null,
  search: "",
  alertTab: "dates",
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
  const d = Math.max(-qty(p), delta);
  if (!d) return;
  ui.swiped = null;
  store.changeQty(id, d, me());
  showToast(`${p.name} ${d > 0 ? "+" : "−"}${Math.abs(d)}`, () => {
    const cur = find(id);
    if (!cur) return;
    const back = Math.max(-qty(cur), -d);
    if (back) store.changeQty(id, back, me());
  });
  render();
}

function openForm(r) {
  const key = `${r.name}/${r.arg}/${r.params.toString()}`;
  if (ui.formKey === key && ui.form) return;
  ui.formKey = key;
  ui.formError = "";
  ui.deleteArmed = false;
  if (r.name === "produit") {
    const p = find(r.arg);
    if (!p) { ui.form = null; return; }
    ui.form = { id: p.id, name: p.name || "", detail: p.detail || "", categoryId: p.categoryId || "alim", quantity: qty(p), unit: p.unit || "pièce", expiry: p.expiry || "", minQuantity: Number(p.minQuantity) || 0 };
  } else {
    const cat = CAT[r.params.get("cat")] ? r.params.get("cat") : "alim";
    ui.form = { name: "", detail: "", categoryId: cat, quantity: 1, unit: cat === "chat" ? "boîte" : "pièce", expiry: "", minQuantity: 1 };
  }
}

async function saveForm() {
  const f = ui.form;
  if (!f) return;
  const name = f.name.trim();
  if (!name) { ui.formError = "Donnez un nom au produit."; render(); return; }
  const data = {
    name,
    detail: f.detail.trim(),
    categoryId: f.categoryId,
    unit: f.unit,
    expiry: f.expiry || null,
    minQuantity: Math.max(0, Number(f.minQuantity) || 0),
  };
  ui.busy = true;
  render();
  try {
    if (f.id) {
      const p = find(f.id);
      const delta = Math.max(0, Number(f.quantity) || 0) - (p ? qty(p) : 0);
      store.updateProduct(f.id, { ...data, updatedBy: me() });
      if (delta) store.changeQty(f.id, delta, me());
      showToast(`${name} enregistré`);
    } else {
      const twin = products.find((p) => p.categoryId === f.categoryId && p.name.toLowerCase() === name.toLowerCase());
      const q = Math.max(0, Number(f.quantity) || 0);
      if (twin) {
        // Déjà dans le placard : on ajoute au stock et on garde la date la plus proche.
        const nearest = [twin.expiry, data.expiry].filter(Boolean).sort()[0] || null;
        if (nearest !== (twin.expiry || null)) store.updateProduct(twin.id, { expiry: nearest });
        if (q) store.changeQty(twin.id, q, me());
        showToast(`${name} +${q} (déjà en stock)`);
      } else {
        await store.addProduct({ ...data, quantity: q, updatedBy: me() });
        showToast(`${name} ajouté`);
      }
    }
    ui.form = null;
    ui.formKey = "";
    go(`#/placard/${data.categoryId}`);
  } catch (e) {
    console.error(e);
    ui.formError = "Enregistrement impossible. Réessayez.";
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

// ───────────────────────── Vues ─────────────────────────
function nav(current) {
  const link = (hash, key, label, icon) =>
    `<a href="${hash}" ${current === key ? 'aria-current="page"' : ""}>${icon}${label}</a>`;
  return `<nav class="nav" aria-label="Navigation principale">
    ${link("#/", "accueil", "Accueil", I.home(24))}
    ${link("#/placards", "placards", "Placards", I.cupboard(24))}
    <a href="#/scan" class="scan" aria-label="Scanner un produit" ${current === "scan" ? 'aria-current="page"' : ""}>${I.scan(28)}</a>
    ${link("#/alertes", "alertes", "Alertes", I.bell(24))}
    ${link("#/profil", "profil", "Profil", I.user(24))}
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
      <span class="s">${CAT[p.categoryId]?.name || ""} · ${qty(p)} ${esc(unitLabel(p))}</span>
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
  body += catGrid();
  if (low.length) {
    body += `<section aria-label="Bientôt épuisé" style="display:flex;flex-direction:column;gap:10px">
      <h2>Bientôt épuisé</h2>
      <div class="card list">${low.slice(0, 6).map(productRowCompact).join("")}</div>
    </section>`;
  }
  if (!products.length && loaded) {
    body += `<p class="empty-state">Vos placards sont vides pour l’instant. Ouvrez un placard ou touchez <strong>Scanner</strong> pour ajouter vos premiers produits.</p>`;
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
  const lowTag = isLow(p) ? `<span class="pill low">${q === 0 ? "Épuisé" : "Stock bas"}</span>` : "";
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
          <span class="q">${q}</span>
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
    <div class="items">${list.length ? list.map(itemHtml).join("") : `<p class="empty-state">${all.length ? "Rien dans ce filtre." : "Ce placard est vide. Touchez Ajouter."}</p>`}</div>
    ${list.length ? `<p class="hint">Glissez un produit vers la gauche pour le retirer. Touchez son nom pour le modifier.</p>` : ""}
  </main>
  ${ui.toast ? "" : `<a class="fab" href="#/ajout?cat=${c.id}">${I.plus(20)}Ajouter</a>`}
  ${nav("placards")}`;
}

function stepper(field, value, label) {
  return `<div class="box" style="display:flex;align-items:center;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:26px;padding:4px">
    <button type="button" class="round-btn" style="background:var(--soft);color:var(--ink)" data-act="fstep" data-field="${field}" data-v="-1" aria-label="${label} moins">${I.minus(18)}</button>
    <span class="h" style="min-width:32px;text-align:center;font-size:22px">${value}</span>
    <button type="button" class="round-btn" style="background:var(--primary);color:var(--primary-ink)" data-act="fstep" data-field="${field}" data-v="1" aria-label="${label} plus">${I.plus(18)}</button>
  </div>`;
}

function viewForm(r) {
  openForm(r);
  const f = ui.form;
  if (!f) return `<main class="screen"><div class="top"><a class="icon-btn" href="#/" aria-label="Retour">${I.back(22)}</a><h1>Produit introuvable</h1></div><p class="empty-state">Il a peut-être été supprimé sur l’autre téléphone.</p></main>`;
  const isFood = f.categoryId === "alim" || f.categoryId === "chat";
  const shortcuts = [
    ["", "Aucune"],
    [addToToday({ days: 7 }), "+1 sem."],
    [addToToday({ months: 1 }), "+1 mois"],
    [addToToday({ years: 1 }), "+1 an"],
  ];
  const back = f.id ? `#/placard/${f.categoryId}` : `#/placard/${f.categoryId}`;
  return `<main class="screen no-nav">
    <div class="top">
      <a class="icon-btn" href="${back}" aria-label="Annuler">${I.close(20)}</a>
      <h1 style="font-size:calc(26px * var(--fs))">${f.id ? "Modifier" : "Nouveau produit"}</h1>
    </div>
    <div class="field"><label for="f-name">Nom du produit</label>
      <input id="f-name" class="input" data-field="name" value="${esc(f.name)}" placeholder="Ex. : gel douche amande" autocomplete="off" enterkeyhint="done"></div>
    <div class="field"><label for="f-detail">Précision <span class="sub">(facultatif)</span></label>
      <input id="f-detail" class="input" data-field="detail" value="${esc(f.detail)}" placeholder="Ex. : boîte 85 g, marque…" autocomplete="off"></div>
    <div class="field"><span class="label" id="lbl-cat">Placard</span>
      <div class="cat-pick" role="group" aria-labelledby="lbl-cat">${CATS.map((c) => `<button type="button" data-act="fset" data-field="categoryId" data-v="${c.id}" aria-pressed="${f.categoryId === c.id}">${c.name}</button>`).join("")}</div></div>
    <div class="field">
      <div class="row-between"><span class="label">Quantité</span>${stepper("quantity", f.quantity, "Quantité")}</div>
      <div class="chips" role="group" aria-label="Unité">${UNITS.map((u) => `<button type="button" class="chip sm" data-act="fset" data-field="unit" data-v="${u}" aria-pressed="${f.unit === u}">${u}</button>`).join("")}</div>
    </div>
    <div class="field">
      <div class="row-between"><span class="label">${isFood ? "DLC / DDM" : "Date de péremption (facultatif)"}</span><span class="sub" style="font-weight:700;color:var(--mint-ink)">${f.expiry ? frDate(f.expiry) : "Sans date"}</span></div>
      <div class="chips" role="group" aria-label="Raccourcis de date">${shortcuts.map(([v, l]) => `<button type="button" class="chip sm" data-act="fset" data-field="expiry" data-v="${v}" aria-pressed="${f.expiry === v}">${l}</button>`).join("")}</div>
      <label class="sr" for="f-date">Choisir une date</label>
      <input id="f-date" class="input" type="date" data-field="expiry" value="${esc(f.expiry)}">
    </div>
    <div class="panel row-between">
      <span style="display:flex;flex-direction:column;gap:2px"><span class="t">M’alerter quand il en reste</span><span class="s">Passe alors en « Bientôt épuisé »</span></span>
      ${stepper("minQuantity", f.minQuantity, "Seuil")}
    </div>
    ${ui.formError ? `<p class="err" role="alert">${esc(ui.formError)}</p>` : ""}
    ${f.id ? `<button type="button" class="danger-btn${ui.deleteArmed ? " armed" : ""}" data-act="delete">${ui.deleteArmed ? "Touchez encore pour supprimer" : "Supprimer ce produit"}</button>` : ""}
  </main>
  <div class="cta-bar"><button class="cta" data-act="save" ${ui.busy ? "disabled" : ""}>${f.id ? "Enregistrer" : "Ajouter au placard"}</button></div>`;
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
      ? `<section style="display:flex;flex-direction:column;gap:8px"><h2 class="eyebrow">Sous le seuil (${lows.length})</h2><div class="card list">${lows.map((p) => row(p, "inc", "+1", qty(p) === 0)).join("")}</div></section>`
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
  return `<main class="screen">
    <h1>Profil</h1>
    <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <div class="row-between"><span class="t">Foyer ${esc(household.name)}</span>
        <span class="s" style="font-weight:600;color:${online ? "var(--mint-ink)" : "var(--warn)"}">${isDemo ? "Démo" : online ? "Synchronisé" : "Hors ligne"}</span></div>
      <div class="avatars">${names.map((n) => `<span class="avatar"><span>${esc(n.slice(0, 1))}</span>${esc(n)}</span>`).join("")}</div>
      <span class="s">Connectée en tant que ${esc(me())}${online || isDemo ? "" : " · les changements partiront au retour du réseau"}.</span>
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
    <section class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:center">
      <span style="color:var(--primary)">${I.share(22)}</span>
      <span style="display:flex;flex-direction:column;gap:2px"><span class="t">Installer sur un autre iPhone</span><span class="s">Ouvrir le lien dans Safari › Partager › Sur l’écran d’accueil</span></span>
    </section>
    ${isDemo
      ? `<button class="danger-btn" data-act="reset-demo">Remettre les données d’exemple</button>`
      : `<button class="danger-btn" data-act="logout">Se déconnecter</button>`}
  </main>${nav("profil")}`;
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
      case "placards": html = viewPlacards(); break;
      case "placard": html = viewPlacard(r.arg); break;
      case "ajout":
      case "produit": html = viewForm(r); break;
      case "alertes": html = viewAlertes(); break;
      case "profil": html = viewProfil(); break;
      case "scan": html = viewHome(); break;
      default: html = viewHome();
    }
    html += toastHtml();
  }
  app.innerHTML = html;
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
      if (ui.swiped) { ui.swiped = null; render(); } else go(`#/produit/${id}`);
      break;
    case "filter": ui.filter = v; render(); break;
    case "atab": ui.alertTab = v; render(); break;
    case "undo": { const u = ui.toast?.undo; ui.toast = null; clearTimeout(toastTimer); if (u) u(); render(); break; }
    case "fset": if (ui.form) { ui.form[field] = v; ui.deleteArmed = false; render(); } break;
    case "fstep": if (ui.form) { ui.form[field] = Math.max(field === "quantity" ? 0 : 0, (Number(ui.form[field]) || 0) + Number(v)); render(); } break;
    case "save": saveForm(); break;
    case "delete": deleteProduct(); break;
    case "theme": localStorage.setItem("plakardo-theme", v); applyPrefs(); render(); break;
    case "big": localStorage.setItem("plakardo-big", localStorage.getItem("plakardo-big") === "1" ? "0" : "1"); applyPrefs(); render(); break;
    case "logout": store.signOut(); break;
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
  if (t.matches("[data-field]") && ui.form) {
    ui.form[t.dataset.field] = t.value;
    if (t.type === "date") render();
  }
});

app.addEventListener("submit", async (e) => {
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

window.addEventListener("hashchange", () => { ui.swiped = null; ui.filter = route().name === "placard" ? ui.filter : "tout"; render(); window.scrollTo(0, 0); });
window.addEventListener("online", render);
window.addEventListener("offline", render);

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
  });
  store.onUser(async (u) => {
    if (u) await resolveName(u.email);
    user = u;
    if (unsub) { unsub(); unsub = null; }
    products = [];
    loaded = false;
    dataError = "";
    if (u) {
      unsub = store.subscribe(
        (list) => { products = list; loaded = true; render(); refreshScanner(); },
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
