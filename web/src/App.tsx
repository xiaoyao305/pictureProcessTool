import { useState, useRef, useCallback } from 'react';

type CompressMode = 'quality' | 'targetKB';

interface ProcessResult {
  blob: Blob;
  url: string;
  size: number;
  quality?: number;
  targetKB?: number;
  actualKB?: number;
  iterations?: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// targetKB 模式支持的格式（PNG 无损，不支持目标体积）
const TARGETKB_FORMATS = ['jpeg', 'jpg', 'webp', 'avif'];

export default function App() {
  const [compressMode, setCompressMode] = useState<CompressMode>('quality');
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string>('');
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragover, setDragover] = useState(false);
  const [error, setError] = useState('');

  // 控制面板参数
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [format, setFormat] = useState('jpeg');
  const [quality, setQuality] = useState(80);
  const [targetKB, setTargetKB] = useState(200);
  const [fit, setFit] = useState<'inside' | 'cover' | 'contain' | 'fill'>('inside');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('请上传图片文件');
      return;
    }
    setError('');
    setOriginalFile(file);
    setOriginalUrl(URL.createObjectURL(file));
    setResult(null);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragover(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const handleProcess = async () => {
    if (!originalFile) return;
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('image', originalFile);
      if (width) fd.append('width', width);
      if (height) fd.append('height', height);
      fd.append('format', format);
      fd.append('fit', fit);

      if (compressMode === 'targetKB') {
        if (!TARGETKB_FORMATS.includes(format)) {
          throw new Error('目标体积压缩仅支持 JPEG / WebP / AVIF，请切换格式');
        }
        if (!targetKB || targetKB <= 0) throw new Error('请输入有效的目标体积（KB）');
        fd.append('targetKB', String(targetKB));
      } else {
        fd.append('quality', String(quality));
      }

      const resp = await fetch('/api/image/process', { method: 'POST', body: fd });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || `服务错误 ${resp.status}`);
      }
      const blob = await resp.blob();
      setResult({
        blob,
        url: URL.createObjectURL(blob),
        size: blob.size,
        quality: resp.headers.get('X-Compress-Quality') ? Number(resp.headers.get('X-Compress-Quality')) : undefined,
        targetKB: resp.headers.get('X-Target-KB') ? Number(resp.headers.get('X-Target-KB')) : undefined,
        actualKB: resp.headers.get('X-Actual-KB') ? Number(resp.headers.get('X-Actual-KB')) : undefined,
        iterations: resp.headers.get('X-Iterations') ? Number(resp.headers.get('X-Iterations')) : undefined,
      });
    } catch (e: any) {
      setError(e.message || '服务端处理失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = `processed.${format === 'jpg' ? 'jpeg' : format}`;
    a.click();
  };

  const savedPercent = originalFile && result
    ? ((1 - result.size / originalFile.size) * 100).toFixed(1)
    : null;

  return (
    <div className="app">
      <h1>🖼️ 图片处理工具</h1>

      <div className="card">
        <div
          className={`upload-zone ${dragover ? 'dragover' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
          onDragLeave={() => setDragover(false)}
          onDrop={onDrop}
        >
          <p>点击或拖拽图片到此处上传</p>
          <p className="hint">支持 JPEG / PNG / WebP / GIF / TIFF / AVIF，最大 20MB</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>

      {originalFile && (
        <div className="card">
          <h2>⚙️ 处理参数</h2>

          <div className="mode-switch" style={{ marginBottom: 20 }}>
            <button
              className={compressMode === 'quality' ? 'active' : ''}
              onClick={() => setCompressMode('quality')}
            >
              🎚️ 按质量压缩
            </button>
            <button
              className={compressMode === 'targetKB' ? 'active' : ''}
              onClick={() => setCompressMode('targetKB')}
            >
              🎯 按目标体积压缩
            </button>
          </div>

          <div className="controls">
            <div className="control-item">
              <label>目标宽度 (px)</label>
              <input
                type="number"
                placeholder="留空等比缩放"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
            </div>
            <div className="control-item">
              <label>目标高度 (px)</label>
              <input
                type="number"
                placeholder="留空等比缩放"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
            </div>
            <div className="control-item">
              <label>格式</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                style={
                  compressMode === 'targetKB' && !TARGETKB_FORMATS.includes(format)
                    ? { borderColor: '#dc2626' }
                    : undefined
                }
              >
                <option value="jpeg">JPEG</option>
                <option value="png">PNG {compressMode === 'targetKB' ? '❌' : ''}</option>
                <option value="webp">WebP</option>
                <option value="avif">AVIF</option>
                <option value="tiff">TIFF {compressMode === 'targetKB' ? '❌' : ''}</option>
              </select>
              {compressMode === 'targetKB' && !TARGETKB_FORMATS.includes(format) && (
                <span style={{ fontSize: 12, color: '#dc2626' }}>
                  目标体积不支持 PNG/TIFF，请改用 JPEG/WebP/AVIF
                </span>
              )}
            </div>

            {compressMode !== 'targetKB' && (
              <div className="control-item">
                <label>压缩质量 ({quality}%)</label>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                />
              </div>
            )}

            {compressMode === 'targetKB' && (
              <div className="control-item">
                <label>🎯 目标体积 (KB)</label>
                <input
                  type="number"
                  min="1"
                  placeholder="例如 200"
                  value={targetKB}
                  onChange={(e) => setTargetKB(Number(e.target.value))}
                />
                <span style={{ fontSize: 12, color: '#888' }}>
                  二分查找 quality 逼近，偏差 ±10% 内
                </span>
              </div>
            )}

            <div className="control-item">
              <label>填充模式</label>
              <select value={fit} onChange={(e) => setFit(e.target.value as any)}>
                <option value="inside">inside（保持比例）</option>
                <option value="cover">cover（裁剪填充）</option>
                <option value="contain">contain（留白）</option>
                <option value="fill">fill（强制拉伸）</option>
              </select>
            </div>
          </div>

          <div className="btn-row">
            <button
              className="btn btn-primary"
              disabled={loading}
              onClick={handleProcess}
            >
              {loading ? '处理中…' : '🚀 开始处理'}
            </button>
            {result && (
              <button className="btn download" onClick={handleDownload}>
                💾 下载结果
              </button>
            )}
          </div>

          {error && (
            <div className="meta" style={{ color: '#dc2626' }}>❌ {error}</div>
          )}
        </div>
      )}

      {originalUrl && (
        <div className="card">
          <h2>👀 预览对比</h2>
          <div className="preview-area">
            <div className="preview-box">
              <img src={originalUrl} alt="原图" />
              <div className="label">原图</div>
              <div className="size">
                {formatSize(originalFile?.size || 0)}
              </div>
            </div>
            {result && (
              <div className="preview-box">
                <img src={result.url} alt="处理后" />
                <div className="label">处理后</div>
                <div className="size">
                  {formatSize(result.size)}
                  {savedPercent && Number(savedPercent) > 0 && (
                    <div className="saved">↓ {savedPercent}% 压缩</div>
                  )}
                  {savedPercent && Number(savedPercent) <= 0 && (
                    <div style={{ color: '#ea580c' }}>↑ {-Number(savedPercent)}% 增大</div>
                  )}
                  {result.quality !== undefined && (
                    <div style={{ fontSize: 11, color: '#888' }}>
                      quality={result.quality}
                      {result.targetKB !== undefined &&
                        ` · 目标${result.targetKB}KB 实际${result.actualKB}KB · ${result.iterations}次迭代`}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
