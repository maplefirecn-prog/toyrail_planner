// Rebuilds src/tomix-catalog.js from the current catalog:
//  - dedup straights/curves: keep PC + plain, drop 高架/WP/SL/板式/RE/SY variants
//  - recategorize X-series crossings (accessory.structure -> track.crossing) with estimated geometry
//  - add estimated piers (accessory.support) and turnouts (track.turnout), marked confidence=estimated
// Run: node tools/rebuild-tomix-catalog.js
const fs = require("fs");
const path = require("path");

global.window = {};
require(path.resolve(__dirname, "..", "src", "tomix-catalog.js"));
const cat = window.RailTomixCatalog;
const PROFILE = "tomix-fine-track";

const VARIANT_KEYS = ["高架", "宽", "WP", "SL", "板式", "RE", "SY", "-S ", "-W "];
function isVariant(name) {
  return VARIANT_KEYS.some(function (k) { return name.indexOf(k) !== -1; });
}

// Useless accessories from the original Tomix lineup: rail-related parts (LED, joiners, etc.)
// that have neither geometry nor dimensions — they render as empty/identical sticks.
const USELESS_SKUS = new Set([
  "1526", // V70-PC PC配件 (no dimensions)
  "1421", "1423", "1425", "1428", "1521", // 1421/LED2/1425/1428/M70 配件 (rail_spc, no dimensions)
  "1811", "1812", "1819", // DS140/DS280/DS1120 复线配件 (no dimensions)
  "1066", "1067", "1070", // DS*-SL 复线板式配件 (already dropped as SL variants, but explicit safety)
  "1781", "1782", "1783", "1784", "1528", // 宽PC 配件 (already dropped as WP variants, but explicit safety)
  "1111", "1112", "1113", // C103/C140/C177 迷你配件 (no dimensions; mini-curve fillers)
  "1298", "1321-old", "1322-old", "1323-old", "1324-old" // legacy X-series ids if present
]);
function isUselessAccessory(p) {
  if (USELESS_SKUS.has(p.sku)) return true;
  // Catch-all: accessory pieces with no geometry AND no real dimensions
  if (p.kind === "accessory.structure" && !p.geometry &&
      (!p.dimensions || (!p.dimensions.widthMm && !p.dimensions.heightMm))) {
    return true;
  }
  return false;
}

// PC vs plain wooden sleeper: geometry/render are identical in our data, so they're visual duplicates.
// Keep PC (modern Tomix mainstream), drop plain wooden-sleeper versions.
// Plain wooden straights/curves/Variable rail: 1801-1806, 1851-1858, 1525, 1099 (端数 wooden), 1092, etc.
const PLAIN_WOODEN_SKUS = new Set([
  "1801","1802","1803","1804","1805","1806", // straights
  "1851","1852","1853","1854","1855","1856","1858","1870", // curves
  "1525", // V70 plain
  "1099", // S18.5 wooden 端数
  "1092"  // S280 wooden 10-pack
]);
function isPlainWoodenDuplicate(p) {
  return PLAIN_WOODEN_SKUS.has(p.sku);
}

function crossingGeometry(L, angleDeg) {
  const a = angleDeg * Math.PI / 180;
  const half = L / 2;
  const norm = function (v) { let r = v % 360; if (r > 180) r -= 360; if (r <= -180) r += 360; return r; };
  return {
    connectors: [
      { id: "A", x: -half, y: 0, z: 0, yawDeg: 180, profile: PROFILE },
      { id: "B", x: half, y: 0, z: 0, yawDeg: 0, profile: PROFILE },
      { id: "C", x: -half * Math.cos(a), y: -half * Math.sin(a), z: 0, yawDeg: norm(180 + angleDeg), profile: PROFILE },
      { id: "D", x: half * Math.cos(a), y: half * Math.sin(a), z: 0, yawDeg: angleDeg, profile: PROFILE }
    ],
    routes: [
      { id: "main", connectorIds: ["A", "B"], segments: [{ type: "line", lengthMm: L }] },
      { id: "cross", connectorIds: ["C", "D"], segments: [{ type: "line", lengthMm: L }] }
    ]
  };
}

