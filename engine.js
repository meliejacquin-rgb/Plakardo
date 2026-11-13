// PLAKARDO V2.2 — moteur métier (pur, sans interface ni base de données)
// Lots, unités, retraits FEFO, opérations atomiques, recettes, besoins du menu.

// ───────────────────────── Lieux ─────────────────────────
export const DEFAULT_LOCATIONS = [
  { id: "placard", name: "Placard cuisine", icon: "stock", order: 0 },
  { id: "frigo", name: "Réfrigérateur", icon: "fridge", order: 1 },
  { id: "congel", name: "Congélateur", icon: "snow", order: 2 },
  { id: "sdb", name: "Salle de bain", icon: "drop", order: 3 },
  { id: "cellier", name: "Cellier", icon: "box", order: 4 },
];
export function defaultLocFor(categoryId) {
  return { alim: "placard", pharma: "sdb", hyg: "sdb", chat: "cellier" }[categoryId] || "placard";
}
// Migration V1 : devine le frigo ou le congélateur d'après le nom (modifiable ensuite par « Transférer »).
const FRIDGE_WORDS = /yaourt|yogourt|jambon|fromage|beurre|cr[eè]me fra|lardon|saumon fum|oeufs?\b|œufs?\b|joghurt|k[äa]se|butter|schinken|quark|sahne/i;
const FREEZER_WORDS = /surgel|congel|glace\b|tiefk[üu]hl|\bTK\b|eis\b/i;
export function guessLoc(p) {
  if (p.homeLoc) return p.homeLoc;
  if (p.categoryId === "alim") {
    const n = `${p.name || ""} ${p.detail || ""}`;
    if (FREEZER_WORDS.test(n)) return "congel";
    if (FRIDGE_WORDS.test(n)) return "frigo";
  }
  return defaultLocFor(p.categoryId);
}

// ───────────────────────── Nombres et dates ─────────────────────────
export const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
export const num = (v) => { const n = Number(String(v ?? "").replace(",", ".").trim()); return Number.isFinite(n) ? n : 0; };
export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export function daysBetween(iso, now = new Date()) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const a = new Date(y, m - 1, d); const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 864e5);
}

// ───────────────────────── Unités ─────────────────────────
// Référence : g (masse), ml (volume), unité (comptage). Jamais de masse ↔ volume sans facteur.
const UNIT_TABLE = {
  g: ["mass", 1], gramme: ["mass", 1], grammes: ["mass", 1], kg: ["mass", 1000],
  ml: ["vol", 1], cl: ["vol", 10], dl: ["vol", 100], l: ["vol", 1000], L: ["vol", 1000], litre: ["vol", 1000], litres: ["vol", 1000],
};
export function unitInfo(unit) {
  const u = String(unit || "").trim();
  const hit = UNIT_TABLE[u] || UNIT_TABLE[u.toLowerCase()];
  if (hit) return { dim: hit[0], factor: hit[1] };
  return { dim: "count:" + normUnit(u), factor: 1 };
}
function normUnit(u) {
  const s = u.toLowerCase().replace(/\.$/, "").trim();
  if (["", "pièce", "pièces", "piece", "pieces", "pc", "pcs", "unité", "unités", "u"].includes(s)) return "pièce";
  return s.replace(/s$/, "");
}
// Convertit q de fromUnit vers toUnit ; null si impossible.
export function convert(q, fromUnit, toUnit) {
  const a = unitInfo(fromUnit), b = unitInfo(toUnit);
  if (a.dim !== b.dim) {
    // une recette en « pièce » face à un produit en boîte/sachet… : comptage générique accepté
    if (a.dim.startsWith("count:") && b.dim.startsWith("count:") && (a.dim === "count:pièce" || b.dim === "count:pièce")) return round3(q);
    return null;
  }
  return round3((q * a.factor) / b.factor);
}

// ───────────────────────── Lots ─────────────────────────
let lotSeq = 0;
export function newLotId() { lotSeq += 1; return `l${Date.now().toString(36)}${lotSeq.toString(36)}${Math.random().toString(36).slice(2, 5)}`; }

