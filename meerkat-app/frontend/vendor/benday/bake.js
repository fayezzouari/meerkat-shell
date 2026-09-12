const DEFAULT_BAKE = {
  dilate: 0,
  gamma: 1,
  grid: 24,
  invert: false,
  maskMode: "auto",
  threshold: 0.18,
  trim: true
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
function resolveBakeOptions(options = {}) {
  const merged = { ...DEFAULT_BAKE, ...stripUndefined(options) };
  const workingSize = options.workingSize ?? clamp(Math.round(merged.grid * 16), 192, 768);
  return { ...merged, workingSize };
}
function stripUndefined(o) {
  const out = {};
  for (const k of Object.keys(o)) {
    if (o[k] !== void 0) {
      out[k] = o[k];
    }
  }
  return out;
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.addEventListener("load", () => resolve(img), { once: true });
    img.addEventListener(
      "error",
      () => reject(new Error(`benday: failed to load image "${src}"`)),
      { once: true }
    );
    img.src = src;
  });
}
async function rasterize(source, workingSize) {
  let el;
  let iw = 0;
  let ih = 0;
  let revoke;
  try {
    if (typeof source === "string") {
      const img = await loadImage(source);
      el = img;
      iw = img.naturalWidth || img.width;
      ih = img.naturalHeight || img.height;
    } else if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
      el = source;
      iw = source.width;
      ih = source.height;
    } else if (source instanceof Blob) {
      revoke = URL.createObjectURL(source);
      const img = await loadImage(revoke);
      el = img;
      iw = img.naturalWidth || img.width;
      ih = img.naturalHeight || img.height;
    } else {
      const img = source;
      el = img;
      iw = img.naturalWidth || img.width;
      ih = img.naturalHeight || img.height;
    }
    if (!iw || !ih) {
      iw = 1024;
      ih = 1024;
    }
    const scale = workingSize / Math.max(iw, ih);
    const width = Math.max(1, Math.round(iw * scale));
    const height = Math.max(1, Math.round(ih * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("benday: could not acquire a 2D context");
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(el, 0, 0, width, height);
    let data;
    try {
      data = ctx.getImageData(0, 0, width, height);
    } catch {
      throw new Error(
        "benday: the image tainted the canvas (cross-origin without CORS headers)"
      );
    }
    return { data, height, width };
  } finally {
    if (revoke) {
      URL.revokeObjectURL(revoke);
    }
  }
}
const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
function hasAlpha(px) {
  let soft = 0;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < 250) {
      soft++;
      if (soft > 8) {
        return true;
      }
    }
  }
  return false;
}
function buildCoverage(img, width, height, mode, invert) {
  const px = img.data;
  const cov = new Float32Array(width * height);
  if (mode === "alpha") {
    for (let i = 0, p = 0; p < cov.length; i += 4, p++) {
      cov[p] = px[i + 3] / 255;
    }
    return cov;
  }
  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + width - 1) * 4
  ];
  const cornerLuma = corners.map((i) => luma(px[i], px[i + 1], px[i + 2])).toSorted((a, b) => a - b);
  let bg = (cornerLuma[1] + cornerLuma[2]) / 2;
  let bgIsLight = bg > 0.5;
  if (invert) {
    bgIsLight = !bgIsLight;
  }
  const span = Math.max(0.12, bgIsLight ? bg : 1 - bg);
  if (!bgIsLight) {
    bg = Math.min(bg, 1 - span);
  }
  for (let i = 0, p = 0; p < cov.length; i += 4, p++) {
    const l = luma(px[i], px[i + 1], px[i + 2]);
    const ink = bgIsLight ? bg - l : l - bg;
    cov[p] = clamp01(ink / span) * (px[i + 3] / 255);
  }
  return cov;
}
function buildTone(img, cov) {
  const px = img.data;
  const histogram = new Float64Array(256);
  let total = 0;
  let luminanceSum = 0;
  for (let i = 0, p = 0; p < cov.length; i += 4, p++) {
    const coverage = cov[p];
    if (coverage <= 0.02) {
      continue;
    }
    const level = Math.round(luma(px[i], px[i + 1], px[i + 2]) * 255);
    histogram[level] += coverage;
    luminanceSum += level * coverage;
    total += coverage;
  }
  const tone = new Float32Array(cov.length);
  if (total === 0) {
    return tone;
  }
  const reference = luminanceSum / total > 128 ? 0 : 255;
  const contrast = new Float64Array(256);
  for (let level = 0; level < 256; level++) {
    contrast[Math.abs(level - reference)] += histogram[level];
  }
  const strongest = histogramPercentile(contrast, total, 0.98);
  if (strongest <= 0) {
    return tone;
  }
  for (let i = 0, p = 0; p < cov.length; i += 4, p++) {
    if (cov[p] <= 0.02) {
      continue;
    }
    const level = luma(px[i], px[i + 1], px[i + 2]) * 255;
    tone[p] = clamp01(Math.abs(level - reference) / strongest);
  }
  return tone;
}
function histogramPercentile(histogram, total, percentile) {
  const target = total * percentile;
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i];
    if (seen >= target) {
      return i;
    }
  }
  return histogram.length - 1;
}
function dilateCoverage(cov, width, height, r) {
  if (r <= 0) {
    return cov;
  }
  const radius = Math.round(r);
  const tmp = new Float32Array(cov.length);
  const out = new Float32Array(cov.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let m = 0;
      const lo = Math.max(0, x - radius);
      const hi = Math.min(width - 1, x + radius);
      for (let k = lo; k <= hi; k++) {
        if (cov[row + k] > m) {
          m = cov[row + k];
        }
      }
      tmp[row + x] = m;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let m = 0;
      const lo = Math.max(0, y - radius);
      const hi = Math.min(height - 1, y + radius);
      for (let k = lo; k <= hi; k++) {
        const v = tmp[k * width + x];
        if (v > m) {
          m = v;
        }
      }
      out[y * width + x] = m;
    }
  }
  return out;
}
const INF = 1e20;
function edt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) {
      k++;
    }
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}
function distanceTransform(mask, width, height) {
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = mask[i] ? INF : 0;
  }
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      f[x] = grid[row + x];
    }
    edt1d(f, d, v, z, width);
    for (let x = 0; x < width; x++) {
      grid[row + x] = d[x];
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      f[y] = grid[y * width + x];
    }
    edt1d(f, d, v, z, height);
    for (let y = 0; y < height; y++) {
      grid[y * width + x] = d[y];
    }
  }
  const dist = new Float32Array(width * height);
  let max = 0;
  for (let i = 0; i < dist.length; i++) {
    const val = Math.sqrt(grid[i]);
    dist[i] = val;
    if (val > max) {
      max = val;
    }
  }
  return { dist, max };
}
function resolveMaskMode(mode, pixels) {
  if (mode !== "auto") {
    return mode;
  }
  return hasAlpha(pixels) ? "alpha" : "luma";
}
function findContentBounds(cov, width, height, trim) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  if (trim) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (cov[row + x] > 0.06) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return { boxH: height, boxW: width, minX: 0, minY: 0 };
  }
  return {
    boxH: maxY - minY + 1,
    boxW: maxX - minX + 1,
    minX,
    minY
  };
}
function sampleDots(cov, tone, dist, width, height, bounds, cols, rows, threshold) {
  const cellW = bounds.boxW / cols;
  const cellH = bounds.boxH / rows;
  const dots = [];
  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor(bounds.minY + row * cellH);
    const y1 = Math.max(y0 + 1, Math.floor(bounds.minY + (row + 1) * cellH));
    for (let col = 0; col < cols; col++) {
      const x0 = Math.floor(bounds.minX + col * cellW);
      const x1 = Math.max(x0 + 1, Math.floor(bounds.minX + (col + 1) * cellW));
      let sum = 0;
      let count = 0;
      let weightedDepth = 0;
      let weightedTone = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        const r = y * width;
        for (let x = x0; x < x1 && x < width; x++) {
          sum += cov[r + x];
          weightedDepth += dist[r + x] * cov[r + x];
          weightedTone += tone[r + x] * cov[r + x];
          count++;
        }
      }
      if (count === 0) {
        continue;
      }
      const v = sum / count;
      if (v < threshold) {
        continue;
      }
      dots.push({
        col,
        d: sum > 0 ? weightedDepth / sum : 0,
        row,
        t: sum > 0 ? weightedTone / sum : 1,
        v: clamp01(v),
        x: (col + 0.5) / cols,
        y: (row + 0.5) / rows
      });
    }
  }
  return dots;
}
function normalizeDepth(dots) {
  let maxDepth = 0;
  for (const dot of dots) {
    maxDepth = Math.max(maxDepth, dot.d);
  }
  for (const dot of dots) {
    dot.d = maxDepth > 0 ? clamp01(dot.d / maxDepth) : 0;
  }
}
async function bake(source, options = {}) {
  const opts = resolveBakeOptions(options);
  const { data, width, height } = await rasterize(source, opts.workingSize);
  const mode = resolveMaskMode(opts.maskMode, data.data);
  let cov = buildCoverage(data, width, height, mode, opts.invert);
  const tone = buildTone(data, cov);
  if (opts.gamma !== 1) {
    const g = Math.max(0.05, opts.gamma);
    for (let i = 0; i < cov.length; i++) {
      cov[i] **= g;
    }
  }
  cov = dilateCoverage(cov, width, height, opts.dilate);
  const mask = new Uint8Array(cov.length);
  for (let i = 0; i < cov.length; i++) {
    mask[i] = cov[i] > 0.5 ? 1 : 0;
  }
  const bounds = findContentBounds(cov, width, height, opts.trim);
  const { dist } = distanceTransform(mask, width, height);
  const longest = Math.max(bounds.boxW, bounds.boxH);
  const cols = Math.max(1, Math.round(bounds.boxW / longest * opts.grid));
  const rows = Math.max(1, Math.round(bounds.boxH / longest * opts.grid));
  const dots = sampleDots(
    cov,
    tone,
    dist,
    width,
    height,
    bounds,
    cols,
    rows,
    opts.threshold
  );
  normalizeDepth(dots);
  return {
    aspect: bounds.boxW / bounds.boxH,
    cells: cols * rows,
    cols,
    dots,
    maskMode: mode,
    rows
  };
}
const cache = /* @__PURE__ */ new Map();
function bakeKey(src, options = {}) {
  const o = resolveBakeOptions(options);
  return [
    src,
    o.grid,
    o.threshold,
    o.gamma,
    o.maskMode,
    o.invert ? 1 : 0,
    o.dilate,
    o.trim ? 1 : 0,
    o.workingSize
  ].join("|");
}
async function bakeAndForgetOnFailure(key, src, options) {
  try {
    return await bake(src, options);
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}
function bakeCached(src, options = {}) {
  const key = bakeKey(src, options);
  let hit = cache.get(key);
  if (!hit) {
    hit = bakeAndForgetOnFailure(key, src, options);
    cache.set(key, hit);
  }
  return hit;
}
function clearBakeCache() {
  cache.clear();
}
export {
  DEFAULT_BAKE,
  bake,
  bakeCached,
  bakeKey,
  clearBakeCache,
  resolveBakeOptions
};
