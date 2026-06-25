(function () {
  function buildTopologyGraph(project, index) {
    const G = window.RailGeometry;
    const nodes = new Map();
    const adj = new Map();

    function ensureNode(connector) {
      const id = G.connectorKey({ placementId: connector.placementId, connectorId: connector.connectorId });
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          placementId: connector.placementId,
          connectorId: connector.connectorId,
          profile: connector.profile,
          x: connector.x,
          y: connector.y,
          z: connector.z,
          yawDeg: connector.yawDeg
        });
        adj.set(id, []);
      }
      return id;
    }

    function addEdge(fromId, toId, edge) {
      if (!adj.has(fromId)) adj.set(fromId, []);
      if (!adj.has(toId)) adj.set(toId, []);
      adj.get(fromId).push(edge);
      adj.get(toId).push({ ...edge, from: toId, to: fromId });
    }

    (project.placements || []).forEach(function (placement) {
      const piece = G.getPiece(index, placement.pieceId);
      if (!piece || !piece.geometry) return;
      const connectors = G.placementConnectors(placement, piece);
      const byConnId = {};
      connectors.forEach(function (c) {
        byConnId[c.connectorId] = c;
        ensureNode(c);
      });
      (piece.geometry.routes || []).forEach(function (route) {
        const ids = route.connectorIds || [];
        if (ids.length < 2) return;
        for (let i = 1; i < ids.length; i += 1) {
          const a = byConnId[ids[i - 1]];
          const b = byConnId[ids[i]];
          if (!a || !b) continue;
          const fromId = ensureNode(a);
          const toId = ensureNode(b);
          addEdge(fromId, toId, {
            from: fromId,
            to: toId,
            kind: "route",
            weight: G.routeLength(route),
            placementId: placement.id,
            routeId: route.id
          });
        }
      });
    });

    (project.connections || []).forEach(function (connection) {
      const fromKey = G.connectorKey(connection.from);
      const toKey = G.connectorKey(connection.to);
      if (!nodes.has(fromKey) || !nodes.has(toKey)) return;
      addEdge(fromKey, toKey, {
        from: fromKey,
        to: toKey,
        kind: "connection",
        weight: 0,
        placementId: null
      });
    });

    return { nodes, adj };
  }

  function connectedComponents(graph) {
    const visited = new Set();
    const components = [];
    for (const id of graph.nodes.keys()) {
      if (visited.has(id)) continue;
      const stack = [id];
      const comp = [];
      while (stack.length) {
        const cur = stack.pop();
        if (visited.has(cur)) continue;
        visited.add(cur);
        comp.push(cur);
        const edges = graph.adj.get(cur) || [];
        for (const e of edges) {
          if (!visited.has(e.to)) stack.push(e.to);
        }
      }
      components.push(comp);
    }
    return components;
  }

  function neighbors(graph, nodeId) {
    return graph.adj.get(nodeId) || [];
  }

  window.RailGraph = {
    buildTopologyGraph,
    connectedComponents,
    neighbors
  };
})();
