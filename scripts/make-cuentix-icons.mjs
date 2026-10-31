/**
 * Rasterize public/brand/cuentix-icon.svg into the PWA icon set.
 *
 *   node scripts/make-cuentix-icons.mjs
 *
 * sharp is a devDependency (librsvg). Outputs are opaque black, no alpha.
 * The maskable PNG scales the mark so every ink pixel sits inside the
 * inner 66% circle (Android adaptive-icon safe zone) on a full-bleed field.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const masterPath = path.join(root, "public/brand/cuentix-icon.svg");
const iconsDir = path.join(root, "public/icons");
const SIZE = 512;
const SAFE_DIAMETER = 0.66 * SIZE;

async function raster(svg, size, { alpha = false } = {}) {
  let image = sharp(svg, { density: 144 })
    .resize(size, size, { fit: "fill" })
    .flatten({ background: "#000000" });
  // Next.js rejects an app/favicon.ico whose embedded PNGs are RGB.
  // Opaque RGBA (alpha 255) stays visually solid and decodes.
  if (alpha) image = image.ensureAlpha();
  else image = image.removeAlpha();
  return image.png().toBuffer();
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
  const full = await sharp(svg, { density: 144 })
    .resize(SIZE, SIZE, { fit: "fill" })
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
  const scaledBuf = await sharp(svg, { density: 144 })
    .resize(scaled, scaled, { fit: "fill" })
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

function icoFromPngs(images) {
  const count = images.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = header.length;
  const parts = [header];
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header[entry] = image.size >= 256 ? 0 : image.size;
    header[entry + 1] = image.size >= 256 ? 0 : image.size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.buffer.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.buffer.length;
    parts.push(image.buffer);
  });
  return Buffer.concat(parts);
}

const svg = await readFile(masterPath);
await mkdir(iconsDir, { recursive: true });

const icon512 = await raster(svg, 512);
const icon192 = await raster(svg, 192);
const apple = await raster(svg, 180);
const fav32 = await raster(svg, 32);
const fav16 = await raster(svg, 16, { alpha: true });
const fav32Ico = await raster(svg, 32, { alpha: true });
const fav48 = await raster(svg, 48, { alpha: true });
const mask = await maskable(svg);
const ico = icoFromPngs([
  { size: 16, buffer: fav16 },
  { size: 32, buffer: fav32Ico },
  { size: 48, buffer: fav48 },
]);

await writeFile(path.join(iconsDir, "icon-512.png"), icon512);
await writeFile(path.join(iconsDir, "icon-192.png"), icon192);
await writeFile(path.join(iconsDir, "icon-maskable-512.png"), mask);
await writeFile(path.join(iconsDir, "apple-touch-icon-180.png"), apple);
await writeFile(path.join(iconsDir, "favicon-32.png"), fav32);
await writeFile(path.join(iconsDir, "favicon.ico"), ico);
await writeFile(path.join(root, "public/favicon.svg"), svg);
await writeFile(path.join(root, "src/app/favicon.ico"), ico);

console.log("wrote public/icons/* , public/favicon.svg , src/app/favicon.ico");