// Lots d'un produit ; les produits de la V1 (sans lots) sont vus comme un lot unique (migration paresseuse).
export function lotsOf(p) {
  if (Array.isArray(p.lots)) return p.lots.filter((l) => num(l.qty) > 0 || l.keep);
  const q = Math.max(0, num(p.quantity));
  if (!q) return [];
  return [{ id: "l0", loc: p.loc || guessLoc(p), qty: q, expiry: p.expiry || null, expiryType: p.expiry ? "DLC" : "unknown", opened: false, addedAt: 0 }];
}
export const totalQty = (p) => round3(lotsOf(p).reduce((n, l) => n + num(l.qty), 0));
export const qtyIn = (p, loc) => round3(lotsOf(p).filter((l) => l.loc === loc).reduce((n, l) => n + num(l.qty), 0));
export const isStatusMode = (p) => p.trackingMode === "status";
export function statusOf(p) {
  if (!isStatusMode(p)) return null;
  return p.status || "dispo";
}
export function isAvailable(p) {
  return isStatusMode(p) ? statusOf(p) !== "epuise" : totalQty(p) > 0;
}
export function isLowStock(p) {
  if (p.lowAlert === false) return false;
  if (isStatusMode(p)) return statusOf(p) !== "dispo";
  return totalQty(p) <= num(p.minQuantity);
}
export function lotExpired(l, now) { return !!l.expiry && l.expiryType !== "DDM" && daysBetween(l.expiry, now) < 0; }
export function lotPastBest(l, now) { return !!l.expiry && l.expiryType === "DDM" && daysBetween(l.expiry, now) < 0; }
// Date la plus proche parmi les lots non vides (projection pour les alertes).
export function nearestLot(p) {
  return lotsOf(p).filter((l) => l.expiry).sort((a, b) => a.expiry.localeCompare(b.expiry))[0] || null;
}
// Ordre FEFO : lots datés du plus proche au plus lointain (ouverts d'abord à date égale), puis non datés par ordre d'ajout.
export function fefo(lots) {
  return [...lots].sort((a, b) => {
    if (a.expiry && b.expiry) return a.expiry.localeCompare(b.expiry) || (b.opened ? 1 : 0) - (a.opened ? 1 : 0);
    if (a.expiry) return -1;
    if (b.expiry) return 1;
    return (a.opened === b.opened ? 0 : a.opened ? -1 : 1) || num(a.addedAt) - num(b.addedAt);
  });
}

// ───────────────────────── Opérations atomiques ─────────────────────────
export class OpError extends Error {
  constructor(code, message, data = {}) { super(message); this.code = code; this.data = data; }
}

