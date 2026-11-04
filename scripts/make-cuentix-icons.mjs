/**
 * Rasterize public/brand/cuentix-icon.v4.svg into the PWA icon set.
 *
 *   node scripts/make-cuentix-icons.mjs
 *
 * sharp is a devDependency (librsvg). "any" and apple-touch outputs are
 * opaque black, full-bleed, no alpha. The maskable PNG scales the mark so
 * every ink pixel sits inside the inner 66% circle (Android adaptive-icon
 * safe zone) on a full-bleed black field.
 *
 * The tab favicon is a separate tight crop (public/favicon-tab.v4.svg).
 * Rasterize it with scripts/make-tab-favicon.py.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const masterPath = path.join(root, "public/brand/cuentix-icon.v4.svg");
const iconsDir = path.join(root, "public/icons");
const SIZE = 512;
const SAFE_DIAMETER = 0.66 * SIZE;

/** ~4× supersample of the 512-unit master, then Lanczos downsample. */
function densityFor(outSize) {
  return Math.max(72, Math.round(72 * ((outSize * 4) / SIZE)));
}

async function raster(svg, size) {
  // Opaque plate. flatten covers any fringe; removeAlpha drops the channel
  // so installers treat the icon as a solid black tile.
  return sharp(svg, { density: densityFor(size) })
    .resize(size, size, { fit: "fill", kernel: "lanczos3" })
    .flatten({ background: "#000000" })
    .removeAlpha()
    .png()
    .toBuffer();
}

function inkBounds(data, width, height, channels) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (data[i] + data[i + 1] + data[i + 2] > 24) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

function assertInsideSafeCircle(data, width, height, channels) {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const radius = SAFE_DIAMETER / 2;
  let outside = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (data[i] + data[i + 1] + data[i + 2] <= 24) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) outside++;
    }
  }
  if (outside > 0) {
    throw new Error(
      `maskable mark leaves the 66% safe circle (${outside} px)`,
    );
  }
}

async function maskable(svg) {
  const full = await sharp(svg, { density: densityFor(SIZE) })
    .resize(SIZE, SIZE, { fit: "fill", kernel: "lanczos3" })
    .flatten({ background: "#000000" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { minX, minY, maxX, maxY } = inkBounds(
    full.data,
    full.info.width,
    full.info.height,
    full.info.channels,
  );
  const markCx = (minX + maxX) / 2;
  const markCy = (minY + maxY) / 2;
  const halfDiag = Math.hypot((maxX - minX) / 2, (maxY - minY) / 2);
  // 2px slack so antialiased edges stay inside the circle.
  const scale = (SAFE_DIAMETER / 2 - 2) / halfDiag;

  const scaled = Math.round(SIZE * scale);
  const scaledBuf = await sharp(svg, { density: densityFor(scaled) })
    .resize(scaled, scaled, { fit: "fill", kernel: "lanczos3" })
    .flatten({ background: "#000000" })
    .png()
    .toBuffer();
  const left = Math.round(SIZE / 2 - markCx * scale);
  const top = Math.round(SIZE / 2 - markCy * scale);

  const png = await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 3,
      background: "#000000",
    },
  })
    .composite([{ input: scaledBuf, left, top }])
    .flatten({ background: "#000000" })
    .removeAlpha()
    .png()
    .toBuffer();

  const check = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assertInsideSafeCircle(
    check.data,
    check.info.width,
    check.info.height,
    check.info.channels,
  );
  return png;
}

async function assertOpaqueBlackPlate(buf, name, size) {
  const meta = await sharp(buf).metadata();
  if (meta.hasAlpha) throw new Error(`${name} still has an alpha channel`);
  if (meta.width !== size || meta.height !== size) {
    throw new Error(`${name} is ${meta.width}x${meta.height}, expected ${size}`);
  }
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const corners = [
    [0, 0],
    [size - 1, 0],
    [0, size - 1],
    [size - 1, size - 1],
  ];
  for (const [x, y] of corners) {
    const i = (y * size + x) * info.channels;
    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) {
      throw new Error(`${name} corner ${x},${y} is not opaque black`);
    }
  }
}

const svg = await readFile(masterPath);
await mkdir(iconsDir, { recursive: true });

const icon512 = await raster(svg, 512);
const icon192 = await raster(svg, 192);
const apple = await raster(svg, 180);
const mask = await maskable(svg);

await assertOpaqueBlackPlate(icon512, "icon-512.v4.png", 512);
await assertOpaqueBlackPlate(icon192, "icon-192.v4.png", 192);
await assertOpaqueBlackPlate(apple, "apple-touch-icon-180.v4.png", 180);
await assertOpaqueBlackPlate(mask, "icon-maskable-512.v4.png", 512);

await writeFile(path.join(iconsDir, "icon-512.v4.png"), icon512);
await writeFile(path.join(iconsDir, "icon-192.v4.png"), icon192);
await writeFile(path.join(iconsDir, "icon-maskable-512.v4.png"), mask);
await writeFile(path.join(iconsDir, "apple-touch-icon-180.v4.png"), apple);

console.log(
  "wrote public/icons/icon-{192,512,maskable-512}.v4.png and apple-touch-icon-180.v4.png (opaque black). Tab favicon: scripts/make-tab-favicon.py",
);
