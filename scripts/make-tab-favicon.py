"""Favicon de pestaña (escritorio) de Cuentix: logo recortado al máximo, fondo transparente, sin cuadrado negro.
Sale de public/brand/cuentix-icon.v2.svg (la "x" es naranja #e2781b). No toca los íconos PWA/apple-touch (scripts/make-cuentix-icons.mjs).
Escribe public/favicon-tab.v3.svg, public/icons/favicon-32.v3.png, public/icons/favicon.v3.ico y src/app/favicon.ico.
Requiere cairosvg y Pillow."""
import io
import re
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SUFFIX = "v3"


def render(svg, size):
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")


src = (ROOT / "public/brand/cuentix-icon.v2.svg").read_text()
src = re.sub(r'\s*<rect width="512" height="512" fill="#000000"/>', "", src)
x0, y0, x1, y1 = render(src, 512).getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
side, cx, cy = max(x1 - x0, y1 - y0), (x0 + x1) / 2, (y0 + y1) / 2
tab = re.sub(r'viewBox="[^"]*"', f'viewBox="{cx - side / 2:.1f} {cy - side / 2:.1f} {side:.1f} {side:.1f}"', src, count=1)
tab = re.sub(r'(<svg[^>]*?) width="512" height="512"', r'\1 width="32" height="32"', tab, count=1)
(ROOT / f"public/favicon-tab.{SUFFIX}.svg").write_text(tab)
render(tab, 32).save(ROOT / f"public/icons/favicon-32.{SUFFIX}.png", optimize=True)
for out in (ROOT / f"public/icons/favicon.{SUFFIX}.ico", ROOT / "src/app/favicon.ico"):
    render(tab, 48).save(out, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)], append_images=[render(tab, 16), render(tab, 32)])
print("tab favicon written")