// Applique un groupe de lignes sur une copie des produits. Tout ou rien : lève OpError au premier problème.
// products : { [id]: doc } (lecture transactionnelle). Renvoie { writes: {id: newDoc}, recorded: [...] }.
// Lignes acceptées :
//   { kind: "add", productId, amount, loc, expiry?, expiryType?, newProduct? }
//   { kind: "remove", productId, amount, lotId? }             (FEFO, ou lot imposé)
//   { kind: "status", productId, status }                     (dispo | bientot | epuise)
//   { kind: "transfer", productId, lotId, amount, toLoc }
//   { kind: "correct", productId, lotId, qty }                (correction d'inventaire, distincte d'une consommation)
//   { kind: "lotdelta", productId, lots: [{ id, delta, loc, expiry, expiryType }] }  (compensation)
export function applyLines(products, lines, { now = new Date(), by = "" } = {}) {
  const writes = {};
  const get = (id) => {
    if (writes[id]) return writes[id];
    const src = products[id];
    if (!src) return null;
    const copy = { ...src, lots: lotsOf(src).map((l) => ({ ...l })) };
    writes[id] = copy;
    return copy;
  };
  const recorded = [];
  for (const line of lines) {
    let p = get(line.productId);
    if (!p && line.kind === "add" && line.newProduct) {
      p = { ...line.newProduct, lots: [] };
      writes[line.productId] = p;
    }
    if (!p) throw new OpError("missing", "Ce produit n’existe plus.", { productId: line.productId });
    const before = isStatusMode(p) ? statusOf(p) : round3(p.lots.reduce((n, l) => n + num(l.qty), 0));
    const rec = { kind: line.kind, productId: line.productId, name: p.name, unit: p.unit || "pièce", before, lots: [] };
    if (line.kind === "add") {
      const amount = round3(line.amount);
      if (!(amount > 0)) throw new OpError("invalid", `Quantité invalide pour ${p.name}.`);
      const lot = { id: line.lotId || newLotId(), loc: line.loc || p.homeLoc || (fefo(p.lots)[0] || {}).loc || defaultLocFor(p.categoryId), qty: amount, expiry: line.expiry || null,
        expiryType: line.expiry ? (line.expiryType || "DLC") : "unknown", opened: false, addedAt: now.getTime() };
      p.lots.push(lot);
      if (isStatusMode(p)) p.status = "dispo";
      rec.lots.push({ id: lot.id, delta: amount, loc: lot.loc, expiry: lot.expiry, expiryType: lot.expiryType });
      rec.delta = amount;
      rec.created = !products[line.productId];
    } else if (line.kind === "remove") {
      const amount = round3(line.amount);
      if (!(amount > 0)) throw new OpError("invalid", `Quantité invalide pour ${p.name}.`);
      if (isStatusMode(p)) throw new OpError("status", `${p.name} est suivi par statut : indiquez son nouvel état.`);
      const pool = line.lotId ? p.lots.filter((l) => l.id === line.lotId) : line.loc ? fefo(p.lots.filter((l) => l.loc === line.loc)) : fefo(p.lots);
      const avail = round3(pool.reduce((n, l) => n + num(l.qty), 0));
      if (amount > avail + 1e-9) {
        throw new OpError("insufficient", `${p.name} : ${fmt(amount)} ${p.unit || ""} demandés, ${fmt(avail)} disponibles.`, { productId: line.productId, requested: amount, available: avail });
      }
      let left = amount;
      for (const l of pool) {
        if (left <= 0) break;
        const take = Math.min(num(l.qty), left);
        if (take <= 0) continue;
        l.qty = round3(num(l.qty) - take);
        left = round3(left - take);
        rec.lots.push({ id: l.id, delta: -take, loc: l.loc, expiry: l.expiry || null, expiryType: l.expiryType || "unknown", opened: !!l.opened });
      }
      rec.delta = -amount;
    } else if (line.kind === "status") {
      if (!["dispo", "bientot", "epuise"].includes(line.status)) throw new OpError("invalid", "Statut inconnu.");
      rec.prevStatus = statusOf(p) || "dispo";
      p.status = line.status;
      rec.status = line.status;
    } else if (line.kind === "transfer") {
      const from = p.lots.find((l) => l.id === line.lotId);
      const amount = round3(line.amount);
      if (!from || amount <= 0 || amount > num(from.qty) + 1e-9) throw new OpError("insufficient", `Transfert impossible pour ${p.name}.`);
      if (from.loc === line.toLoc) throw new OpError("invalid", "Choisissez un autre lieu.");
      from.qty = round3(num(from.qty) - amount);
      const to = { ...from, id: newLotId(), loc: line.toLoc, qty: amount };
      p.lots.push(to);
      rec.lots.push({ id: from.id, delta: -amount, loc: from.loc, expiry: from.expiry || null, expiryType: from.expiryType || "unknown" });
      rec.lots.push({ id: to.id, delta: amount, loc: to.loc, expiry: to.expiry || null, expiryType: to.expiryType || "unknown" });
      rec.delta = 0;
    } else if (line.kind === "correct") {
      const lot = p.lots.find((l) => l.id === line.lotId);
      const q = round3(line.qty);
      if (!lot || q < 0) throw new OpError("invalid", `Correction impossible pour ${p.name}.`);
      const d = round3(q - num(lot.qty));
      lot.qty = q;
      rec.lots.push({ id: lot.id, delta: d, loc: lot.loc, expiry: lot.expiry || null, expiryType: lot.expiryType || "unknown" });
      rec.delta = d;
    } else if (line.kind === "lotdelta") {
      for (const ld of line.lots) {
        let lot = p.lots.find((l) => l.id === ld.id);
        if (!lot) {
          if (ld.delta < 0) throw new OpError("changed", `Les lots de ${p.name} ont changé depuis : annulation impossible pour ce produit.`);
          lot = { id: ld.id, loc: ld.loc, qty: 0, expiry: ld.expiry || null, expiryType: ld.expiryType || "unknown", opened: !!ld.opened, addedAt: now.getTime() };
          p.lots.push(lot);
        }
        const nq = round3(num(lot.qty) + ld.delta);
        if (nq < -1e-9) throw new OpError("changed", `${p.name} a déjà été consommé depuis : annulation impossible pour ce produit.`);
        lot.qty = Math.max(0, nq);
        rec.lots.push({ ...ld });
      }
      if (line.status) { rec.prevStatus = statusOf(p); p.status = line.status; rec.status = line.status; }
      rec.delta = round3(line.lots.reduce((n, l) => n + l.delta, 0));
    } else {
      throw new OpError("invalid", "Opération inconnue.");
    }
    // nettoyage + projections lisibles par les anciens écrans
    p.lots = p.lots.filter((l) => num(l.qty) > 0);
    const total = round3(p.lots.reduce((n, l) => n + num(l.qty), 0));
    p.quantity = total;
    const near = nearestLot(p);
    p.expiry = near ? near.expiry : null;
    p.updatedBy = by;
    rec.after = isStatusMode(p) ? statusOf(p) : total;
    recorded.push(rec);
  }
  return { writes, recorded };
}

