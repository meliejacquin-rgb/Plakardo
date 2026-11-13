// Scanner : caméra, lecture des codes, fiche d'ajout / retrait.
import { decode, lookupOFF, parseDateText } from "./codes.js";

const LIB = "https://fastly.jsdelivr.net/npm/barcode-detector@3/dist/es/ponyfill.min.js";
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "data_matrix"];

let ctx = null;          // { store, getProducts, me, cats, units, plural, onClose }
let layer, video, uiBox;
let stream = null;
let detector = null;
let open = false;
let loopTimer = null;
const s = {
  mode: "add",           // add | remove
  stage: "idle",         // idle | starting | scanning | loading | sheet | error
  error: "",
  cur: null,             // { info, product?, source }
  form: null,
  formError: "",
  status: "",
  lastKey: "",
  lastAt: 0,
  batch: [],             // rafale : [{ key, info, at, qty, product, name, detail, categoryId, unit, expiry, source }]
  batchError: "",
};
let statusTimer = null;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromToday = ({ days = 0, months = 0, years = 0 }) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setFullYear(d.getFullYear() + years, d.getMonth() + months, d.getDate() + days); return iso(d); };
const frDate = (v) => { const [y, m, d] = v.split("-"); return `${d}/${m}/${y}`; };
const parseQ = (v) => { const n = Number(String(v ?? "").replace(",", ".").trim()); return Number.isFinite(n) ? Math.max(0, Math.round(n * 1000) / 1000) : 0; };
const fmtQ = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000).replace(".", ",");
const qtyOf = (p) => parseQ(p?.quantity);
const ICON = {
  close: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  minus: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  plus: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
};

export function initScanner(c) {
  ctx = c;
  layer = document.createElement("div");
  layer.className = "scan-layer";
  layer.hidden = true;
  layer.innerHTML = `<video playsinline muted autoplay></video><div class="scan-ui"></div>`;
  document.body.appendChild(layer);
  video = layer.querySelector("video");
  uiBox = layer.querySelector(".scan-ui");
  uiBox.addEventListener("click", onClick);
  uiBox.addEventListener("input", onInput);
}

export async function openScanner() {
  if (open) return;
  open = true;
  layer.hidden = false;
  document.body.classList.add("scanning");
  s.stage = "starting";
  s.cur = null; s.form = null; s.error = "";
  render();
  try {
    if (!detector) {
      const mod = await import(LIB);
      detector = new mod.BarcodeDetector({ formats: FORMATS });
    }
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no-camera"), { name: "NotSupported" });
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    if (!open) { stopStream(); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    s.stage = "scanning";
    render();
    loop();
  } catch (e) {
    console.error(e);
    s.stage = "error";
    s.error = e?.name === "NotAllowedError"
      ? "L’accès à la caméra a été refusé. Touchez « Réessayer » et acceptez. Si rien ne s’affiche : Réglages de l’iPhone › Safari › Caméra › Autoriser."
      : e?.name === "NotSupported"
        ? "Cet appareil ne donne pas accès à la caméra ici."
        : "Le lecteur de codes n’a pas pu démarrer. Vérifiez la connexion internet et réessayez.";
    render();
  }
}

export function closeScanner() {
  if (!open) return;
  open = false;
  clearTimeout(loopTimer);
  stopStream();
  layer.hidden = true;
  document.body.classList.remove("scanning");
  s.stage = "idle";
}

export function refreshScanner() {
  if (open && s.stage === "sheet" && s.cur?.product) {
    const fresh = ctx.getProducts().find((p) => p.id === s.cur.product.id);
    if (fresh) { s.cur.product = fresh; render(); }
  }
}

function stopStream() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) video.srcObject = null;
}

