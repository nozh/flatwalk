#!/usr/bin/env node
// Генератор эталона 54541: пиксельная обводка плана (plan.png, 940×786) → flat.model.json + overlay.svg.
// Запуск из корня репозитория: node fixtures/54541/build.mjs
// Источник геометрии — план; координаты стен получены профилями тёмных пикселей (см. README.md).
// Схема — FlatModel v0.1 по docs/architecture.md §3 и docs/modules.md; никаких собственных полей.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const listing = JSON.parse(readFileSync(join(here, "listing.json"), "utf8"));

const PROV = "fixture/manual@0.1";
const PLAN_W = 940, PLAN_H = 786;
const THICK_PX = 17, THIN_PX = 8.5; // измерено по плану: наружные/несущие 17 px, перегородки 8–9 px

// Осевые линии стен в пикселях plan.png (центры тёмных полос).
const X = { L: 9, A: 174.5, B: 254.5, C: 287, D: 451, E: 581, F: 609, R: 895 };
const Y = { T: 9, A: 94, B: 196, C: 298.5, D: 395, E: 534, F: 567.5, G: 776 };

const V = {
  a: [X.L, Y.A], b: [X.B, Y.A], c: [X.D, Y.A], d: [X.D, Y.T], e: [X.E, Y.T], f: [X.R, Y.T],
  g: [X.R, Y.C], h: [X.R, Y.F], i: [X.R, Y.G], j: [X.F, Y.G], k: [X.F, Y.F], l: [X.E, Y.F],
  m: [X.E, Y.E], n: [X.C, Y.E], o: [X.C, Y.D], p: [X.A, Y.D], q: [X.L, Y.D], r: [X.L, Y.C],
  s: [X.A, Y.C], t: [X.B, Y.C], u: [X.C, Y.C], vv: [X.D, Y.C], w: [X.E, Y.C], x: [X.D, Y.B], y: [X.E, Y.B],
};
const VID = Object.fromEntries(Object.keys(V).map((k, i) => [k, `v${i + 1}`]));

// Стены: [a, b, толщина, exterior, комнаты слева/справа (для проверки), комментарий]
const WALLS = [
  ["a", "b", "thick", true, ["r4"], "спальня, север (наружная)"],
  ["b", "c", "thick", true, ["r3"], "кухня, север (наружная)"],
  ["c", "d", "thick", true, ["r7"], "душевая, запад (наружная)"],
  ["d", "e", "thick", true, ["r7"], "душевая, север (наружная)"],
  ["e", "f", "thick", true, ["r9"], "спальня с террасой, север (наружная)"],
  ["f", "g", "thick", true, ["r9"], "спальня с террасой, восток (наружная, дверь на террасу)"],
  ["g", "h", "thick", true, ["r1"], "гостиная, восток (наружная)"],
  ["h", "i", "thick", true, ["r10"], "спальня с рабочим местом, восток (наружная)"],
  ["i", "j", "thick", true, ["r10"], "спальня с рабочим местом, юг (наружная)"],
  ["j", "k", "thick", true, ["r10"], "спальня с рабочим местом, запад (наружная)"],
  ["k", "l", "thin", true, ["r1"], "гостиная, короткий южный участок (наружная, на плане тонкая)"],
  ["l", "m", "thick", true, ["r1"], "гостиная, короткий западный участок (наружная)"],
  ["m", "n", "thick", true, ["r2"], "столовая, юг (наружная, вход)"],
  ["n", "o", "thick", true, ["r2"], "столовая, запад (наружная)"],
  ["o", "p", "thin", true, ["r6"], "коридор, юг (к лоджии; на плане тонкая)"],
  ["p", "q", "thick", true, ["r5"], "ванная, юг (наружная)"],
  ["q", "r", "thick", true, ["r5"], "ванная, запад (наружная)"],
  ["r", "a", "thick", true, ["r4"], "спальня, запад (наружная)"],
  ["r", "s", "thin", false, ["r4", "r5"], "спальня | ванная"],
  ["s", "t", "thin", false, ["r4", "r6"], "спальня | коридор"],
  ["t", "u", "thin", false, ["r3", "r6"], "кухня | коридор"],
  ["u", "vv", "thin", false, ["r3", "r2"], "кухня | столовая (проход и стойка)"],
  ["vv", "w", "thin", false, ["r8", "r2"], "холл | столовая"],
  ["w", "g", "thin", false, ["r9", "r1"], "спальня с террасой | гостиная"],
  ["b", "t", "thin", false, ["r4", "r3"], "спальня | кухня"],
  ["c", "x", "thick", false, ["r3", "r7"], "кухня | душевая (на плане толстая)"],
  ["x", "vv", "thick", false, ["r3", "r8"], "кухня | холл (на плане толстая)"],
  ["e", "y", "thin", false, ["r7", "r9"], "душевая | спальня с террасой"],
  ["y", "w", "thin", false, ["r8", "r9"], "холл | спальня с террасой"],
  ["x", "y", "thin", false, ["r7", "r8"], "душевая | холл"],
  ["w", "m", "thick", false, ["r2", "r1"], "столовая | гостиная (на плане толстая, арка)"],
  ["s", "p", "thin", false, ["r5", "r6"], "ванная | коридор"],
  ["u", "o", "thin", false, ["r6", "r2"], "коридор | столовая (арка между стойками стены)"],
  ["k", "h", "thin", false, ["r10", "r1"], "спальня с рабочим местом | гостиная"],
];
const WID = Object.fromEntries(WALLS.map((w, i) => [`${w[0]}-${w[1]}`, `w${i + 1}`]));

