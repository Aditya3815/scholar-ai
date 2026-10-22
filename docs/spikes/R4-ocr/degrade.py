"""Makes scan-like JPEGs from the clean PNGs: a decent scan and a poor one (phone photo of a page / old photocopy)."""
import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(HERE, "scans"), exist_ok=True)
rng = np.random.default_rng(7)

LEVELS = {
    # name: (rotation degrees, blur radius, noise sigma, contrast, scale, jpeg quality, shade)
    "good": (0.8, 0.5, 6, 0.95, 1.0, 80, 0.04),
    "poor": (2.2, 1.1, 16, 0.75, 0.62, 45, 0.18),
}

for f in sorted(os.listdir(os.path.join(HERE, "clean"))):
    if not f.endswith(".png"):
        continue
    base = Image.open(os.path.join(HERE, "clean", f)).convert("L")
    for name, (rot, blur, sigma, contrast, scale, q, shade) in LEVELS.items():
        im = base.rotate(rot, resample=Image.BICUBIC, expand=False, fillcolor=255)
        if scale != 1.0:
            im = im.resize((int(im.width * scale), int(im.height * scale)), Image.BILINEAR)
        im = im.filter(ImageFilter.GaussianBlur(blur))
        a = np.asarray(im, dtype=np.float32)
        a = 255 - (255 - a) * contrast  # lighter ink
        h, w = a.shape
        yy, xx = np.mgrid[0:h, 0:w]
        a = a * (1 - shade * (xx / w) * 0.8 - shade * (yy / h) * 0.4)  # uneven lighting, like a page under a lamp
        a = a + rng.normal(0, sigma, a.shape)
        out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        path = os.path.join(HERE, "scans", f"{f[:-4]}.{name}.jpg")
        out.save(path, quality=q)
        print(path, out.size, os.path.getsize(path) // 1024, "KB")
