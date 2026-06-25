(function () {
  const DEFAULT_CELL = 100;

  function makeBounds(minX, minY, maxX, maxY) {
    return { minX, minY, maxX, maxY };
  }

  function boundsOverlap(a, b) {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  }

  function SpatialGrid(cellSize) {
    this.cell = cellSize || DEFAULT_CELL;
    this.cells = new Map();
  }

  SpatialGrid.prototype.key = function (cx, cy) {
    return cx + "," + cy;
  };

  SpatialGrid.prototype.insert = function (id, bounds, payload) {
    const entry = { id, bounds, payload };
    const minCx = Math.floor(bounds.minX / this.cell);
    const maxCx = Math.floor(bounds.maxX / this.cell);
    const minCy = Math.floor(bounds.minY / this.cell);
    const maxCy = Math.floor(bounds.maxY / this.cell);
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      for (let cy = minCy; cy <= maxCy; cy += 1) {
        const key = this.key(cx, cy);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(entry);
      }
    }
    return entry;
  };

  SpatialGrid.prototype.queryAABB = function (bounds) {
    const seen = new Set();
    const out = [];
    const minCx = Math.floor(bounds.minX / this.cell);
    const maxCx = Math.floor(bounds.maxX / this.cell);
    const minCy = Math.floor(bounds.minY / this.cell);
    const maxCy = Math.floor(bounds.maxY / this.cell);
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      for (let cy = minCy; cy <= maxCy; cy += 1) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i += 1) {
          const entry = bucket[i];
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          if (boundsOverlap(entry.bounds, bounds)) out.push(entry);
        }
      }
    }
    return out;
  };

  SpatialGrid.prototype.queryPoint = function (x, y) {
    return this.queryAABB({ minX: x, minY: y, maxX: x, maxY: y });
  };

  SpatialGrid.prototype.queryRadius = function (x, y, radius) {
    return this.queryAABB({
      minX: x - radius,
      minY: y - radius,
      maxX: x + radius,
      maxY: y + radius
    });
  };

  SpatialGrid.prototype.size = function () {
    return this.cells.size;
  };

  window.RailSpatial = {
    SpatialGrid,
    makeBounds,
    boundsOverlap,
    DEFAULT_CELL
  };
})();
