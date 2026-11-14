// PLAKARDO – « Ajouter en une phrase » : dictée ou texte libre → articles.
// Ex. « chez Lidl : deux yaourts, un kilo de pommes 2 euros 50, 500 g de poulet, du lait, total 12 euros »

const NUM_WORDS = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50, cent: 100, demi: 0.5, "demie": 0.5, "une douzaine": 12, douzaine: 12, quelques: 2, plusieurs: 2 };
const UNIT_WORDS = [
  [/^(kilos?|kilogrammes?|kg)$/, "kg"], [/^(grammes?|gr?|g)$/, "g"], [/^(litres?|l)$/, "l"], [/^(centilitres?|cl)$/, "cl"], [/^(millilitres?|ml)$/, "ml"],
  [/^(bo[iî]tes?|conserves?)$/, "boîte"], [/^(paquets?|sachets?)$/, "sachet"], [/^(bouteilles?|flacons?)$/, "flacon"], [/^(tubes?)$/, "tube"],
  [/^(sacs?)$/, "sac"], [/^(rouleaux?|lots?|bouquets?|t[eê]tes?|filets?)$/, "pièce"], [/^(pots?|barquettes?|briques?|packs?|tranches?|pi[eè]ces?|morceaux?)$/, "pièce"],
];
const norm = (s) => String(s || "").toLowerCase().replace(/œ/g, "oe").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, " ").replace(/\s+/g, " ").trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function toNumber(tok) {
  if (tok == null) return null;
  const t = norm(tok);
  if (/^\d+([.,]\d+)?$/.test(t)) return Number(t.replace(",", "."));
  if (t in NUM_WORDS) return NUM_WORDS[t];
  return null;
}
// « 6 euros 50 », « 6,50 € », « 6 € 50 », « six euros » → 6.5
function extractPrice(s) {
  const rx = /(\d+(?:[.,]\d{1,2})?|\b(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente)\b)\s*(?:euros?|€|eur)\s*(\d{1,2})?(?!\s*(?:g|kg|l|cl|ml)\b)/i;
  const cm = s.match(/(\d{1,2}|\b(?:dix|vingt|trente|quarante|cinquante)\b)\s*centimes?/i);
  if (cm) { const v = toNumber(cm[1]); if (v != null) return { price: v / 100, rest: (s.slice(0, cm.index) + " " + s.slice(cm.index + cm[0].length)).replace(/(?:^|\s)(a|à|pour)\s*$/i, "").trim() }; }
  const m = s.match(rx);
  if (!m) return { price: null, rest: s };
  const a = toNumber(m[1]);
  const cents = m[2] ? Number(m[2].padEnd(2, "0")) / 100 : 0;
  return { price: a == null ? null : Math.round((a + cents) * 100) / 100, rest: (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).replace(/(?:^|\s)(a|à|pour|au prix de)\s*$/i, "").trim() };
}

