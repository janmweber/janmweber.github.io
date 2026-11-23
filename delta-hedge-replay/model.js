"use strict";

const DAYS = 60;
const STRIKE = 100;
const VOLATILITY = 0.25;
const TRADING_DAYS = 252;

function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const polynomial = t * (0.31938153 + t * (-0.356563782 +
    t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const upperTail = Math.exp(-0.5 * x * x) * polynomial / Math.sqrt(2 * Math.PI);
  return x < 0 ? upperTail : 1 - upperTail;
}

function callAt(spot, day) {
  if (day === DAYS) return { value: Math.max(spot - STRIKE, 0), delta: 0 };
  const width = VOLATILITY * Math.sqrt((DAYS - day) / TRADING_DAYS);
  const d1 = Math.log(spot / STRIKE) / width + width / 2;
  const delta = normalCdf(d1);
  return { value: spot * delta - STRIKE * normalCdf(d1 - width), delta };
}

// Interpolate an illustrative scenario with repeatable daily variation.
const anchors = [
  [0, 100], [5, 97.1], [10, 99.8], [15, 105.2], [20, 103.4],
  [24, 99.4], [30, 104.7], [34, 110.7], [40, 106.5], [45, 111.9],
  [50, 108.3], [54, 114.3], [58, 111.6], [60, 115.9],
];

const market = Object.freeze(anchors.slice(1).flatMap(([end, last], segment) => {
  const [start, first] = anchors[segment];
  return Array.from({ length: end - start }, (_, offset) => {
    const day = start + offset;
    const fraction = offset / (end - start);
    const variation = Math.sin(Math.PI * fraction) *
      (1.38 * Math.sin(day * 2.31) + 0.6 * Math.cos(day * 1.17));
    return Object.freeze({ day, spot: first + (last - first) * fraction + variation });
  });
}).concat(Object.freeze({ day: DAYS, spot: anchors.at(-1)[1] }))
  .map(({ day, spot }) => Object.freeze({ day, spot, ...callAt(spot, day) })));

function simulate(interval, costBps) {
  const premium = market[0].value;
  let shares = 0;
  let cash = premium;
  let fees = 0;
  return market.map(({ day, spot, value, delta }) => {
    let trade = 0;
    if (day === DAYS || day % interval === 0) {
      const targetShares = day === DAYS ? 0 : delta;
      trade = targetShares - shares;
      const turnover = Math.abs(trade) * spot;
      const fee = turnover * costBps / 10_000;
      cash -= trade * spot + fee;
      fees += fee;
      shares = targetShares;
    }
    return { day, spot, trade, fees, hedged: cash + shares * spot - value, unhedged: premium - value };
  });
}
