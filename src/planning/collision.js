(function () {
  const G = window.RailGeometry;
  const Spatial = window.RailSpatial;

  function segmentSegmentDistance(p1, p2, p3, p4) {
    const d1 = G.pointLineDistance(p1, p3, p4);
    const d2 = G.pointLineDistance(p2, p3, p4);
    const d3 = G.pointLineDistance(p3, p1, p2);
    const d4 = G.pointLineDistance(p4, p1, p2);
    return Math.min(d1, d2, d3, d4);
  }

  function detectCollisions(project, index, options) {
    const opts = options || {};
    const clearance = opts.clearanceMm != null ? opts.clearanceMm : 2;
    const grid = new Spatial.SpatialGrid(Spatial.DEFAULT_CELL);

    const items = [];
    (project.placements || []).forEach(function (placement) {
      const piece = G.getPiece(index, placement.pieceId);
      if (!piece) return;
      const bounds = G.placementBounds(placement, piece);
      const routes = G.placementRoutes(placement, piece, 12);
      items.push({ placement, piece, bounds, routes });
      grid.insert(placement.id, bounds, { placement, piece, routes });
    });

    const collisions = [];
    const seen = new Set();

    items.forEach(function (item) {
      const candidates = grid.queryAABB({
        minX: item.bounds.minX - clearance,
        minY: item.bounds.minY - clearance,
        maxX: item.bounds.maxX + clearance,
        maxY: item.bounds.maxY + clearance
      });
      candidates.forEach(function (entry) {
        const other = entry.payload;
        if (other.placement.id === item.placement.id) return;
        const pairKey = item.placement.id < other.placement.id
          ? item.placement.id + "|" + other.placement.id
          : other.placement.id + "|" + item.placement.id;
        if (seen.has(pairKey)) return;
        seen.add(pairKey);

        let minDist = Infinity;
        const aRoutes = item.routes;
        const bRoutes = other.routes;
        if (aRoutes.length && bRoutes.length) {
          for (let i = 0; i < aRoutes.length && minDist > clearance; i += 1) {
            const ap = aRoutes[i].points;
            for (let j = 0; j < bRoutes.length && minDist > clearance; j += 1) {
              const bp = bRoutes[j].points;
              for (let a = 1; a < ap.length && minDist > clearance; a += 1) {
                for (let b = 1; b < bp.length; b += 1) {
                  const d = segmentSegmentDistance(ap[a - 1], ap[a], bp[b - 1], bp[b]);
                  if (d < minDist) minDist = d;
                }
              }
            }
          }
        } else {
          minDist = Math.hypot(item.placement.x - other.placement.x, item.placement.y - other.placement.y);
        }

        if (minDist < clearance) {
          collisions.push({
            a: item.placement.id,
            b: other.placement.id,
            distance: minDist,
            clearance
          });
        }
      });
    });

    return collisions;
  }

  window.RailPlanning = window.RailPlanning || {};
  window.RailPlanning.detectCollisions = detectCollisions;
  window.RailPlanning.segmentSegmentDistance = segmentSegmentDistance;
})();
