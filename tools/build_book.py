# Génère public/recipes.js à partir de tools/book.txt (livre de recettes intégré).
import json, re, sys, unicodedata
src = open(sys.argv[1], encoding="utf-8").read().strip()
def norm(s):
    s = s.lower().replace("œ", "oe").replace("’", "'")
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
def slug(s): return "b-" + re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")
ALLERG = {
  "gluten": r"\b(pates|spaghetti|farine|pain|pate brisee|pate a pizza|pate feuilletee|nouilles|semoule|chapelure|tortillas|biscuits|lasagne|gnocchis|macaroni|cannellonis|crozets|spatzle|biere|flocons d'avoine|granola)\b",
  "lait": r"\b(lait|beurre|creme|fromage|mozzarella|parmesan|feta|yaourt|chevre|ricotta|mascarpone|reblochon|cheddar|gorgonzola|comte|raclette)\b",
  "œufs": r"\boeufs?\b",
  "poisson": r"\b(saumon|thon|cabillaud|morue|poisson)\b",
  "crustacés": r"\bcrevettes?\b",
  "mollusques": r"\bmoules?\b",
  "fruits à coque": r"\b(noix)\b",
  "arachide": r"\bcacahuetes?\b",
  "soja": r"\b(soja|tofu|miso)\b",
  "moutarde": r"\bmoutarde\b",
  "sulfites": r"\bvin\b",
}
out, seen = [], set()
for block in re.split(r"\n\s*\n", src):
    lines = [l.rstrip() for l in block.strip().splitlines() if l.strip()]
    title, typ, theme, prep, cook, diff = [x.strip() for x in lines[0].split("|")]
    ings, steps = [], []
    for l in lines[1:]:
        if l.startswith(">"): steps.append(l[1:].strip()); continue
        if not l.startswith("-"): raise SystemExit("ligne inconnue: " + l)
        body = l[1:].strip(); base = body.endswith("*"); body = body.rstrip("*").strip()
        if ":" in body:
            name, rest = body.split(":", 1); parts = rest.strip().split(" ", 1)
            q = float(parts[0].replace(",", ".")); unit = parts[1].strip() if len(parts) > 1 else "pièce"
            ings.append({"name": name.strip(), "qty": q, "unit": unit, **({"base": True} if base else {})})
        else:
            ings.append({"name": body, "qty": None, "unit": "", "base": True})
    rid = slug(title)
    assert rid not in seen, rid; seen.add(rid)
    blob = " ".join(norm(i["name"]) for i in ings if not (norm(i["name"]).startswith("lait de coco")))
    blob_all = " ".join(norm(i["name"]) for i in ings)
    al = [k for k, rx in ALLERG.items() if re.search(rx, blob if k == "lait" else blob_all)]
    out.append({"id": rid, "title": title, "type": typ, "theme": theme, "prepMin": int(prep), "cookMin": int(cook), "difficulty": diff,
                "portions": 2, "ingredients": ings, "steps": steps, "allergens": al, "builtin": True, "kind": "book"})
js = "// Livre de recettes intégré à Plakardo (généré par tools/build_book.py — ne pas modifier à la main).\nexport const BOOK = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n"
open(sys.argv[2], "w", encoding="utf-8").write(js)
from collections import Counter
print(len(out), Counter(r["type"] for r in out), len(js) // 1024, "Ko")