function loop() {
  clearTimeout(loopTimer);
  if (!open || s.stage !== "scanning") return;
  loopTimer = setTimeout(async () => {
    if (!open || s.stage !== "scanning") return;
    try {
      if (video.readyState >= 2) {
        const found = await detector.detect(video);
        const hit = found && found.find((b) => b.rawValue);
        if (hit && s.stage === "scanning") {
          const info = decode(hit.format, hit.rawValue);
          if (info.kind !== "other" && s.mode === "batch") { batchAdd(info); }
          else {
            const fresh = !(info.key === s.lastKey && Date.now() - s.lastAt < 3000);
            if (fresh && info.kind !== "other") { await handle(info); return; }
          }
        }
      }
    } catch (e) { console.warn(e); }
    loop();
  }, 180);
}

async function resolveTemplate(info) {
  let template = await ctx.store.getBarcode(info.key);
  let source = template ? "memory" : "";
  if (!template && info.kind === "ean") {
    template = await lookupOFF(info.ean);
    if (template) source = "off";
  }
  if (!template) {
    source = "unknown";
    template = info.kind === "drug"
      ? { name: "", detail: "", categoryId: "pharma", unit: "boîte" }
      : { name: "", detail: "", categoryId: "alim", unit: "pièce" };
  }
  return { template, source };
}

function flash(text) {
  s.status = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { s.status = ""; if (open) render(); }, 2000);
}

async function batchAdd(info) {
  const now = Date.now();
  const found = s.batch.find((b) => b.key === info.key);
  if (found) {
    if (now - found.at < 1800) return;
    found.at = now;
    found.qty = parseQ(found.qty) + 1;
    flash(`${found.name || "Produit"} ×${fmtQ(found.qty)}`);
    try { navigator.vibrate && navigator.vibrate(20); } catch {}
    render();
    return;
  }
  const product = ctx.getProducts().find((p) => p.barcode === info.key) || null;
  const entry = {
    key: info.key, info, at: now, qty: 1, product,
    name: product ? product.name : "", detail: product ? product.detail || "" : "",
    categoryId: product ? product.categoryId : info.kind === "drug" ? "pharma" : "alim",
    unit: product ? product.unit : info.kind === "drug" ? "boîte" : "pièce",
    expiry: info.expiry || "", source: product ? "stock" : "loading",
  };
  s.batch.unshift(entry);
  try { navigator.vibrate && navigator.vibrate(20); } catch {}
  flash(product ? `${product.name} +1` : "Code lu, recherche…");
  render();
  if (!product) {
    const { template, source } = await resolveTemplate(info);
    Object.assign(entry, { name: entry.name || template.name || "", detail: template.detail || "", categoryId: template.categoryId, unit: template.unit, source });
    if (open) render();
  }
}

async function batchSave() {
  const missing = s.batch.filter((b) => !b.product && !(b.name || "").trim());
  if (missing.length) { s.batchError = "Donnez un nom aux produits inconnus (en rouge) avant de ranger."; render(); return; }
  const by = ctx.me();
  let n = 0;
  for (const b of s.batch) {
    const q = parseQ(b.qty);
    if (!q) continue;
    n += 1;
    const fresh = b.product ? ctx.getProducts().find((p) => p.id === b.product.id) : null;
    if (fresh) {
      ctx.store.changeQty(fresh.id, q, by);
      if (b.expiry && (!fresh.expiry || b.expiry < fresh.expiry)) ctx.store.updateProduct(fresh.id, { expiry: b.expiry });
      continue;
    }
    const name = b.name.trim();
    const data = { name, detail: (b.detail || "").trim(), categoryId: b.categoryId, unit: b.unit };
    const twin = ctx.getProducts().find((p) => p.categoryId === data.categoryId && p.name.toLowerCase() === name.toLowerCase());
    if (twin) {
      ctx.store.updateProduct(twin.id, { barcode: b.key });
      ctx.store.changeQty(twin.id, q, by);
    } else {
      await ctx.store.addProduct({ ...data, quantity: q, expiry: b.expiry || null, minQuantity: 1, lowAlert: true, barcode: b.key, updatedBy: by });
    }
    ctx.store.saveBarcode(b.key, data);
  }
  s.batch = [];
  s.batchError = "";
  flash(`${n} produit${n > 1 ? "s" : ""} rangé${n > 1 ? "s" : ""}`);
  render();
}