// Проёмы: стена, вид, абсолютный диапазон в px вдоль оси стены (x для горизонтальной, y для вертикальной).
// span получен по разрывам тёмной полосы стены (fixtures/54541/README.md, таблица проёмов).
const OPENINGS = [
  ["s-t", "door", [189, 241], { c: 0.85 }, "дверь спальня → коридор"],
  ["s-p", "door", [332, 385], { c: 0.85 }, "дверь ванная → коридор"],
  ["vv-w", "door", [511, 563], { c: 0.85 }, "дверь холл → столовая"],
  ["x-y", "door", [518, 571], { c: 0.85 }, "дверь душевая → холл"],
  ["y-w", "door", [235, 288], { c: 0.85 }, "дверь спальня с террасой → холл"],
  ["w-m", "door", [350, 427], { c: 0.8 }, "арка столовая ↔ гостиная (без полотна)"],
  ["k-h", "door", [676, 729], { c: 0.85 }, "дверь гостиная → спальня с рабочим местом"],
  ["u-vv", "door", [291, 362], { c: 0.7, q: "открытый проход кухня ↔ столовая без полотна и дуги на плане; ширина по разрыву стены" }, "проход кухня ↔ столовая"],
  ["u-vv", "window", [362, 447], { c: 0.6, q: "белый прямоугольник на стене: по фото p4/p5/p6 барная стойка с проёмом над ней; принято как окно во внутренней стене (непроходимо)" }, "стойка/сервировочный проём кухня ↔ столовая"],
  ["m-n", "door", [302, 388], { c: 0.9, entrance: true }, "вход (стрелка на плане), двустворчатая"],
  ["o-p", "door", [200, 256], { c: 0.8, passable: false }, "дверь на лоджию (за контуром, непроходима в MVP)"],
  ["f-g", "door", [72, 164], { c: 0.85, passable: false }, "двустворчатая дверь на террасу (непроходима в MVP)"],
  ["r-a", "window", [160, 240], { c: 0.8 }, "окно спальни"],
  ["q-r", "window", [320, 362], { c: 0.8 }, "окно ванной"],
  ["b-c", "window", [269, 317], { c: 0.8 }, "окно кухни"],
  ["c-d", "window", [23, 80], { c: 0.8 }, "окно душевой"],
  ["g-h", "window", [392, 472], { c: 0.8 }, "окно гостиной"],
  ["h-i", "window", [667, 739], { c: 0.8 }, "окно спальни с рабочим местом"],
  ["n-o", "window", [435, 505], { c: 0.8 }, "окно столовой (с импостом)"],
  ["u-o", "door", [307, 385], { c: 0.75, q: "арка между двумя короткими стойками стены; дуги нет, полотна нет" }, "арка коридор ↔ столовая"],
];

