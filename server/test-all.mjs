// 综合回归测试
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = 'http://localhost:3001/api/image/process';

const passed = [], failed = [];
function assert(cond, msg) {
  if (cond) { passed.push(msg); console.log(`  ✅ ${msg}`); }
  else     { failed.push(msg); console.log(`  ❌ ${msg}`); }
}

async function upload(body, testBuf, filename, fmt) {
  const fd = new FormData();
  fd.append('image', new Blob([testBuf], { type: fmt }), filename);
  for (const [k, v] of Object.entries(body)) fd.append(k, String(v));
  const resp = await fetch(API, { method: 'POST', body: fd });
  if (!resp.ok) return { ok: false, err: await resp.json() };
  const buf = Buffer.from(await resp.arrayBuffer());
  return { ok: true, buf, headers: resp.headers };
}

// ── Test 1: Alpha PNG → JPEG 不能变黑（核心修复验证） ────────────────────
console.log('\n═══ 1️⃣ 核心修复: Alpha PNG → JPEG 透明区不能变黑 ═══');
{
  // 造：中心橙色圆 + 周围完全透明
  const w = 600, h = 600;
  const raw = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - w/2, dy = y - h/2;
      const i = (y * w + x) * 4;
      if (dx*dx + dy*dy < 100*100) {
        raw[i]=255; raw[i+1]=165; raw[i+2]=0; raw[i+3]=255;
      } else {
        raw[i]=0; raw[i+1]=0; raw[i+2]=0; raw[i+3]=0;
      }
    }
  }
  const rgba = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  fs.writeFileSync('./output/1_alpha_input.png', rgba);

  for (const [body, label] of [
    [{ format: 'jpeg', quality: '80', targetKB: '' }, 'quality=80'],
    [{ format: 'jpeg', targetKB: '200', width: '300', height: '300' }, 'targetKB=200 resize'],
    [{ format: 'webp', quality: '80' }, 'webp'],
  ]) {
    const r = await upload(body, rgba, 'alpha.png', 'image/png');
    if (!r.ok) { console.log('  ❌', label, r.err.error); failed.push(label + ' ' + r.err.error); continue; }
    const out = r.buf;
    fs.writeFileSync('./output/1_alpha_' + label.replace(/[^a-z0-9]/gi,'') + '.jpg', out);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    let black = 0, total = 0;
    for (let i = 0; i < data.length; i += info.channels || 3) {
      total++;
      if (data[i]<30 && data[i+1]<30 && data[i+2]<30) black++;
    }
    console.log(`  ${label}: 黑像素 (${black}/${total})`);
    assert(black / total < 0.01, `${label} 黑像素占比 < 1% (${(black/total*100).toFixed(2)}%)`);
  }
}

// ── Test 2: 分辨率调整回归（不能回退） ───────────────────────────────────
console.log('\n═══ 2️⃣ 分辨率调整回归 ═══');
{
  const big = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#4a69bd' } })
    .png().toBuffer();
  fs.writeFileSync('./uploads/_big.png', big);

  // fill/cover/contain 自动放大（之前的修复也要保留）
  const small = await sharp({ create: { width: 800, height: 300, channels: 3, background: '#e74c3c' } })
    .png().toBuffer();
  fs.writeFileSync('./uploads/_small.png', small);

  // 大图: fit=fill 1120x560
  let r = await upload({ width: 1120, height: 560, fit: 'fill', format: 'jpeg', quality: '90' }, big, 'b.png', 'image/png');
  const m1 = await sharp(r.buf).metadata();
  assert(m1.width === 1120 && m1.height === 560, `fill 1120x560 → ${m1.width}x${m1.height}`);

  // 小图: fit=fill 1120x560 自动放大
  r = await upload({ width: 1120, height: 560, fit: 'fill', format: 'jpeg', quality: '90' }, small, 's.png', 'image/png');
  const m2 = await sharp(r.buf).metadata();
  assert(m2.width === 1120 && m2.height === 560, `小图 fill 自动放大 → ${m2.width}x${m2.height}`);
}

