/* JWBR/EUR: simulated market + "trade to unlock" game, drawn on <canvas> at 60 fps.

   Price model: geometric random walk with hidden trend regimes (up / flat / down) that
   switch at random (~every 3.5 s on average). Trends persist, so reading the chart gives
   a real edge. After each losing trade a small, invisible "assist" makes regime switches
   lean towards the player's side, so nobody stays stuck for long. */
(() => {
  'use strict';
  const JW = (window.JW = window.JW || {});

  const TICK_MS = 100, TPC = 5, NC = 64;        // 10 ticks/s, 0.5 s candles, 64 candles on screen
  const SIG = 0.0006, MU = 0.00024, HAZARD = 1 / 35;
  const LEV = 20, START = 1000, GOAL = 1200, STOP = 150, MARGIN_CALL = 750;
  const KEY = 'jw-contact-unlocked';
  const UP = '#e9e7d2', DN = '#8c7cf0';

  const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  const eur = n => (n < -0.004 ? '−' : '') + '€' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sEur = n => (n > 0.004 ? '+' : '') + eur(n);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------------- market ---------------- */
  const M = { candles: [], price: 100, k: 0, mu: 0, nextId: 0, lastTick: 0 };

  function pickRegime(fav, assist) {
    const w = { 1: 1, 0: 0.8, '-1': 1 };
    if (fav) w[fav] += 4 * assist;
    let r = Math.random() * (w[1] + w[0] + w[-1]);
    for (const s of [1, 0, -1]) { r -= w[s]; if (r <= 0) return s * MU; }
    return 0;
  }
  function step(fav, assist) {
    if (Math.random() < HAZARD) M.mu = pickRegime(fav, assist);
    M.price *= Math.exp(M.mu + SIG * gauss());
  }
  for (let j = 0; j < NC; j++) {
    const c = { id: M.nextId++, o: M.price, h: M.price, l: M.price, c: M.price };
    for (let t = 0; t < TPC; t++) { step(0, 0); c.h = Math.max(c.h, M.price); c.l = Math.min(c.l, M.price); }
    c.c = M.price;
    M.candles.push(c);
  }

  /* ---------------- game state ---------------- */
  const G = { phase: 'idle', equity: START, side: 0, entry: 0, notional: 0, openedAt: 0,
              losses: 0, assist: 0, skipped: false, fills: [], markers: [] };
  const upnl = () => (G.side ? G.side * G.notional * (M.price / G.entry - 1) : 0);
  const tpPrice = () => G.entry * (1 + G.side * (GOAL - G.equity) / G.notional);
  const slPrice = () => G.entry * (1 - G.side * STOP / G.notional);

  function open(side) {
    if (G.phase !== 'idle') return;
    Object.assign(G, { phase: 'open', side, entry: M.price, notional: G.equity * LEV, openedAt: performance.now() });
    G.markers.push({ id: M.candles[M.candles.length - 1].id, price: M.price, kind: side > 0 ? 'long' : 'short' });
    ui();
  }

  function close(reason = 'manual') {
    if (G.phase !== 'open') return;
    const exit = reason === 'stop' ? slPrice() : M.price;
    const pnl = reason === 'stop' ? -STOP : upnl();
    G.equity += pnl;
    G.markers.push({ id: M.candles[M.candles.length - 1].id, price: exit, kind: 'exit' });
    G.fills.unshift({ side: G.side, entry: G.entry, exit, pnl });
    G.fills.length = Math.min(G.fills.length, 4);
    G.side = 0;
    G.phase = 'idle';

    if (G.equity >= GOAL - 0.005) {
      G.phase = 'won';
      try { localStorage.setItem(KEY, '1'); } catch (e) {}
      flash('Target hit · ' + eur(G.equity), UP);
      JW.unlock && JW.unlock(true);
    } else if (pnl < 0) {
      G.losses++;
      G.assist = Math.min(0.4, 0.12 * G.losses);
      if (G.equity < MARGIN_CALL) {
        G.equity = START;
        flash('Margin call · account reset to €1,000', DN);
      } else flash((reason === 'stop' ? 'Stopped out · ' : '') + sEur(pnl), DN);
    } else flash(sEur(pnl), UP);
    ui();
  }

  function skip() {
    if (G.phase === 'open') close();
    G.phase = 'won';
    G.skipped = true;
    JW.unlock && JW.unlock(true);
    ui();
  }

  function reset() {
    Object.assign(G, { phase: 'idle', equity: START, side: 0, losses: 0, assist: 0, skipped: false, restored: false, fills: [], markers: [] });
    ui();
  }

  /* ---------------- tick loop ---------------- */
  function tick() {
    step(G.side, G.side ? G.assist : 0);
    const p = M.price;
    let last = M.candles[M.candles.length - 1];
    if (++M.k >= TPC) {
      M.k = 0;
      last = { id: M.nextId++, o: last.c, h: Math.max(last.c, p), l: Math.min(last.c, p), c: p };
      M.candles.push(last);
      if (M.candles.length > NC) M.candles.shift();
    } else {
      last.h = Math.max(last.h, p); last.l = Math.min(last.l, p); last.c = p;
    }
    M.lastTick = performance.now();
    if (G.phase === 'open') {
      const u = upnl();
      if (G.equity + u >= GOAL) close('target');
      else if (u <= -STOP) close('stop');
    }
    ui();
  }

  /* ---------------- DOM ---------------- */
  const $ = id => document.getElementById(id);
  let D = null;
  function bindDom() {
    D = {
      price: document.querySelectorAll('[data-bind="price"]'), quote: document.querySelectorAll('[data-bind="quote"]'),
      tapeVal: document.querySelectorAll('[data-bind="tape-val"]'), tapeChg: document.querySelectorAll('[data-bind="tape-chg"]'),
      equity: $('g-equity'), pos: $('g-pos'), upnl: $('g-upnl'), prog: $('g-prog'), status: $('g-status'),
      long: $('g-long'), short: $('g-short'), close: $('g-close'), reset: $('g-reset'), fills: $('g-fills'), flash: $('g-flash'),
    };
  }

  let flashTimer = 0;
  function flash(text, col) {
    if (!D) return;
    D.flash.textContent = text;
    D.flash.style.color = col;
    D.flash.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => D.flash.classList.remove('show'), 1600);
  }

  function ui() {
    if (!D) return;
    const p = M.price, ps = p.toFixed(2);
    const chg = (p / 100 - 1) * 100, up = chg >= 0;
    const chgStr = (up ? '+' : '−') + Math.abs(chg).toFixed(2) + '%';
    D.price.forEach(e => (e.textContent = ps));
    D.quote.forEach(e => { e.textContent = ps + ' ' + chgStr; e.className = up ? 'up' : 'dn'; });
    D.tapeVal.forEach(e => (e.textContent = ps));
    D.tapeChg.forEach(e => { e.textContent = chgStr; e.className = up ? 'up' : 'dn'; });

    const u = upnl(), total = G.equity + u - START;
    D.equity.textContent = eur(G.equity + u);
    D.pos.textContent = G.side ? `${G.side > 0 ? 'LONG' : 'SHORT'} 20× @ ${G.entry.toFixed(2)}` : '—';
    D.pos.style.color = G.side ? (G.side > 0 ? UP : DN) : '';
    D.upnl.textContent = sEur(u);
    D.upnl.style.color = u > 0.005 ? UP : u < -0.005 ? DN : '';
    const won = G.phase === 'won';
    D.prog.style.width = (won ? 100 : total >= 0 ? clamp(total / (GOAL - START), 0, 1) * 100 : clamp(-total / (START - MARGIN_CALL), 0, 1) * 100) + '%';
    D.prog.style.background = won || total >= 0 ? UP : DN;

    if (G.phase === 'idle') D.status.textContent = G.fills.length ? `Equity ${eur(G.equity)} · ${eur(GOAL - G.equity)} to go. Pick a side.` : 'Pick a side. Stop-loss at −€150 per trade.';
    else if (G.phase === 'open') {
      const secs = ((performance.now() - G.openedAt) / 1000).toFixed(1);
      D.status.textContent = `Position open · ${secs}s · TP ${tpPrice().toFixed(2)} · SL ${slPrice().toFixed(2)}`;
    } else D.status.textContent = G.skipped ? 'Game skipped. Details unlocked.' : G.restored ? 'Unlocked on an earlier visit.' : 'Target hit. Position closed. Details unlocked.';

    D.long.hidden = D.short.hidden = G.phase !== 'idle';
    D.close.hidden = G.phase !== 'open';
    D.reset.hidden = !won;
    D.reset.textContent = G.skipped ? 'Play anyway' : 'Play again';

    const fillsHTML = G.fills.map(f =>
      `<div class="fill"><span style="color:${f.side > 0 ? UP : DN}">${f.side > 0 ? 'LONG' : 'SHORT'}</span>` +
      `<span>${f.entry.toFixed(2)} → ${f.exit.toFixed(2)}</span><span style="color:${f.pnl >= 0 ? UP : DN}">${sEur(f.pnl)}</span></div>`).join('');
    if (D.fills.innerHTML !== fillsHTML) D.fills.innerHTML = fillsHTML;
    D.fills.hidden = !G.fills.length;
  }

  /* ---------------- canvas chart ---------------- */
  const AXIS = 78, TOP = 30, BOT = 10, SLOTS = NC + 3;
  let cv, ctx, W = 0, H = 0, dpr = 1, hover = null, wasVisible = false;
  const view = { lo: 0, hi: 0, disp: 0, init: false };

  function resize() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }

  function niceStep(range) {
    const raw = range / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    return (n < 1.5 ? 1 : n < 2.25 ? 2 : n < 3.5 ? 2.5 : n < 7.5 ? 5 : 10) * mag;
  }

  function tag(y, text, bg, fg = bg === UP ? '#1b1a19' : '#fff') {
    ctx.fillStyle = bg;
    ctx.fillRect(W - AXIS, Math.round(y - 9), AXIS, 18);
    ctx.fillStyle = fg;
    ctx.fillText(text, W - AXIS + 8, y + 0.5);
  }
  function hline(y, col, dash, x0 = 0) {
    ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.beginPath();
    ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(W - AXIS, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
  }

  function draw() {
    requestAnimationFrame(draw);
    const vis = !!JW.gameVisible;
    if (vis && !wasVisible) view.init = false;
    wasVisible = vis;
    if (!vis || !W || !H) return;
    const cs = M.candles, last = cs[cs.length - 1];
    if (!view.init) view.disp = last.c;
    view.disp += (last.c - view.disp) * 0.35;
    const disp = view.disp;

    let lo = Infinity, hi = -Infinity;
    for (const c of cs) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }
    if (G.phase === 'open') { const a = [G.entry, tpPrice(), slPrice()]; lo = Math.min(lo, ...a); hi = Math.max(hi, ...a); }
    const pad = Math.max((hi - lo) * 0.08, 0.05); lo -= pad; hi += pad;
    if (!view.init) { view.lo = lo; view.hi = hi; view.init = true; }
    view.lo += (lo - view.lo) * 0.12; view.hi += (hi - view.hi) * 0.12;
    lo = view.lo; hi = view.hi;

    const plotW = W - AXIS, cw = plotW / SLOTS;
    const Y = v => TOP + (hi - v) / (hi - lo) * (H - TOP - BOT);
    const V = y => hi - (y - TOP) / (H - TOP - BOT) * (hi - lo);
    const X = i => i * cw + cw / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;

    // grid + axis labels
    const st = niceStep(hi - lo);
    for (let i = 1; i < 6; i++) { const x = Math.round(plotW * i / 6) + 0.5; ctx.strokeStyle = 'rgba(233,231,210,.04)'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let v = Math.ceil(lo / st) * st; v < hi; v += st) {
      const y = Y(v);
      if (y < TOP - 4 || y > H - 4) continue;
      hline(y, 'rgba(233,231,210,.07)', []);
      ctx.fillStyle = '#9d97ad'; ctx.fillText(v.toFixed(2), W - AXIS + 8, y);
    }
    ctx.strokeStyle = 'rgba(233,231,210,.14)'; ctx.beginPath(); ctx.moveTo(plotW + 0.5, 0); ctx.lineTo(plotW + 0.5, H); ctx.stroke();

    // open-position P&L zone
    if (G.phase === 'open') {
      const m = G.markers[G.markers.length - 1], xi = Math.max(0, X(m.id - cs[0].id));
      const yE = Y(G.entry), yP = Y(disp), good = G.side * (disp - G.entry) >= 0;
      ctx.fillStyle = good ? 'rgba(200,199,147,.09)' : 'rgba(110,96,230,.16)';
      ctx.fillRect(xi, Math.min(yE, yP), plotW - xi, Math.abs(yP - yE));
    }

    // candles
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i], isLast = i === cs.length - 1;
      const cc = isLast ? disp : c.c, h = isLast ? Math.max(c.h, disp) : c.h, l = isLast ? Math.min(c.l, disp) : c.l;
      const col = cc >= c.o ? UP : DN, x = Math.round(X(i)) + 0.5;
      ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x, Y(h)); ctx.lineTo(x, Y(l)); ctx.stroke();
      const top = Y(Math.max(c.o, cc)), bh = Math.max(1, Y(Math.min(c.o, cc)) - top), bw = Math.max(1, cw * 0.64);
      ctx.fillStyle = col; ctx.fillRect(x - bw / 2, top, bw, bh);
    }

    // trade markers
    for (const m of G.markers) {
      const i = m.id - cs[0].id;
      if (i < 0) continue;
      const x = X(i), y = Y(m.price), s = 5;
      ctx.beginPath();
      if (m.kind === 'long') { ctx.fillStyle = UP; ctx.moveTo(x, y + 4); ctx.lineTo(x - s, y + 4 + s * 1.6); ctx.lineTo(x + s, y + 4 + s * 1.6); }
      else if (m.kind === 'short') { ctx.fillStyle = DN; ctx.moveTo(x, y - 4); ctx.lineTo(x - s, y - 4 - s * 1.6); ctx.lineTo(x + s, y - 4 - s * 1.6); }
      else { ctx.fillStyle = '#fff'; ctx.arc(x, y, 3.5, 0, Math.PI * 2); }
      ctx.fill();
    }

    // position lines
    const tags = [];
    if (G.phase === 'open') {
      hline(Y(G.entry), '#9d97ad', [4, 4]); tags.push([Y(G.entry), G.entry.toFixed(2), '#3F2548']);
      const tp = tpPrice(), sl = slPrice();
      hline(Y(tp), UP, [6, 4]); tags.push([Y(tp), 'TP ' + tp.toFixed(2), UP]);
      hline(Y(sl), DN, [6, 4]); tags.push([Y(sl), 'SL ' + sl.toFixed(2), DN]);
    }

    // last price
    const lastCol = disp >= last.o ? UP : DN;
    hline(Y(disp), lastCol, [1, 3]);
    tags.push([Y(disp), disp.toFixed(2), lastCol]);

    // crosshair
    let hi_i = cs.length - 1;
    if (hover && hover.x < plotW && hover.y > 0 && hover.y < H) {
      hi_i = clamp(Math.floor(hover.x / cw), 0, cs.length - 1);
      const x = Math.round(X(hi_i)) + 0.5;
      ctx.strokeStyle = '#6a6480'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.setLineDash([]);
      hline(hover.y, '#6a6480', [3, 3]);
      tags.push([hover.y, V(hover.y).toFixed(2), '#6a6480']);
    }
    for (const t of tags) tag(...t);

    // OHLC legend
    const hc = cs[hi_i], hcC = hi_i === cs.length - 1 ? disp : hc.c, lc = hcC >= hc.o ? UP : DN;
    let lx = 12;
    const put = (txt, col) => { ctx.fillStyle = col; ctx.fillText(txt, lx, 15); lx += ctx.measureText(txt).width; };
    const narrow = plotW < 440;
    if (!narrow) put('JWBR/EUR · 0.5s   ', '#9d97ad');
    for (const [k, v] of [['O', hc.o], ['H', Math.max(hc.h, hcC)], ['L', Math.min(hc.l, hcC)], ['C', hcC]]) { put(k + ' ', '#9d97ad'); put(v.toFixed(2) + (narrow ? ' ' : '  '), lc); }
  }

  /* ---------------- init (called by main.js once the DOM shell exists) ---------------- */
  JW.skip = skip;
  JW.initGame = () => {
    bindDom();
    cv = $('chart'); ctx = cv.getContext('2d');
    new ResizeObserver(resize).observe(cv);
    cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); hover = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    cv.addEventListener('pointerleave', () => (hover = null));
    D.long.addEventListener('click', () => open(1));
    D.short.addEventListener('click', () => open(-1));
    D.close.addEventListener('click', () => close());
    D.reset.addEventListener('click', reset);
    document.addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const r = cv.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return; // only while the chart is on screen
      if (e.target.closest && e.target.closest('input,textarea,select')) return;
      const k = e.key.toLowerCase();
      if (k === 'l' && G.phase === 'idle') open(1);
      else if (k === 's' && G.phase === 'idle') open(-1);
      else if (k === 'x' && G.phase === 'open') close();
    });

    let stored = false;
    try { stored = localStorage.getItem(KEY) === '1'; } catch (e) {}
    if (stored) { G.phase = 'won'; G.restored = true; JW.unlock && JW.unlock(false); }
    ui();
    setInterval(tick, TICK_MS);
    requestAnimationFrame(draw);
  };
})();