function turnoutGeometry(straightLen, radius, angleDeg, direction) {
  const sign = direction === "left" ? 1 : -1;
  const a = angleDeg * Math.PI / 180;
  const Cx = radius * Math.sin(a);
  const Cy = sign * radius * (1 - Math.cos(a));
  return {
    connectors: [
      { id: "A", x: 0, y: 0, z: 0, yawDeg: 180, profile: PROFILE },
      { id: "B", x: straightLen, y: 0, z: 0, yawDeg: 0, profile: PROFILE },
      { id: "C", x: Cx, y: Cy, z: 0, yawDeg: sign * angleDeg, profile: PROFILE }
    ],
    routes: [
      { id: "straight", connectorIds: ["A", "B"], segments: [{ type: "line", lengthMm: straightLen }] },
      { id: "diverging", connectorIds: ["A", "C"], segments: [{ type: "arc", radiusMm: radius, angleDeg: angleDeg, direction: direction }] }
    ]
  };
}

// 3-way turnout: A->B straight, A->C arc one direction, A->D arc the other direction
function threeWayGeometry(straightLen, radius1, dir1, radius2, dir2, angleDeg) {
  const a = angleDeg * Math.PI / 180;
  const s1 = dir1 === "left" ? 1 : -1;
  const s2 = dir2 === "left" ? 1 : -1;
  return {
    connectors: [
      { id: "A", x: 0, y: 0, z: 0, yawDeg: 180, profile: PROFILE },
      { id: "B", x: straightLen, y: 0, z: 0, yawDeg: 0, profile: PROFILE },
      { id: "C", x: radius1 * Math.sin(a), y: s1 * radius1 * (1 - Math.cos(a)), z: 0, yawDeg: s1 * angleDeg, profile: PROFILE },
      { id: "D", x: radius2 * Math.sin(a), y: s2 * radius2 * (1 - Math.cos(a)), z: 0, yawDeg: s2 * angleDeg, profile: PROFILE }
    ],
    routes: [
      { id: "straight", connectorIds: ["A", "B"], segments: [{ type: "line", lengthMm: straightLen }] },
      { id: "diverge1", connectorIds: ["A", "C"], segments: [{ type: "arc", radiusMm: radius1, angleDeg: angleDeg, direction: dir1 }] },
      { id: "diverge2", connectorIds: ["A", "D"], segments: [{ type: "arc", radiusMm: radius2, angleDeg: angleDeg, direction: dir2 }] }
    ]
  };
}

// Curved turnout: arc(R_outer) from A to B, arc(R_inner) from A diverging
// Simplified: both routes are arcs sharing connector A
function curvedTurnoutGeometry(rOuter, rInner, angleDeg, mainDir) {
  const a = angleDeg * Math.PI / 180;
  const sM = mainDir === "left" ? 1 : -1; // main (outer) curve direction
  // Inner curve goes same direction but tighter
  return {
    connectors: [
      { id: "A", x: 0, y: 0, z: 0, yawDeg: 180, profile: PROFILE },
      { id: "B", x: rOuter * Math.sin(a), y: sM * rOuter * (1 - Math.cos(a)), z: 0, yawDeg: sM * angleDeg, profile: PROFILE },
      { id: "C", x: rInner * Math.sin(a), y: sM * rInner * (1 - Math.cos(a)), z: 0, yawDeg: sM * angleDeg, profile: PROFILE }
    ],
    routes: [
      { id: "outer", connectorIds: ["A", "B"], segments: [{ type: "arc", radiusMm: rOuter, angleDeg: angleDeg, direction: mainDir }] },
      { id: "inner", connectorIds: ["A", "C"], segments: [{ type: "arc", radiusMm: rInner, angleDeg: angleDeg, direction: mainDir }] }
    ]
  };
}

