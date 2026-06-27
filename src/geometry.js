(function () {
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const EPS = 0.000001;

  function degToRad(value) {
    return value * DEG;
  }

  function radToDeg(value) {
    return value / DEG;
  }

  function normalizeDeg(value) {
    let result = value % 360;
    if (result <= -180) result += 360;
    if (result > 180) result -= 360;
    return result;
  }

  function rotatePoint(point, yawDeg) {
    const yaw = degToRad(yawDeg);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return {
      x: point.x * c - point.y * s,
      y: point.x * s + point.y * c,
      z: point.z || 0
    };
  }

  function transformPoint(point, placement) {
    const local = {
      x: point.x * (placement.flipX ? -1 : 1),
      y: point.y * (placement.flipY ? -1 : 1),
      z: point.z || 0
    };
    const rotated = rotatePoint(local, placement.yawDeg || 0);
    return {
      x: (placement.x || 0) + rotated.x,
      y: (placement.y || 0) + rotated.y,
      z: (placement.z || 0) + (point.z || 0)
    };
  }

  function transformYaw(yawDeg, placement) {
    const yaw = degToRad(yawDeg);
    const vector = {
      x: Math.cos(yaw) * (placement.flipX ? -1 : 1),
      y: Math.sin(yaw) * (placement.flipY ? -1 : 1)
    };
    return normalizeDeg((placement.yawDeg || 0) + radToDeg(Math.atan2(vector.y, vector.x)));
  }

  function makeCatalogIndex(catalogs) {
    const byId = {};
    const catalogById = {};
    catalogs.forEach(function (catalog) {
      catalogById[catalog.catalogId] = catalog;
      (catalog.pieces || []).forEach(function (piece) {
        byId[piece.id] = { piece, catalog };
      });
    });
    return { byId, catalogById };
  }

  function getPiece(index, pieceId) {
    return index.byId[pieceId] ? index.byId[pieceId].piece : null;
  }

  function segmentPoints(segments, stepMm) {
    const step = stepMm || 12;
    const points = [];
    let x = 0;
    let y = 0;
    let heading = 0;

    function ensureCurrentPoint() {
      if (!points.length) points.push({ x, y });
    }

    (segments || []).forEach(function (segment) {
      if (segment.type === "line") {
        ensureCurrentPoint();
        const count = Math.max(1, Math.ceil(segment.lengthMm / step));
        for (let i = 1; i <= count; i += 1) {
          const d = segment.lengthMm * i / count;
          points.push({
            x: x + Math.cos(heading) * d,
            y: y + Math.sin(heading) * d
          });
        }
        x += Math.cos(heading) * segment.lengthMm;
        y += Math.sin(heading) * segment.lengthMm;
        return;
      }

      if (segment.type === "arc") {
        ensureCurrentPoint();
        const sign = segment.direction === "left" ? 1 : -1;
        const angle = degToRad(segment.angleDeg);
        const count = Math.max(4, Math.ceil(Math.abs(segment.radiusMm * angle) / step));
        for (let i = 1; i <= count; i += 1) {
          const a = angle * i / count;
          const local = {
            x: segment.radiusMm * Math.sin(a),
            y: sign * segment.radiusMm * (1 - Math.cos(a))
          };
          const rotated = rotatePoint(local, radToDeg(heading));
          points.push({ x: x + rotated.x, y: y + rotated.y });
        }
        const endLocal = {
          x: segment.radiusMm * Math.sin(angle),
          y: sign * segment.radiusMm * (1 - Math.cos(angle))
        };
        const end = rotatePoint(endLocal, radToDeg(heading));
        x += end.x;
        y += end.y;
        heading += sign * angle;
        return;
      }

      if (segment.type === "polyline") {
        const poly = segment.points || [];
        poly.forEach(function (point) {
          points.push({ x: point.x, y: point.y });
        });
        if (poly.length >= 2) {
          const a = poly[poly.length - 2];
          const b = poly[poly.length - 1];
          heading = Math.atan2(b.y - a.y, b.x - a.x);
          x = b.x;
          y = b.y;
        }
      }
    });

    return dedupePoints(points);
  }

  function dedupePoints(points) {
    const out = [];
    points.forEach(function (point) {
      const prev = out[out.length - 1];
      if (!prev || Math.hypot(point.x - prev.x, point.y - prev.y) > EPS) {
        out.push(point);
      }
    });
    return out;
  }

  function segmentEndpoint(segments) {
    let x = 0, y = 0, heading = 0;
    (segments || []).forEach(function (seg) {
      if (seg.type === "line") {
        x += Math.cos(heading) * seg.lengthMm;
        y += Math.sin(heading) * seg.lengthMm;
      } else if (seg.type === "arc") {
        const sign = seg.direction === "left" ? 1 : -1;
        const angle = degToRad(seg.angleDeg);
        const local = {
          x: seg.radiusMm * Math.sin(angle),
          y: sign * seg.radiusMm * (1 - Math.cos(angle))
        };
        const c = Math.cos(heading), s = Math.sin(heading);
        x += local.x * c - local.y * s;
        y += local.x * s + local.y * c;
        heading += sign * angle;
      } else if (seg.type === "polyline") {
        const poly = seg.points || [];
        for (let i = 0; i < poly.length; i += 1) {
          if (i === 0) continue;
          const a = poly[i - 1], b = poly[i];
          x += b.x - a.x;
          y += b.y - a.y;
          heading = Math.atan2(b.y - a.y, b.x - a.x);
        }
      }
    });
    return { x, y, yawDeg: radToDeg(heading) };
  }

  function isFlexPlacement(placement, piece) {
    return Boolean(piece && piece.kind === "track.flex"
      && placement && placement.properties && placement.properties.flexSegments);
  }

  function localRoutes(piece, stepMm) {
    if (!piece || !piece.geometry) return [];
    return piece.geometry.routes.map(function (route) {
      return {
        id: route.id,
        connectorIds: route.connectorIds,
        points: segmentPoints(route.segments, stepMm)
      };
    });
  }

  function isSlopedPlacement(placement, piece) {
    if (!placement || placement.zEnd == null || placement.zEnd === (placement.z || 0)) return false;
    if (!piece || !piece.geometry || !piece.geometry.routes) return false;
    const routes = piece.geometry.routes;
    if (isFlexPlacement(placement, piece)) return true;
    return routes.length === 1 && routes[0].connectorIds && routes[0].connectorIds.length === 2;
  }

  function placementFingerprint(placement) {
    const parts = [
      placement.pieceId,
      placement.x || 0,
      placement.y || 0,
      placement.z || 0,
      placement.yawDeg || 0,
      placement.flipX ? 1 : 0,
      placement.flipY ? 1 : 0,
      placement.zEnd != null ? "ze:" + placement.zEnd : ""
    ];
    const flex = placement.properties && placement.properties.flexSegments;
    if (flex) parts.push("flex:" + JSON.stringify(flex));
    return parts.join("|");
  }

  const routeCache = new Map();
  const connectorCache = new Map();

  function invalidatePlacementGeometry(placementId) {
    if (!placementId) return;
    const prefix = placementId + "|";
    for (const key of routeCache.keys()) {
      if (key.startsWith(prefix)) routeCache.delete(key);
    }
    for (const key of connectorCache.keys()) {
      if (key.startsWith(prefix)) connectorCache.delete(key);
    }
  }

  function clearGeometryCache() {
    routeCache.clear();
    connectorCache.clear();
  }

  function applySlopeToRoute(routePoints, placement) {
    const zStart = placement.z || 0;
    const zEnd = placement.zEnd;
    if (zEnd == null || zEnd === zStart || routePoints.length < 2) return;
    let total = 0;
    const cum = [0];
    for (let i = 1; i < routePoints.length; i += 1) {
      total += Math.hypot(routePoints[i].x - routePoints[i - 1].x, routePoints[i].y - routePoints[i - 1].y);
      cum.push(total);
    }
    if (total < EPS) return;
    for (let i = 0; i < routePoints.length; i += 1) {
      const frac = cum[i] / total;
      routePoints[i].z = zStart + (zEnd - zStart) * frac;
    }
  }

  function placementRoutes(placement, piece, stepMm) {
    if (!piece || !piece.geometry) return [];
    const step = stepMm || 12;
    const key = placement.id + "|" + placementFingerprint(placement) + "|" + step;
    const cached = routeCache.get(key);
    if (cached) return cached;
    let result;
    if (isFlexPlacement(placement, piece)) {
      const pts = segmentPoints(placement.properties.flexSegments, step);
      const points = pts.map(function (point) {
        return transformPoint({ x: point.x, y: point.y, z: 0 }, placement);
      });
      if (isSlopedPlacement(placement, piece)) applySlopeToRoute(points, placement);
      result = [{ id: "main", connectorIds: ["A", "B"], points }];
    } else {
      result = localRoutes(piece, step).map(function (route) {
        const points = route.points.map(function (point) {
          return transformPoint({ x: point.x, y: point.y, z: 0 }, placement);
        });
        if (isSlopedPlacement(placement, piece)) applySlopeToRoute(points, placement);
        return { id: route.id, connectorIds: route.connectorIds, points };
      });
    }
    routeCache.set(key, result);
    return result;
  }

  function placementConnectors(placement, piece) {
    if (!piece || !piece.geometry) return [];
    const key = placement.id + "|" + placementFingerprint(placement);
    const cached = connectorCache.get(key);
    if (cached) return cached;
    let sourceConnectors = piece.geometry.connectors;
    if (isFlexPlacement(placement, piece)) {
      const endLocal = segmentEndpoint(placement.properties.flexSegments);
      sourceConnectors = piece.geometry.connectors.map(function (connector) {
        if (connector.id === "B") {
          return { id: "B", x: endLocal.x, y: endLocal.y, z: 0, yawDeg: endLocal.yawDeg, profile: connector.profile };
        }
        return connector;
      });
    }
    const sloped = isSlopedPlacement(placement, piece);
    const zStart = placement.z || 0;
    const zEnd = placement.zEnd;
    let startConnId = null, endConnId = null;
    if (sloped && !isFlexPlacement(placement, piece) && piece.geometry.routes[0]) {
      const ids = piece.geometry.routes[0].connectorIds;
      startConnId = ids[0];
      endConnId = ids[ids.length - 1];
    }
    const result = sourceConnectors.map(function (connector) {
      const world = transformPoint(connector, placement);
      let z = world.z;
      if (sloped) {
        if (isFlexPlacement(placement, piece)) {
          z = connector.id === "B" ? zEnd : zStart;
        } else if (connector.id === startConnId) {
          z = zStart;
        } else if (connector.id === endConnId) {
          z = zEnd;
        }
      }
      return {
        placementId: placement.id,
        pieceId: placement.pieceId,
        connectorId: connector.id,
        profile: connector.profile,
        x: world.x,
        y: world.y,
        z,
        yawDeg: transformYaw(connector.yawDeg, placement),
        local: connector
      };
    });
    connectorCache.set(key, result);
    return result;
  }

  function connectorKey(ref) {
    return ref.placementId + ":" + ref.connectorId;
  }

  function connectedKeySet(project) {
    const keys = new Set();
    (project.connections || []).forEach(function (connection) {
      keys.add(connectorKey(connection.from));
      keys.add(connectorKey(connection.to));
    });
    return keys;
  }

  function isCompatible(profileA, profileB, catalogs) {
    if (!profileA || !profileB) return false;
    if (profileA === profileB) return true;
    return catalogs.some(function (catalog) {
      return (catalog.connectorProfiles || []).some(function (profile) {
        return profile.id === profileA && (profile.compatibleWith || []).includes(profileB);
      });
    });
  }

  function allConnectors(project, index) {
    return (project.placements || []).flatMap(function (placement) {
      const piece = getPiece(index, placement.pieceId);
      return placementConnectors(placement, piece);
    });
  }

  function openConnectors(project, index) {
    const connected = connectedKeySet(project);
    return allConnectors(project, index).filter(function (connector) {
      return !connected.has(connectorKey({
        placementId: connector.placementId,
        connectorId: connector.connectorId
      }));
    });
  }

  function nearestOpenConnector(project, catalogs, index, point, options) {
    const opts = options || {};
    const threshold = opts.thresholdMm || 28;
    const excludePlacementId = opts.excludePlacementId || null;
    const sourceProfile = opts.sourceProfile || null;
    let best = null;

    openConnectors(project, index).forEach(function (connector) {
      if (connector.placementId === excludePlacementId) return;
      if (sourceProfile && !isCompatible(sourceProfile, connector.profile, catalogs)) return;
      const distance = Math.hypot(connector.x - point.x, connector.y - point.y);
      if (distance <= threshold && (!best || distance < best.distance)) {
        best = { connector, distance };
      }
    });

    return best;
  }

  function alignConnectorToTarget(piece, sourceConnectorId, targetConnector) {
    const source = piece.geometry.connectors.find(function (connector) {
      return connector.id === sourceConnectorId;
    }) || piece.geometry.connectors[0];

    const yawDeg = normalizeDeg(targetConnector.yawDeg + 180 - source.yawDeg);
    const rotated = rotatePoint(source, yawDeg);
    return {
      x: targetConnector.x - rotated.x,
      y: targetConnector.y - rotated.y,
      z: targetConnector.z - (source.z || 0),
      yawDeg
    };
  }

  function routeLength(route) {
    return (route.segments || []).reduce(function (sum, segment) {
      if (segment.type === "line") return sum + segment.lengthMm;
      if (segment.type === "arc") return sum + Math.abs(segment.radiusMm * degToRad(segment.angleDeg));
      if (segment.type === "polyline") {
        return sum + (segment.points || []).reduce(function (subtotal, point, index, points) {
          if (index === 0) return subtotal;
          const prev = points[index - 1];
          return subtotal + Math.hypot(point.x - prev.x, point.y - prev.y);
        }, 0);
      }
      return sum;
    }, 0);
  }

  function pieceLength(piece) {
    if (!piece.geometry) return 0;
    return Math.max.apply(null, piece.geometry.routes.map(routeLength));
  }

  function projectBom(project, index) {
    const counts = {};
    (project.placements || []).forEach(function (placement) {
      const piece = getPiece(index, placement.pieceId);
      if (!piece) return;
      const key = piece.bom && piece.bom.countAs ? piece.bom.countAs : piece.id;
      const qty = piece.bom && piece.bom.quantity ? piece.bom.quantity : 1;
      counts[key] = (counts[key] || 0) + qty;
    });
    return counts;
  }

  function projectLength(project, index) {
    return (project.placements || []).reduce(function (sum, placement) {
      const piece = getPiece(index, placement.pieceId);
      if (!piece || !piece.kind.startsWith("track.")) return sum;
      return sum + pieceLength(piece);
    }, 0);
  }

  function placementBounds(placement, piece) {
    const points = [];
    placementRoutes(placement, piece, 18).forEach(function (route) {
      route.points.forEach(function (point) { points.push(point); });
    });
    if (piece && piece.dimensions && !piece.geometry) {
      const w = piece.dimensions.widthMm || 20;
      const d = piece.dimensions.depthMm || 20;
      [
        { x: -w / 2, y: -d / 2, z: 0 },
        { x: w / 2, y: -d / 2, z: 0 },
        { x: w / 2, y: d / 2, z: 0 },
        { x: -w / 2, y: d / 2, z: 0 }
      ].forEach(function (point) { points.push(transformPoint(point, placement)); });
    }
    if (!points.length) points.push({ x: placement.x, y: placement.y, z: placement.z || 0 });
    return boundsFromPoints(points);
  }

  function projectBounds(project, index) {
    const points = [];
    (project.placements || []).forEach(function (placement) {
      const piece = getPiece(index, placement.pieceId);
      const bounds = placementBounds(placement, piece);
      points.push({ x: bounds.minX, y: bounds.minY });
      points.push({ x: bounds.maxX, y: bounds.maxY });
    });
    if (!points.length) {
      const board = project.board || { widthMm: 1200, heightMm: 800 };
      const halfW = board.widthMm / 2;
      const halfH = board.heightMm / 2;
      return { minX: -halfW, minY: -halfH, maxX: halfW, maxY: halfH };
    }
    return boundsFromPoints(points);
  }

  function boundsFromPoints(points) {
    return {
      minX: Math.min.apply(null, points.map(function (p) { return p.x; })),
      minY: Math.min.apply(null, points.map(function (p) { return p.y; })),
      maxX: Math.max.apply(null, points.map(function (p) { return p.x; })),
      maxY: Math.max.apply(null, points.map(function (p) { return p.y; }))
    };
  }

  function pointLineDistance(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) return Math.hypot(point.x - a.x, point.y - a.y);
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
  }

  function nearestPlacement(project, index, point, thresholdMm) {
    let best = null;
    const threshold = thresholdMm || 18;
    (project.placements || []).forEach(function (placement) {
      const piece = getPiece(index, placement.pieceId);
      if (!piece) return;
      if (!piece.geometry) {
        const distance = Math.hypot(point.x - placement.x, point.y - placement.y);
        if (distance <= threshold && (!best || distance < best.distance)) {
          best = { placement, distance };
        }
        return;
      }
      placementRoutes(placement, piece, 12).forEach(function (route) {
        for (let i = 1; i < route.points.length; i += 1) {
          const distance = pointLineDistance(point, route.points[i - 1], route.points[i]);
          if (distance <= threshold && (!best || distance < best.distance)) {
            best = { placement, distance };
          }
        }
      });
    });
    return best ? best.placement : null;
  }

  function makeId(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 8);
  }

  window.RailGeometry = {
    TAU,
    degToRad,
    radToDeg,
    normalizeDeg,
    rotatePoint,
    transformPoint,
    transformYaw,
    makeCatalogIndex,
    getPiece,
    segmentPoints,
    segmentEndpoint,
    isFlexPlacement,
    isSlopedPlacement,
    localRoutes,
    placementRoutes,
    placementConnectors,
    placementFingerprint,
    invalidatePlacementGeometry,
    clearGeometryCache,
    placementBounds,
    allConnectors,
    openConnectors,
    connectedKeySet,
    isCompatible,
    nearestOpenConnector,
    alignConnectorToTarget,
    routeLength,
    pieceLength,
    projectBom,
    projectLength,
    projectBounds,
    pointLineDistance,
    nearestPlacement,
    connectorKey,
    makeId
  };
})();
