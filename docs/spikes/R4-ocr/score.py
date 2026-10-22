"""CER / WER / number recall of every OCR answer against the text the page was rendered from."""
import json, os, re, unicodedata, sys

HERE = os.path.dirname(os.path.abspath(__file__))
pages = {p["id"]: p for p in json.load(open(os.path.join(HERE, "pages.json"), encoding="utf-8"))}


def norm(s):
    s = unicodedata.normalize("NFC", s)
    s = re.sub(r"[*_`#>]", "", s)  # markdown the model may add
    return re.sub(r"\s+", " ", s).strip()


def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def numbers(s):
    return re.findall(r"\d+(?:[.,]\d+)*", s)


rows = []
for model in sorted(os.listdir(os.path.join(HERE, os.environ.get("RES", "results")))):
    for f in sorted(os.listdir(os.path.join(HERE, os.environ.get("RES", "results"), model))):
        r = json.load(open(os.path.join(HERE, os.environ.get("RES", "results"), model, f), encoding="utf-8"))
        pid, level = f.replace(".json", "").rsplit(".", 1)
        truth = norm(" ".join(pages[pid]["paragraphs"]))
        if not r.get("ok"):
            rows.append((model, pid, level, None, None, None, r.get("neurons"), r.get("ms"), 0))
            continue
        out = norm(r["text"])
        cer = lev(truth, out) / len(truth)
        tw, ow = truth.split(" "), out.split(" ")
        wer = lev(tw, ow) / len(tw)
        tn = numbers(truth)
        on = set(numbers(out))
        nrec = sum(1 for n in tn if n in on) / len(tn)
        rows.append((model, pid, level, cer, wer, nrec, (r.get("usage") or {}).get("neurons"), r["ms"], len(out) / len(truth)))

print(f"{'model':38} {'page':12} {'scan':5} {'CER':>6} {'WER':>6} {'nums':>5} {'neur':>5} {'ms':>6} {'len x':>6}")
for m, p, l, c, w, n, ne, ms, ln in rows:
    print(f"{m[4:42]:38} {p:12} {l:5} " + (f"{c*100:5.1f}% {w*100:5.1f}% {n*100:4.0f}% {ne or 0:5.0f} {ms:6d} {ln:6.2f}" if c is not None else "failed"))

print("\n--- mean by model, language group and scan quality ---")
groups = {}
for m, p, l, c, w, n, ne, ms, ln in rows:
    if c is None:
        continue
    lang = pages[p]["lang"]
    for key in [(m, "all", "all"), (m, lang, l), (m, "all", l)]:
        groups.setdefault(key, []).append((c, w, n, ne, ms))
for (m, lang, l), v in sorted(groups.items()):
    k = len(v)
    print(f"{m[4:42]:38} {lang:6} {l:4} n={k:2}  CER {sum(x[0] for x in v)/k*100:5.1f}%  WER {sum(x[1] for x in v)/k*100:5.1f}%  numbers {sum(x[2] for x in v)/k*100:4.0f}%  {sum(x[3] for x in v)/k:4.0f} neurons  {sum(x[4] for x in v)/k/1000:4.1f} s")