async function handle(info) {
  s.stage = "loading";
  s.formError = "";
  render();
  const products = ctx.getProducts();
  const product = products.find((p) => p.barcode === info.key);
  if (product) {
    s.cur = { info, product, source: "stock" };
    s.form = { quantity: 1, expiry: info.expiry || "" };
  } else {
    const { template, source } = await resolveTemplate(info);
    s.cur = { info, product: null, source };
    s.form = {
      name: template.name || "",
      detail: template.detail || "",
      categoryId: template.categoryId || "alim",
      unit: template.unit || "pièce",
      quantity: 1,
      expiry: info.expiry || "",
      minQuantity: 1,
    };
  }
  s.stage = "sheet";
  try { navigator.vibrate && navigator.vibrate(30); } catch {}
  render();
}

function resume(statusText) {
  if (s.cur) { s.lastKey = s.cur.info.key; s.lastAt = Date.now(); }
  s.cur = null; s.form = null; s.formError = "";
  if (statusText) {
    s.status = statusText;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { s.status = ""; if (open) render(); }, 2500);
  }
  s.stage = "scanning";
  render();
  loop();
}

async function confirm() {
  const { cur, form } = s;
  if (!cur || !form) return;
  const by = ctx.me();
  const q = parseQ(form.quantity) || 1;
  if (cur.product) {
    const p = cur.product;
    if (s.mode === "remove") {
      const d = -Math.min(q, qtyOf(p));
      if (d) ctx.store.changeQty(p.id, d, by);
      resume(`${p.name} −${-d || 0}`);
    } else {
      ctx.store.changeQty(p.id, q, by);
      if (form.expiry && (!p.expiry || form.expiry < p.expiry)) ctx.store.updateProduct(p.id, { expiry: form.expiry });
      resume(`${p.name} +${q}`);
    }
    return;
  }
  // Nouveau produit
  const name = (form.name || "").trim();
  if (!name) { s.formError = "Donnez un nom au produit (une seule fois, il sera mémorisé)."; render(); return; }
  const data = { name, detail: (form.detail || "").trim(), categoryId: form.categoryId, unit: form.unit };
  const twin = ctx.getProducts().find((p) => p.categoryId === data.categoryId && p.name.toLowerCase() === name.toLowerCase());
  if (twin) {
    ctx.store.updateProduct(twin.id, { barcode: cur.info.key, ...(form.expiry && (!twin.expiry || form.expiry < twin.expiry) ? { expiry: form.expiry } : {}) });
    ctx.store.changeQty(twin.id, q, by);
  } else {
    await ctx.store.addProduct({ ...data, quantity: q, expiry: form.expiry || null, minQuantity: parseQ(form.minQuantity), barcode: cur.info.key, updatedBy: by });
  }
  ctx.store.saveBarcode(cur.info.key, data);
  resume(`${name} +${q} · mémorisé`);
}

