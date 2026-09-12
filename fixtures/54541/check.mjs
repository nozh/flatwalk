#!/usr/bin/env node
// Структурная проверка эталона 54541 без внешних API и без modules/contract.
// Запуск: node fixtures/54541/check.mjs   (выход 0 — все проверки прошли)
// Проверяет: уникальность и разрешимость ссылок, планарность графа стен, проёмы внутри стен и без пересечений,
// диапазоны ширин Validator, масштаб по заявленной площади, связность по дверям, признаки масштаба.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const M = JSON.parse(readFileSync(join(here, "flat.model.json"), "utf8"));
const EPS = 0.01; // допуск совпадения точек, м
const errors = [], notes = [];
const fail = (s) => errors.push(s);

// --- ссылки и типы ---
for (const [id, w] of Object.entries(M.walls)) {
  if (!M.vertices[w.a] || !M.vertices[w.b]) fail(`wall ${id}: вершина не найдена`);
  if (w.a === w.b) fail(`wall ${id}: a == b`);
  if (!(w.thickness > 0)) fail(`wall ${id}: толщина`);
  if (!w.meta?.provenance) fail(`wall ${id}: нет meta.provenance`);
}
for (const [id, o] of Object.entries(M.openings)) {
  if (!M.walls[o.wall]) fail(`opening ${id}: стена ${o.wall} не найдена`);
  if (!["door", "window"].includes(o.kind)) fail(`opening ${id}: kind ${o.kind}`);
}
for (const [id, r] of Object.entries(M.rooms)) if (!Array.isArray(r.anchor) || r.anchor.length !== 2) fail(`room ${id}: anchor`);
for (const [id, a] of Object.entries(M.assets)) {
  if (a.kind === "photo") {
    if (!M.rooms[a.room]) fail(`asset ${id}: комната ${a.room}`);
    if (a.faces && !M.walls[a.faces]) fail(`asset ${id}: стена ${a.faces}`);
  }
}
if (M.assets[M.plan.asset]?.kind !== "image") fail("plan.asset не указывает на image");

