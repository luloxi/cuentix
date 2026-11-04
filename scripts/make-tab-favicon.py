"""Favicon de pestaña de Tarask (Ticket 2), variante chica.

Lee public/favicon-tab.v5.svg: recorte apretado, fondo transparente, el dibujo
llena el viewBox. Sin las dos líneas internas (se empastan a 16px) y con el
tilde más grueso. No lo regenera desde el ícono PWA.

Escribe public/icons/favicon-32.v5.png, public/icons/favicon.v5.ico (16/32/48,
los tres tamaños salen del mismo svg, PNG embebido en RGBA para que Next lo
acepte) y src/app/favicon.ico.

No toca los íconos PWA ni apple-touch (scripts/make-tarask-icons.mjs).
Requiere cairosvg y Pillow.
"""
import io
import struct
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SUFFIX = "v5"


def render(svg: str, size: int) -> Image.Image:
    # Rasterize the vectors at the target pixel size. Downsampling a big
    # render softens the 16px tab icon; cairo at 1:1 keeps the strokes crisp.
    png = cairosvg.svg2png(
        bytestring=svg.encode(),
        output_width=size,
        output_height=size,
    )
    image = Image.open(io.BytesIO(png)).convert("RGBA")
    if image.size != (size, size):
        raise SystemExit(f"favicon render is {image.size}, expected {size}x{size}")
    return image


def assert_fills_canvas(image: Image.Image) -> None:
    """Transparent plate, and the artwork spans the cropped viewBox."""
    alpha = image.getchannel("A")
    width, height = image.size
    px = image.load()
    for x, y in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        if px[x, y][3] > 8:
            raise SystemExit(f"favicon corner {x},{y} is not transparent")
    bbox = alpha.point(lambda a: 255 if a > 8 else 0).getbbox()
    if bbox is None:
        raise SystemExit("favicon has no ink")
    x0, y0, x1, y1 = bbox
    span_x = (x1 - x0) / width
    span_y = (y1 - y0) / height
    # Square crop of a taller ticket: height fills the canvas, width stays close.
    if span_y < 0.9 or span_x < 0.75:
        raise SystemExit(
            f"favicon does not fill the canvas (span {span_x:.2f} x {span_y:.2f})"
        )


def assert_ico_rgba_png(path: Path) -> None:
    data = path.read_bytes()
    reserved, kind, count = struct.unpack_from("<HHH", data, 0)
    if reserved != 0 or kind != 1 or count != 3:
        raise SystemExit(f"{path.name}: expected a 3-image ICO, got {reserved},{kind},{count}")
    sizes = []
    offset = 6
    for _ in range(count):
        width, height, _colors, _res, _planes, bpp, size, image_at = struct.unpack_from(
            "<BBBBHHII", data, offset
        )
        offset += 16
        chunk = data[image_at : image_at + size]
        if chunk[:8] != b"\x89PNG\r\n\x1a\n":
            raise SystemExit(f"{path.name}: image {width}x{height} is not a PNG")
        # PNG: 8 signature + 4 length + 4 "IHDR" + 4 width + 4 height + 1 bit depth.
        color_type = chunk[25]
        if color_type != 6 or bpp != 32:
            raise SystemExit(
                f"{path.name}: image {width}x{height} is not RGBA (color type {color_type}, bpp {bpp})"
            )
        sizes.append(width or 256)
    if sizes != [16, 32, 48]:
        raise SystemExit(f"{path.name}: sizes {sizes}, expected 16/32/48")


src = (ROOT / f"public/favicon-tab.{SUFFIX}.svg").read_text()
png32 = render(src, 32)
assert_fills_canvas(png32)
png32.save(ROOT / f"public/icons/favicon-32.{SUFFIX}.png", optimize=True)

frames = {size: render(src, size) for size in (16, 32, 48)}
for out in (
    ROOT / f"public/icons/favicon.{SUFFIX}.ico",
    ROOT / "src/app/favicon.ico",
):
    frames[48].save(
        out,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=[frames[16], frames[32]],
    )
    assert_ico_rgba_png(out)

print("tab favicon written (favicon-32.v5.png, favicon.v5.ico, src/app/favicon.ico)")