function onClick(e) {
  const t = e.target.closest("[data-s]");
  if (!t) return;
  const { s: act, v, f } = t.dataset;
  switch (act) {
    case "close": ctx.onClose(); break;
    case "mode":
      s.mode = v;
      if (s.stage === "sheet" && (v === "batch")) { s.cur = null; s.form = null; s.stage = "scanning"; loop(); }
      render();
      break;
    case "bstep": { const b = s.batch[Number(t.dataset.i)]; if (b) { b.qty = Math.max(0, parseQ(b.qty) + Number(v)); render(); } break; }
    case "bdel": s.batch.splice(Number(t.dataset.i), 1); render(); break;
    case "bcat": { const b = s.batch[Number(t.dataset.i)]; if (b) { const ids = ctx.cats.map((c) => c.id); b.categoryId = ids[(ids.indexOf(b.categoryId) + 1) % ids.length]; render(); } break; }
    case "bsave": batchSave(); break;
    case "cart": {
      const p = s.cur?.product;
      if (p) ctx.store.setShopping(`p_${p.id}`, { productId: p.id, forced: true, checked: false });
      else ctx.store.addShopping({ label: (s.form?.name || "").trim() || "Produit scanné", qty: 1, checked: false });
      resume("Ajouté à la liste de courses");
      break;
    }
    case "retry": closeScanner(); openScanner(); break;
    case "manual": ctx.onClose("#/ajout"); break;
    case "cancel": resume(); break;
    case "confirm": confirm(); break;
    case "to-add": s.mode = "add"; handle(s.cur.info); break;
    case "set": if (s.form) { s.form[f] = v; if (f === "expiry") s.form.expiryText = v ? frDate(v) : ""; render(); } break;
    case "step": if (s.form) {
      const n = Math.max(f === "minQuantity" ? 0 : 1, parseQ(s.form[f]) + Number(v));
      s.form[f] = n;
      const el = uiBox.querySelector(`#sc-${f}`);
      if (el) el.value = fmtQ(n);
      updateCta();
    } break;
  }
}

function onInput(e) {
  const t = e.target;
  if ("sdate" in t.dataset && s.form) {
    s.form.expiryText = t.value;
    const iso = parseDateText(t.value);
    const res = uiBox.querySelector("#sc-date-res");
    if (!t.value.trim()) { s.form.expiry = ""; if (res) { res.textContent = "—"; res.style.color = ""; } }
    else if (iso) { s.form.expiry = iso; if (res) { res.textContent = frDate(iso); res.style.color = ""; } }
    else if (res) { res.textContent = "Date non reconnue"; res.style.color = "var(--warn)"; }
    return;
  }
  if ("bname" in t.dataset) { const b = s.batch[Number(t.dataset.i)]; if (b) b.name = t.value; return; }
  if ("bqty" in t.dataset) { const b = s.batch[Number(t.dataset.i)]; if (b) b.qty = t.value; return; }
  if (t.dataset.sf && s.form) {
    s.form[t.dataset.sf] = t.value;
    if (t.type === "date") render();
    else if (t.dataset.sf === "quantity") updateCta();
  }
}

function ctaLabel() {
  const { cur, form } = s;
  if (!cur || !form) return "";
  const q = parseQ(form.quantity) || 1;
  if (!cur.product) return "Ajouter au placard";
  const p = cur.product;
  const unit = (n) => (n > 1 ? (ctx.plural[p.unit] || p.unit) : p.unit) || "";
  if (s.mode === "remove") { const n = Math.min(q, qtyOf(p)); return `Retirer ${fmtQ(n)} ${unit(n)}`; }
  return `Ajouter ${fmtQ(q)} ${unit(q)}`;
}
function updateCta() {
  const b = uiBox.querySelector('[data-s="confirm"]');
  if (b) b.textContent = ctaLabel();
}

// ───────────────────────── Affichage ─────────────────────────
function stepperHtml(field, value, label) {
  return `<div class="sc-step">
    <button type="button" data-s="step" data-f="${field}" data-v="-1" aria-label="${label} moins">${ICON.minus}</button>
    <label class="sr" for="sc-${field}">${label}</label>
    <input id="sc-${field}" class="qinput" type="text" inputmode="decimal" autocomplete="off" data-sf="${field}" value="${fmtQ(value)}">
    <button type="button" class="on" data-s="step" data-f="${field}" data-v="1" aria-label="${label} plus">${ICON.plus}</button>
  </div>`;
}