// --- геометрия ---
const P = (v) => M.vertices[v];
const seg = (w) => [P(w.a), P(w.b)];
const len = ([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const distPS = (p, [a, b]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const W = Object.entries(M.walls);
// вершина не лежит внутри чужой стены
for (const [vid, p] of Object.entries(M.vertices)) {
  for (const [wid, w] of W) {
    if (w.a === vid || w.b === vid) continue;
    if (distPS(p, seg(w)) < EPS) fail(`вершина ${vid} лежит на стене ${wid} (нужен T-стык)`);
  }
}
// стены не пересекаются вне вершин (ортогональный случай + общий)
const cross = (a, b, c, d) => (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
for (let i = 0; i < W.length; i++) for (let j = i + 1; j < W.length; j++) {
  const [ia, wa] = W[i], [ib, wb] = W[j];
  const shared = new Set([wa.a, wa.b].filter((v) => v === wb.a || v === wb.b));
  const [a, b] = seg(wa), [c, d] = seg(wb);
  if (shared.size) {
    // общая вершина: проверяем, что стены не коллинеарны с наложением
    const other = shared.size === 2;
    if (other) fail(`стены ${ia} и ${ib} дублируют друг друга`);
    continue;
  }
  const den = cross(a, b, c, d);
  if (Math.abs(den) < 1e-12) continue; // параллельные: наложение поймано проверкой вершин выше
  const t = cross(c, a, c, d) / -den, u = cross(a, b, a, c) / den;
  if (t > 0 && t < 1 && u > 0 && u < 1) fail(`стены ${ia} и ${ib} пересекаются вне вершин`);
}
// проёмы внутри стены, не пересекаются, ширины по слою «Геометрия» Validator
const byWall = {};
for (const [id, o] of Object.entries(M.openings)) (byWall[o.wall] ??= []).push([id, o]);
for (const [wid, list] of Object.entries(byWall)) {
  const L = len(seg(M.walls[wid]));
  list.sort((x, y) => x[1].at - y[1].at);
  let end = -1;
  for (const [id, o] of list) {
    if (o.at < -1e-9 || o.at + o.width > L + 1e-9) fail(`opening ${id}: выходит за стену ${wid} (at=${o.at}, w=${o.width}, L=${L.toFixed(3)})`);
    if (o.at < end - 1e-9) fail(`opening ${id}: пересекается с предыдущим проёмом на ${wid}`);
    end = o.at + o.width;
    if (o.kind === "door" && (o.width < 0.6 || o.width > 1.4)) fail(`opening ${id}: ширина двери ${o.width}`);
    if (o.kind === "window" && (o.width < 0.4 || o.width > 4)) fail(`opening ${id}: ширина окна ${o.width}`);
  }
}
const entrances = Object.entries(M.openings).filter(([, o]) => o.entrance);
if (entrances.length !== 1) fail(`входов: ${entrances.length}`);
else if (!M.walls[entrances[0][1].wall].exterior) fail("вход не на внешней стене");

// --- комнаты как грани ортогонального графа: якорь не на стене, лучи от якоря по четырём осям упираются в стены ---
const cross2 = (v, w) => v[0] * w[1] - v[1] * w[0];
// расстояние по лучу из p в направлении d до ближайшей стены (Infinity, если луч уходит наружу)
const rayDist = (p, d) => {
  let best = Infinity;
  for (const [, w] of W) {
    const [a, b] = seg(w); const e = [b[0] - a[0], b[1] - a[1]]; const ap = [a[0] - p[0], a[1] - p[1]];
    const den = cross2(d, e); if (Math.abs(den) < 1e-12) continue;
    const t = cross2(ap, e) / den, u = cross2(ap, d) / den;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
};
for (const [rid, r] of Object.entries(M.rooms)) {
  for (const [wid, w] of W) if (distPS(r.anchor, seg(w)) < w.thickness / 2 + EPS) fail(`room ${rid}: якорь на стене ${wid}`);
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!isFinite(rayDist(r.anchor, d))) fail(`room ${rid}: луч (${d}) от якоря не упирается в стену — грань не замкнута`);
}

// --- масштаб: площадь заливки по осям = areaDeclared (basis declared-area). Комнаты — прямоугольники по осям стен,
// поэтому площадь = произведение сторон, найденных лучами от якоря. ---
let areaSum = 0;
const areas = {};
for (const [rid, r] of Object.entries(M.rooms)) {
  const wdt = rayDist(r.anchor, [1, 0]) + rayDist(r.anchor, [-1, 0]);
  const hgt = rayDist(r.anchor, [0, 1]) + rayDist(r.anchor, [0, -1]);
  areas[rid] = Math.round(wdt * hgt * 100) / 100; areaSum += wdt * hgt;
  if (wdt * hgt < 1.5 || wdt * hgt > 80) fail(`room ${rid}: площадь ${(wdt * hgt).toFixed(2)} вне 1.5–80`);
}
notes.push(`площади (м², по осям, только для прямоугольных комнат): ${JSON.stringify(areas)}; Σ=${areaSum.toFixed(2)} при areaDeclared=${M.flat.areaDeclared}`);
if (Math.abs(areaSum - M.flat.areaDeclared) > 0.5) fail(`Σ площадей ${areaSum.toFixed(2)} ≠ areaDeclared ${M.flat.areaDeclared}`);

// --- связность по проходимым дверям: комнаты по обе стороны двери определяем якорями соседних граней ---
// сторона двери: точка на 5 см от середины проёма по нормали; комната = ближайший якорь, чей прямоугольник содержит точку.
const roomAt = (p) => Object.entries(M.rooms).find(([, r]) => {
  const l = rayDist(r.anchor, [-1, 0]), rr = rayDist(r.anchor, [1, 0]), u = rayDist(r.anchor, [0, -1]), d = rayDist(r.anchor, [0, 1]);
  return p[0] > r.anchor[0] - l && p[0] < r.anchor[0] + rr && p[1] > r.anchor[1] - u && p[1] < r.anchor[1] + d;
})?.[0];
const adj = Object.fromEntries(Object.keys(M.rooms).map((r) => [r, new Set()]));
const doorPairs = {};
for (const [id, o] of Object.entries(M.openings)) {
  if (o.kind !== "door" || o.passable === false || o.entrance) continue;
  const w = M.walls[o.wall]; const [a, b] = seg(w); const L = len([a, b]);
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; const s = o.at + o.width / 2;
  const mid = [a[0] + ux * s, a[1] + uy * s]; const off = w.thickness / 2 + 0.05;
  const r1 = roomAt([mid[0] - uy * off, mid[1] + ux * off]), r2 = roomAt([mid[0] + uy * off, mid[1] - ux * off]);
  if (!r1 || !r2 || r1 === r2) fail(`дверь ${id}: не соединяет две разные комнаты (${r1}, ${r2})`);
  else { adj[r1].add(r2); adj[r2].add(r1); doorPairs[id] = [r1, r2]; }
}
const entrance = entrances[0]?.[1];
let start;
if (entrance) {
  const w = M.walls[entrance.wall]; const [a, b] = seg(w); const L = len([a, b]);
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; const s = entrance.at + entrance.width / 2;
  const mid = [a[0] + ux * s, a[1] + uy * s];
  start = roomAt([mid[0] - uy * 1, mid[1] + ux * 1]) ?? roomAt([mid[0] + uy * 1, mid[1] - ux * 1]);
  if (!start) fail("точка старта (1 м внутрь от входа) не попала в комнату");
}
const seen = new Set(start ? [start] : []); const queue = [...seen];
while (queue.length) for (const n of adj[queue.shift()]) if (!seen.has(n)) { seen.add(n); queue.push(n); }
const unreachable = Object.keys(M.rooms).filter((r) => !seen.has(r));
if (unreachable.length) fail(`недостижимы от входа: ${unreachable.join(", ")}`);
notes.push(`старт в ${start}; пары комнат у дверей: ${JSON.stringify(doorPairs)}`);

// --- независимые признаки масштаба (слой «Масштаб» Validator) ---
const doorWidths = Object.values(M.openings).filter((o) => o.kind === "door").map((o) => o.width).sort((x, y) => x - y);
const median = doorWidths[Math.floor(doorWidths.length / 2)];
if (median < 0.7 || median > 1.0) fail(`медиана ширины дверей ${median}`);
for (const [id, w] of W) if (w.thickness < 0.08 || w.thickness > 0.5) fail(`wall ${id}: толщина ${w.thickness}`);
notes.push(`медиана ширины дверей ${median} м; толщины ${[...new Set(W.map(([, w]) => w.thickness))].join("/")} м; pxPerMeter ${M.plan.pxPerMeter}`);
// фото: стена принадлежит контуру комнаты (для прямоугольных комнат — стена на границе прямоугольника)
for (const [id, a] of Object.entries(M.assets)) {
  if (a.kind !== "photo" || !a.faces) continue;
  const r = M.rooms[a.room]; const w = M.walls[a.faces]; const [p, q] = seg(w);
  const l = rayDist(r.anchor, [-1, 0]), rr = rayDist(r.anchor, [1, 0]), u = rayDist(r.anchor, [0, -1]), d = rayDist(r.anchor, [0, 1]);
  const x0 = r.anchor[0] - l, x1 = r.anchor[0] + rr, y0 = r.anchor[1] - u, y1 = r.anchor[1] + d;
  const onRect = (pt) => (Math.abs(pt[0] - x0) < EPS || Math.abs(pt[0] - x1) < EPS || Math.abs(pt[1] - y0) < EPS || Math.abs(pt[1] - y1) < EPS)
    && pt[0] > x0 - EPS && pt[0] < x1 + EPS && pt[1] > y0 - EPS && pt[1] < y1 + EPS;
  if (!onRect(p) || !onRect(q)) fail(`asset ${id}: стена ${a.faces} не на контуре комнаты ${a.room}`);
}
const noPhoto = Object.keys(M.rooms).filter((r) => !Object.values(M.assets).some((a) => a.kind === "photo" && a.room === r));
notes.push(`комнаты без фото: ${noPhoto.join(", ") || "нет"}`);

for (const n of notes) console.log("· " + n);
if (errors.length) { console.error(`FAIL (${errors.length}):\n - ` + errors.join("\n - ")); process.exit(1); }
console.log(`OK: ${Object.keys(M.rooms).length} комнат, ${W.length} стен, ${Object.keys(M.openings).length} проёмов, ${Object.keys(M.vertices).length} вершин`);