// Комнаты: прямоугольник по осям стен (px), тип, подпись, фото.
const ROOMS = [
  ["r1", "living", "Гостиная", [X.E, X.R, Y.C, Y.F], { c: 0.9 }],
  ["r2", "hall", "Столовая и вход", [X.C, X.E, Y.C, Y.E], { c: 0.6, q: "столовая со входом; в enum типов нет dining — принят hall как входное распределительное помещение" }],
  ["r3", "kitchen", "Кухня", [X.B, X.D, Y.A, Y.C], { c: 0.9 }],
  ["r4", "bedroom", "Спальня", [X.L, X.B, Y.A, Y.C], { c: 0.85 }],
  ["r5", "bathroom", "Ванная", [X.L, X.A, Y.C, Y.D], { c: 0.85 }],
  ["r6", "corridor", "Коридор", [X.A, X.C, Y.C, Y.D], { c: 0.7, q: "узкий коридор между спальней, ванной, лоджией и столовой; фотографий нет" }],
  ["r7", "bathroom", "Душевая", [X.D, X.E, Y.T, Y.B], { c: 0.85 }],
  ["r8", "hall", "Холл", [X.D, X.E, Y.B, Y.C], { c: 0.7 }],
  ["r9", "bedroom", "Спальня с террасой", [X.E, X.R, Y.T, Y.C], { c: 0.85 }],
  ["r10", "bedroom", "Спальня с рабочим местом", [X.F, X.R, Y.F, Y.G], { c: 0.85 }],
];

// Фото: комната, стена (в сторону взгляда), уверенность, отделка; по визуальному сопоставлению фото с планом.
const PHOTOS = {
  p1: ["r1", "g-h", 0.85, "parquet", "light", "камин слева, окно впереди на восточной стене"],
  p2: ["r1", "w-m", 0.8, "parquet", "light", "взгляд на запад: арка в столовую, дверь в спальню слева"],
  p3: ["r10", "i-j", 0.75, "parquet", "light", "кровать у южной стены, окно слева на восточной"],
  p4: ["r2", "n-o", 0.8, "parquet", "light", "вход слева, окно впереди, арка в коридор справа, стойка"],
  p5: ["r2", "w-m", 0.8, "parquet", "light", "взгляд на восток: стойка слева, дверь холла, арка в гостиную"],
  p6: ["r3", "x-vv", 0.6, "tile", "light", "мойка у восточной стены; проём над стойкой справа; выбор участка стены условный"],
  p7: ["r3", "b-c", 0.75, "tile", "light", "духовка и холодильник, окно вверху слева на северной стене"],
  p8: ["r4", "a-b", 0.7, "parquet", "light", "изголовье у северной стены, окно слева"],
  p9: ["r4", "r-a", 0.7, "parquet", "light", "телевизор слева, окно впереди на западной стене"],
  p10: ["r7", "d-e", 0.8, "tile", "light", "душ, унитаз, раковина; съёмка от двери"],
  p11: ["r8", "x-y", 0.55, "parquet", "light", "коридор: дверь душевой впереди, дверь спальни справа; слева дверь с фрамугой, которой нет на плане"],
  p12: ["r9", "f-g", 0.85, "parquet", "light", "балконная дверь с синими шторами впереди"],
  p13: ["r9", "y-w", 0.8, "parquet", "light", "дверь в холл впереди, шкаф справа"],
  p14: ["r5", "q-r", 0.8, "tile", "light", "ванна под окном на западной стене"],
  p15: ["r5", "q-r", 0.75, "tile", "light", "ванна и окно, радиатор справа"],
  p16: ["r10", "j-k", 0.75, "parquet", "light", "стол и зеркальный шкаф у западной стены, дверь справа"],
  p17: ["r1", "l-m", 0.7, "parquet", "light", "угол с портретом и креслами; дверь в спальню слева"],
};
// Размеры файлов фото (ширина, высота) — прочитаны из JPEG; photo-11 портретное, photo-06 1079 px высотой.
const PHOTO_SIZE = { p6: [1920, 1079], p11: [1078, 1920] };

