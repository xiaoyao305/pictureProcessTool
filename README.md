# 🖼️ PictureProcessTool

一个基于 **Sharp (libvips)** + **Vite + React** 的图片处理工具，支持分辨率调整、格式转换、按质量 / 按目标体积两种压缩模式。

## ✨ 功能

| 能力 | 说明 |
|---|---|
| 分辨率调整 | 等比缩放 / 固定尺寸，4 种填充模式：inside、cover、contain、fill |
| 压缩方式 | 按质量 (10-100%) 或 按目标体积 (KB，二分查找，偏差 ±10%) |
| 格式支持 | JPEG (mozjpeg) / PNG (无损) / WebP / AVIF / TIFF |
| 色彩空间 | 自动 CMYK → sRGB、灰度 → sRGB |
| Alpha 合成 | 透明通道 → 白色背景（JPEG/WebP/AVIF） |
| EXIF 自动旋转 | 手机竖拍照片不会躺倒 |
| 局域网分享 | 监听 `0.0.0.0`，同一 WiFi 下可直接访问 |

## 🛠️ 技术栈

- **后端**: Node.js 20+ · Express 4 · Sharp 0.33 (libvips) · Multer 2
- **前端**: Vite 5 · React 18 · TypeScript · 原生 CSS（Flat 2.0 极简风格）

## 📦 目录结构

```
pictureProcessTool/
├── server/                  # 后端 Express + Sharp
│   ├── server.js           # 入口（/api/image/process, /api/image/info）
│   ├── package.json
│   └── test-*.mjs          # 自动化测试
└── web/                     # 前端 Vite + React
    ├── src/App.tsx          # 主组件
    ├── src/index.css        # Flat 2.0 风格样式
    ├── vite.config.ts
    └── package.json
```

## 🚀 快速开始

### 环境要求

- Node.js **≥ 18**（推荐 20 LTS）
- npm / pnpm / yarn 任一

### 启动

需要**两个终端**，分别启动后端和前端：

```bash
# 终端 1 —— 后端（端口 3001）
cd server
npm install        # 首次安装依赖（Sharp 会下载预编译二进制）
npm run dev        # 开发模式，--watch 自动重载

# 终端 2 —— 前端（端口 4173）
cd web
npm install
npm run dev
```

浏览器访问 http://localhost:4173

### 局域网分享

前端 Vite 和后端 Express 均已监听 `0.0.0.0`，同一 WiFi 下的设备可直接访问：

```bash
# 查看本机局域网 IP（PowerShell）
ipconfig | findstr "IPv4"

# 假设 IP 是 192.168.1.100，朋友访问：
# http://192.168.1.100:4173
```

> 若朋友打不开，Windows 防火墙需放行 3001 和 4173 端口，或首次启动时点「允许访问」。

### 生产构建

```bash
# 后端 —— 直接 node server.js 即可
cd server && npm ci --omit=dev && node server.js

# 前端
cd web && npm run build
# 产物在 web/dist/，可用 Nginx 托管（配合反向代理 /api → 3001）
```

## 🧪 测试

后端自动化测试（全量覆盖分辨率、targetKB 精度、色彩空间、alpha 通道）：

```bash
cd server
node test-all.mjs               # 综合回归（14 用例）
node test-resize-regression.mjs # 分辨率调整专项（9 用例）
node test-targetkb.mjs          # targetKB 专项（9 用例）
node test-boundary.mjs          # 边界场景（CMYK/灰度/RGBA）
```

## 🔌 API

### POST `/api/image/process`

图片处理主接口。

**multipart/form-data**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image` | File | ✅ | 图片文件（≤ 20MB） |
| `width` | number | ❌ | 目标宽度 (px) |
| `height` | number | ❌ | 目标高度 (px) |
| `format` | string | ❌ | jpeg / jpg / png / webp / avif / tiff，默认 jpeg |
| `fit` | string | ❌ | inside / cover / contain / fill，默认 inside |
| `quality` | number | ❌ | 压缩质量 1-100，默认 80（不传 targetKB 时生效） |
| `targetKB` | number | ❌ | 目标体积 KB（传了即走 targetKB 模式） |

**响应 Headers**：

| Header | 说明 |
|---|---|
| `X-Compress-Mode` | `quality` 或 `targetKB` |
| `X-Compress-Quality` | 最终使用的 quality 值 |
| `X-Target-KB` | targetKB 模式：目标体积 |
| `X-Actual-KB` | targetKB 模式：实际体积 |
| `X-Iterations` | targetKB 模式：二分迭代次数 |
| `X-Original-Size` | 原图字节数 |
| `X-Processed-Size` | 输出字节数 |

### POST `/api/image/info`

返回图片元信息（Sharp metadata）。

## ❓ FAQ

**Q: 为什么传 targetKB + PNG 会报错？**
A: PNG 是无损格式，没有 quality 参数可调，无法通过调 quality 逼近目标体积。请改用 JPEG / WebP / AVIF。

**Q: fill / cover / contain 有什么区别？**
A:
- `inside` — 保持比例塞进去，可能留白（默认）
- `cover` — 保持比例裁剪填满
- `contain` — 保持比例塞满精确尺寸，留白用白色填充
- `fill` — 强制拉伸变形到精确尺寸

**Q: 为什么我的手机竖拍图片上传后躺倒了？**
A: 不会，后端已开启 `autoOrient` 自动处理 EXIF 方向标签。

## 📄 License

MIT