function dateHtml(form, keepLabel) {
  const opts = [["", keepLabel], [fromToday({ days: 7 }), "+1 sem."], [fromToday({ months: 1 }), "+1 mois"], [fromToday({ years: 1 }), "+1 an"]];
  const preset = opts.some(([v]) => v === form.expiry);
  return `<div class="sc-field">
    <div class="sc-row"><span class="sc-label">Date (DLC / péremption)</span><strong class="sc-date" id="sc-date-res">${form.expiry ? frDate(form.expiry) : keepLabel}</strong></div>
    <div class="sc-chips">${opts.map(([v, l]) => `<button type="button" class="chip sm" data-s="set" data-f="expiry" data-v="${v}" aria-pressed="${form.expiry === v || (!preset && !v && !form.expiry)}">${l}</button>`).join("")}</div>
    <label class="sr" for="sc-date">Saisir ou scanner la date</label>
    <input id="sc-date" class="input" type="text" inputmode="numeric" autocomplete="off" data-sdate placeholder="JJ/MM/AA — ou « Scanner du texte »" value="${esc(form.expiryText ?? (form.expiry ? frDate(form.expiry) : ""))}">
  </div>`;
}

function sheetHtml() {
  if (s.stage === "loading") {
    return `<div class="sc-sheet"><div class="sc-handle"></div><p class="sc-loading">Recherche du produit…</p></div>`;
  }
  const { cur, form } = s;
  const info = cur.info;
  const unitOf = (p, n) => (n > 1 ? (ctx.plural[p.unit] || p.unit) : p.unit) || "";
  if (s.mode === "find") {
    const p = cur.product;
    if (p) {
      const stock = qtyOf(p);
      const cat = ctx.cats.find((c) => c.id === p.categoryId);
      return `<div class="sc-sheet"><div class="sc-handle"></div>
        <div class="sc-head"><span class="cat-ico c-${p.categoryId}">${ctx.catIcon(p.categoryId)}</span>
          <div class="sc-title"><span class="sub">${cat ? cat.name : ""}</span><strong>${esc(p.name)}</strong></div></div>
        <p class="sc-stock ${stock === 0 ? "none" : ""}">${stock === 0 ? "Plus rien à la maison" : `Il en reste ${fmtQ(stock)} ${esc((stock > 1 ? ctx.plural[p.unit] : p.unit) || "")} à la maison`}</p>
        ${p.expiry ? `<p class="sc-note">Date la plus proche : ${frDate(p.expiry)}</p>` : ""}
        <button class="cta" data-s="cart">Ajouter à la liste de courses</button>
        <button class="link-btn" data-s="cancel">Scanner autre chose</button>
      </div>`;
    }
    return `<div class="sc-sheet"><div class="sc-handle"></div>
      <p class="sc-big">${form.name ? esc(form.name) : "Produit inconnu"}</p>
      <p class="sc-stock none">Pas dans vos placards</p>
      <button class="cta" data-s="cart">Ajouter à la liste de courses</button>
      <button class="link-btn" data-s="cancel">Scanner autre chose</button>
    </div>`;
  }
  if (cur.product) {
    const p = cur.product;
    const stock = qtyOf(p);
    const cat = ctx.cats.find((c) => c.id === p.categoryId);
    const removing = s.mode === "remove";
    const q = parseQ(form.quantity) || 1;
    return `<div class="sc-sheet"><div class="sc-handle"></div>
      <div class="sc-head">
        <span class="cat-ico c-${p.categoryId}">${ctx.catIcon(p.categoryId)}</span>
        <div class="sc-title"><span class="sc-ok">${ICON.check} Dans vos placards</span>
          <strong>${esc(p.name)}</strong>
          <span class="sub">${cat ? cat.name : ""}${p.detail ? " · " + esc(p.detail) : ""} · ${fmtQ(stock)} en stock</span></div>
      </div>
      <div class="sc-row"><span class="sc-label">${removing ? "Combien en retirer ?" : "Combien en ajouter ?"}</span>${stepperHtml("quantity", q, "Quantité")}</div>
      ${removing ? (stock === 0 ? `<p class="sc-note">Ce produit est déjà à 0.</p>` : "") : dateHtml(form, "Inchangée")}
      ${info.lot ? `<p class="sc-note">Lot ${esc(info.lot)}${info.expiry ? " · date lue sur le code carré" : ""}</p>` : ""}
      <button class="cta ${removing ? "danger" : ""}" data-s="confirm" ${removing && stock === 0 ? "disabled" : ""}>${esc(ctaLabel())}</button>
      <button class="link-btn" data-s="cancel">Scanner autre chose</button>
    </div>`;
  }
  if (s.mode === "remove") {
    return `<div class="sc-sheet"><div class="sc-handle"></div>
      <p class="sc-big">Ce produit n’est pas dans vos placards.</p>
      <p class="sc-note">${esc(info.label)}</p>
      <button class="cta" data-s="to-add">L’ajouter</button>
      <button class="link-btn" data-s="cancel">Scanner autre chose</button>
    </div>`;
  }
  const srcNote = {
    off: `${ICON.check} Trouvé sur Open Food Facts : vérifiez le nom`,
    memory: `${ICON.check} Produit déjà scanné, reconnu`,
    unknown: info.kind === "drug"
      ? "Médicament : donnez-lui un nom, il sera reconnu la prochaine fois"
      : "Produit inconnu : donnez-lui un nom, il sera reconnu la prochaine fois",
  }[cur.source];
  return `<div class="sc-sheet"><div class="sc-handle"></div>
    <p class="sc-src ${cur.source === "unknown" ? "unknown" : ""}">${srcNote}</p>
    <div class="sc-field"><label class="sc-label" for="sc-name">Nom du produit</label>
      <input id="sc-name" class="input" data-sf="name" value="${esc(form.name)}" placeholder="Ex. : pâtée saumon" autocomplete="off"></div>
    <div class="sc-field"><label class="sc-label" for="sc-detail">Précision <span class="sub">(facultatif)</span></label>
      <input id="sc-detail" class="input" data-sf="detail" value="${esc(form.detail)}" placeholder="Marque, contenance…" autocomplete="off"></div>
    <div class="sc-field"><span class="sc-label">Placard</span>
      <div class="cat-pick">${ctx.cats.map((c) => `<button type="button" data-s="set" data-f="categoryId" data-v="${c.id}" aria-pressed="${form.categoryId === c.id}">${c.name}</button>`).join("")}</div></div>
    <div class="sc-row"><span class="sc-label">Quantité</span>${stepperHtml("quantity", form.quantity, "Quantité")}</div>
    <div class="sc-chips">${ctx.units.map((u) => `<button type="button" class="chip sm" data-s="set" data-f="unit" data-v="${u}" aria-pressed="${form.unit === u}">${u}</button>`).join("")}</div>
    ${dateHtml(form, "Sans date")}
    ${s.formError ? `<p class="err" role="alert">${esc(s.formError)}</p>` : ""}
    <button class="cta" data-s="confirm">Ajouter au placard</button>
    <button class="link-btn" data-s="cancel">Annuler</button>
  </div>`;
}