// Dictée sans ponctuation : « un paquet de pâtes de 1 kg trois courgettes pour 2,20 € six rouleaux… »
// → coupe avant chaque nouvelle quantité et après chaque prix.
const QTY_START = /^(\d+([.,]\d+)?|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarante|cinquante|cent|des|du|quelques|plusieurs|demi|douzaine)$/i;
const CUR = /^(€|euros?|eur)$/i;
const LINK = /^(de|d'|à|a|x|pour|par|en)$/i;
function segment(src) {
  return src.split(/,(?!\d)/).map((part) => {
    const toks = part.trim().replace(/(\d)\s*€/g, "$1 €").split(/\s+/).filter(Boolean);
    const out = []; let cur = []; let named = false; let priced = false;
    const flush = () => { if (cur.length) out.push(cur.join(" ")); cur = []; named = false; priced = false; };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i], nt = toks[i + 1] || "", prev = cur[cur.length - 1] || "";
      const isNum = /^\d+([.,]\d+)?$/.test(t) || QTY_START.test(t);
      // Prix : « 2,20 € », « trois euros 50 », « pour 4,25 € »
      if (isNum && CUR.test(nt)) {
        if (/^pour$/i.test(prev) || /^à$|^a$/i.test(prev)) cur.pop();
        cur.push(t, nt); i++;
        if (/^\d{1,2}$/.test(toks[i + 1] || "") && !CUR.test(toks[i + 2] || "") && !/^(g|kg|l|cl|ml)$/i.test(toks[i + 2] || "")) { cur.push(toks[i + 1]); i++; }
        if (/^centimes?$/i.test(toks[i + 1] || "")) { cur.push(toks[i + 1]); i++; }
        priced = true; continue;
      }
      // « orange à banane » : la dictée a entendu « à » au lieu de « et une » (sauf « pâte à tartiner », « crème à fouetter »…)
      if (/^(à|a)$/i.test(t) && named && nt && !/^\d/.test(nt) && !QTY_START.test(nt) && !/^(tartiner|fouetter|pizza|gratin|cuire|cuisson|la|l'|base|raclette|soupe|risotto|sushi|r[aâ]per|poêler|boire|croquer|th[eé]|caf[eé])/i.test(nt)) { flush(); cur.push("un"); continue; }
      if (isNum && named && !LINK.test(prev)) flush();
      else if (isNum && named && /^pour$/i.test(prev)) { cur.pop(); flush(); }
      else if (priced && !isNum) flush();
      cur.push(t);
      if (!isNum && !LINK.test(t) && !/^(g|kg|l|cl|ml|kilos?|grammes?|litres?|paquets?|bo[iî]tes?|sachets?|bouteilles?|rouleaux?|tubes?|sacs?|pots?|barquettes?|packs?|filets?|lots?)$/i.test(t)) named = true;
    }
    flush();
    return out.join(", ");
  }).filter(Boolean).join(", ");
}

// Retourne { store, total, items: [{ name, qty, unit, price }] }
export function parsePhrase(text) {
  // Langage parlé : « J'ai acheté… ainsi que… J'ai également pris… » → liste d'articles.
  let src = String(text || "").replace(/\n+/g, ", ").replace(/[’`]/g, "'")
    .replace(/^\s*(che|chaise|cher)\s+/i, "chez ")
    .replace(/[.!?;]+(\s|$)/g, ", ")
    .replace(/(^|[\s,])(j'?\s?ai|on a|nous avons|je viens d'|il y a)\s*(également|egalement|aussi|encore|aujourd'hui)?\s*(achet[ée]e?s?|pris|rapport[ée]s?|acheter|prendre)?(?=[\s,]|$)/gi, "$1, ")
    .replace(/(^|[\s,])(ainsi que|et puis|en plus|de plus|et aussi|aussi|également|egalement|ensuite|il y avait|ajouter|ajoutez|ajoute|achète|achetez|rajoute)(?=[\s,]|$)/gi, "$1, ")
    .replace(/,(\s*,)+/g, ",");
  src = segment(src);
  let store = "";
  const sm = src.match(/\b(?:chez|a la|à la|au|aux|bei)\s+([A-Za-zÀ-ÿ'][\wÀ-ÿ' .-]{1,24}?)\s*(?::|,|$)/i);
  if (sm && !/^\d/.test(sm[1])) { store = cap(sm[1].trim()); src = src.replace(sm[0], ", "); }
  const head = src.match(/^\s*([A-Za-zÀ-ÿ][\wÀ-ÿ' .-]{1,24}?)\s*:\s*/);
  if (!store && head) { store = cap(head[1].trim()); src = src.slice(head[0].length); }
  let total = null;
  const tm = src.match(/\b(?:total|en tout|au total|j ?ai pay[eé]|ça fait|ca fait)\s*(?:de|:)?\s*([^,;]+)/i);
  if (tm) { const p = extractPrice(tm[1] + (/(€|euro)/i.test(tm[1]) ? "" : " euros")); if (p.price != null) { total = p.price; src = src.replace(tm[0], ", "); } }
  const chunks0 = src.split(/\s*(?:,(?!\d)|;|\bet\b(?!\s+demi)|\bpuis\b|\bplus\b|\+|\bavec\b)\s*/i).map((c) => c.trim()).filter(Boolean);
  // La dictée met parfois une virgule au milieu d'un article : « 200 g, emmental râpé », « 1 kg de riz, basmati à 2,49 € »
  const hasQty = (c) => /^(\d|un\b|une\b|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|des\b|du\b|de la\b|demi|quelques|plusieurs)/i.test(c);
  const onlyQty = (c) => /^(\d+(?:[.,]\d+)?|une?|deux|trois|quatre|cinq|six|dix|douze)\s*(g|kg|l|cl|ml|kilos?|grammes?|litres?|paquets?|bo[iî]tes?|sachets?|bouteilles?)?$/i.test(c.trim());
  const hasPrice = (c) => /(\d|\b(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\b)\s*(€|euros?|centimes?)/i.test(c);
  const chunks = [];
  for (const c of chunks0) {
    const prev = chunks[chunks.length - 1];
    if (prev && onlyQty(prev)) { chunks[chunks.length - 1] = `${prev} ${c}`; continue; }
    if (prev && !hasQty(c) && hasPrice(c) && hasQty(prev) && !hasPrice(prev)) { chunks[chunks.length - 1] = `${prev} ${c}`; continue; }
    chunks.push(c);
  }
  const items = [];
  for (let c of chunks) {
    const { price, rest } = extractPrice(c);
    c = rest;
    let words = c.split(/\s+/).filter(Boolean);
    let qty = 1, unit = "", explicit = false;
    // « une douzaine d'œufs »
    if (/^(une?\s+)?douzaine/i.test(c)) { qty = 12; explicit = true; words = c.replace(/^(une?\s+)?douzaine\s*(d[e'’]\s*)?/i, "").split(/\s+/); }
    else {
      const n = toNumber(words[0]);
      // « 1,5 kg », « 500g »
      const glued = words[0] && words[0].match(/^(\d+(?:[.,]\d+)?)(kg|g|l|cl|ml)$/i);
      if (glued) { qty = Number(glued[1].replace(",", ".")); unit = glued[2].toLowerCase(); words.shift(); explicit = true; }
      else if (n != null) {
        qty = n; words.shift(); explicit = true;
        if (qty === 1 && words[0] && /^demie?$/.test(norm(words[0]))) { qty = 0.5; words.shift(); }
        if (words[0] && /^(et)$/i.test(words[0]) && /^demi/.test(norm(words[1] || ""))) { qty += 0.5; words.splice(0, 2); }
      }
      const u = words[0] && UNIT_WORDS.find(([rx]) => rx.test(norm(words[0])));
      if (u) { unit = u[1]; words.shift(); }
      if (qty === 0.5 && unit === "" && words[0] && /^(kilo|kg)/.test(norm(words[0]))) { unit = "kg"; words.shift(); }
    }
    // « paquet de pâtes Panzani de 1 kg » : la taille du paquet n'est pas la quantité achetée
    const size = words.join(" ").match(/\s+de\s+(\d+(?:[.,]\d+)?)\s*(g|kg|l|cl|ml)\b/i);
    if (size) words = words.join(" ").replace(size[0], "").split(/\s+/);
    const ART = /^(?:(?:de la|du|des|de|les|la|le)\s+|(?:de l|d|l)['’]\s*)/i;
    let name = words.join(" ").replace(ART, "").replace(ART, "").trim();
    name = name.replace(/\s+(s'il te pla[iî]t|stp)$/i, "").trim();
    if (!name || /^(merci|voila|voilà|c est tout|c'est tout|chez|che|et)$/i.test(name)) { if (price != null && items.length && items[items.length - 1].price == null) items[items.length - 1].price = price; continue; }
    if (unit === "kg" && qty < 30) { /* gardé en kg */ }
    items.push({ name: cap(name), qty, unit, price, explicit });
  }
  return { store, total, items };
}

// Durée de conservation estimée (en jours) d'un produit frais ; null = pas de date utile.
const SHELF = [
  [/poisson|saumon|cabillaud|crevette|moule|fruits de mer|thon frais/, 2], [/hache|steak|viande|poulet|dinde|boeuf|porc|veau|agneau|escalope|saucisse|merguez|cote/, 3],
  [/salade|laitue|epinard|champignon|fraise|framboise|myrtille|herbe|persil|basilic|coriandre/, 4], [/pain|baguette|croissant|brioche/, 3],
  [/jambon|blanc de poulet|charcuterie|saucisson tranche/, 6], [/plat prepare|traiteur|quiche|pizza fraiche|taboule/, 4],
  [/lait (?:frais|entier|demi)|lait$/, 7], [/lait uht|lait longue/, 90], [/creme|mascarpone|ricotta|fromage frais|fromage blanc|philadelphia/, 12],
  [/yaourt|yogourt|skyr|dessert lacte|compote fraiche|joghurt/, 21], [/lardon|bacon|chorizo/, 14], [/fromage|emmental|comte|gruyere|chevre|feta|mozzarella|parmesan|cheddar|reblochon|raclette/, 18],
  [/beurre/, 45], [/oeuf|eier/, 28], [/jus|smoothie/, 6], [/tomate|courgette|poivron|concombre|aubergine|brocoli|haricot vert|poireau|chou/, 7],
  [/banane|peche|abricot|raisin|kiwi|avocat|mangue|melon|pasteque/, 6], [/carotte|betterave|navet|celeri|orange|citron|clementine|mandarine/, 18],
  [/pommes? de terre|patate|oignon|\bail\b|echalote|courge|potiron/, 30], [/pomme|poire/, 21],
];
export function estimateShelfDays(name, categoryId) {
  if (categoryId && categoryId !== "alim") return null;
  const n = norm(name);
  if (/surgel|congel|conserve|boite|bocal|sec|pates|riz|farine|sucre|huile|vinaigre|epice|cafe|the|chocolat|biscuit|cereale|lentille|pois chiche|semoule|uht/.test(n) && !/lait uht/.test(n)) return null;
  if (/pommes? de terre|patate/.test(n)) return 30;
  for (const [rx, d] of SHELF) if (rx.test(n)) return d;
  return null;
}
