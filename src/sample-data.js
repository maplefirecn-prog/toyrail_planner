(function () {
  const source = {
    url: "",
    title: "Demo placeholder",
    retrievedAt: "2026-06-21",
    confidence: "estimated"
  };

  function straight(id, sku, lengthMm) {
    return {
      id,
      sku,
      name: "Straight Track " + sku,
      kind: "track.straight",
      tags: ["track", "straight"],
      geometry: {
        connectors: [
          { id: "A", x: 0, y: 0, z: 0, yawDeg: 180, profile: "tomix-demo-finetrack" },
          { id: "B", x: lengthMm, y: 0, z: 0, yawDeg: 0, profile: "tomix-demo-finetrack" }
        ],
        routes: [
          { id: "main", connectorIds: ["A", "B"], segments: [{ type: "line", lengthMm }] }
        ]
      },
      render: { railGaugeMm: 9, roadbedWidthMm: 18.5, sleeperSpacingMm: 6 },
      bom: { countAs: id, quantity: 1 },
      sources: [source]
    };
  }

  function curve(id, sku, radiusMm, angleDeg, direction) {
    const sign = direction === "left" ? 1 : -1;
    const a = angleDeg * Math.PI / 180;
    return {
      id,
      sku,
      name: "Curve Track " + sku,
      kind: "track.curve",
      tags: ["track", "curve", direction],
      geometry: {
        connectors: [
          { id: "A", x: 0, y: 0, z: 0, yawDeg: 180, profile: "tomix-demo-finetrack" },
          {
            id: "B",
            x: Number((radiusMm * Math.sin(a)).toFixed(2)),
            y: Number((sign * radiusMm * (1 - Math.cos(a))).toFixed(2)),
            z: 0,
            yawDeg: sign * angleDeg,
            profile: "tomix-demo-finetrack"
          }
        ],
        routes: [
          {
            id: "main",
            connectorIds: ["A", "B"],
            segments: [{ type: "arc", radiusMm, angleDeg, direction }]
          }
        ]
      },
      render: { railGaugeMm: 9, roadbedWidthMm: 18.5, sleeperSpacingMm: 6 },
      bom: { countAs: id, quantity: 1 },
      sources: [source]
    };
  }

  const sampleCatalog = {
    schema: "raildesign.catalog.v1",
    catalogId: "tomix.demo.finetrack.n",
    version: "2026.06.21-demo",
    units: "mm",
    manufacturer: "Tomix",
    productLine: "Fine Track Demo",
    scale: "N",
    gaugeMm: 9,
    description: "Demo catalog for local MVP development. Replace with verified manufacturer data before production use.",
    connectorProfiles: [
      {
        id: "tomix-demo-finetrack",
        name: "Tomix demo Fine Track connector",
        compatibleWith: ["tomix-demo-finetrack"]
      }
    ],
    pieces: [
      straight("tomix.demo.s70", "S70", 70),
      straight("tomix.demo.s140", "S140", 140),
      curve("tomix.demo.c280-45l", "C280-45L", 280, 45, "left"),
      curve("tomix.demo.c280-45r", "C280-45R", 280, 45, "right"),
      {
        id: "tomix.demo.turnout-r",
        sku: "PR-demo",
        name: "Power Turnout Right Demo",
        kind: "track.turnout",
        tags: ["track", "turnout", "right"],
        geometry: {
          connectors: [
            { id: "A", x: 0, y: 0, z: 0, yawDeg: 180, profile: "tomix-demo-finetrack" },
            { id: "B", x: 140, y: 0, z: 0, yawDeg: 0, profile: "tomix-demo-finetrack" },
            { id: "C", x: 139.52, y: -12.2, z: 0, yawDeg: -10, profile: "tomix-demo-finetrack" }
          ],
          routes: [
            { id: "straight", connectorIds: ["A", "B"], segments: [{ type: "line", lengthMm: 140 }] },
            { id: "diverging", connectorIds: ["A", "C"], segments: [{ type: "arc", radiusMm: 800, angleDeg: 10, direction: "right" }] }
          ]
        },
        render: { railGaugeMm: 9, roadbedWidthMm: 22, sleeperSpacingMm: 6 },
        bom: { countAs: "tomix.demo.turnout-r", quantity: 1 },
        sources: [source]
      },
      {
        id: "tomix.demo.support-55",
        sku: "P55-demo",
        name: "Elevated Pier 55mm Demo",
        kind: "accessory.support",
        tags: ["support", "elevated"],
        dimensions: { widthMm: 22, depthMm: 22, heightMm: 55 },
        placement: {
          anchor: "center",
          canAutoGenerate: true,
          supportsElevationMm: [50, 55, 60],
          defaultSpacingMm: 140
        },
        render: { color: "#aeb8c8" },
        bom: { countAs: "tomix.demo.support-55", quantity: 1 },
        sources: [source]
      }
    ],
    metadata: {
      createdAt: "2026-06-21T00:00:00Z",
      updatedAt: "2026-06-21T00:00:00Z",
      notes: "Built-in MVP demo data."
    }
  };

  const sampleProject = {
    schema: "raildesign.project.v1",
    projectId: "demo-local-layout",
    name: "Local MVP Demo Layout",
    units: "mm",
    board: { widthMm: 1800, heightMm: 900, origin: "center", gridMm: 20 },
    catalogRefs: [{ catalogId: "tomix.demo.finetrack.n", version: "2026.06.21-demo" }],
    view: {
      camera2d: { x: 140, y: 40, zoom: 0.9, rotationDeg: 0 },
      camera3d: { yawDeg: -40, pitchDeg: 48, distanceMm: 1400 }
    },
    layers: [{ id: "base", name: "Base Layout", visible: true, locked: false }],
    placements: [
      { id: "p1", pieceId: "tomix.demo.s140", x: -280, y: 0, z: 0, yawDeg: 0, layerId: "base", locked: false },
      { id: "p2", pieceId: "tomix.demo.s140", x: -140, y: 0, z: 0, yawDeg: 0, layerId: "base", locked: false },
      { id: "p3", pieceId: "tomix.demo.c280-45l", x: 0, y: 0, z: 55, yawDeg: 0, layerId: "base", locked: false },
      { id: "p4", pieceId: "tomix.demo.c280-45l", x: 197.99, y: 82.01, z: 55, yawDeg: 45, layerId: "base", locked: false },
      { id: "p5", pieceId: "tomix.demo.turnout-r", x: -420, y: -120, z: 0, yawDeg: 12, layerId: "base", locked: false },
      { id: "p6", pieceId: "tomix.demo.support-55", x: 70, y: 44, z: 0, yawDeg: 0, layerId: "base", locked: false }
    ],
    connections: [
      { from: { placementId: "p1", connectorId: "B" }, to: { placementId: "p2", connectorId: "A" } },
      { from: { placementId: "p2", connectorId: "B" }, to: { placementId: "p3", connectorId: "A" } },
      { from: { placementId: "p3", connectorId: "B" }, to: { placementId: "p4", connectorId: "A" } }
    ],
    metadata: {
      createdAt: "2026-06-21T00:00:00Z",
      updatedAt: "2026-06-21T00:00:00Z",
      notes: "Built-in MVP demo layout."
    }
  };

  window.RailSampleData = {
    catalog: sampleCatalog,
    project: sampleProject
  };
})();