function batchHtml() {
  const total = s.batch.reduce((n, b) => n + (parseQ(b.qty) ? 1 : 0), 0);
  const rows = s.batch.map((b, i) => {
    const cat = ctx.cats.find((c) => c.id === b.categoryId);
    const unknown = !b.product && !(b.name || "").trim() && b.source !== "loading";
    const nameCell = b.product
      ? `<span class="t">${esc(b.name)}</span><span class="s">${cat ? cat.name : ""} · déjà ${fmtQ(qtyOf(b.product))} en stock</span>`
      : b.source === "loading"
        ? `<span class="t">Recherche…</span><span class="s">${esc(b.info.label)}</span>`
        : `<input class="input sm${unknown ? " bad" : ""}" data-bname data-i="${i}" value="${esc(b.name)}" placeholder="Nom du produit" autocomplete="off">
           <button type="button" class="sc-cat" data-s="bcat" data-i="${i}">${cat ? cat.name : "Placard"} ▾</button>`;
    return `<div class="sc-brow">
      <div class="grow">${nameCell}</div>
      <div class="sc-bq">
        <button type="button" data-s="bstep" data-i="${i}" data-v="-1" aria-label="Moins">−</button>
        <input class="qinput sm" type="text" inputmode="decimal" data-bqty data-i="${i}" value="${fmtQ(b.qty)}" aria-label="Quantité">
        <button type="button" data-s="bstep" data-i="${i}" data-v="1" aria-label="Plus">+</button>
      </div>
      <button type="button" class="sc-x" data-s="bdel" data-i="${i}" aria-label="Retirer de la liste">×</button>
    </div>`;
  }).join("");
  return `<div class="sc-sheet sc-batch"><div class="sc-handle"></div>
    <div class="sc-row"><strong class="sc-big" style="margin:0">Rafale · ${s.batch.length}</strong><span class="sc-note">Scannez tout, rangez à la fin</span></div>
    ${s.status ? `<span class="sc-status sm">${ICON.check} ${esc(s.status)}</span>` : ""}
    ${rows || `<p class="sc-note">Visez chaque produit l’un après l’autre. Un même produit scanné deux fois compte 2.</p>`}
    ${s.batchError ? `<p class="err" role="alert">${esc(s.batchError)}</p>` : ""}
    <button class="cta" data-s="bsave" ${total ? "" : "disabled"}>Tout ranger${total ? ` · ${total} produit${total > 1 ? "s" : ""}` : ""}</button>
  </div>`;
}