// Double crossover (剪式交叉): two parallel tracks crossing between, simplified as a straight box with 4 connectors
function doubleCrossoverGeometry(totalLen, spacing) {
  const half = totalLen / 2;
  const ys = spacing / 2;
  return {
    connectors: [
      { id: "A1", x: -half, y: ys, z: 0, yawDeg: 180, profile: PROFILE },
      { id: "B1", x: half, y: ys, z: 0, yawDeg: 0, profile: PROFILE },
      { id: "A2", x: -half, y: -ys, z: 0, yawDeg: 180, profile: PROFILE },
      { id: "B2", x: half, y: -ys, z: 0, yawDeg: 0, profile: PROFILE }
    ],
    routes: [
      { id: "top", connectorIds: ["A1", "B1"], segments: [{ type: "line", lengthMm: totalLen }] },
      { id: "bottom", connectorIds: ["A2", "B2"], segments: [{ type: "line", lengthMm: totalLen }] },
      { id: "cross1", connectorIds: ["A1", "B2"], segments: [{ type: "polyline", points: [{ x: -half, y: ys }, { x: half, y: -ys }] }] },
      { id: "cross2", connectorIds: ["A2", "B1"], segments: [{ type: "polyline", points: [{ x: -half, y: -ys }, { x: half, y: ys }] }] }
    ]
  };
}

// Double slip (复式交分 / PXL/PXR140-15): straight 140 + 15deg diverging cross
function doubleSlipGeometry(len, angleDeg, dir) {
  const sign = dir === "left" ? 1 : -1;
  const a = angleDeg * Math.PI / 180;
  return {
    connectors: [
      { id: "A", x: 0, y: 0, z: 0, yawDeg: 180, profile: PROFILE },
      { id: "B", x: len, y: 0, z: 0, yawDeg: 0, profile: PROFILE },
      { id: "C", x: 0, y: 0, z: 0, yawDeg: 180 + sign * angleDeg, profile: PROFILE },
      { id: "D", x: len * Math.cos(a), y: sign * len * Math.sin(a), z: 0, yawDeg: sign * angleDeg, profile: PROFILE }
    ],
    routes: [
      { id: "straight", connectorIds: ["A", "B"], segments: [{ type: "line", lengthMm: len }] },
      { id: "cross", connectorIds: ["C", "D"], segments: [{ type: "line", lengthMm: len }] }
    ]
  };
}

function pieceId(sku) { return "tomix.fine-track." + sku; }
function estSource(notes) {
  return [{ url: "", title: "Estimated geometry (not from official spec)", retrievedAt: "2026-06-23", confidence: "estimated", notes: notes || "Estimated for planning; verify against Tomix product page before production." }];
}

const newPieces = [];

// SKUs we add ourselves (turnouts, piers); skip these on re-run for idempotency.
// Include dropped PC-dedup victims (1271/1272/1240) so they don't sneak back in via cat re-read.
const ADDED_SKUS = new Set([
  "1271","1272","1277","1278","1273","1274","1261","1262",
  "1240","1247","1245","1246","1279","1280","1231","1232",
  // real piers (deduplicated to one per distinct geometry)
  "3018","3041","3047","3244","3245","3228",
  // dropped pier SKUs (same geometry as the canonical ones above)
  "3271","3048","3045",
  // dropped guard rails (decorative-only, not useful)
  "3055","3056","3057","3080",
  // legacy estimated turnouts and piers from earlier runs
  "PIER-50","PIER-55","PIER-60",
  "5421-E","5422-E","5411-E"
]);
// Slope-pier SKUs (3016-D1..D9 and 3044-DSD1..DSD9; D10/DSD10 dropped as duplicates of 3018/3041)
for (let i = 1; i <= 9; i++) {
  ADDED_SKUS.add("3016-D" + i);
  ADDED_SKUS.add("3044-DSD" + i);
}
// Also dropped slope-pier 10ths
ADDED_SKUS.add("3016-D10");
ADDED_SKUS.add("3044-DSD10");