// ---- масштаб: Σ площадей комнат по осям стен (px²) = areaDeclared ----
const areaDeclared = listing.areaSqm;
const sumPx = ROOMS.reduce((s, r) => s + (r[3][1] - r[3][0]) * (r[3][3] - r[3][2]), 0);
const pxPerMeter = Math.sqrt(sumPx / areaDeclared);
const m = (px) => Math.round((px / pxPerMeter) * 1000) / 1000;
const thickness = (kind) => Math.round(((kind === "thick" ? THICK_PX : THIN_PX) / pxPerMeter) * 100) / 100;
const meta = (extra) => ({ provenance: PROV, basis: "inferred", ...extra });

const vertices = Object.fromEntries(Object.entries(V).map(([k, [px, py]]) => [VID[k], [m(px), m(py)]]));

const walls = {};
for (const [a, b, kind, exterior, , note] of WALLS) {
  walls[WID[`${a}-${b}`]] = { a: VID[a], b: VID[b], thickness: thickness(kind), exterior, meta: meta({ confidence: 0.9 }) };
  void note;
}

const openings = {};
OPENINGS.forEach(([wallKey, kind, span, opt], i) => {
  const [a, b] = wallKey.split("-");
  const horizontal = V[a][1] === V[b][1];
  const axis = horizontal ? 0 : 1;
  const a0 = V[a][axis];
  const at = Math.min(Math.abs(span[0] - a0), Math.abs(span[1] - a0));
  const width = Math.abs(span[1] - span[0]);
  const o = { wall: WID[wallKey], kind, at: m(at), width: m(width) };
  if (opt.entrance) o.entrance = true;
  if (opt.passable === false) o.passable = false;
  o.meta = meta({ confidence: opt.c, ...(opt.q ? { question: opt.q } : {}) });
  openings[`o${i + 1}`] = o;
});

const rooms = {};
for (const [id, type, label, [x0, x1, y0, y1], opt] of ROOMS) {
  rooms[id] = {
    anchor: [m((x0 + x1) / 2), m((y0 + y1) / 2)],
    type, label,
    meta: meta({ confidence: opt.c, ...(opt.q ? { question: opt.q } : {}) }),
  };
}

const assets = { plan: { kind: "image", url: "plan.png", width: PLAN_W, height: PLAN_H } };
for (const [id, [room, wallKey, c, floor, wallTone]] of Object.entries(PHOTOS)) {
  const n = String(id.slice(1)).padStart(2, "0");
  const [w, h] = PHOTO_SIZE[id] ?? [1920, 1078];
  assets[id] = {
    kind: "photo", url: `photos/photo-${n}.jpg`, width: w, height: h,
    room, faces: WID[wallKey], look: { floor, wallTone },
    meta: meta({ confidence: c, ...(c < 0.6 ? { question: PHOTOS[id][5] } : {}) }),
  };
}

const model = {
  schemaVersion: "0.1",
  id: `${listing.source.site}-${listing.source.listingId}`,
  revision: 0,
  source: { site: listing.source.site, url: listing.source.url, fetchedAt: listing.source.fetchedAt },
  plan: {
    asset: "plan",
    pxPerMeter: Math.round(pxPerMeter * 1000) / 1000,
    meta: { provenance: PROV, basis: "declared-area", confidence: 0.7 },
  },
  flat: {
    areaDeclared,
    roomsDeclared: 3.5,
    meta: { provenance: PROV, basis: "declared" },
    defaults: {
      wallHeight: 2.8, doorHeight: 2.1, windowSill: 0.9, windowHeight: 1.5,
      meta: { provenance: PROV, basis: "assumed" },
    },
  },
  vertices, walls, openings, rooms, assets,
};

