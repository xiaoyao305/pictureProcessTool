// 新功能测试：按目标体积压缩 (targetKB)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = 'http://localhost:3001/api/image/process';

// 用之前生成的复杂噪点图（8.6MB）
const testBuf = fs.readFileSync(path.join(__dirname, 'uploads', 'complex.png'));
const passed = [];
const failed = [];
function assert(cond, msg) {
  if (cond) { passed.push(msg); console.log(`  ✅ ${msg}`); }
  else     { failed.push(msg); console.log(`  ❌ ${msg}`); }
}

async function call(name, body, expect) {
  console.log(`\n▶ ${name}`);
  const fd = new FormData();
  fd.append('image', new Blob([testBuf], { type: 'image/png' }), 'complex.png');
  for (const [k, v] of Object.entries(body)) fd.append(k, String(v));
  const resp = await fetch(API, { method: 'POST', body: fd });
  const ct = resp.headers.get('Content-Type');
  const mode = resp.headers.get('X-Compress-Mode');
  const actKB = resp.headers.get('X-Actual-KB');
  const tgtKB = resp.headers.get('X-Target-KB');
  const quality = resp.headers.get('X-Compress-Quality');
  const iterations = resp.headers.get('X-Iterations');
  console.log(`  headers: mode=${mode} quality=${quality} iter=${iterations} target=${tgtKB}KB actual=${actKB}KB`);

  if (expect.error) {
    if (resp.ok) { console.log('  HTTP 200（预期应报错）'); failed.push('预期报错但返回 200'); return; }
    const err = await resp.json();
    assert(err.error.includes(expect.error), `错误消息含 "${expect.error}" → ${err.error}`);
    return;
  }

  if (!resp.ok) { console.log('  HTTP', resp.status, await resp.text()); failed.push('HTTP ' + resp.status); return; }
  const buf = Buffer.from(await resp.arrayBuffer());
  const fmt = (await sharp(buf).metadata()).format;

  assert(mode === 'targetKB', 'X-Compress-Mode = targetKB');
  assert(Number(quality) >= 1 && Number(quality) <= 100, 'X-Compress-Quality 在 1-100 之间');

  if (expect.dev) {
    // 验证偏差在容差内（默认 ±10%）
    const actual = buf.length;
    const target = expect.targetKB * 1024;
    const dev = Math.abs(actual / target - 1);
    const devPct = (dev * 100).toFixed(1);
    console.log(`  实际 ${(actual/1024).toFixed(1)}KB / 目标 ${expect.targetKB}KB  偏差 ${devPct}%`);
    assert(dev <= expect.dev, `偏差 ≤ ${expect.dev*100}%（${devPct}%）`);
  }
  if (expect.format) assert(fmt === expect.format, `格式 ${expect.format}`);
}

// ── 正向用例 ──────────────────────────────────────────────────────────────
await call('JPEG 目标 200KB', { targetKB: 200, format: 'jpeg' }, { targetKB: 200, dev: 0.10, format: 'jpeg' });
await call('JPEG 目标 100KB', { targetKB: 100, format: 'jpeg' }, { targetKB: 100, dev: 0.10, format: 'jpeg' });
await call('JPEG 目标 50KB',  { targetKB: 50,  format: 'jpeg' }, { targetKB: 50,  dev: 0.15, format: 'jpeg' }); // 50KB 极小图容差放宽
await call('WebP 目标 200KB', { targetKB: 200, format: 'webp' }, { targetKB: 200, dev: 0.10, format: 'webp' });

// 组合：先 resize 再 targetKB
await call('resize 1200x900 + JPEG 目标 80KB',
  { targetKB: 80, format: 'jpeg', width: 1200, height: 900 },
  { targetKB: 80, dev: 0.12, format: 'jpeg' });

// ── 反向用例：格式不支持 ──────────────────────────────────────────────────
await call('PNG + targetKB 应报错', { targetKB: 100, format: 'png' }, { error: '目标体积压缩不支持 PNG' });
await call('TIFF + targetKB 应报错', { targetKB: 100, format: 'tiff' }, { error: '目标体积压缩不支持 TIFF' });
await call('非法 targetKB', { targetKB: -10, format: 'jpeg' }, { error: 'targetKB 必须是正数' });

// ── 兼容：不传 targetKB 应仍走 quality 模式 ──────────────────────────────
console.log('\n▶ 兼容：不传 targetKB → quality 模式');
{
  const fd = new FormData();
  fd.append('image', new Blob([testBuf], { type: 'image/png' }), 'complex.png');
  fd.append('format', 'jpeg');
  fd.append('quality', '80');
  const resp = await fetch(API, { method: 'POST', body: fd });
  const mode = resp.headers.get('X-Compress-Mode');
  assert(mode === 'quality', 'X-Compress-Mode = quality（不传 targetKB 走旧逻辑）');
  const buf = Buffer.from(await resp.arrayBuffer());
  console.log(`  quality=80 JPEG → ${(buf.length/1024).toFixed(0)}KB`);
}

// ── 汇总 ─────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════');
console.log(`  ✅ 通过: ${passed.length}   ❌ 失败: ${failed.length}`);
console.log('═══════════════════════════════════════════════');
if (failed.length) {
  failed.forEach((f) => console.log('  ❌', f));
  process.exit(1);
} else {
  console.log('🎉 targetKB 新功能全部通过！');
}
