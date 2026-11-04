import sharp from 'sharp';
import fs from 'node:fs';

const cases = [];

// 1. CMYK JPEG
try {
  const cmyk = await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 100, g: 150, b: 200 } } })
    .toColourspace('cmyk').jpeg().toBuffer();
  fs.writeFileSync('./uploads/cmyk.jpg', cmyk);
  cases.push({ name: 'CMYK JPEG', buf: cmyk, fmt: 'image/jpeg' });
} catch(e) { console.log('CMYK 跳过:', e.message); }

// 2. 灰度（用 RGB 图转灰度）
const gray = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#888' } })
  .grayscale().png().toBuffer();
fs.writeFileSync('./uploads/gray.png', gray);
const grayMeta = await sharp(gray).metadata();
console.log('灰度 channels:', grayMeta.channels, 'space:', grayMeta.space);
cases.push({ name: 'gray', buf: gray, fmt: 'image/png' });

// 3. RGBA PNG
const rgba = await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 255, g: 165, b: 0, alpha: 0.5 } } })
  .png().toBuffer();
fs.writeFileSync('./uploads/rgba.png', rgba);
cases.push({ name: 'RGBA', buf: rgba, fmt: 'image/png' });

// 4. RGB JPEG
const rgb = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#4a69bd' } })
  .jpeg().toBuffer();
fs.writeFileSync('./uploads/rgb.jpg', rgb);
cases.push({ name: 'RGB', buf: rgb, fmt: 'image/jpeg' });

for (const c of cases) {
  console.log(`\n═══ ${c.name} ═══`);
  const fd = new FormData();
  fd.append('image', new Blob([c.buf], { type: c.fmt }), c.name + '.' + c.fmt.split('/')[1]);
  fd.append('format', 'jpeg');
  fd.append('targetKB', '200');
  fd.append('width', '400');
  fd.append('height', '300');

  const resp = await fetch('http://localhost:3001/api/image/process', { method: 'POST', body: fd });
  if (!resp.ok) {
    const err = await resp.json();
    console.log('  HTTP', resp.status, err.error);
    continue;
  }
  const out = Buffer.from(await resp.arrayBuffer());
  const meta = await sharp(out).metadata();
  const stats = await sharp(out).stats();
  const ch = stats.channels;
  const means = ch.map((c) => c.mean.toFixed(0)).join(',');
  console.log(`  ${out.length}B ${meta.width}x${meta.height} ${meta.space} means=[${means}]`);

  // 黑像素占比
  const raw = await sharp(out).raw().toBuffer();
  const cs = meta.channels || 3;
  let black = 0, total = 0;
  for (let i = 0; i < raw.length; i += cs) {
    total++;
    let isBlack = true;
    for (let j = 0; j < Math.min(3, cs); j++) if (raw[i + j] > 20) { isBlack = false; break; }
    if (isBlack) black++;
  }
  console.log(`  黑像素占比: ${(black/total*100).toFixed(1)}%`);
  fs.writeFileSync('./output/boundary_' + c.name + '.jpg', out);
}

// 再测一遍纯 quality 模式（不传 targetKB）
console.log('\n═══════════════════════════════════════════════');
console.log('再测 quality=80 模式（非 targetKB）');
console.log('═══════════════════════════════════════════════');
for (const c of cases) {
  console.log(`\n── ${c.name} quality=80 ──`);
  const fd = new FormData();
  fd.append('image', new Blob([c.buf], { type: c.fmt }), c.name + '.' + c.fmt.split('/')[1]);
  fd.append('format', 'jpeg');
  fd.append('quality', '80');
  fd.append('width', '400');
  fd.append('height', '300');

  const resp = await fetch('http://localhost:3001/api/image/process', { method: 'POST', body: fd });
  if (!resp.ok) { console.log('  HTTP', resp.status); continue; }
  const out = Buffer.from(await resp.arrayBuffer());
  const meta = await sharp(out).metadata();
  const stats = await sharp(out).stats();
  const ch = stats.channels;
  const means = ch.map((c) => c.mean.toFixed(0)).join(',');
  console.log(`  ${out.length}B ${meta.width}x${meta.height} ${meta.space} means=[${means}]`);
  fs.writeFileSync('./output/quality_' + c.name + '.jpg', out);
}