cat.pieces.forEach(function (p) {
  // Skip previously-added estimated/curated pieces so the script is idempotent on re-run
  if (p.id && p.id.indexOf("tomix.estimated.") === 0) return;
  if (ADDED_SKUS.has(p.sku)) return;
  const name = p.name || "";
  // Dedup PC vs plain wooden: keep PC, drop plain wooden duplicates
  if (isPlainWoodenDuplicate(p)) return;
  // Drop useless rail-related accessories (no geometry, no real dimensions)
  if (isUselessAccessory(p)) return;
  // Dedup straights/curves + double-track: drop appearance variants
  if (p.kind === "track.straight" || p.kind === "track.curve") {
    if (isVariant(name)) return; // drop 高架/WP/SL/板式/RE/SY
  }
  if (p.kind === "accessory.structure") {
    // drop WP/SL variant accessories; keep X (recategorize), keep DS/DC plain, keep mini curves, keep V70 plain
    if (isVariant(name)) return;
  }

  // Recategorize X crossings
  if (/^X[A-Z]?\d/.test(name) && p.kind === "accessory.structure") {
    const m = name.match(/X[A-Z]?([\d.]+)-(\d+)/);
    if (m) {
      const L = parseFloat(m[1]);
      const angle = parseFloat(m[2]);
      const geo = crossingGeometry(L, angle);
      newPieces.push({
        id: p.id, sku: p.sku, name: name.replace(" 配件", " 交叉轨"),
        kind: "track.crossing",
        tags: (p.tags || []).concat(["crossing"]),
        geometry: geo,
        render: { railGaugeMm: 9, roadbedWidthMm: 18.5, sleeperSpacingMm: 6 },
        bom: p.bom,
        placement: { anchor: "center", canAutoGenerate: false },
        sources: estSource("Diamond crossing; through-length " + L + "mm, angle " + angle + "deg. Estimated from product name."),
        metadata: Object.assign({}, p.metadata, { notes: "Estimated crossing geometry. Original: " + (p.metadata && p.metadata.originalName || "") })
      });
      return;
    }
  }

  // keep as-is (PC/plain straights & curves, DS/DC double-track plain, mini curves, V70 plain, misc)
  newPieces.push(p);
});

// Add real Tomix piers, slope-pier sets, structural beams, and guard rails
// (user-supplied 2026-06-23 from Tomix product pages).
// Note: Heights are from official spec. Width/depth are estimated based on Tomix conventions
// (single ~22mm, double ~37mm spacing + roadbed). Marked confidence=secondary for widths.

// Standard piers — one per distinct geometry. Merges previously duplicated SKUs:
//   55mm single 22x22: 3018 (was: 3018, 3271, 3016-D10 — same footprint+height)
//   55mm double 56x22: 3041 (was: 3041, 3048, 3045, 3044-DSD10 — same footprint+height)
//   27mm double 56x22: 3047 (unique short variant)
const REAL_PIERS = [
  { sku: "3018", name: "单线高架桥脚 55mm",        w: 22, d: 22, h: 55, line: "single", notes: "代表所有 22x22x55 单线立柱（3018圆柱/3271方形红砖等同尺寸已合并）" },
  { sku: "3041", name: "复线高架桥脚 55mm",        w: 56, d: 22, h: 55, line: "double", notes: "代表所有 56x22x55 复线立柱（3048 PC柱/3045 螺旋等同尺寸已合并）" },
  { sku: "3047", name: "复线高架桥脚（小型）",      w: 56, d: 22, h: 27, line: "double", notes: "低矮高架/爬坡衔接段" },

  // 阶层高架梁（多线，结构件，宽度不同保留两个）
  { sku: "3244", name: "阶层高架梁 M（2-3线两层）", w: 120, d: 30, h: 110, line: "multi", notes: "双层轨道/立体交叉/多层车站" },
  { sku: "3245", name: "阶层高架梁 L（更宽两层）",   w: 180, d: 30, h: 110, line: "multi", notes: "多线编组站上方" },

  // 路基坡（独有几何）
  { sku: "3228", name: "筑堤（土坡）套装 280mm",   w: 56, d: 280, h: 55, line: "embankment", notes: "梯形土坡，280mm 长", tag: "embankment" }
];

REAL_PIERS.forEach(function (p) {
  // 阶层高架梁（3244/3245）按用户决定归为装饰性结构件，不是支撑立柱
  const kind = (p.sku === "3244" || p.sku === "3245") ? "accessory.structure" : "accessory.support";
  const baseTags = ["tomix", "fine-track", "pier", p.line];
  if (p.tag) baseTags.push(p.tag);
  newPieces.push({
    id: "tomix.fine-track." + p.sku,
    sku: p.sku,
    name: p.name,
    kind: kind,
    tags: baseTags,
    dimensions: { widthMm: p.w, depthMm: p.d, heightMm: p.h },
    placement: { anchor: "center", canAutoGenerate: false, supportsElevationMm: [p.h] },
    render: { color: p.line === "double" ? "#9aa3ab" : "#a8867a" },
    bom: { countAs: "tomix.fine-track." + p.sku, quantity: 1 },
    sources: [{
      url: "",
      title: "Tomix product list (user-supplied 2026-06-23, screenshots from Google)",
      retrievedAt: "2026-06-23",
      confidence: "secondary",
      notes: "Height from official spec. Width/depth estimated from Tomix conventions. " + p.notes
    }]
  });
});

