// Décodage des contenus de codes : EAN classiques et codes carrés de médicaments.

const GS = "\x1d";
const RS = "\x1e";

const lastDay = (y, m) => new Date(y, m, 0).getDate();
function yymmdd(s) {
  if (!/^\d{6}$/.test(s || "")) return null;
  const y = 2000 + Number(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  let d = Number(s.slice(4, 6));
  if (m < 1 || m > 12) return null;
  if (d === 0) d = lastDay(y, m); // « 00 » = fin du mois
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// GS1 (médicaments français, et beaucoup d'autres) : (01) GTIN, (17) péremption, (10) lot, (21) série
function parseGS1(raw) {
  let s = raw.replace(/^\]d2|^\]C1|^\]Q3/, "");
  if (s.startsWith(GS)) s = s.slice(1);
  const out = {};
  const fixed = { "01": 14, "02": 14, "11": 6, "13": 6, "15": 6, "17": 6, "20": 2 };
  let guard = 0;
  while (s.length && guard++ < 20) {
    if (s.startsWith(GS)) { s = s.slice(1); continue; }
    const ai2 = s.slice(0, 2);
    if (fixed[ai2]) {
      out[ai2] = s.slice(2, 2 + fixed[ai2]);
      s = s.slice(2 + fixed[ai2]);
      continue;
    }
    let aiLen = 2;
    if (/^(7\d\d|24\d|25\d|30|37)/.test(s)) aiLen = s.startsWith("30") || s.startsWith("37") ? 2 : 3;
    else if (!/^(10|21|22|90|91|92|93|94|95|96|97|98|99)/.test(s)) break;
    const ai = s.slice(0, aiLen);
    const end = s.indexOf(GS, aiLen);
    out[ai] = end === -1 ? s.slice(aiLen) : s.slice(aiLen, end);
    s = end === -1 ? "" : s.slice(end + 1);
  }
  return out;
}

// Format IFA (médicaments allemands, securPharm) : 9N = PPN (contient le PZN), D = péremption, 1T = lot
function parseIFA(raw) {
  const out = {};
  raw.split(new RegExp(`[${GS}${RS}\x04]`)).forEach((f) => {
    if (f.startsWith("9N")) out.ppn = f.slice(2);
    else if (f.startsWith("1T")) out.lot = f.slice(2);
    else if (f.startsWith("D") && /^D\d{6}$/.test(f)) out.expiry = f.slice(1);
    else if (f.startsWith("8P")) out.gtin = f.slice(2);
  });
  return out;
}

// Renvoie { key, kind: "ean" | "drug", ean?, expiry?, lot?, label }
export function decode(format, raw) {
  const text = String(raw || "");
  if (format !== "data_matrix" && /^\d{8,14}$/.test(text)) {
    const ean = text.length === 12 ? "0" + text : text; // UPC-A → EAN-13
    return { key: ean, kind: "ean", ean, label: ean };
  }
  if (text.includes("[)>") || /(^|[\x1d\x1e])9N\d/.test(text)) {
    const r = parseIFA(text);
    const pzn = r.ppn && r.ppn.length >= 10 ? r.ppn.slice(2, 10) : null;
    return { key: pzn ? `pzn:${pzn}` : `ifa:${r.ppn || text}`, kind: "drug", expiry: yymmdd(r.expiry), lot: r.lot || null, label: pzn ? `PZN ${pzn}` : "Médicament" };
  }
  if (/^(\]d2)?\x1d?01\d{14}/.test(text) || /^(\]d2)?\x1d?01/.test(text)) {
    const r = parseGS1(text);
    const gtin = r["01"];
    let key = gtin ? `gtin:${gtin}` : `dm:${text}`;
    let label = gtin ? `GTIN ${gtin}` : "Code carré";
    if (gtin && gtin.startsWith("03400")) { key = `cip:${gtin.slice(1)}`; label = `CIP ${gtin.slice(1)}`; }
    else if (gtin && gtin.startsWith("04150")) { key = `pzn:${gtin.slice(5, 13)}`; label = `PZN ${gtin.slice(5, 13)}`; }
    return { key, kind: "drug", expiry: yymmdd(r["17"]), lot: r["10"] || null, label };
  }
  if (/^\d{8,14}$/.test(text)) return { key: text, kind: "ean", ean: text, label: text };
  return { key: `raw:${text.slice(0, 80)}`, kind: "other", label: "Code" };
}

// Open Food Facts : une seule requête interroge aliments, nourriture animale, cosmétiques et autres produits.
const TYPE_TO_CAT = { food: "alim", petfood: "chat", beauty: "hyg", product: "hyg" };
export async function lookupOFF(ean) {
  const fields = "product_name,product_name_fr,product_name_de,generic_name_fr,generic_name,brands,quantity,product_type";
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?product_type=all&fields=${fields}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const p = data && data.product;
    if (!p || data.status === 0) return null;
    const name = (p.product_name_fr || p.product_name_de || p.product_name || p.generic_name_fr || p.generic_name || "").trim();
    if (!name) return null;
    const brand = (p.brands || "").split(",")[0].trim();
    const detail = [brand, (p.quantity || "").trim()].filter(Boolean).join(" · ");
    const categoryId = TYPE_TO_CAT[p.product_type] || "alim";
    return { name, detail, categoryId, unit: categoryId === "chat" ? "boîte" : "pièce" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
