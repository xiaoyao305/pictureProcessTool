import express from 'express';
import cors from 'cors';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'output');

[UPLOAD_DIR, OUTPUT_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ts = Date.now();
    const safeName = file.originalname.replace(/[^\w.\-]/g, '_');
    cb(null, `${ts}-${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_, file, cb) => {
    const allowed = /image\/(jpeg|png|webp|gif|tiff|avif)/;
    if (allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持图片格式：jpeg/png/webp/gif/tiff/avif'));
  },
});

// JPEG/WebP/AVIF 不支持 alpha → 显式合成到白色背景
// PNG/TIFF 保留 alpha（PNG 本身支持）
function prepareForEncode(pipeline, fmt) {
  const noAlpha = ['jpeg', 'jpg', 'webp', 'avif'];
  let p = pipeline;
  // 显式处理色彩空间：CMYK / 灰度 → sRGB，防止编码器奇怪行为
  p = p.toColourspace('srgb');
  if (noAlpha.includes(fmt)) {
    // 关键修复：alpha 通道合成到白色背景（sharp 默认黑色！）
    p = p.flatten({ background: { r: 255, g: 255, b: 255 } });
  }
  return p;
}

// 根据格式 + quality 对 sharp 管道做编码配置
function encode(pipeline, fmt, q) {
  if (fmt === 'jpeg' || fmt === 'jpg') {
    // mozjpeg 4:2:0 子采样在极端压缩下会让彩色边缘变黑；
    // targetKB 模式质量可能很低，4:4:4 更安全
    return pipeline.jpeg({ quality: q, mozjpeg: true });
  }
  if (fmt === 'png') {
    // PNG 默认无损（palette: false），quality 实际控制压缩耗时
    // palette:true 才是有损调色板压缩
    return pipeline.png({ quality: q, compressionLevel: 9, palette: false });
  }
  if (fmt === 'webp')   return pipeline.webp({ quality: q });
  if (fmt === 'avif')   return pipeline.avif({ quality: q });
  if (fmt === 'tiff')   return pipeline.tiff({ quality: q });
  return null;
}

// 对 buffer 按格式 + quality 重新编码（targetKB 模式复用）
async function encodeBuffer(buf, fmt, q) {
  let p = sharp(buf);
  p = prepareForEncode(p, fmt);
  const e = encode(p, fmt, q);
  if (!e) throw new Error(`不支持的格式: ${fmt}`);
  return e.toBuffer();
}

// 二分查找 quality，逼近目标体积
// 输入已经是 resize 后的 buffer，返回 { buffer, quality }
async function targetSizeCompress(resizedBuf, targetBytes, fmt, tolerance = 0.1, maxIter = 12) {
  let lo = 1, hi = 100;
  let closestSmall = null; // ≤ target 最接近的
  let closestBig = null;   // > target 最接近的

  for (let i = 0; i < maxIter; i++) {
    const q = Math.max(1, Math.min(100, Math.round((lo + hi) / 2)));
    const buf = await encodeBuffer(resizedBuf, fmt, q);
    const ratio = buf.length / targetBytes;

    if (ratio <= 1 + tolerance && ratio >= 1 - tolerance) {
      return { buffer: buf, quality: q, iterations: i + 1, hit: true };
    }
    if (ratio > 1) {
      hi = q - 1;
      closestBig = { buffer: buf, quality: q };
    } else {
      lo = q + 1;
      closestSmall = { buffer: buf, quality: q };
    }
    if (lo > hi) break;
  }

  // 容差内没命中：优先返回不超目标的（closestSmall），否则 closestBig
  const picked = closestSmall || closestBig;
  return { buffer: picked.buffer, quality: picked.quality, iterations: maxIter, hit: false };
}

const TARGET_SIZE_SUPPORTED = ['jpeg', 'jpg', 'webp', 'avif'];

// POST /api/image/process
// body: { width, height, fit, format, quality, targetKB }
//   - 不传 targetKB → 按 quality 压缩（原有逻辑）
//   - 传 targetKB   → 按目标体积压缩（二分 quality）
app.post('/api/image/process', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上传文件' });

    const {
      width,
      height,
      fit = 'inside',
      format = 'jpeg',
      quality = 80,
      withoutEnlargement = 'true',
      targetKB, // 新增：按目标体积压缩（KB）
    } = req.body;

    const fmt = format.toLowerCase();

    // ── 格式预处理 ────────────────────────────────────────────────────────
    const supportedFormats = ['jpeg', 'jpg', 'png', 'webp', 'avif', 'tiff'];
    if (!supportedFormats.includes(fmt)) {
      return res.status(400).json({ error: `不支持的格式: ${format}` });
    }

    // ── 目标体积模式格式校验 ──────────────────────────────────────────────
    const isTargetMode = targetKB !== undefined && targetKB !== '' && targetKB !== null;
    if (isTargetMode && !TARGET_SIZE_SUPPORTED.includes(fmt)) {
      return res.status(400).json({
        error: `目标体积压缩不支持 ${fmt.toUpperCase()} 格式，请改用 JPEG / WebP / AVIF`,
      });
    }

    // ── Step 1: 解码 + EXIF + 色彩空间 + 分辨率调整 → 中间 buffer ────────
    let pipeline = sharp(req.file.path, {
      // 自动处理 EXIF 方向标签（手机竖拍不会躺倒）
      autoOrient: true,
      // 输入色彩空间容错（CMYK / 灰度自动识别）
      failOnError: false,
    });

    // 统一色彩空间到 sRGB
    pipeline = pipeline.toColourspace('srgb');

    if (width || height) {
      const forceExact = fit === 'fill' || fit === 'cover' || fit === 'contain';
      pipeline = pipeline.resize(
        width ? Number(width) : null,
        height ? Number(height) : null,
        {
          fit,
          withoutEnlargement: forceExact ? false : withoutEnlargement !== 'false',
          // contain 模式留白用白色（防止变成黑色）
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        }
      );
    }

    const resizedBuf = await pipeline.toBuffer();

    // ── Step 2: 编码压缩 ──────────────────────────────────────────────────
    let buffer, finalQuality, meta = {};

    if (isTargetMode) {
      const targetBytes = Number(targetKB) * 1024;
      if (isNaN(targetBytes) || targetBytes <= 0) {
        return res.status(400).json({ error: 'targetKB 必须是正数' });
      }
      const r = await targetSizeCompress(resizedBuf, targetBytes, fmt);
      buffer = r.buffer;
      finalQuality = r.quality;
      meta = {
        targetKB: Number(targetKB),
        actualKB: Math.round(buffer.length / 1024),
        quality: r.quality,
        iterations: r.iterations,
        hit: r.hit,
      };
    } else {
      // 按 quality 压缩：对 Step1 输出做 prepareForEncode + 编码
      const q = Number(quality);
      const e = encode(prepareForEncode(sharp(resizedBuf), fmt), fmt, q);
      if (!e) throw new Error(`不支持的格式: ${fmt}`);
      buffer = await e.toBuffer();
      finalQuality = q;
    }

    // ── 收尾 ──────────────────────────────────────────────────────────────
    fs.unlink(req.file.path, () => {});

    const ext = fmt === 'jpg' ? 'jpeg' : fmt;
    res.set({
      'Content-Type': `image/${ext}`,
      'Content-Disposition': `inline; filename="processed.${ext}"`,
      'X-Original-Size': req.file.size,
      'X-Processed-Size': buffer.length,
      'X-Compress-Quality': finalQuality,
      'X-Compress-Mode': isTargetMode ? 'targetKB' : 'quality',
      ...(isTargetMode ? {
        'X-Target-KB': meta.targetKB,
        'X-Actual-KB': meta.actualKB,
        'X-Iterations': meta.iterations,
      } : {}),
    });
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/image/info — 返回图片元信息
app.post('/api/image/info', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上传文件' });
    const meta = await sharp(req.file.path).metadata();
    fs.unlink(req.file.path, () => {});
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((err, _, res, __) => {
  res.status(400).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🖼️  图片处理服务已启动: http://localhost:${PORT}`);
});