// 坡道立柱套（3016 单线 / 3044 复线）—— 拆成 9 个逐增高度的独立件（D10/DSD10 = 55mm 与标准立柱重复，跳过）
const SLOPE_PIER_HEIGHTS = [];
for (let i = 1; i <= 9; i++) SLOPE_PIER_HEIGHTS.push(+(5.5 * i).toFixed(1));

SLOPE_PIER_HEIGHTS.forEach(function (h, idx) {
  const i = idx + 1;
  // 单线 D1..D9 (sku 3016 family)
  newPieces.push({
    id: "tomix.fine-track.3016-D" + i,
    sku: "3016-D" + i,
    name: "单线坡道桥脚 D" + i + "（" + h + "mm）",
    kind: "accessory.support",
    tags: ["tomix", "fine-track", "pier", "slope", "single"],
    dimensions: { widthMm: 22, depthMm: 22, heightMm: h },
    placement: { anchor: "center", canAutoGenerate: true, supportsElevationMm: [h], defaultSpacingMm: 280 },
    render: { color: "#a8867a" },
    bom: { countAs: "tomix.fine-track.3016", quantity: 0.1 },
    sources: [{
      url: "",
      title: "Tomix 3016 单线勾配桥脚 SET（10 根递增至 55mm，间距 280mm，坡度 4%）",
      retrievedAt: "2026-06-23",
      confidence: "secondary",
      notes: "Decomposed from 10-piece set; height " + h + "mm = step " + i + " of 10. (D10=55mm merged into 3018)"
    }]
  });
  // 复线 DS-D1..DS-D9 (sku 3044 family)
  newPieces.push({
    id: "tomix.fine-track.3044-DSD" + i,
    sku: "3044-DSD" + i,
    name: "复线坡道桥脚 DS-D" + i + "（" + h + "mm）",
    kind: "accessory.support",
    tags: ["tomix", "fine-track", "pier", "slope", "double"],
    dimensions: { widthMm: 56, depthMm: 22, heightMm: h },
    placement: { anchor: "center", canAutoGenerate: true, supportsElevationMm: [h], defaultSpacingMm: 280 },
    render: { color: "#9aa3ab" },
    bom: { countAs: "tomix.fine-track.3044", quantity: 0.1 },
    sources: [{
      url: "",
      title: "Tomix 3044 复线勾配桥脚 SET（10 根递增至 55mm，间距 280mm，坡度 4%）",
      retrievedAt: "2026-06-23",
      confidence: "secondary",
      notes: "Decomposed from 10-piece set; height " + h + "mm = step " + i + " of 10. (DSD10=55mm merged into 3041)"
    }]
  });
});

// 保护网/侧壁/栅栏：用户决定删除（仅装饰、立体图看不见、徒增负担）
// 3055, 3056, 3057, 3080 不再加入

