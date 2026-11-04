// 分辨率调整自动化测试 —— 放在 server/ 目录内执行
// Usage: node test-resize.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMG = path.join(__dirname, 'uploads', 'test_2000x1500.png');
const TMP_DIR = path.join(__dirname, 'output');
const API = 'http://localhost:3001/api/image/process';

fs.mkdirSync(TMP_DIR, { recursive: true });

const passed = [];
const failed = [];

function assert(cond, msg) {
  if (cond) { passed.push(msg); console.log(`  ✅ ${msg}`); }
  else     { failed.push(msg); console.log(`  ❌ ${msg}`); }
}

async function runCase(name, body, expect) {
  console.log(`\n▶ ${name}`);
  const fd = new FormData();
  const fileBuf = fs.readFileSync(TEST_IMG);
  const blob = new Blob([fileBuf], { type: 'image/png' });
  fd.append('image', blob, 'test.png');
  for (const [k, v] of Object.entries(body)) fd.append(k, String(v));

  const resp = await fetch(API, { method: 'POST', body: fd });
  assert(resp.ok, `HTTP ${resp.status} OK`);
  if (!resp.ok) { console.log('  错误:', await resp.text()); return; }

  const buf = Buffer.from(await resp.arrayBuffer());
  const meta = await sharp(buf).metadata();
  console.log(`  实际尺寸: ${meta.width}x${meta.height}  格式: ${meta.format}  大小: ${buf.length}B`);

  // 保存以便排查
  const ext = expect.format || 'jpeg';
  fs.writeFileSync(path.join(TMP_DIR, `test_${name.replace(/\s+/g, '_')}.${ext}`), buf);

  if (expect.width !== undefined) assert(meta.width === expect.width,  `宽度应为 ${expect.width}，实际 ${meta.width}`);
  if (expect.height !== undefined) assert(meta.height === expect.height, `高度应为 ${expect.height}，实际 ${meta.height}`);
  if (expect.format) assert(meta.format === expect.format, `格式应为 ${expect.format}`);
}

// ─── 测试用例 ──────────────────────────────────────────────────────────────
async function main() {
  console.log('📐 原图: 2000x1500 (宽高比 4:3)');

  // 1) 只给宽度 —— 应按比例缩放，高度 = 900
  await runCase('只给宽度 1200',
    { width: 1200, format: 'jpeg', quality: 90 },
    { width: 1200, height: 900, format: 'jpeg' });

  // 2) 只给高度 —— 应按比例缩放，宽度 = 1067 (2000*800/1500 ≈ 1066.67)
  await runCase('只给高度 800',
    { height: 800, format: 'jpeg', quality: 90 },
    { width: 1067, height: 800, format: 'jpeg' });

  // 3) 同时给宽高 —— inside 模式保持比例，不会裁剪
  await runCase('宽高 1000x1000 fit=inside',
    { width: 1000, height: 1000, fit: 'inside', format: 'jpeg' },
    { width: 1000, height: 750 });  // 4:3 放入 1000x1000 → 1000x750

  // 4) cover 模式 —— 覆盖填充，会裁剪到精确尺寸
  await runCase('宽高 1000x1000 fit=cover',
    { width: 1000, height: 1000, fit: 'cover', format: 'jpeg' },
    { width: 1000, height: 1000 });

  // 5) contain 模式 —— 留白填充到精确尺寸
  await runCase('宽高 1000x1000 fit=contain',
    { width: 1000, height: 1000, fit: 'contain', format: 'jpeg' },
    { width: 1000, height: 1000 });

  // 6) 小图放大 —— withoutEnlargement 默认 true，不应放大
  await runCase('小图尺寸 4000x3000 不放大会被忽略',
    { width: 4000, height: 3000, format: 'png' },
    { width: 2000, height: 1500 });  // 保持原图

  // 7) 小图尺寸 4000x3000 允许放大
  await runCase('小图尺寸 4000x3000 withoutEnlargement=false',
    { width: 4000, height: 3000, withoutEnlargement: 'false', format: 'png' },
    { width: 4000, height: 3000 });

  // 8) 格式转换 WebP
  await runCase('格式转 WebP + 压缩',
    { width: 800, format: 'webp', quality: 60 },
    { width: 800, height: 600, format: 'webp' });

  // 9) fit=fill 强制拉伸
  await runCase('宽高 800x600 fit=fill 强制拉伸',
    { width: 800, height: 600, fit: 'fill', format: 'jpeg' },
    { width: 800, height: 600 });

  // ── 汇总 ────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  console.log(`  ✅ 通过: ${passed.length}   ❌ 失败: ${failed.length}`);
  console.log('═══════════════════════════════════════════════');
  if (failed.length) {
    console.log('\n失败项:');
    failed.forEach((f) => console.log('  -', f));
    process.exit(1);
  } else {
    console.log('\n🎉 全部通过！');
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
