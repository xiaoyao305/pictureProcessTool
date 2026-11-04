// 回归测试 —— 覆盖 fix：fill/cover/contain 在小图场景下也应输出精确尺寸
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, 'output');
const API = 'http://localhost:3001/api/image/process';

fs.mkdirSync(TMP_DIR, { recursive: true });

const passed = [];
const failed = [];
const origBuf = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#4a69bd' } }).png().toBuffer();
const smallBuf = await sharp({ create: { width: 800, height: 300, channels: 3, background: '#e74c3c' } }).png().toBuffer();
fs.writeFileSync(path.join(__dirname, 'uploads', 'test_big.png'), origBuf);
fs.writeFileSync(path.join(__dirname, 'uploads', 'test_small.png'), smallBuf);

function assert(cond, msg) {
  if (cond) { passed.push(msg); console.log(`  ✅ ${msg}`); }
  else     { failed.push(msg); console.log(`  ❌ ${msg}`); }
}

async function runCase(name, filename, buf, body, expectW, expectH, expectFmt) {
  console.log(`\n▶ ${name}`);
  fs.writeFileSync(path.join(__dirname, 'uploads', filename), buf);
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type: 'image/png' }), filename);
  for (const [k, v] of Object.entries(body)) fd.append(k, String(v));
  const resp = await fetch(API, { method: 'POST', body: fd });
  if (!resp.ok) { console.log('  HTTP', resp.status, await resp.text()); return; }
  const r = Buffer.from(await resp.arrayBuffer());
  const m = await sharp(r).metadata();
  console.log(`  → ${m.width}x${m.height} ${m.format}  (期望 ${expectW}x${expectH})`);
  assert(m.width === expectW,  `宽度 ${expectW} ✔`);
  assert(m.height === expectH, `高度 ${expectH} ✔`);
  if (expectFmt) assert(m.format === expectFmt, `格式 ${expectFmt} ✔`);
}

// ── 大图场景（原有测试）─────────────────────────────────────────────────
console.log('═══ 大图 2000x1500（4:3）═══');
await runCase('fill 1120x560（强制拉伸变形）', 'test_big.png', origBuf,
  { width: 1120, height: 560, fit: 'fill', format: 'jpeg' }, 1120, 560, 'jpeg');
await runCase('cover 1000x1000（裁剪填充）', 'test_big.png', origBuf,
  { width: 1000, height: 1000, fit: 'cover', format: 'jpeg' }, 1000, 1000, 'jpeg');
await runCase('contain 1000x1000（留白）', 'test_big.png', origBuf,
  { width: 1000, height: 1000, fit: 'contain', format: 'jpeg' }, 1000, 1000, 'jpeg');
await runCase('inside 1000x1000（保持比例）', 'test_big.png', origBuf,
  { width: 1000, height: 1000, fit: 'inside', format: 'jpeg' }, 1000, 750);

// ── 小图场景（关键回归：fill/cover/contain 应允许放大）─────────────────
console.log('\n═══ 小图 800x300（8:3）═══');
await runCase('fill 1120x560（小图→必须放大拉伸）', 'test_small.png', smallBuf,
  { width: 1120, height: 560, fit: 'fill', format: 'jpeg' }, 1120, 560, 'jpeg');
await runCase('cover 1120x560（小图放大填充）', 'test_small.png', smallBuf,
  { width: 1120, height: 560, fit: 'cover', format: 'jpeg' }, 1120, 560, 'jpeg');
await runCase('contain 1120x560（小图放大留白）', 'test_small.png', smallBuf,
  { width: 1120, height: 560, fit: 'contain', format: 'jpeg' }, 1120, 560, 'jpeg');
// inside 默认 withoutEnlargement=true，小图不会被放大，保持原图尺寸
await runCase('inside 1120x560（小图 + inside 默认不放大大图 → 保持原尺寸）', 'test_small.png', smallBuf,
  { width: 1120, height: 560, fit: 'inside', format: 'jpeg' }, 800, 300);
// 显式传 withoutEnlargement=false 才会放大
await runCase('inside 1120x560 + withoutEnlargement=false（允许放大小图）', 'test_small.png', smallBuf,
  { width: 1120, height: 560, fit: 'inside', format: 'jpeg', withoutEnlargement: 'false' }, 1120, 420);

// ── 汇总 ────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════');
console.log(`  ✅ 通过: ${passed.length}   ❌ 失败: ${failed.length}`);
console.log('═══════════════════════════════════════════════');
if (failed.length) {
  failed.forEach((f) => console.log('  ❌', f));
  process.exit(1);
} else {
  console.log('🎉 全部通过！');
}
