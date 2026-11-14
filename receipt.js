// PLAKARDO – lecture d'un ticket de caisse (texte lu par l'iPhone : « Scanner du texte »).
// Fonctions pures, testables sans navigateur. Tickets français et allemands.

const STORES = [
  ["fressnapf", "Fressnapf", "chat"], ["zooplus", "Zooplus", "chat"], ["maxi zoo", "Maxi Zoo", "chat"], ["animalis", "Animalis", "chat"],
  ["dm drogerie", "dm", "hyg"], ["dm-drogerie", "dm", "hyg"], ["rossmann", "Rossmann", "hyg"], ["muller", "Müller", "hyg"], ["sephora", "Sephora", "hyg"],
  ["apotheke", "Pharmacie (DE)", "pharma"], ["pharmacie", "Pharmacie", "pharma"],
  ["lidl", "Lidl", "alim"], ["aldi", "Aldi", "alim"], ["edeka", "Edeka", "alim"], ["rewe", "Rewe", "alim"], ["kaufland", "Kaufland", "alim"],
  ["netto", "Netto", "alim"], ["penny", "Penny", "alim"], ["globus", "Globus", "alim"], ["norma", "Norma", "alim"], ["real", "Real", "alim"],
  ["leclercdrive", "E.Leclerc Drive", "alim"], ["leclerc drive", "E.Leclerc Drive", "alim"], ["leclerc", "E.Leclerc", "alim"], ["courses u", "Courses U", "alim"], ["carrefour drive", "Carrefour Drive", "alim"], ["carrefour", "Carrefour", "alim"], ["auchan", "Auchan", "alim"], ["intermarche", "Intermarché", "alim"],
  ["super u", "Super U", "alim"], ["hyper u", "Hyper U", "alim"], ["magasins u", "Magasins U", "alim"], ["monoprix", "Monoprix", "alim"],
  ["franprix", "Franprix", "alim"], ["cora", "Cora", "alim"], ["match", "Match", "alim"], ["grand frais", "Grand Frais", "alim"], ["biocoop", "Biocoop", "alim"],
  ["picard", "Picard", "alim"], ["action", "Action", "hyg"],
];
const norm = (s) => String(s || "").toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "");
const PRICE = /(-?\d{1,4}[.,]\d{2})(?!\d)/g;
const STOP = /\b(summe|total|zu zahlen|a payer|à payer|montant du|gesamt|net a payer|zwischensumme|sous[- ]total)\b/i;
const SKIP = /\b(mwst|ust|tva|steuer|netto|brutto|kartenzahlung|karte|visa|mastercard|girocard|ec[- ]?cash|carte bancaire|\bcb\b|ruckgeld|rückgeld|gegeben|bar\b|especes|rendu|payback|bonus|punkte|points|tel\.?|www\.|siret|steuernummer|ust-?id|kassen|bon[- ]?nr|ticket n|caisse|terminal|datum|uhrzeit|date|heure|merci|danke|vielen dank|bitte|beleg|kunden|client|fidelite|carte u)\b/i;
const DEPOSIT = /\b(pfand|leergut|consigne)\b/i;
const DISCOUNT = /\b(rabatt|remise|reduction|réduction|preisvorteil|aktion|coupon|bon de reduction|promo|nachlass|ersparnis)\b/i;

