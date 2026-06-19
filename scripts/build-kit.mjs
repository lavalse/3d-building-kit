#!/usr/bin/env node
// Asset pipeline: read the Kenney Building Kit zip and produce the web-ready
// asset folder under public/kit/ plus a pieces.json manifest.
//   - public/kit/models/*.glb          (one per piece)
//   - public/kit/models/Textures/*.png (colormap, only if GLBs reference it externally)
//   - public/kit/previews/*.png         (thumbnail per piece, used as palette icons)
//   - public/kit/pieces.json            (manifest: id, name, glb, preview, category, size, center)
//
// `unzip` is not available in this environment, so we read the zip directly with
// node's zlib. Run:  node scripts/build-kit.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ZIP_PATH =
  process.argv[2] || '/mnt/c/Users/laval/Downloads/kenney_building-kit.zip';
const OUT = path.join(ROOT, 'public', 'kit');

// ---------------------------------------------------------------------------
// Minimal zip reader (central-directory based, supports stored + deflate)
// ---------------------------------------------------------------------------
function findCentralDirOffset(buf) {
  const start = Math.max(0, buf.length - 65557);
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.subarray(i, i + 4).equals(sig)) return buf.readUInt32LE(i + 16);
  }
  throw new Error('EOCD not found - not a valid zip');
}

function listEntries(buf) {
  const cdSig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let pos = findCentralDirOffset(buf);
  const entries = [];
  while (pos < buf.length - 22 && buf.subarray(pos, pos + 4).equals(cdSig)) {
    const compression = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const filename = buf.toString('utf-8', pos + 46, pos + 46 + nameLen);
    entries.push({ filename, compression, compSize, localHeaderOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry) {
  const o = entry.localHeaderOffset;
  if (buf.readUInt32LE(o) !== 0x04034b50)
    throw new Error('bad local header for ' + entry.filename);
  const nameLen = buf.readUInt16LE(o + 26);
  const extraLen = buf.readUInt16LE(o + 28);
  const dataOffset = o + 30 + nameLen + extraLen;
  const comp = buf.subarray(dataOffset, dataOffset + entry.compSize);
  if (entry.compression === 0) return comp;
  if (entry.compression === 8) return zlib.inflateRawSync(comp);
  throw new Error('unsupported compression ' + entry.compression);
}

// ---------------------------------------------------------------------------
// GLB parsing → POSITION bounds (size + center)
// ---------------------------------------------------------------------------
function parseGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.length) {
    const size = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + size);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf-8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + size;
  }
  return { json, bin };
}

function boundsOf(json, bin) {
  let min = null;
  let max = null;
  const merge = (mn, mx) => {
    if (!min) {
      min = [...mn];
      max = [...mx];
    } else {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], mn[k]);
        max[k] = Math.max(max[k], mx[k]);
      }
    }
  };
  for (const node of json.nodes || []) {
    if (node.mesh === undefined) continue;
    for (const prim of json.meshes[node.mesh].primitives) {
      const ai = prim.attributes.POSITION;
      if (ai === undefined) continue;
      const acc = json.accessors[ai];
      if (acc.min && acc.max) {
        merge(acc.min, acc.max);
      } else {
        // fallback: scan floats
        const bv = json.bufferViews[acc.bufferView];
        const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
        const stride = bv.byteStride || 12;
        const mn = [Infinity, Infinity, Infinity];
        const mx = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < acc.count; i++) {
          for (let k = 0; k < 3; k++) {
            const v = bin.readFloatLE(base + i * stride + k * 4);
            if (v < mn[k]) mn[k] = v;
            if (v > mx[k]) mx[k] = v;
          }
        }
        merge(mn, mx);
      }
    }
  }
  if (!min) return { size: [0, 0, 0], center: [0, 0, 0] };
  const round = (n) => Math.round(n * 1000) / 1000;
  return {
    size: [round(max[0] - min[0]), round(max[1] - min[1]), round(max[2] - min[2])],
    center: [round((max[0] + min[0]) / 2), round((max[1] + min[1]) / 2), round((max[2] + min[2]) / 2)],
  };
}

