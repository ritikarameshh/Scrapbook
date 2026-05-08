#!/usr/bin/env node
// Generate a binary outline PNG from a reference photo using Sobel edge detection.
//
// Usage:
//   npm run gen-outlines
//   npm run gen-outlines -- Assets/HiddenGem.png
//
// Defaults to processing every PNG/JPEG in Assets/ that doesn't already end in
// `.auto.png`. Each input X.png produces X.auto.png (transparent background,
// black edges).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = path.join(ROOT, 'Assets');
const TARGET_W = 480;
const EDGE_THRESHOLD = 60;     // 0..255; raise for cleaner outlines, lower for more detail
const STROKE_DILATE = 1;       // pixels; widens edges so they read on a phone screen

function isInputImage(name) {
  if (name.endsWith('.auto.png')) return false;
  return /\.(png|jpe?g)$/i.test(name);
}

async function listInputs(explicit) {
  if (explicit && explicit.length) {
    return explicit.map(p => path.isAbsolute(p) ? p : path.join(ROOT, p));
  }
  const entries = await fs.readdir(ASSETS_DIR);
  return entries.filter(isInputImage).map(n => path.join(ASSETS_DIR, n));
}

function outPathFor(inputPath) {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath).replace(/\.(png|jpe?g)$/i, '');
  return path.join(dir, `${base}.auto.png`);
}

async function generateOutline(inputPath) {
  const outPath = outPathFor(inputPath);
  const meta = await sharp(inputPath).metadata();
  const aspect = (meta.height || 1) / (meta.width || 1);
  const width = TARGET_W;
  const height = Math.round(width * aspect);

  const gray = await sharp(inputPath)
    .resize(width, height, { fit: 'fill' })
    .grayscale()
    .blur(1)
    .raw()
    .toBuffer();

  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  const edges = Buffer.alloc(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0, k = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const v = gray[(y + ky) * width + (x + kx)];
          gx += v * sobelX[k];
          gy += v * sobelY[k];
          k++;
        }
      }
      const m = Math.min(255, Math.hypot(gx, gy));
      edges[y * width + x] = m > EDGE_THRESHOLD ? 255 : 0;
    }
  }

  // Compose RGBA: black stroke where edge=255, fully transparent elsewhere.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < edges.length; i++) {
    const on = edges[i] === 255;
    rgba[i * 4 + 0] = 0;
    rgba[i * 4 + 1] = 0;
    rgba[i * 4 + 2] = 0;
    rgba[i * 4 + 3] = on ? 255 : 0;
  }

  let pipeline = sharp(rgba, { raw: { width, height, channels: 4 } });
  if (STROKE_DILATE > 0) {
    pipeline = pipeline.convolve({
      width: 3, height: 3,
      kernel: [1, 1, 1, 1, 1, 1, 1, 1, 1],
      scale: 1, offset: 0,
    });
  }

  await pipeline.png().toFile(outPath);
  return outPath;
}

async function main() {
  const args = process.argv.slice(2);
  const inputs = await listInputs(args);

  if (!inputs.length) {
    console.log('No inputs found in Assets/. Drop a PNG/JPEG in Assets/ and re-run.');
    return;
  }

  for (const input of inputs) {
    process.stdout.write(`outline ← ${path.relative(ROOT, input)} … `);
    try {
      const out = await generateOutline(input);
      console.log(`→ ${path.relative(ROOT, out)}`);
    } catch (err) {
      console.log(`failed: ${err.message}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