writeFileSync(join(here, "flat.model.json"), JSON.stringify(model, null, 2) + "\n");

// ---- overlay.svg: план + стены, проёмы, якоря и ID (для визуальной проверки человеком) ----
const planB64 = readFileSync(join(here, "plan.png")).toString("base64");
const P = (v) => [v[0] * pxPerMeter, v[1] * pxPerMeter];
const svg = [];
svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${PLAN_W}" height="${PLAN_H}" viewBox="0 0 ${PLAN_W} ${PLAN_H}" font-family="Helvetica, Arial, sans-serif">`);
svg.push(`<image href="data:image/png;base64,${planB64}" width="${PLAN_W}" height="${PLAN_H}" opacity="0.55"/>`);
for (const [id, w] of Object.entries(walls)) {
  const [ax, ay] = P(vertices[w.a]), [bx, by] = P(vertices[w.b]);
  svg.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${w.exterior ? "#1d4ed8" : "#7c3aed"}" stroke-width="${w.thickness * pxPerMeter}" stroke-opacity="0.45"/>`);
  svg.push(`<text x="${(ax + bx) / 2}" y="${(ay + by) / 2 - 3}" font-size="9" fill="#3b0764" text-anchor="middle">${id}</text>`);
}
for (const [id, o] of Object.entries(openings)) {
  const w = walls[o.wall]; const a = P(vertices[w.a]), b = P(vertices[w.b]);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const s0 = o.at * pxPerMeter, s1 = (o.at + o.width) * pxPerMeter;
  const color = o.entrance ? "#dc2626" : o.passable === false ? "#ea580c" : o.kind === "door" ? "#16a34a" : "#0ea5e9";
  svg.push(`<line x1="${a[0] + ux * s0}" y1="${a[1] + uy * s0}" x2="${a[0] + ux * s1}" y2="${a[1] + uy * s1}" stroke="${color}" stroke-width="6"/>`);
  svg.push(`<text x="${a[0] + ux * (s0 + s1) / 2 + uy * 12}" y="${a[1] + uy * (s0 + s1) / 2 - ux * 12 + 3}" font-size="10" fill="${color}" text-anchor="middle" font-weight="bold">${id}</text>`);
}
for (const [id, r] of Object.entries(rooms)) {
  const [x, y] = P(r.anchor);
  svg.push(`<circle cx="${x}" cy="${y}" r="7" fill="#f59e0b" stroke="#78350f"/>`);
  svg.push(`<text x="${x}" y="${y - 10}" font-size="13" font-weight="bold" fill="#78350f" text-anchor="middle">${id} ${r.type}</text>`);
}
for (const [k, v] of Object.entries(vertices)) {
  const [x, y] = P(v);
  svg.push(`<circle cx="${x}" cy="${y}" r="2.5" fill="#111"/><text x="${x + 3}" y="${y - 3}" font-size="7" fill="#111">${k}</text>`);
}
svg.push(`</svg>`);
writeFileSync(join(here, "overlay.svg"), svg.join("\n") + "\n");

console.log(`pxPerMeter=${pxPerMeter.toFixed(3)} sumPx=${sumPx} rooms=${Object.keys(rooms).length} walls=${Object.keys(walls).length} openings=${Object.keys(openings).length} vertices=${Object.keys(vertices).length}`);
console.log("vertex map:", Object.entries(VID).map(([k, v]) => `${k}=${v}`).join(" "));
console.log("wall map:", Object.entries(WID).map(([k, v]) => `${k}=${v}`).join(" "));