// ---------------------------------------------------------------------------
// Categorisation + naming
// ---------------------------------------------------------------------------
function categoryOf(id) {
  if (id.startsWith('wall') || id.startsWith('door')) return 'wall';
  if (id.startsWith('floor')) return 'floor';
  if (id.startsWith('roof')) return 'roof';
  if (id.startsWith('stairs')) return 'stairs';
  return 'structure'; // column, border, plating, gutter, detail, barricade, ...
}

function titleOf(id) {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  if (!fs.existsSync(ZIP_PATH)) {
    console.error('Kit zip not found at: ' + ZIP_PATH);
    console.error('Pass the path as an argument: node scripts/build-kit.mjs <zip>');
    process.exit(1);
  }
  console.log('Reading', ZIP_PATH);
  const buf = fs.readFileSync(ZIP_PATH);
  const entries = listEntries(buf);

  const modelsDir = path.join(OUT, 'models');
  const texDir = path.join(modelsDir, 'Textures');
  const previewsDir = path.join(OUT, 'previews');
  ensureDir(modelsDir);
  ensureDir(previewsDir);

  const glbEntries = entries.filter(
    (e) => e.filename.includes('Models/GLB format/') && e.filename.endsWith('.glb')
  );
  console.log(`Found ${glbEntries.length} GLB pieces`);

  let needsExternalTexture = false;
  const pieces = [];

  for (const e of glbEntries) {
    const id = path.basename(e.filename, '.glb');
    const data = readEntry(buf, e);
    fs.writeFileSync(path.join(modelsDir, id + '.glb'), data);

    const { json, bin } = parseGLB(data);
    const { size, center } = boundsOf(json, bin);
    // texture mode: external uri means we must ship colormap.png alongside
    if ((json.images || []).some((img) => typeof img.uri === 'string')) {
      needsExternalTexture = true;
    }

    pieces.push({
      id,
      name: titleOf(id),
      glb: `/kit/models/${id}.glb`,
      preview: `/kit/previews/${id}.png`,
      category: categoryOf(id),
      size,
      center,
    });
  }

  // Copy the colormap texture if any GLB references it externally.
  if (needsExternalTexture) {
    const tex = entries.find(
      (e) =>
        e.filename.includes('Models/GLB format/') &&
        /\.png$/i.test(e.filename) &&
        /colormap/i.test(e.filename)
    );
    if (tex) {
      ensureDir(texDir);
      fs.writeFileSync(path.join(texDir, 'colormap.png'), readEntry(buf, tex));
      console.log('Copied external colormap.png (GLBs reference it via uri)');
    } else {
      console.warn('WARNING: GLBs use external textures but colormap.png not found in zip!');
    }
  } else {
    console.log('Textures are embedded in GLBs (no external copy needed)');
  }

  // Preview thumbnails: one PNG per piece basename under Previews/
  const previewEntries = entries.filter(
    (e) => e.filename.includes('Previews/') && e.filename.endsWith('.png')
  );
  let previewCount = 0;
  const pieceIds = new Set(pieces.map((p) => p.id));
  for (const e of previewEntries) {
    const id = path.basename(e.filename, '.png');
    if (!pieceIds.has(id)) continue; // skip marketing/sample images
    fs.writeFileSync(path.join(previewsDir, id + '.png'), readEntry(buf, e));
    previewCount++;
  }
  console.log(`Wrote ${previewCount} preview thumbnails`);

  pieces.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(path.join(OUT, 'pieces.json'), JSON.stringify(pieces, null, 2));

  const byCat = pieces.reduce((m, p) => ((m[p.category] = (m[p.category] || 0) + 1), m), {});
  console.log('Manifest written:', path.join(OUT, 'pieces.json'));
  console.log('Pieces by category:', byCat);
}

main();
