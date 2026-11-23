"use strict";

const byId = (id) => document.getElementById(id);
const interval = byId("interval");
const cost = byId("cost");
const timeline = byId("timeline");
const priceCanvas = byId("price-chart");
const pnlCanvas = byId("pnl-chart");
const play = byId("play");
const charts = [priceCanvas, pnlCanvas];
const css = getComputedStyle(document.documentElement);
const palette = Object.fromEntries(
  ["paper", "muted", "grid", "reference", "accent", "price", "hedged", "unhedged", "area-start", "area-end", "mono"]
    .map((name) => [name, css.getPropertyValue("--" + name).trim()]),
);

const euros = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const signedEuros = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", signDisplay: "exceptZero" });
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const MS_PER_DAY = 145;
const PRICE_SCALE = { low: 94, high: 118, step: 6 };
const PNL_SCALE = { low: -12, high: 4, step: 4 };

let position = DAYS;
let hoverDay = null;
let playbackStart = null;
let frame = null;
let displayedDay = null;
let displayedPoint = null;
let series = simulate(Number(interval.value), Number(cost.value));

function plotBounds(canvas) {
  const { width, height } = canvas.getBoundingClientRect();
  return { width, height, left: 33, right: width - 13, top: 12, bottom: height - 26 };
}

function drawChart(canvas, scale, showPrice, end) {
  const { width, height, left, right, top, bottom } = plotBounds(canvas);
  if (width <= 0 || height <= 0) return;
  const ratio = window.devicePixelRatio || 1;
  const pixelsWide = Math.round(width * ratio);
  const pixelsHigh = Math.round(height * ratio);
  if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
    canvas.width = pixelsWide;
    canvas.height = pixelsHigh;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(pixelsWide / width, 0, 0, pixelsHigh / height, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const x = (i) => left + i * (right - left) / DAYS;
  const y = (v) => bottom - (v - scale.low) * (bottom - top) / (scale.high - scale.low);
  const lastDay = Math.floor(end);
  const last = series[lastDay];
  const fraction = end - lastDay;

  function valueAtEnd(key) {
    if (fraction === 0) return last[key];
    return last[key] + (series[lastDay + 1][key] - last[key]) * fraction;
  }

  function rule(x1, y1, x2, y2, color, dash = []) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = palette.muted;
  ctx.font = "12px " + palette.mono;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let value = scale.low; value <= scale.high; value += scale.step) {
    const baseline = value === (showPrice ? STRIKE : 0);
    rule(left, y(value), right, y(value), baseline ? palette.reference : palette.grid, baseline ? [4, 4] : []);
    ctx.fillText(value.toString().replace("-", "−"), left - 8, y(value));
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const spacing = width < 460 ? 20 : 10;
  for (let i = 0; i <= DAYS; i += spacing) {
    rule(x(i), bottom, x(i), bottom + 4, palette.grid);
    ctx.fillText(i === 0 ? "Tag 0" : i.toString(), x(i), bottom + 8);
  }

  function trace(key) {
    ctx.beginPath();
    ctx.moveTo(x(0), y(series[0][key]));
    for (let i = 1; i <= lastDay; i++) ctx.lineTo(x(i), y(series[i][key]));
    if (fraction > 0) ctx.lineTo(x(end), y(valueAtEnd(key)));
  }

  function line(key, color, dash = []) {
    trace(key);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 2.1;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function dot(xPos, yPos, color) {
    ctx.beginPath();
    ctx.arc(xPos, yPos, 3.5, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = palette.paper;
    ctx.stroke();
  }

  if (showPrice) {
    const fill = ctx.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, palette["area-start"]);
    fill.addColorStop(1, palette["area-end"]);
    trace("spot");
    ctx.lineTo(x(end), bottom);
    ctx.lineTo(left, bottom);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    line("spot", palette.price);

    for (let i = 0; i <= lastDay; i++) {
      const point = series[i];
      if (Math.abs(point.trade) < 1e-12) continue;
      ctx.save();
      ctx.translate(x(point.day), y(point.spot));
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = palette.paper;
      ctx.fillRect(-3.1, -3.1, 6.2, 6.2);
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(-3.1, -3.1, 6.2, 6.2);
      ctx.restore();
    }
  } else {
    line("unhedged", palette.unhedged, [5, 4]);
    line("hedged", palette.hedged);
  }

  const cursor = hoverDay ?? end;
  const cursorX = x(cursor);
  if (hoverDay !== null || end < DAYS) {
    rule(cursorX, top, cursorX, bottom, palette.reference, [2, 4]);
  }
  const cursorValue = hoverDay === null ? valueAtEnd : (key) => series[hoverDay][key];
  if (showPrice) {
    if (hoverDay !== null || fraction > 0 || Math.abs(last.trade) < 1e-12) {
      dot(cursorX, y(cursorValue("spot")), palette.price);
    }
  } else {
    dot(cursorX, y(cursorValue("unhedged")), palette.unhedged);
    dot(cursorX, y(cursorValue("hedged")), palette.hedged);
  }
}

function syncRange(input, description) {
  const fill = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
  input.style.setProperty("--fill", (fill * 100) + "%");
  input.setAttribute("aria-valuetext", description);
}

function render(timestamp) {
  frame = null;
  if (playbackStart !== null) {
    position = Math.min(DAYS, Math.max(position, (timestamp - playbackStart) / MS_PER_DAY));
    if (position === DAYS) playbackStart = null;
  }

  // Interpolate the drawing while keeping readouts and trades on trading days.
  const day = Math.floor(position);
  const end = reducedMotion.matches ? day : position;
  drawChart(priceCanvas, PRICE_SCALE, true, end);
  drawChart(pnlCanvas, PNL_SCALE, false, end);

  const inspected = series[hoverDay ?? day];
  if (inspected !== displayedPoint) {
    const inspectedDay = "Tag " + inspected.day;
    byId("spot-day").textContent = inspectedDay;
    byId("spot-value").textContent = euros.format(inspected.spot);
    byId("result-day").textContent = inspectedDay;
    byId("results-title").textContent = inspected.day === DAYS ? "P&L am Verfall" : "P&L im Replay";
    byId("hedged-value").textContent = signedEuros.format(inspected.hedged);
    byId("unhedged-value").textContent = signedEuros.format(inspected.unhedged);
    byId("fees-value").textContent = euros.format(inspected.fees);
    displayedPoint = inspected;
  }
  if (day !== displayedDay) {
    byId("timeline-value").textContent = day + " / " + DAYS;
    timeline.setAttribute("aria-valuetext", "Tag " + day + " von " + DAYS);
    displayedDay = day;
  }
  if (Number(timeline.value) !== day) timeline.value = day;
  timeline.style.setProperty("--fill", (end * 100 / DAYS) + "%");
  timeline.classList.toggle("between-days", end !== day);

  const playing = playbackStart !== null;
  const label = playing ? "Pausieren" : position > 0 && position < DAYS ? "Fortsetzen" : "Replay starten";
  const playLabel = byId("play-label");
  if (playLabel.textContent !== label) playLabel.textContent = label;
  byId("play-icon").classList.toggle("is-playing", playing);
  if (playing) scheduleRender();
}

function scheduleRender() {
  if (frame === null) frame = requestAnimationFrame(render);
}

function recalculate() {
  const days = Number(interval.value);
  const bps = Number(cost.value);
  const dayLabel = days === 1 ? "1 Tag" : days + " Tage";
  byId("interval-value").textContent = dayLabel;
  byId("cost-value").textContent = bps + " bp";
  syncRange(interval, days + (days === 1 ? " Handelstag" : " Handelstage"));
  syncRange(cost, bps + (bps === 1 ? " Basispunkt" : " Basispunkte"));
  series = simulate(days, bps);
  scheduleRender();
}

function seek(nextDay) {
  playbackStart = null;
  hoverDay = null;
  position = nextDay;
  scheduleRender();
}

interval.addEventListener("input", recalculate);
cost.addEventListener("input", recalculate);
timeline.addEventListener("input", () => seek(Number(timeline.value)));
byId("reset").addEventListener("click", () => seek(0));
play.addEventListener("click", () => {
  if (playbackStart !== null) {
    playbackStart = null;
  } else {
    if (position === DAYS) position = 0;
    hoverDay = null;
    playbackStart = performance.now() - position * MS_PER_DAY;
  }
  scheduleRender();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && playbackStart !== null) {
    playbackStart = null;
    scheduleRender();
  }
});

for (const canvas of charts) {
  canvas.addEventListener("pointermove", (event) => {
    if (playbackStart !== null || event.pointerType === "touch") return;
    const { left, right } = plotBounds(canvas);
    const offset = event.clientX - canvas.getBoundingClientRect().left;
    const nextHover = Math.round(((offset - left) / (right - left)) * DAYS);
    const next = nextHover >= 0 && nextHover <= Math.floor(position) ? nextHover : null;
    if (next !== hoverDay) {
      hoverDay = next;
      scheduleRender();
    }
  });
  canvas.addEventListener("pointerleave", () => {
    if (hoverDay === null) return;
    hoverDay = null;
    scheduleRender();
  });
}
const observer = new ResizeObserver(scheduleRender);
for (const canvas of charts) observer.observe(canvas);
reducedMotion.addEventListener("change", scheduleRender);
recalculate();
document.fonts.ready.then(scheduleRender);