// Opération inverse traçable (COOK-06) : on ne supprime jamais l'opération d'origine.
export function compensationLines(op) {
  const out = [];
  for (const r of op.lines || []) {
    if (r.kind === "status") { out.push({ kind: "lotdelta", productId: r.productId, lots: [], status: r.prevStatus || "dispo" }); continue; }
    if (r.lots && r.lots.length) out.push({ kind: "lotdelta", productId: r.productId, lots: r.lots.map((l) => ({ ...l, delta: -l.delta })), ...(r.prevStatus ? { status: r.prevStatus } : {}) });
  }
  return out;
}

const fmt = (n) => String(round3(n)).replace(".", ",");

// ───────────────────────── Recettes (via Claude, copier-coller) ─────────────────────────
export const THEMES = ["Méditerranéen", "Français", "Italien", "Espagnol", "Grec", "Européen", "Asiatique", "Japonais", "Chinois", "Thaïlandais", "Indien", "Moyen-oriental", "Mexicain", "Américain", "Cuisine du monde"];
export const DISH_TYPES = ["Entrée", "Plat", "Dessert", "Petit-déjeuner", "Accompagnement"];

// Produits prioritaires (EXP-01/02) : DLC proche, lots ouverts datés, DDM proche. DLC dépassée exclue ; date inconnue ≠ urgent.
export function priorityList(products, now = new Date()) {
  const out = [];
  for (const p of products) {
    if (p.categoryId && !["alim"].includes(p.categoryId)) continue;
    for (const l of lotsOf(p)) {
      if (!l.expiry || lotExpired(l, now)) continue;
      if (l.loc === "congel") continue; // EXP-04 : pas de priorité sur une date de produit frais au congélateur
      const d = daysBetween(l.expiry, now);
      const weight = l.expiryType === "DDM" ? 0.5 : 1;
      if (d <= 7) out.push({ product: p, lot: l, days: d, score: (8 - d) * weight + (l.opened ? 2 : 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
export function weekDays(n, now = new Date()) {
  const start = (now.getDay() + 6) % 7; // aujourd'hui
  return Array.from({ length: Math.max(1, Math.min(7, n)) }, (_, i) => DAYS[(start + i) % 7]);
}
export function buildPrompt({ products, locations, filters, prefs, mode, now = new Date() }) {
  const locName = Object.fromEntries((locations || []).map((l) => [l.id, l.name]));
  const food = products.filter((p) => p.categoryId === "alim" && isAvailable(p));
  const prio = priorityList(food, now);
  const prioIds = new Set(prio.map((x) => x.product.id));
  const line = (p) => {
    if (isStatusMode(p)) return `- id:${p.id} | ${p.name} | quantité inconnue (statut : ${statusOf(p) === "bientot" ? "bientôt vide" : "disponible"})`;
    const lots = lotsOf(p).filter((l) => !lotExpired(l, now));
    const q = round3(lots.reduce((n, l) => n + num(l.qty), 0));
    if (!q) return null;
    const dates = lots.filter((l) => l.expiry).map((l) => `${l.expiryType === "DDM" ? "DDM" : "DLC"} ${l.expiry}${l.opened ? " ouvert" : ""}`).join(", ");
    const where = [...new Set(lots.map((l) => locName[l.loc] || l.loc))].join(", ");
    return `- id:${p.id} | ${p.name} | ${fmt(q)} ${p.unit || "pièce"} | ${where}${dates ? " | " + dates : ""}`;
  };
  const stock = food.map(line).filter(Boolean).join("\n") || "(aucun produit alimentaire en stock)";
  const prioTxt = prio.slice(0, 8).map((x) => `- ${x.product.name} (${x.lot.expiryType === "DDM" ? "DDM" : "DLC"} ${x.lot.expiry}${x.lot.opened ? ", ouvert" : ""})`).join("\n") || "(aucun)";
  const f = filters || {};
  const pr = prefs || {};
  const lines = [
    mode === "week"
      ? (() => { const nd = (filters && filters.days) || 5; const two = /et d/.test((filters && filters.meal) || ""); return `Tu es l’assistant cuisine de l’app Plakardo. Prépare le menu de la semaine : exactement ${two ? nd * 2 : nd} recettes, ${two ? "deux par jour (déjeuner puis dîner)" : "une par jour"} (${weekDays(nd).join(", ")}), pour le ${two ? "déjeuner et le dîner" : (filters && filters.meal) || "dîner"}. Indique le jour dans "jour"${two ? " et le repas dans \"description\"" : ""}.`; })() + ` Place en début de semaine les recettes qui utilisent les produits aux dates les plus proches. Varie les plats et ne compte pas deux fois le même stock.`
      : "Tu es l’assistant cuisine de l’app Plakardo. Propose exactement 3 recettes.",
    mode === "week" ? "Utilise en priorité le stock ci-dessous ; les achats nécessaires seront ajoutés automatiquement à la liste de courses." : mode === "inspiration" ? "Mode « Trouver l’inspiration » : tu peux sortir du stock, mais signale ce qui manque." : "Mode « Avec mes stocks » : utilise en priorité le stock ci-dessous et limite les achats.",
    f.antigaspi !== false ? "Priorité anti-gaspillage : utilise d’abord les produits prioritaires." : "",
    "",
    "CONTRAINTES",
    `- Portions : ${f.portions || 2}`,
    f.theme ? `- Thème : ${f.theme}` : "- Thème : libre",
    f.maxTime ? `- Temps total maximal : ${f.maxTime} min` : "",
    f.difficulty ? `- Difficulté : ${f.difficulty}` : "",
    f.dishType ? `- Type de plat : ${f.dishType}` : "",
    f.mustUse && f.mustUse.length ? `- Ingrédients imposés : ${f.mustUse.join(", ")}` : "",
    f.exclude && f.exclude.length ? `- Ingrédients interdits : ${f.exclude.join(", ")}` : "",
    pr.allergies && pr.allergies.length ? `- Allergies (exclure strictement) : ${pr.allergies.join(", ")}` : "",
    pr.dislikes && pr.dislikes.length ? `- Préférences (éviter) : ${pr.dislikes.join(", ")}` : "",
    pr.equipment && pr.equipment.length ? `- Équipements disponibles : ${pr.equipment.join(", ")}` : "",
    `- Achats supplémentaires tolérés : ${f.extraBuys ?? "1 à 2 ingrédients"}`,
    "- Si les contraintes sont impossibles, n’invente rien : renvoie \"recettes\": [] et explique dans \"blocage\".",
    "",
    "PRODUITS PRIORITAIRES",
    prioTxt,
    "",
    "STOCK (id | nom | quantité unité | lieu | dates)",
    stock,
    "",
    "FORMAT DE RÉPONSE OBLIGATOIRE : uniquement un bloc ```json, sans texte autour, de la forme :",
    '```json',
    '{"recettes":[{"jour":"Lundi","titre":"…","description":"…","theme":"…","type":"Plat","portions":2,"preparation_min":10,"cuisson_min":20,"difficulte":"Facile",',
    '"ingredients":[{"nom":"…","quantite":200,"unite":"g","id":"id du stock ou null","indivisible":false}],',
    '"etapes":["…","…"],"substitutions":["…"],"allergenes":["…"]}],"blocage":null}',
    '```',
    "Règles : unités parmi g, kg, ml, cl, l, pièce, c. à soupe, c. à café, pincée. Reprends l’id exact du stock quand l’ingrédient en vient, sinon null. N’indique jamais une quantité de stock que tu ne connais pas.",
    "Réponds directement dans la conversation, sans créer de fichier, de document ni d’artefact, et sans texte avant ou après le bloc json.",
  ];
  return lines.filter((x) => x !== "").join("\n").replace(/\nCONTRAINTES/, "\n\nCONTRAINTES").replace(/\nPRODUITS PRIORITAIRES/, "\n\nPRODUITS PRIORITAIRES").replace(/\nSTOCK \(/, "\n\nSTOCK (").replace(/\nFORMAT DE/, "\n\nFORMAT DE");
}

const ALLOWED_UNITS = ["g", "kg", "ml", "cl", "dl", "l", "pièce", "pièces", "c. à soupe", "c. à café", "pincée", "pincées", "gousse", "gousses", "tranche", "tranches", "feuille", "feuilles", "botte", "bottes", "boîte", "boîtes", "sachet", "sachets"];
const MAX_BY_DIM = { mass: 5000, vol: 5000 };

// Lecture tolérante de la réponse copiée depuis Claude (guillemets typographiques, virgules en trop,
// dessins mal échappés, bloc de code absent ou non refermé).
function tryParse(s) { try { return JSON.parse(s); } catch { return null; } }
function cleanJson(s) {
  return s.replace(/^\uFEFF/, "").replace(/[\u201C\u201D\u201E]/g, '"').replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00A0/g, " ").replace(/,\s*([}\]])/g, "$1");
}
function sliceObject(body) {
  const a = body.indexOf("{"), b = body.lastIndexOf("}");
  return a === -1 || b <= a ? null : body.slice(a, b + 1);
}
function extractJson(text) {
  const t = String(text || "");
  const bodies = [];
  const fences = [...t.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)].map((m) => m[1]).filter((x) => x.includes("recettes"));
  bodies.push(...fences);
  const open = t.match(/```[a-zA-Z]*\s*([\s\S]*)$/); // bloc non refermé
  if (open && open[1].includes("recettes")) bodies.push(open[1]);
  bodies.push(t);
  for (const body of bodies) {
    const obj = sliceObject(body);
    if (!obj) continue;
    const direct = tryParse(obj) || tryParse(cleanJson(obj));
    if (direct) return direct;
    // Dessins qui cassent le JSON : on les met de côté puis on les rattache dans l'ordre.
    const svgs = [];
    const stripped = obj.replace(/"dessin_svg"\s*:\s*"(<svg[\s\S]*?<\/svg>)\s*"/g, (_, svg) => { svgs.push(svg.replace(/\\"/g, "'").replace(/\\n/g, " ")); return '"dessin_svg":null'; });
    const data = tryParse(stripped) || tryParse(cleanJson(stripped));
    if (data) {
      if (Array.isArray(data.recettes) && svgs.length === data.recettes.length) data.recettes.forEach((r, i) => { if (r) r.dessin_svg = svgs[i].replace(/"/g, "'"); });
      return data;
    }
  }
  return null;
}

// Valide strictement la réponse (AI-02/03, T14). L'IA n'écrit jamais en stock : on ne fait que lire.
export function parseRecipes(text, products) {
  const data = extractJson(text);
  if (!data || !Array.isArray(data.recettes)) return { recipes: [], errors: [String(text || "").includes("recettes") ? "Réponse incomplète ou abîmée : dans Claude, touchez Copier sous la réponse entière (pas seulement une partie), puis recommencez." : "Ce n’est pas la réponse de Claude : copiez-la avec le bouton Copier sous sa réponse."], blocage: null };
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const recipes = [], errors = [];
  data.recettes.forEach((r, i) => {
    const label = r && r.titre ? `« ${r.titre} »` : `Recette ${i + 1}`;
    const problems = [];
    if (!r || typeof r.titre !== "string" || !r.titre.trim()) problems.push("titre manquant");
    const portions = Math.round(num(r && r.portions));
    if (!(portions >= 1 && portions <= 30)) problems.push("portions invalides");
    const ings = Array.isArray(r && r.ingredients) ? r.ingredients : [];
    if (!ings.length) problems.push("aucun ingrédient");
    const steps = Array.isArray(r && r.etapes) ? r.etapes.filter((s) => typeof s === "string" && s.trim()) : [];
    if (!steps.length) problems.push("aucune étape");
    const ingredients = ings.map((g) => {
      const q = num(g && g.quantite);
      const unit = String((g && g.unite) || "pièce").trim();
      const info = unitInfo(unit);
      let warn = "";
      if (!(q > 0)) warn = "quantité absente";
      if (info.dim in MAX_BY_DIM && q * info.factor > MAX_BY_DIM[info.dim]) problems.push(`quantité absurde (${g.nom} : ${q} ${unit})`);
      if (info.dim === "count:pièce" && q > 60) problems.push(`quantité absurde (${g.nom} : ${q})`);
      if (!ALLOWED_UNITS.includes(unit.toLowerCase()) && !ALLOWED_UNITS.includes(unit)) warn = warn || `unité « ${unit} » non standard`;
      let id = g && g.id && g.id !== "null" ? String(g.id) : null;
      let idWarn = "";
      if (id && !byId[id]) { idWarn = "ingrédient inventé ou absent du stock"; id = null; }
      return { name: String((g && g.nom) || "").trim() || "Ingrédient", qty: q > 0 ? round3(q) : null, unit, productId: id, indivisible: !!(g && g.indivisible), warn: warn || idWarn };
    });
    if (problems.length) { errors.push(`${label} refusée : ${problems.join(", ")}.`); return; }
    recipes.push({
      id: "tmp" + Date.now().toString(36) + i,
      day: String(r.jour || "").trim(), title: r.titre.trim(), description: String(r.description || "").trim(), theme: String(r.theme || "").trim(), type: String(r.type || "Plat").trim(),
      portions, prepMin: Math.max(0, Math.round(num(r.preparation_min))), cookMin: Math.max(0, Math.round(num(r.cuisson_min))),
      difficulty: String(r.difficulte || "").trim(), ingredients, steps: steps.map((s) => s.trim()),
      substitutions: (Array.isArray(r.substitutions) ? r.substitutions : []).filter((s) => typeof s === "string"),
      allergens: (Array.isArray(r.allergenes) ? r.allergenes : []).filter((s) => typeof s === "string"),
      drawing: sanitizeSvg(r.dessin_svg),
      source: "claude", version: 1,
    });
  });
  return { recipes, errors, blocage: typeof data.blocage === "string" && data.blocage.trim() ? data.blocage.trim() : null };
}

// Mise à l'échelle déterministe (REC-06), sans nouvel appel IA.
export function scaleRecipe(recipe, portions) {
  const k = portions / (recipe.portions || 1);
  return recipe.ingredients.map((g) => {
    if (g.qty == null) return { ...g };
    let q = g.qty * k;
    const info = unitInfo(g.unit);
    const countable = info.dim.startsWith("count:") && !["c. à soupe", "c. à café", "pincée", "pincées"].includes(g.unit);
    let note = "";
    if (countable || g.indivisible) {
      const r = Math.max(1, Math.round(q * 2) / 2);
      if (g.indivisible) { const r2 = Math.max(1, Math.round(q)); if (Math.abs(r2 - q) > 0.01) note = "arrondi (indivisible)"; q = r2; }
      else { if (Math.abs(r - q) > 0.01) note = "arrondi"; q = r; }
    } else q = Math.round(q * 10) / 10;
    return { ...g, qty: round3(q), note };
  });
}

// État d'un ingrédient face au stock (REC-05, EXP-03, INV-04/05).
export function ingredientState(g, byId, now = new Date()) {
  const p = g.productId ? byId[g.productId] : null;
  if (!p) return { state: "missing", product: null, label: g.warn === "ingrédient inventé ou absent du stock" ? "Absent du stock (non reconnu)" : "Manquant" };
  if (isStatusMode(p)) {
    const st = statusOf(p);
    if (st === "epuise") return { state: "missing", product: p, label: "Épuisé" };
    return { state: "check", product: p, label: "Quantité à vérifier" };
  }
  const usable = lotsOf(p).filter((l) => !lotExpired(l, now));
  const avail = round3(usable.reduce((n, l) => n + num(l.qty), 0));
  if (g.qty == null) return { state: avail > 0 ? "check" : "missing", product: p, label: avail > 0 ? "Quantité à vérifier" : "Manquant", avail };
  const need = convert(g.qty, g.unit, p.unit || "pièce");
  if (need == null) return { state: "check", product: p, label: `Unités différentes (${p.unit}) : à vérifier`, avail };
  if (avail + 1e-9 >= need) return { state: "ok", product: p, label: `Disponible · ${fmt(avail)} ${p.unit}`, avail, need };
  if (avail > 0) return { state: "partial", product: p, label: `Il manque ${fmt(round3(need - avail))} ${p.unit}`, avail, need, missing: round3(need - avail) };
  return { state: "missing", product: p, label: "Épuisé", avail: 0, need, missing: need };
}

// Classement métier explicable (EXP-02/03) — l'ordre final n'est pas confié à l'IA.
export function scoreRecipe(recipe, products, now = new Date()) {
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const prio = priorityList(products, now);
  const prioMap = new Map(prio.map((x) => [x.product.id, x]));
  let score = 0, missing = 0, check = 0;
  const uses = [];
  for (const g of recipe.ingredients) {
    const st = ingredientState(g, byId, now);
    if (st.state === "missing" || st.state === "partial") missing += 1;
    if (st.state === "check") check += 1;
    const pr = g.productId && prioMap.get(g.productId);
    if (pr) { score += pr.score; uses.push(pr); }
    if (st.state === "ok") score += 1;
  }
  score -= missing * 3;
  const tags = [];
  uses.sort((a, b) => a.days - b.days).slice(0, 2).forEach((u) => {
    const [y, m, d] = u.lot.expiry.split("-");
    tags.push({ kind: "prio", text: `Utilise ${u.product.name.toLowerCase()} avant le ${d}/${m}` });
  });
  if (!missing && !check) tags.push({ kind: "ok", text: "Tous les ingrédients disponibles" });
  else if (missing) tags.push({ kind: "miss", text: missing === 1 ? "Il manque 1 ingrédient" : `Il manque ${missing} ingrédients` });
  if (check) tags.push({ kind: "check", text: check === 1 ? "1 quantité à vérifier" : `${check} quantités à vérifier` });
  return { score, tags, missing, check };
}

// ───────────────────────── Besoins du menu (PLAN-02, SHOP-01) ─────────────────────────
// entries : [{ recipe, portions }]. Réservation virtuelle : un même stock n'est jamais compté deux fois.
export function computeNeeds(entries, products, now = new Date()) {
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const lines = new Map();
  for (const e of entries) {
    if (!e.recipe) continue;
    for (const g of scaleRecipe(e.recipe, e.portions || e.recipe.portions)) {
      const p = g.productId ? byId[g.productId] : null;
      const key = p ? `p:${p.id}` : `n:${g.name.toLowerCase()}|${unitInfo(g.unit).dim}`;
      let L = lines.get(key);
      if (!L) { L = { key, product: p, name: p ? p.name : g.name, unit: p ? (p.unit || "pièce") : g.unit, need: 0, unknown: false, sources: [] }; lines.set(key, L); }
      L.sources.push(e.recipe.title);
      if (g.qty == null) { L.unknown = true; continue; }
      const q = p ? convert(g.qty, g.unit, L.unit) : convert(g.qty, g.unit, L.unit);
      if (q == null) { L.unknown = true; continue; }
      L.need = round3(L.need + q);
    }
  }
  const out = [];
  for (const L of lines.values()) {
    L.sources = [...new Set(L.sources)];
    if (L.product && isStatusMode(L.product)) {
      const st = statusOf(L.product);
      L.mode = st === "epuise" ? "buy" : st === "bientot" ? "suggest" : "check";
      L.missing = null;
    } else if (L.product) {
      L.avail = round3(lotsOf(L.product).filter((l) => !lotExpired(l, now)).reduce((n, l) => n + num(l.qty), 0));
      L.missing = round3(Math.max(0, L.need - L.avail));
      L.mode = L.unknown && !L.need ? "check" : L.missing > 0 ? "buy" : "ok";
    } else {
      L.avail = 0; L.missing = L.need || null; L.mode = "buy";
    }
    if (L.mode === "buy" && L.product && num(L.product.packSize) > 0 && L.missing) {
      const packs = Math.ceil(L.missing / num(L.product.packSize));
      L.suggestion = { packs, qty: round3(packs * num(L.product.packSize)) };
    }
    out.push(L);
  }
  return out.sort((a, b) => ({ buy: 0, suggest: 1, check: 2, ok: 3 }[a.mode] - { buy: 0, suggest: 1, check: 2, ok: 3 }[b.mode]) || a.name.localeCompare(b.name, "fr"));
}


// Dessin fourni par Claude : seules des formes simples sont gardées (pas de script, lien, image ni texte).
const SVG_TAGS = new Set(["svg", "g", "rect", "circle", "ellipse", "path", "polygon", "polyline", "line"]);
const SVG_ATTRS = new Set(["viewbox", "xmlns", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity", "transform", "fill-rule"]);
export function sanitizeSvg(src) {
  const s = String(src || "").trim();
  if (!s || s.length > 6000 || !/^<svg[\s>]/i.test(s)) return null;
  const out = [];
  const re = /<\s*(\/?)\s*([a-zA-Z]+)([^<>]*?)(\/?)\s*>/g;
  let m, last = 0, depth = 0;
  while ((m = re.exec(s))) {
    if (s.slice(last, m.index).trim()) return null; // pas de texte entre les balises
    last = re.lastIndex;
    const [, close, tagRaw, attrs, self] = m;
    const tag = tagRaw.toLowerCase();
    if (!SVG_TAGS.has(tag)) return null;
    if (close) { out.push(`</${tag}>`); depth -= 1; continue; }
    const kept = [];
    const ar = /([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a, rest = attrs;
    while ((a = ar.exec(attrs))) {
      const name = a[1].toLowerCase();
      const val = a[3] ?? a[4] ?? "";
      if (!SVG_ATTRS.has(name)) continue;
      if (/url\(|javascript|expression|[<>&"]/i.test(val) || val.length > 2000) return null;
      kept.push(`${name === "viewbox" ? "viewBox" : name}="${val}"`);
      rest = rest.replace(a[0], "");
    }
    if (rest.replace(/\//g, "").trim()) return null;
    if (tag === "svg" && !kept.some((k) => k.startsWith("xmlns="))) kept.push('xmlns="http://www.w3.org/2000/svg"');
    out.push(`<${tag}${kept.length ? " " + kept.join(" ") : ""}${self ? "/" : ""}>`);
    if (!self) depth += 1;
  }
  if (s.slice(last).trim() || depth !== 0) return null;
  const res = out.join("");
  return /^<svg[^>]*viewBox=/.test(res) ? res : null;
}