export function detectStore(text) {
  const n = norm(text).slice(0, 800);
  for (const [k, name, cat] of STORES) if (new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(n)) return { name, category: cat };
  return { name: "", category: "" };
}
export function detectDate(text) {
  const m = String(text).match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (!m) return null;
  let [, d, mo, y] = m.map(Number);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const toNum = (s) => Number(String(s).replace(",", "."));
function cleanLabel(s) {
  return s.replace(/\d+[.,]\d{1,3}\s*kg\s*[x×*]\s*(\d+[.,]\d{2})?\s*(eur|€)?\s*\/\s*kg/gi, " ").replace(/\bart\/?ean\b/gi, " ").replace(/\b\d{8,14}\b/g, " ").replace(PRICE, " ").replace(/\b(eur|€)\b/gi, " ")
    .replace(/\s[A-D12]\s*$/, " ").replace(/[*#]+/g, " ").replace(/\s+/g, " ").trim();
}
function pretty(s) {
  const t = s.trim();
  if (!t) return t;
  if (t === t.toUpperCase()) return t.toLowerCase().replace(/(^|[\s(/-])\p{L}/gu, (c) => c.toUpperCase());
  return t;
}

// Rayons des commandes drive (Leclerc, Carrefour, Courses U…) → catégories Plakardo.
const RAYONS = [
  [/hygiene|beaute|droguerie|entretien|bebe|maison/, "hyg"], [/animal|animaux|chat|chien/, "chat"], [/parapharmacie|sante|pharmacie/, "pharma"],
  [/viande|poisson|fruit|legume|laitier|oeuf|cremerie|fromage|charcuterie|traiteur|epicerie|boisson|surgele|boulangerie|petit dejeuner|vegetal|bio/, "alim"],
];
function rayonOf(line) {
  const m = norm(line).match(/^([a-z' &,-]+?)\s*\(\d+\s*produits?\)\s*$/);
  if (!m) return null;
  for (const [rx, c] of RAYONS) if (rx.test(m[1])) return c;
  return "alim";
}
// Ligne de commande drive : « Libellé   Quantité   Prix unitaire   Total »
const DRIVE_LINE = /^(.+?)\s{2,}(\d{1,3})\s{2,}(\d{1,4}[.,]\d{2})\s+(\d{1,4}[.,]\d{2})\s*€?$/;

// Retourne { store, category, date, total, items: [{ label, ean, qty, unitPrice, price, weight, kind }] }
export function parseReceipt(text) {
  const raw = String(text || "").replace(/\r/g, "");
  const rawLines = raw.split("\n").map((l) => l.replace(/\t/g, "   ").trim()).filter(Boolean);
  const lines = rawLines.map((l) => l.replace(/\s+/g, " "));
  const { name: store, category } = detectStore(raw);
  const date = detectDate(raw);
  const items = [];
  let total = null, started = false, ended = false;
  let buf = [], pendingQty = null, pendingUnit = null, pendingEan = null, pendingWeight = null, rayon = null;
  const flush = (price, extraLabel = "") => {
    const label = pretty(cleanLabel([...buf.slice(-2), extraLabel].join(" ")));
    const qty = pendingQty || 1;
    const pk = label.match(/(?:^|[\s-])x\s?(\d{1,2})(?![\d,.])/i);
    const item = { label: label || "Article", category: rayon || null, pack: pk ? Number(pk[1]) : 1, ean: pendingEan, qty, unitPrice: pendingUnit || Math.round((price / qty) * 100) / 100, price, weight: pendingWeight, kind: "item" };
    const nl = norm(label);
    if (DEPOSIT.test(nl)) item.kind = "deposit";
    if (price < 0 || DISCOUNT.test(nl)) item.kind = "discount";
    items.push(item);
    buf = []; pendingQty = null; pendingUnit = null; pendingEan = null; pendingWeight = null;
  };
  for (let li = 0; li < lines.length; li++) {
    if (ended) break;
    const line = lines[li], wide = rawLines[li];
    const nl = norm(line);
    if (STOP.test(nl)) {
      const ps = [...line.matchAll(PRICE)].map((m) => toNum(m[1]));
      if (ps.length && /summe|total|a payer|zu zahlen|gesamt/.test(nl) && !/sous|zwischen|tva|mwst/.test(nl)) { total = ps[ps.length - 1]; ended = true; }
      continue;
    }
    const ray = rayonOf(line);
    if (ray) { rayon = ray; buf = []; started = true; continue; }
    if (/^(origine|alliances locales|categorie|pays d|mode de conservation|designation|variete)\b/.test(nl) || / • /.test(line) || /^\d+\/\d+$/.test(line)) continue;
    const dl = wide.match(DRIVE_LINE);
    if (dl) {
      buf = []; started = true; pendingEan = null;
      pendingQty = Number(dl[2]); pendingUnit = toNum(dl[3]);
      const gw = dl[1].match(/\b(\d{1,4})\s?(g|kg|ml|cl|l)\b/i);
      if (gw) pendingWeight = { value: Number(gw[1]), unit: gw[2].toLowerCase() };
      flush(toNum(dl[4]), dl[1]);
      continue;
    }
    if (SKIP.test(nl)) { if (started) buf = []; continue; }
    if (!started && (detectStore(line).name || /\b\d{5}\b/.test(line) || /gmbh|sarl|sas\b|s\.a\.|strasse|straße|str\.|rue |avenue|bd /i.test(line))) continue;
    const ean = line.match(/\b(\d{13})\b/) || (/\b(ean|art)\b/i.test(line) ? line.match(/\b(\d{8})\b/) : null);
    if (ean && (started || /\b(ean|art)\b/i.test(line))) pendingEan = ean[1];
    // « 2 x 1,99 » ou « 2 x » ou « 2 St x 1,99 EUR »
    const q = line.match(/^(\d{1,3})\s*(?:st\.?|stk\.?|pce?s?\.?)?\s*[x×*]\s*(\d{1,4}[.,]\d{2})?/i);
    if (q) {
      pendingQty = Number(q[1]); if (q[2]) pendingUnit = toNum(q[2]);
      const rest = line.slice(q[0].length);
      if (!PRICE.test(rest)) { PRICE.lastIndex = 0; continue; }
      PRICE.lastIndex = 0;
    }
    // Poids : « 0,532 kg x 2,99 EUR/kg »
    const w = line.match(/(\d+[.,]\d{1,3})\s*kg\s*[x×*]\s*(\d+[.,]\d{2})/i);
    if (w) { pendingWeight = { value: toNum(w[1]), unit: "kg" }; pendingUnit = toNum(w[2]); }
    const g = line.match(/\b(\d{1,4})\s?(g|kg|ml|cl|l)\b/i);
    if (g && !w) pendingWeight = { value: Number(g[1]), unit: g[2].toLowerCase() };
    const prices = [...line.matchAll(PRICE)].map((m) => ({ v: toNum(m[1]), i: m.index, after: line.slice(m.index + m[0].length) }));
    // Prix suivi de « EUR » / « €/kg » sur une ligne de quantité = prix unitaire, pas le total de l'article.
    const itemPrices = prices.filter((p) => !(/^\s*(eur|€)?\s*\/\s*(kg|l|st)/i.test(p.after)) && !(pendingQty && /^\s*(eur|€)/i.test(p.after) && !/\s[A-D12]\s*$/.test(line)));
    if (!itemPrices.length) {
      if (prices.length && pendingQty) pendingUnit = prices[0].v;
      const lab = cleanLabel(line);
      if (lab && !/^\d+[.,]?\d*\s?(g|kg|ml|cl|l)$/i.test(lab)) buf.push(lab);
      started = started || !!lab;
      continue;
    }
    started = true;
    const price = itemPrices[itemPrices.length - 1].v;
    const before = cleanLabel(line.slice(0, itemPrices[itemPrices.length - 1].i));
    const labelPart = /^\d+[.,]?\d*\s?(g|kg|ml|cl|l)$/i.test(before) ? "" : before;
    if (!labelPart && !buf.length && items.length && (price < 0)) { items[items.length - 1].discount = (items[items.length - 1].discount || 0) + price; continue; }
    flush(price, labelPart);
  }
  // Remises : déduites de l'article précédent.
  const out = [];
  for (const it of items) {
    if (it.kind === "discount" && out.length) { out[out.length - 1].price = Math.round((out[out.length - 1].price + it.price) * 100) / 100; continue; }
    out.push(it);
  }
  if (total == null) total = Math.round(out.reduce((n, it) => n + it.price, 0) * 100) / 100;
  const sum = Math.round(out.reduce((n, it) => n + it.price, 0) * 100) / 100;
  return { store, category, date, total, sum, items: out };
}

// Clé de mémorisation d'une ligne de ticket (magasin + libellé, ou code EAN).
export function lineKey(store, item) {
  if (item.ean) return `ean:${item.ean}`;
  return `${norm(store || "?")}:${norm(item.label).replace(/[^a-z0-9]+/g, " ").trim()}`;
}