// Real Tomix turnouts (user-supplied data, 2026-06-23).
// Per user dedup rule "留 PC + 普通": keep N- (普通) and W- (宽PC); drop other variants.
// Sources: Tomix product naming convention; SKUs from user-supplied list, verified-pending.
const REAL_TURNOUTS = [
  // 1. 经典主力 541-15: straight 140mm, diverging R541/15deg
  // (N- versions 1271/1272 dropped: geometry identical to W-PC versions, per PC-dedup rule)
  { sku: "1277", name: "W-PR541-15 宽PC道岔 右", kind: "track.turnout", geo: turnoutGeometry(140, 541, 15, "right"), tags: ["right", "wide-pc"] },
  { sku: "1278", name: "W-PL541-15 宽PC道岔 左", kind: "track.turnout", geo: turnoutGeometry(140, 541, 15, "left"),  tags: ["left",  "wide-pc"] },

  // 2. 紧凑 280-30: straight 140mm, diverging R280/30deg
  { sku: "1273", name: "N-PR280-30 道岔 右", kind: "track.turnout", geo: turnoutGeometry(140, 280, 30, "right"), tags: ["right", "compact"] },
  { sku: "1274", name: "N-PL280-30 道岔 左", kind: "track.turnout", geo: turnoutGeometry(140, 280, 30, "left"),  tags: ["left",  "compact"] },

  // 3. 三向道岔 541/280-15: straight 140mm, two divergings at 15deg, R541 and R280
  { sku: "1261", name: "N-PRL541/280-15 三向道岔 先右后左", kind: "track.turnout",
    geo: threeWayGeometry(140, 541, "right", 280, "left", 15), tags: ["3way"] },
  { sku: "1262", name: "N-PLR541/280-15 三向道岔 先左后右", kind: "track.turnout",
    geo: threeWayGeometry(140, 541, "left", 280, "right", 15), tags: ["3way"] },

  // 4. 双交叉 / 复式交分
  // (1240 N- dropped: geometry identical to W-PC, per PC-dedup rule)
  { sku: "1247", name: "W-PX280 双线剪式交叉 宽PC", kind: "track.crossing",
    geo: doubleCrossoverGeometry(280, 37), tags: ["double-crossover", "wide-pc"] },
  { sku: "1245", name: "PXL140-15 复式交分 左", kind: "track.crossing",
    geo: doubleSlipGeometry(140, 15, "left"), tags: ["double-slip", "left"] },
  { sku: "1246", name: "PXR140-15 复式交分 右", kind: "track.crossing",
    geo: doubleSlipGeometry(140, 15, "right"), tags: ["double-slip", "right"] },

  // 5. 弧线道岔 317/280-45: outer R317, inner R280, 45deg
  { sku: "1279", name: "CPL317/280-45 弧线道岔 左", kind: "track.turnout",
    geo: curvedTurnoutGeometry(317, 280, 45, "left"), tags: ["curved", "left"] },
  { sku: "1280", name: "CPR317/280-45 弧线道岔 右", kind: "track.turnout",
    geo: curvedTurnoutGeometry(317, 280, 45, "right"), tags: ["curved", "right"] },

  // 6. 迷你道岔 140-30: straight 70mm, diverging R140/30deg
  { sku: "1231", name: "PR140-30 迷你道岔 右", kind: "track.turnout",
    geo: turnoutGeometry(70, 140, 30, "right"), tags: ["mini", "right"] },
  { sku: "1232", name: "PL140-30 迷你道岔 左", kind: "track.turnout",
    geo: turnoutGeometry(70, 140, 30, "left"),  tags: ["mini", "left"] }
];

REAL_TURNOUTS.forEach(function (t) {
  newPieces.push({
    id: "tomix.fine-track." + t.sku,
    sku: t.sku,
    name: t.name,
    kind: t.kind,
    tags: (t.tags || []).concat(["tomix", "fine-track"]),
    geometry: t.geo,
    render: { railGaugeMm: 9, roadbedWidthMm: t.kind === "track.crossing" ? 18.5 : 22, sleeperSpacingMm: 6 },
    bom: { countAs: "tomix.fine-track." + t.sku, quantity: 1 },
    placement: { anchor: "connector", canAutoGenerate: false },
    sources: [{ url: "", title: "Tomix product list (user-supplied 2026-06-23)", retrievedAt: "2026-06-23", confidence: "secondary", notes: "SKU and naming from user-supplied list; geometry computed from name spec (straight len + radius + angle). Verify against official Tomix product page before production." }]
  });
});

const out = Object.assign({}, cat, {
  version: "2026-06-23-curated",
  description: (cat.description || "") + " Curated 2026-06-23: deduped to PC+plain variants, X crossings recategorized with estimated geometry, estimated piers and turnouts added (marked confidence=estimated).",
  pieces: newPieces
});

const body = "window.RailTomixCatalog = " + JSON.stringify(out, null, 2) + ";\n";
fs.writeFileSync(path.resolve(__dirname, "..", "src", "tomix-catalog.js"), body);

console.log("Wrote src/tomix-catalog.js");
console.log("pieces: " + newPieces.length + " (was " + cat.pieces.length + ")");
const byKind = {};
newPieces.forEach(function (p) { byKind[p.kind] = (byKind[p.kind] || 0) + 1; });
console.log("by kind:", JSON.stringify(byKind));
