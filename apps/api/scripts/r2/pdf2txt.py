import sys, re
from pypdf import PdfReader
src, dst = sys.argv[1], sys.argv[2]
r = PdfReader(src)
pages = []
for i, p in enumerate(r.pages):
    t = p.extract_text() or ""
    t = re.sub(r"-\n(?=[a-z])", "", t)          # de-hyphenate line breaks
    t = re.sub(r"[ \t]+", " ", t)
    pages.append(f"[[page {i+1}]]\n{t.strip()}")
open(dst, "w", encoding="utf-8").write("\n\n".join(pages))
print(f"{src.split(chr(92))[-1]}: {len(r.pages)} pages, {sum(len(p.split()) for p in pages)} words")
