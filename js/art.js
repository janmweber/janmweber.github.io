/* Generative art: stippled "sculptures of mathematics" and engraving-style plates.
   Everything is drawn procedurally on <canvas>, no image files needed.

   <canvas data-sculpt="trefoil|mixture|bell|saddle|sphere|torus" data-ghost="1" data-speed="0.1" data-color="#hex">
   <canvas data-art="ridges|halftone|vol|paths|eye"> */
(() => {
  'use strict';
  const JW = (window.JW = window.JW || {});
  const TAU = Math.PI * 2;
  const BONE = '#e9e7d2', GHOST = '#4d4fe0', RED = '#a99be0', BG = '#121110';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());

  function fit(cv) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }

  /* ================= surfaces ================= */
  const g2 = (x, z, cx, cz, s) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));
  const polar = (R, height) => (u, v) => {
    const x = R * u * Math.cos(TAU * v), z = R * u * Math.sin(TAU * v);
    return [x, height(x, z), z];
  };
  function trefoil(u, v) {
    const t = TAU * u, a = TAU * v, r = 0.62;
    const c = [Math.sin(t) + 2 * Math.sin(2 * t), Math.cos(t) - 2 * Math.cos(2 * t), -Math.sin(3 * t)];
    const d1 = [Math.cos(t) + 4 * Math.cos(2 * t), -Math.sin(t) + 4 * Math.sin(2 * t), -3 * Math.cos(3 * t)];
    const d2 = [-Math.sin(t) - 8 * Math.sin(2 * t), -Math.cos(t) + 8 * Math.cos(2 * t), 9 * Math.sin(3 * t)];
    const T = norm(d1), k = dot(d2, T), N = norm([d2[0] - k * T[0], d2[1] - k * T[1], d2[2] - k * T[2]]), B = cross(T, N);
    const n = [Math.cos(a) * N[0] + Math.sin(a) * B[0], Math.cos(a) * N[1] + Math.sin(a) * B[1], Math.cos(a) * N[2] + Math.sin(a) * B[2]];
    return [c[0] + r * n[0], c[1] + r * n[1], c[2] + r * n[2], n[0], n[1], n[2]];
  }
  // price path of the Delta Hedge Replay (same anchors + daily variation as its model.js)
  const HEDGE_PATH = (() => {
    const A = [[0, 100], [5, 97.1], [10, 99.8], [15, 105.2], [20, 103.4], [24, 99.4], [30, 104.7], [34, 110.7], [40, 106.5], [45, 111.9], [50, 108.3], [54, 114.3], [58, 111.6], [60, 115.9]];
    const out = [];
    for (let k = 1; k < A.length; k++) {
      const [d0, p0] = A[k - 1], [d1, p1] = A[k];
      for (let d = d0; d < d1; d++) { const f = (d - d0) / (d1 - d0); out.push(p0 + (p1 - p0) * f + Math.sin(Math.PI * f) * (1.38 * Math.sin(d * 2.31) + 0.6 * Math.cos(d * 1.17))); }
    }
    out.push(115.9);
    return out;
  })();
  const pathAt = t => { const x = Math.min(59.999, Math.max(0, t * 60)), i = Math.floor(x), f = x - i; return HEDGE_PATH[i] * (1 - f) + HEDGE_PATH[i + 1] * f; };
  // ribbon of the price path + dashed strike line + diamond marker at day 0
  function hedge(u, v) {
    const X = t => (t - 0.5) * 4.2, Y = p => (p - 106) / 6, front = 0.75;
    if (u < 0.74) { const t = u / 0.74; return [X(t), Y(pathAt(t)), (v - 0.5) * 2 * front]; }
    if (u < 0.88) {
      const t = (u - 0.74) / 0.14;
      if (Math.floor(t * 26) % 2) return [X(t), Y(100), front];        // gap: zero area, never sampled
      return [X(t), Y(100) + (v - 0.5) * 0.07, front];
    }
    const th = TAU * (u - 0.88) / 0.12, ph = Math.PI * v;
    const x = Math.sin(ph) * Math.cos(th), y = Math.cos(ph), z = Math.sin(ph) * Math.sin(th), n = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1, r = 0.27;
    return [X(0) + (x / n) * r, Y(100) + (y / n) * r * 1.35, front + (z / n) * r];
  }
  const SHAPES = {
    hedge: { f: hedge, tilt: 0.42, zoom: 1.25, swing: 0.55, yaw0: -0.3 },
    trefoil: { closed: true, f: trefoil, tilt: 0.35 },
    mixture: { f: polar(3, (x, z) => 2.3 * g2(x, z, -0.9, -0.35, 0.72) + 1.55 * g2(x, z, 1.05, 0.55, 0.62) + 0.7 * g2(x, z, 0.3, -1.4, 0.5)), tilt: 0.7, zoom: 1.45 },
    bell: { f: polar(3, (x, z) => 2.8 * g2(x, z, 0, 0, 0.85)), tilt: 0.5, zoom: 1.1 },
    saddle: { f: polar(1.7, (x, z) => 0.55 * (x * x - z * z)), tilt: 0.45, zoom: 1.05 },
    sphere: { closed: true, f: (u, v) => { const t = TAU * u, p = Math.PI * v, s = Math.sin(p); const x = s * Math.cos(t), y = Math.cos(p), z = s * Math.sin(t); return [x, y, z, x, y, z]; }, tilt: 0.2, zoom: 0.9 },
    torus: { closed: true, f: (u, v) => { const t = TAU * u, p = TAU * v, R = 1.4, r = 0.58, c = Math.cos(p); return [(R + r * c) * Math.cos(t), r * Math.sin(p), (R + r * c) * Math.sin(t), c * Math.cos(t), Math.sin(p), c * Math.sin(t)]; }, tilt: 0.62, zoom: 1.05 },
  };
  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

  const L = norm([-0.55, 0.62, 0.58]);

  class Sculpture {
    constructor(cv, o = {}) {
      this.cv = cv;
      this.shape = o.shape || cv.dataset.sculpt;
      this.color = o.color || cv.dataset.color || BONE;
      this.ghost = o.ghost ?? cv.dataset.ghost === '1';
      this.speed = o.speed ?? parseFloat(cv.dataset.speed || '0.1');
      this.density = o.density || 1;
      this.yaw = o.yaw ?? 0.7;
      this.seed = o.seed || 7;
      this.animated = !o.static && !reduce && this.speed > 0;
      this.visible = false;
      this.resize();
    }
    resize() {
      Object.assign(this, fit(this.cv));
      this.cv._w = Math.round(this.w); this.cv._h = Math.round(this.h);
      this.sample();
      this.render();
    }
    setShape(name) { this.shape = name; this.sample(); this.render(); }
    sample() {
      const sh = SHAPES[this.shape], r = rng(this.seed), e = 1e-4;
      const N = Math.round(Math.max(1200, Math.min(46000, (this.w * this.h) / 5)) * this.density);
      const area = (u, v) => {
        const p = sh.f(u, v), pu = sh.f(u + e, v), pv = sh.f(u, v + e);
        const a = [pu[0] - p[0], pu[1] - p[1], pu[2] - p[2]], b = [pv[0] - p[0], pv[1] - p[1], pv[2] - p[2]];
        const c = cross(a, b);
        return { p, c, A: Math.hypot(c[0], c[1], c[2]) };
      };
      // robust max of the area element (ignores finite-difference spikes at piece boundaries)
      const As = [];
      for (let i = 0; i < 4000; i++) As.push(area(r() * 0.9999, r() * 0.9999).A);
      As.sort((a, b) => a - b);
      const amax = As[Math.floor(As.length * 0.985)] * 1.15;
      const P = new Float32Array(N * 3), Nn = new Float32Array(N * 3), T = new Float32Array(N);
      let n = 0, it = 0;
      while (n < N && it++ < N * 40) {
        const u = r() * 0.9999, v = r() * 0.9999, s = area(u, v);
        if (r() * amax > s.A) continue;
        const p = s.p, nn = p.length > 3 ? [p[3], p[4], p[5]] : norm(s.c);
        P.set([p[0], p[1], p[2]], n * 3); Nn.set(nn, n * 3); T[n] = r(); n++;
      }
      // centre + normalise
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const q = P[i * 3 + k]; if (q < lo[k]) lo[k] = q; if (q > hi[k]) hi[k] = q; }
      const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      let R = 0;
      for (let i = 0; i < n; i++) { P[i * 3] -= c[0]; P[i * 3 + 1] -= c[1]; P[i * 3 + 2] -= c[2]; R = Math.max(R, Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])); }
      for (let i = 0; i < n * 3; i++) P[i] /= R;
      Object.assign(this, { P, Nn, T, n, sh, X: new Float32Array(n), Y: new Float32Array(n), Z: new Float32Array(n), B: new Float32Array(n) });
    }
    render(dt = 0) {
      if (!this.P) return;
      this.yaw += dt * this.speed;
      const { ctx, w, h, P, Nn, T, n, sh, X, Y, Z, B } = this;
      const yaw = sh.swing ? sh.yaw0 + sh.swing * Math.sin(this.yaw) : this.yaw;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), ta = sh.tilt || 0.3, ct = Math.cos(ta), st = Math.sin(ta);
      const D = 3.6, S = Math.min(w, h) * 0.37 * (sh.zoom || 1), cx = w / 2, cyy = h / 2;
      const cell = 4, gw = Math.ceil(w / cell) + 1, gh = Math.ceil(h / cell) + 1;
      if (!this.zb || this.zb.length !== gw * gh) this.zb = new Float32Array(gw * gh);
      const zb = this.zb; zb.fill(-9);
      const closed = !!sh.closed;
      // pass 1: transform, light, depth
      for (let i = 0; i < n; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
        const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct;
        let nx = Nn[i * 3], ny = Nn[i * 3 + 1], nz = Nn[i * 3 + 2];
        const nx1 = nx * cy + nz * sy, nz1 = -nx * sy + nz * cy;
        let ny2 = ny * ct - nz1 * st, nz2 = ny * st + nz1 * ct; nx = nx1;
        if (nz2 < 0) { if (closed) { B[i] = -1; continue; } nx = -nx; ny2 = -ny2; nz2 = -nz2; }
        const f = D / (D - z2), px = cx + x1 * S * f, py = cyy - y2 * S * f;
        X[i] = px; Y[i] = py; Z[i] = z2;
        const lam = Math.max(0, nx * L[0] + ny2 * L[1] + nz2 * L[2]);
        B[i] = (0.03 + 0.97 * Math.pow(lam, 1.05)) * (0.72 + 0.28 * (z2 + 1) / 2) + 0.18 * Math.pow(1 - nz2, 3);
        const gi = ((py / cell) | 0) * gw + ((px / cell) | 0);
        if (gi >= 0 && gi < zb.length && z2 > zb[gi]) zb[gi] = z2;
      }
      // pass 2: visible dots
      const path = new Path2D(), s = 1.15;
      for (let i = 0; i < n; i++) {
        if (B[i] < T[i]) continue;
        const gi = ((Y[i] / cell) | 0) * gw + ((X[i] / cell) | 0);
        if (gi >= 0 && gi < zb.length && Z[i] < zb[gi] - 0.07) continue;
        path.rect(X[i], Y[i], s, s);
      }
      ctx.clearRect(0, 0, w, h);
      if (this.ghost) {
        ctx.save(); ctx.translate(8, 5); ctx.globalAlpha = 0.75; ctx.fillStyle = GHOST; ctx.fill(path); ctx.restore();
      }
      ctx.fillStyle = this.color;
      ctx.fill(path);
    }
  }

  /* ================= static plates ================= */
  // fill the area under a polyline with the background (occlusion), leave the polyline as current path
  function poly(ctx, pts, yb) {
    ctx.beginPath(); ctx.moveTo(pts[0], yb);
    for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.lineTo(pts[pts.length - 2], yb); ctx.closePath();
    ctx.fillStyle = BG; ctx.fill();
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  }

  const PLATES = {
    // volatility clustering as engraved ridgelines
    ridges(ctx, w, h, r) {
      ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
      const n = Math.round(h / 8), top = h * 0.16, bot = h * 0.95, gap = (bot - top) / n;
      for (let i = 0; i < n; i++) {
        const y0 = top + i * gap, ph = [r() * TAU, r() * TAU, r() * TAU, r() * TAU], burst = r() < 0.3 ? 1 : 0.35;
        const peak = 0.52 + 0.08 * Math.sin(i * 0.23), shape = Math.sin(Math.PI * (i + 1) / (n + 1));
        const pts = [];
        for (let x = 0; x <= w; x += 2) {
          const t = x / w;
          const env = Math.exp(-(((t - peak) / 0.15) ** 2)) + 0.6 * burst * Math.exp(-(((t - 0.22) / 0.05) ** 2)) + 0.25 * Math.exp(-(((t - 0.8) / 0.06) ** 2));
          const nz = Math.abs(Math.sin(t * 9 * TAU + ph[0]) + 0.6 * Math.sin(t * 23 * TAU + ph[1]) + 0.35 * Math.sin(t * 51 * TAU + ph[2]) + 0.2 * Math.sin(t * 97 * TAU + ph[3]));
          pts.push(x, y0 - env * (0.35 + 0.65 * nz / 2.15) * gap * 7.5 * shape - (r() - 0.5) * 0.6);
        }
        poly(ctx, pts, y0 + gap * 2);
        ctx.strokeStyle = BONE; ctx.lineWidth = 0.9; ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1;
      }
    },
    // block-structured correlation matrix as halftone
    halftone(ctx, w, h, r) {
      ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
      const m = 16, cell = Math.min(w, h) / (m + 1.2), ox = (w - cell * m) / 2, oy = (h - cell * m) / 2;
      const blk = i => (i < 6 ? 0 : i < 11 ? 1 : 2), M = [];
      for (let i = 0; i < m; i++) { M[i] = []; for (let j = 0; j <= i; j++) { const v = i === j ? 1 : blk(i) === blk(j) ? 0.45 + 0.35 * r() : 0.04 + 0.2 * r(); M[i][j] = v; } }
      for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
        const v = j <= i ? M[i][j] : M[j][i], rad = cell * 0.48 * Math.sqrt(v);
        ctx.beginPath(); ctx.arc(ox + (j + 0.5) * cell, oy + (i + 0.5) * cell, rad, 0, TAU);
        ctx.fillStyle = i === j ? RED : BONE; ctx.fill();
      }
    },
    // implied-vol smile surface, engraved
    vol(ctx, w, h) {
      ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
      const sig = (k, T) => 0.16 + 0.22 * k * k / (0.45 + T) - 0.08 * k / (0.6 + T);
      const rows = 46;
      for (let j = rows; j >= 0; j--) {
        const T = j / rows, base = h * 0.9 - T * h * 0.5, pts = [];
        for (let i = 0; i <= 120; i++) {
          const k = -1 + 2 * i / 120;
          pts.push(w * 0.46 + k * w * 0.36 + T * w * 0.12, base - sig(k, T) * h * 0.55);
        }
        poly(ctx, pts, base + h);
        ctx.strokeStyle = BONE; ctx.globalAlpha = 0.3 + 0.65 * (1 - T); ctx.lineWidth = 0.9; ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = BONE; ctx.globalAlpha = 0.6; ctx.font = '10px Inter, sans-serif';
      ctx.fillText('σ(K, T)', 14, 20); ctx.globalAlpha = 1;
    },
    // Brownian fan + terminal histogram
    paths(ctx, w, h, r) {
      ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
      const N = 110, steps = 220, x0 = w * 0.05, x1 = w * 0.74, sd = h * 0.0135, ends = [];
      for (let p = 0; p < N; p++) {
        let y = h / 2; ctx.beginPath(); ctx.moveTo(x0, y);
        for (let s = 1; s <= steps; s++) { y += gauss(r) * sd; ctx.lineTo(x0 + (x1 - x0) * s / steps, y); }
        ends.push(y);
        ctx.strokeStyle = p === 0 ? RED : BONE; ctx.globalAlpha = p === 0 ? 1 : 0.13; ctx.lineWidth = p === 0 ? 1.5 : 0.8; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const bins = 34, cnt = new Array(bins).fill(0), bh = h / bins;
      ends.forEach(y => { const b = Math.floor(y / bh); if (b >= 0 && b < bins) cnt[b]++; });
      const mx = Math.max(...cnt), bx = w * 0.79, bw = w * 0.18;
      cnt.forEach((c, b) => { ctx.fillStyle = BONE; ctx.globalAlpha = 0.75; ctx.fillRect(bx, b * bh + 1, bw * c / mx, bh - 2); });
      ctx.globalAlpha = 1; ctx.strokeStyle = RED; ctx.lineWidth = 1.2; ctx.beginPath();
      const s2 = sd * Math.sqrt(steps);
      for (let y = 0; y <= h; y += 2) { const v = Math.exp(-((y - h / 2) ** 2) / (2 * s2 * s2)); const x = bx + bw * v; y ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    },
    // grainy flowing light bands with a sparkle (after the blurred-light reference)
    aura(ctx, w, h, r) {
      const cv = ctx.canvas, W = cv.width, H = cv.height, img = ctx.createImageData(W, H), d = img.data;
      const bands = [0, 1, 2, 3].map(k => ({ c: 0.18 + 0.22 * k, a: 0.9 - 0.12 * k, w: 0.1 + 0.04 * r(), p1: r(), p2: r(), f: 0.9 + 0.5 * r() }));
      const stops = [[0, [18, 17, 16]], [0.3, [53, 54, 156]], [0.58, [124, 103, 158]], [0.8, [190, 180, 210]], [1, [236, 234, 214]]];
      const ramp = t => {
        t = Math.max(0, Math.min(1, t));
        for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
          const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], q = (t - t0) / (t1 - t0);
          return [c0[0] + (c1[0] - c0[0]) * q, c0[1] + (c1[1] - c0[1]) * q, c0[2] + (c1[2] - c0[2]) * q];
        }
        return stops[stops.length - 1][1];
      };
      const sx = 0.56, sy = 0.5;
      for (let y = 0; y < H; y++) {
        const v = y / H;
        for (let x = 0; x < W; x++) {
          const u = x / W;
          let I = 0;
          for (const b of bands) {
            const c = b.c + 0.09 * Math.sin(TAU * (u * b.f + b.p1)) + 0.04 * Math.sin(TAU * (u * 2.6 + b.p2));
            const dv = v - c;
            I += b.a * (dv < 0 ? Math.exp(-((dv / (b.w * 0.4)) ** 2)) : Math.exp(-((dv / b.w) ** 2)));
          }
          const edge = Math.min(1, u / 0.1, (1 - u) / 0.1);
          I *= edge * edge * (3 - 2 * edge);
          I *= 1 - 0.85 * Math.exp(-(((u - sx) ** 2) / 0.006 + ((v - sy) ** 2) / 0.05));
          const col = ramp(I * 0.95 + (r() - 0.5) * 0.32);
          const k = (y * W + x) * 4;
          d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
        }
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(img, 0, 0); ctx.restore();
      // sparkle + horizontal flare
      const px = w * sx, py = h * sy, L = Math.min(w * 0.16, 200), g = ctx.createLinearGradient(px - L, 0, px + L, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(px - L, py - 0.6, 2 * L, 1.2);
      const s = Math.min(16, h * 0.08);
      ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(200,199,147,.9)'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.moveTo(px, py - s * 1.6); ctx.quadraticCurveTo(px + s * 0.12, py - s * 0.12, px + s, py); ctx.quadraticCurveTo(px + s * 0.12, py + s * 0.12, px, py + s * 1.6);
      ctx.quadraticCurveTo(px - s * 0.12, py + s * 0.12, px - s, py); ctx.quadraticCurveTo(px - s * 0.12, py - s * 0.12, px, py - s * 1.6); ctx.fill();
      ctx.shadowBlur = 0;
    },
  };

  function drawPlate(cv) {
    const { ctx, w, h } = fit(cv);
    const seed = [...cv.dataset.art].reduce((s, c) => s * 31 + c.charCodeAt(0), 17);
    PLATES[cv.dataset.art](ctx, w, h, rng(seed));
  }

  /* ================= stippled photo (B&W cut-out → dots) =================
     <canvas data-portrait="images/x.png">: greyscale PNG with alpha; bright = dense dots.
     Dots "develop" in when the canvas first scrolls into view. */
  const imgCache = {};
  const loadImg = src => (imgCache[src] = imgCache[src] || new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src;
  }));
  class Portrait {
    constructor(cv) {
      this.cv = cv;
      this.p = reduce ? 1 : 0;
      this.started = reduce;
      loadImg(cv.dataset.portrait).then(im => { this.img = im; this.resize(); }).catch(() => {});
    }
    resize() {
      if (!this.img) return;
      Object.assign(this, fit(this.cv));
      this.cv._w = Math.round(this.w); this.cv._h = Math.round(this.h);
      const { w, h, img } = this, s = Math.min(w / img.width, h / img.height);
      const dw = Math.round(img.width * s), dh = Math.round(img.height * s), ox = (w - dw) / 2, oy = h - dh;
      // Floyd–Steinberg dither on a ~1.7 px grid keeps the face readable while staying "dots"
      const cell = 1.7, gw = Math.max(1, Math.round(dw / cell)), gh = Math.max(1, Math.round(dh / cell));
      const oc = document.createElement('canvas'); oc.width = gw; oc.height = gh;
      const octx = oc.getContext('2d', { willReadFrequently: true });
      octx.drawImage(img, 0, 0, gw, gh);
      const px = octx.getImageData(0, 0, gw, gh).data, r = rng(11);
      const v = new Float32Array(gw * gh), on = new Uint8Array(gw * gh);
      for (let i = 0; i < gw * gh; i++) {
        const a = px[i * 4 + 3] / 255;
        on[i] = a > 0.03 ? 1 : 0;
        v[i] = Math.pow(Math.max(0, Math.min(1, (px[i * 4] / 255 - 0.04) / 0.92)), 1.15) * a;
      }
      const X = [], Y = [], T = [];
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const i = y * gw + x, old = v[i], nv = old > 0.5 ? 1 : 0, err = old - nv;
        if (x + 1 < gw) v[i + 1] += err * 7 / 16;
        if (y + 1 < gh) { if (x > 0) v[i + gw - 1] += err * 3 / 16; v[i + gw] += err * 5 / 16; if (x + 1 < gw) v[i + gw + 1] += err / 16; }
        if (nv && on[i]) { X.push(ox + x * cell + (r() - 0.5) * 0.5); Y.push(oy + y * cell + (r() - 0.5) * 0.5); T.push(r()); }
      }
      this.X = X; this.Y = Y; this.T = T;
      this.render();
    }
    render() {
      const { ctx, w, h, X, Y, T, p } = this;
      if (!X) return;
      const path = new Path2D();
      for (let i = 0; i < X.length; i++) if (T[i] <= p) path.rect(X[i], Y[i], 1.15, 1.15);
      ctx.clearRect(0, 0, w, h);
      ctx.save(); ctx.translate(7, 4); ctx.globalAlpha = 0.75; ctx.fillStyle = GHOST; ctx.fill(path); ctx.restore();
      ctx.fillStyle = BONE; ctx.fill(path);
    }
    reveal() {
      if (this.started) return;
      this.started = true;
      const t0 = performance.now();
      const step = t => { this.p = Math.min(1, (t - t0) / 1800); this.p = 1 - Math.pow(1 - this.p, 3); this.render(); if (t - t0 < 1800) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
  }

  /* ================= wiring ================= */
  const sculpts = [];
  let last = 0;
  function loop(t) {
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0; last = t;
    for (const s of sculpts) if (s.animated && s.visible) s.render(dt);
    requestAnimationFrame(loop);
  }

  JW.Sculpture = Sculpture;
  JW.sculpts = sculpts;
  JW.initArt = () => {
    const io = new IntersectionObserver(es => es.forEach(e => {
      const s = e.target._sculpt; if (s) s.visible = e.isIntersecting;
      if (e.isIntersecting && e.target._portrait) e.target._portrait.reveal();
    }), { rootMargin: '100px' });
    const ro = new ResizeObserver(es => es.forEach(e => {
      const cv = e.target, r = e.contentRect;
      if (!r.width || !r.height) return;
      if (cv._w === Math.round(r.width) && cv._h === Math.round(r.height)) return;
      cv._w = Math.round(r.width); cv._h = Math.round(r.height);
      if (cv._sculpt) cv._sculpt.resize(); else if (cv._portrait) cv._portrait.resize(); else if (cv.dataset.art) drawPlate(cv);
    }));
    document.querySelectorAll('canvas[data-portrait]').forEach(cv => {
      cv._portrait = new Portrait(cv); io.observe(cv); ro.observe(cv);
    });
    document.querySelectorAll('canvas[data-sculpt]').forEach(cv => {
      const s = new Sculpture(cv);
      cv._sculpt = s; sculpts.push(s); io.observe(cv); ro.observe(cv);
    });
    document.querySelectorAll('canvas[data-art]').forEach(cv => ro.observe(cv));
    requestAnimationFrame(loop);
  };
})();