function render() {
  if (!uiBox) return;
  const seg = (v, l) => `<button data-s="mode" data-v="${v}" aria-pressed="${s.mode === v}">${l}</button>`;
  let body = "";
  if (s.stage === "error") {
    body = `<div class="sc-sheet"><div class="sc-handle"></div><p class="sc-big">Caméra indisponible</p><p class="sc-note">${esc(s.error)}</p>
      <button class="cta" data-s="retry">Réessayer</button><button class="link-btn" data-s="manual">Ajouter à la main</button></div>`;
  } else if (s.mode === "batch" && s.stage !== "starting") {
    body = `<div class="sc-frame small" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>${batchHtml()}`;
  } else if (s.stage === "sheet" || s.stage === "loading") {
    body = sheetHtml();
  } else {
    body = `<div class="sc-frame" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
      <p class="sc-hint">${s.stage === "starting" ? "Ouverture de la caméra…" : ({ add: "Visez le code-barres ou le code carré du produit à ranger", remove: "Visez le code du produit utilisé", find: "Visez un produit pour savoir combien il en reste à la maison" })[s.mode] || ""}</p>
      <div class="sc-bottom">${s.status ? `<span class="sc-status">${ICON.check} ${esc(s.status)}</span>` : ""}
        <button class="sc-manual" data-s="manual">Saisir à la main</button></div>`;
  }
  const prevSheet = uiBox.querySelector(".sc-sheet");
  const keep = prevSheet ? prevSheet.scrollTop : 0;
  const act = document.activeElement;
  const focusSel = act && uiBox.contains(act) && act.matches("input")
    ? (act.id ? `#${act.id}` : act.dataset.i != null ? `input[data-${"bname" in act.dataset ? "bname" : "bqty"}][data-i="${act.dataset.i}"]` : null)
    : null;
  const caret = focusSel && "selectionStart" in act ? act.selectionStart : null;
  uiBox.innerHTML = `<div class="sc-top">
      <button class="sc-round" data-s="close" aria-label="Fermer le scanner">${ICON.close}</button>
      <div class="sc-seg" role="group" aria-label="Mode">${seg("add", "Ajouter")}${seg("remove", "Retirer")}${seg("batch", "Rafale")}${seg("find", "Chercher")}</div>
    </div>${body}`;
  const sheet = uiBox.querySelector(".sc-sheet");
  if (sheet && keep) sheet.scrollTop = keep;
  if (focusSel) {
    const el = uiBox.querySelector(focusSel);
    if (el) { el.focus({ preventScroll: true }); try { if (caret != null) el.setSelectionRange(caret, caret); } catch {} }
  }
}