// ── Test 3: targetKB 精度回归 ───────────────────────────────────────────
console.log('\n═══ 3️⃣ targetKB 精度回归 ═══');
{
  const complex = fs.readFileSync(path.join(__dirname, 'uploads', 'complex.png'));
  for (const [kb, fmt, dev] of [[200, 'jpeg', 0.10], [100, 'jpeg', 0.10], [200, 'webp', 0.10]]) {
    const r = await upload({ targetKB: kb, format: fmt }, complex, 'c.png', 'image/png');
    if (!r.ok) { console.log('  ❌ targetKB ' + kb + ' ' + fmt + ' HTTP ' + r.err.error); continue; }
    const ratio = r.buf.length / (kb * 1024);
    const devPct = Math.abs(ratio - 1) * 100;
    console.log(`  ${kb}KB ${fmt} → ${(r.buf.length/1024).toFixed(1)}KB 偏差 ${devPct.toFixed(1)}%`);
    assert(Math.abs(ratio - 1) <= dev, `targetKB ${kb} ${fmt} 偏差 ≤ ${dev*100}%`);
  }

  // PNG + targetKB 应报错
  const rPNG = await upload({ targetKB: 100, format: 'png' }, complex, 'c.png', 'image/png');
  assert(!rPNG.ok && rPNG.err.error.includes('目标体积压缩不支持 PNG'), 'PNG + targetKB 正确拦截');
}

// ── Test 4: 色彩空间 & 格式转换 ───────────────────────────────────────────
console.log('\n═══ 4️⃣ 色彩空间 & 格式转换 ═══');
{
  // CMYK
  const cmyk = await sharp({ create: { width: 500, height: 400, channels: 4, background: { r: 100, g: 150, b: 200 } } })
    .toColourspace('cmyk').jpeg().toBuffer();
  let r = await upload({ format: 'jpeg', quality: '80' }, cmyk, 'cmyk.jpg', 'image/jpeg');
  const m1 = await sharp(r.buf).metadata();
  assert(m1.space === 'srgb', `CMYK→JPEG 输出 sRGB (${m1.space})`);

  // 灰度
  const gray = await sharp({ create: { width: 500, height: 400, channels: 3, background: '#888' } })
    .grayscale().png().toBuffer();
  r = await upload({ format: 'jpeg', quality: '80' }, gray, 'gray.png', 'image/png');
  const m2 = await sharp(r.buf).metadata();
  const s2 = await sharp(r.buf).stats();
  const eq = Math.abs(s2.channels[0].mean - s2.channels[1].mean) < 2 && Math.abs(s2.channels[1].mean - s2.channels[2].mean) < 2;
  assert(m2.space === 'srgb' && eq, '灰度 PNG→JPEG 颜色一致');

  // JPEG → PNG（PNG 现在默认 palette: false，无损）
  const rgb = await sharp({ create: { width: 500, height: 400, channels: 3, background: '#e74c3c' } })
    .jpeg().toBuffer();
  r = await upload({ format: 'png', quality: '90' }, rgb, 'rgb.jpg', 'image/jpeg');
  const m3 = await sharp(r.buf).metadata();
  assert(m3.format === 'png' && m3.channels >= 3, 'JPEG→PNG 格式正确');
}

// ── Test 5: 不传宽高也能正常处理（之前有 else 分支问题） ─────────────────
console.log('\n═══ 5️⃣ 不传 width/height 也正常 ═══');
{
  const rgb = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#27ae60' } })
    .png().toBuffer();
  // 纯 quality
  let r = await upload({ format: 'jpeg', quality: '80' }, rgb, 'rgb.png', 'image/png');
  const m1 = await sharp(r.buf).metadata();
  assert(m1.width === 600 && m1.height === 400, '不传宽高+quality 保持原尺寸');

  // 纯 targetKB
  r = await upload({ format: 'jpeg', targetKB: '100' }, rgb, 'rgb.png', 'image/png');
  const m2 = await sharp(r.buf).metadata();
  assert(m2.width === 600 && m2.height === 400, '不传宽高+targetKB 保持原尺寸');
}

// ── 汇总 ─────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════');
console.log(`  ✅ 通过: ${passed.length}   ❌ 失败: ${failed.length}`);
console.log('═══════════════════════════════════════════════');
if (failed.length) {
  failed.forEach((f) => console.log('  ❌', f));
  process.exit(1);
} else {
  console.log('🎉 全部通过！');
}
