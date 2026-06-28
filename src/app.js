(function () {
  const G = window.RailGeometry;
  const Db = window.RailDesignDb;
  const Sample = window.RailSampleData;

  const state = {
    catalogs: [],
    activeCatalogId: null,
    project: null,
    index: G.makeCatalogIndex([]),
    mode: "select",
    selectedPieceId: null,
    selectedPlacementId: null,
    pointerWorld: null,
    snap: null,
    drag: null,
    movePlacementId: null,
    placementSession: null,
    fixedStart: null,
    startPickMode: false,
    lastCommitAt: 0,
    autoConnectSnap: null,
    aiPlanner: { open: false, busy: false, abort: null, generated: null },
    show3d: true,
    view3d: { yawDeg: 0, tilt: 0.55, zoom: 1, panX: 0, panY: 0, drag: null },
    renderQueued: false
  };

  const els = {};
  const AI_SETTINGS_KEY = "raildesign.aiPlanner.settings.v1";
  const AI_KEY_STORAGE_KEY = "raildesign.aiPlanner.apiKey.v1";
  const AI_MASK = "************";
  const AI_DEFAULTS = {
    anthropic: {
      baseUrl: "https://api.anthropic.com",
      model: "claude-opus-4-8"
    },
    openai: {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1"
    }
  };

  const AI_TEMPLATES = {
    "重新设计": "请重新设计当前轨道，做一个适合 N 轨的紧凑环线布局，尽量使用标准直轨和曲轨，减少开放端点，并保持在画布范围内。",
    "扩展当前": "请基于当前布局继续扩展，不要删除已有轨道。增加一条会车线和一条短侧线，尽量避免碰撞，并保持连接合理。",
    "从起点": "请从当前设置的起点继续铺轨，延展出一段自然线路。优先使用标准直轨和曲轨，必要时可以使用道岔。",
    "优化": "请优化当前布局，尽量减少开放端点和断开的连通分量，保留大部分已有轨道位置，只在必要时调整或补充。",
    "站场": "请设计一个小型车站区域，包括主线、会车线和一条货物侧线，布局要紧凑，适合当前画布尺寸。"
  };

  const AI_GENERATED_PROJECT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["schema", "summary", "project"],
    properties: {
      schema: { const: "raildesign.aiGeneratedProject.v1" },
      summary: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "description",
          "warnings",
          "estimatedPlacementCount",
          "estimatedTrackLengthMm",
          "estimatedOpenConnectors"
        ],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          warnings: { type: "array", items: { type: "string" } },
          estimatedPlacementCount: { type: "integer" },
          estimatedTrackLengthMm: { type: "number" },
          estimatedOpenConnectors: { type: "integer" }
        }
      },
      project: {
        type: "object",
        additionalProperties: true
      }
    }
  };

  const AI_SYSTEM_PROMPT = [
    "你是 RailDesign Planner 的轨道规划引擎。你需要根据用户需求、当前项目、固定起点、开放端点和素材库，生成一个完整的 RailDesign project JSON 候选方案。",
    "你必须只输出 JSON，不能输出 Markdown、解释文字或代码块。",
    "输出根对象必须是 {\"schema\":\"raildesign.aiGeneratedProject.v1\",\"summary\":{...},\"project\":{...}}。",
    "规则：",
    "1. 所有单位都是 mm。坐标原点在画布中心，x 向右为正，y 向上为正；yawDeg 中 0 表示朝 +x，90 表示朝 +y。",
    "2. 只能使用上下文 catalog.pieces 中存在的 pieceId，不能编造 pieceId 或 connectorId。",
    "3. project.schema 必须是 raildesign.project.v1，project.units 必须是 mm。",
    "4. 每个 placement 必须包含 id, pieceId, x, y, z, yawDeg；新增 id 使用 ai-pl-001 这种格式。",
    "5. connections 必须引用真实 placementId 和 connectorId；同一个 connector 不能重复连接。",
    "6. 连续轨道的连接端点应尽量几何重合，朝向应相反。",
    "7. 用户要求“基于当前布局扩展”时，尽量保留 currentProject 的 placements 和 connections。",
    "8. 用户要求“重新设计”时，可以替换 placements 和 connections。",
    "9. 用户要求“从当前起点继续铺轨”时，必须优先从 fixedStart 或开放端点开始。",
    "10. 尽量让轨道位于 board 范围内，减少开放端点，避免明显碰撞。",
    "11. 如果不能完全闭合或不能满足需求，把原因写入 summary.warnings。"
  ].join("\n");

  function $(id) {
    return document.getElementById(id);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function activeCatalog() {
    return state.catalogs.find(function (catalog) {
      return catalog.catalogId === state.activeCatalogId;
    }) || state.catalogs[0] || null;
  }

  function selectedPlacement() {
    return (state.project.placements || []).find(function (placement) {
      return placement.id === state.selectedPlacementId;
    }) || null;
  }

  function selectedPiece() {
    return G.getPiece(state.index, state.selectedPieceId);
  }

  function activePlacementPiece() {
    if (state.placementSession && state.placementSession.pieceId) {
      return G.getPiece(state.index, state.placementSession.pieceId);
    }
    return selectedPiece();
  }

  function selectedPlacementPiece() {
    const placement = selectedPlacement();
    return placement ? G.getPiece(state.index, placement.pieceId) : null;
  }

  function hasTrackConnectors(piece) {
    return Boolean(piece && piece.geometry && piece.geometry.connectors && piece.geometry.connectors.length);
  }

  function setStatus(message) {
    els.storageStatus.textContent = message;
  }

  function syncProjectView() {
    if (!state.project.view) state.project.view = {};
    state.project.view.camera2d = camera();
  }

  function camera() {
    if (!state.project.view) state.project.view = {};
    if (!state.project.view.camera2d) {
      state.project.view.camera2d = { x: 0, y: 0, zoom: 0.8, rotationDeg: 0 };
    }
    return state.project.view.camera2d;
  }

  function markDirty() {
    if (!state.project.metadata) state.project.metadata = {};
    state.project.metadata.updatedAt = nowIso();
  }

  async function init() {
    cacheElements();
    attachEvents();

    await Db.db.open();
    await seedDemoIfNeeded(false);
    await reloadCatalogs();
    await loadInitialProject();

    resizeCanvases();
    fitView();
    renderAll();
    await renderLocalProjects();
    setStatus(window.__RAILDESIGN_DEXIE_FALLBACK__
      ? "本地存储：IndexedDB fallback 已启用。"
      : "本地存储：Dexie 已启用。");
  }

  function cacheElements() {
    [
      "newProjectBtn",
      "saveProjectBtn",
      "exportProjectBtn",
      "exportCatalogBtn",
      "importJsonBtn",
      "aiPlannerOpenBtn",
      "jsonInput",
      "seedDemoBtn",
      "catalogSelect",
      "catalogInfo",
      "pieceLibrary",
      "selectModeBtn",
      "setStartPointBtn",
      "clearStartPointBtn",
      "fixedStartStatus",
      "fitViewBtn",
      "viewRotateLeftBtn",
      "viewRotateRightBtn",
      "toggle3dBtn",
      "canvasStack",
      "planInspector",
      "planInspectorName",
      "planInspectorHint",
      "planYawInput",
      "planStepInput",
      "planRotateDirection",
      "planApplyYawBtn",
      "planRotateStepBtn",
      "planFlipHorizontalBtn",
      "planFlipVerticalBtn",
      "boardWidthInput",
      "boardHeightInput",
      "gridInput",
      "toolHint",
      "planCanvas",
      "viewCanvas",
      "projectNameInput",
      "pieceCount",
      "trackLength",
      "validationBox",
      "selectedEmpty",
      "selectedForm",
      "selectedName",
      "selX",
      "selY",
      "selZ",
      "selZEnd",
      "selYaw",
      "rotateLeftBtn",
      "rotateRightBtn",
      "deletePlacementBtn",
      "bomList",
      "localProjects",
      "storageStatus",
      "aiPlannerPanel",
      "aiPlannerCloseBtn",
      "aiProviderSelect",
      "aiBaseUrlInput",
      "aiModelInput",
      "aiApiKeyInput",
      "aiSaveKeyBtn",
      "aiDeleteKeyBtn",
      "aiKeyStatus",
      "aiPromptInput",
      "aiGenerateBtn",
      "aiStopBtn",
      "aiCopyJsonBtn",
      "aiResultBox",
      "aiApplyBtn"
    ].forEach(function (id) {
      els[id] = $(id);
    });

    els.planCtx = els.planCanvas.getContext("2d");
    els.viewCtx = els.viewCanvas.getContext("2d");
  }

  function attachEvents() {
    els.newProjectBtn.addEventListener("click", newProject);
    els.saveProjectBtn.addEventListener("click", saveCurrentProject);
    els.exportProjectBtn.addEventListener("click", exportCurrentProject);
    els.exportCatalogBtn.addEventListener("click", exportCurrentCatalog);
    els.importJsonBtn.addEventListener("click", function () { els.jsonInput.click(); });
    els.aiPlannerOpenBtn.addEventListener("click", openAiPlanner);
    els.aiPlannerCloseBtn.addEventListener("click", closeAiPlanner);
    els.aiProviderSelect.addEventListener("change", onAiProviderChange);
    els.aiBaseUrlInput.addEventListener("change", saveAiSettings);
    els.aiModelInput.addEventListener("change", saveAiSettings);
    els.aiSaveKeyBtn.addEventListener("click", saveAiKey);
    els.aiDeleteKeyBtn.addEventListener("click", deleteAiKey);
    els.aiGenerateBtn.addEventListener("click", generateAiPlan);
    els.aiStopBtn.addEventListener("click", stopAiPlan);
    els.aiCopyJsonBtn.addEventListener("click", copyAiGeneratedJson);
    els.aiApplyBtn.addEventListener("click", applyAiGeneratedPlan);
    document.querySelectorAll("[data-ai-template]").forEach(function (button) {
      button.addEventListener("click", function () { useAiTemplate(button.dataset.aiTemplate); });
    });
    loadAiSettings();
    els.jsonInput.addEventListener("change", importJsonFile);
    els.seedDemoBtn.addEventListener("click", function () { seedDemoIfNeeded(true).then(reloadAfterSeed); });
    els.catalogSelect.addEventListener("change", function () {
      state.activeCatalogId = els.catalogSelect.value;
      state.selectedPieceId = null;
      setMode("select");
      renderAll();
    });
    els.selectModeBtn.addEventListener("click", function () { setMode("select"); });
    els.setStartPointBtn.addEventListener("click", beginStartPickMode);
    els.clearStartPointBtn.addEventListener("click", clearFixedStart);
    els.fitViewBtn.addEventListener("click", fitView);
    els.viewRotateLeftBtn.addEventListener("click", function () { rotateView(-15); });
    els.viewRotateRightBtn.addEventListener("click", function () { rotateView(15); });
    els.toggle3dBtn.addEventListener("click", toggle3dPreview);
    els.planApplyYawBtn.addEventListener("click", applyPlanYaw);
    els.planRotateStepBtn.addEventListener("click", applyPlanStepRotation);
    els.planFlipHorizontalBtn.addEventListener("click", function () { flipSelected("x"); });
    els.planFlipVerticalBtn.addEventListener("click", function () { flipSelected("y"); });

    els.boardWidthInput.addEventListener("change", updateBoardFromInputs);
    els.boardHeightInput.addEventListener("change", updateBoardFromInputs);
    els.gridInput.addEventListener("change", updateBoardFromInputs);
    els.projectNameInput.addEventListener("change", function () {
      state.project.name = els.projectNameInput.value.trim() || "Untitled Layout";
      markDirty();
      queueRender();
    });

    ["selX", "selY", "selZ", "selZEnd", "selYaw"].forEach(function (id) {
      els[id].addEventListener("change", updateSelectedFromInputs);
    });
    els.rotateLeftBtn.addEventListener("click", function () { rotateSelected(-15); });
    els.rotateRightBtn.addEventListener("click", function () { rotateSelected(15); });
    els.deletePlacementBtn.addEventListener("click", deleteSelectedPlacement);

    els.planCanvas.addEventListener("pointermove", onPlanPointerMove);
    els.planCanvas.addEventListener("pointerdown", onPlanPointerDown);
    els.planCanvas.addEventListener("pointerup", onPlanPointerUp);
    els.planCanvas.addEventListener("pointercancel", onPlanPointerUp);
    els.planCanvas.addEventListener("dblclick", onPlanDoubleClick);
    els.planCanvas.addEventListener("wheel", onPlanWheel, { passive: false });
    els.planCanvas.addEventListener("contextmenu", function (event) { event.preventDefault(); });
    els.viewCanvas.addEventListener("pointerdown", onViewPointerDown);
    els.viewCanvas.addEventListener("pointermove", onViewPointerMove);
    els.viewCanvas.addEventListener("pointerup", onViewPointerUp);
    els.viewCanvas.addEventListener("pointercancel", onViewPointerUp);
    els.viewCanvas.addEventListener("wheel", onViewWheel, { passive: false });
    els.viewCanvas.addEventListener("dblclick", reset3dView);
    els.viewCanvas.addEventListener("contextmenu", function (event) { event.preventDefault(); });

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", function () {
      resizeCanvases();
      renderAll();
    });

    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        resizeCanvases();
        renderAll();
      }).observe(els.planCanvas.parentElement);
    }
  }

  async function seedDemoIfNeeded(force) {
    const catalogs = await Db.listCatalogs();
    const projects = await Db.listProjects();
    if (force || catalogs.length === 0) {
      await Db.saveCatalog(clone(Sample.catalog));
    }
    const tomixRow = window.RailTomixCatalog
      ? catalogs.find(function (row) { return row.catalogId === window.RailTomixCatalog.catalogId; })
      : null;
    if (window.RailTomixCatalog && (
      force ||
      !tomixRow ||
      tomixRow.version !== window.RailTomixCatalog.version ||
      !tomixRow.data ||
      !tomixRow.data.pieces ||
      tomixRow.data.pieces.length !== window.RailTomixCatalog.pieces.length
    )) {
      await Db.saveCatalog(clone(window.RailTomixCatalog));
    }
    if (force || projects.length === 0) {
      await Db.saveProject(clone(Sample.project));
    }
  }

  async function reloadAfterSeed() {
    await reloadCatalogs();
    state.project = clone(Sample.project);
    G.clearGeometryCache();
    state.selectedPlacementId = null;
    state.fixedStart = null;
    state.startPickMode = false;
    clearPlacementSession();
    rebuildIndex();
    fitView();
    renderAll();
    await renderLocalProjects();
    setStatus("Demo catalog/project 已写入本地 IndexedDB。");
  }

  async function reloadCatalogs() {
    const rows = await Db.listCatalogs();
    state.catalogs = rows.map(function (row) { return row.data; });
    if (!state.activeCatalogId || !state.catalogs.some(function (catalog) { return catalog.catalogId === state.activeCatalogId; })) {
      state.activeCatalogId = state.catalogs[0] ? state.catalogs[0].catalogId : null;
    }
    rebuildIndex();
  }

  async function loadInitialProject() {
    const projects = await Db.listProjects();
    state.project = projects[0] ? clone(projects[0].data) : clone(Sample.project);
    ensureProjectShape();
    rebuildIndex();
  }

  function ensureProjectShape() {
    if (!state.project) state.project = makeBlankProject();
    if (!state.project.board) state.project.board = { widthMm: 1800, heightMm: 900, origin: "center", gridMm: 20 };
    if (!state.project.placements) state.project.placements = [];
    if (!state.project.connections) state.project.connections = [];
    if (!state.project.catalogRefs) state.project.catalogRefs = [];
    if (!state.project.layers) state.project.layers = [{ id: "base", name: "Base Layout", visible: true, locked: false }];
    if (!state.project.metadata) state.project.metadata = { createdAt: nowIso(), updatedAt: nowIso() };
  }

  function rebuildIndex() {
    state.index = G.makeCatalogIndex(state.catalogs);
  }

  function makeBlankProject() {
    return {
      schema: "raildesign.project.v1",
      projectId: "layout-" + Date.now().toString(36),
      name: "Untitled Layout",
      units: "mm",
      board: { widthMm: 1800, heightMm: 900, origin: "center", gridMm: 20 },
      catalogRefs: state.catalogs.map(function (catalog) {
        return { catalogId: catalog.catalogId, version: catalog.version };
      }),
      view: { camera2d: { x: 0, y: 0, zoom: 0.75, rotationDeg: 0 }, camera3d: { yawDeg: -40, pitchDeg: 45, distanceMm: 1400 } },
      layers: [{ id: "base", name: "Base Layout", visible: true, locked: false }],
      placements: [],
      connections: [],
      metadata: { createdAt: nowIso(), updatedAt: nowIso() }
    };
  }

  function newProject() {
    state.project = makeBlankProject();
    G.clearGeometryCache();
    state.selectedPlacementId = null;
    state.selectedPieceId = null;
    state.fixedStart = null;
    state.startPickMode = false;
    clearPlacementSession();
    setMode("select");
    fitView();
    renderAll();
    setStatus("已创建新项目。点击“保存到本地”后会写入 IndexedDB。");
  }

  async function saveCurrentProject() {
    syncProjectView();
    markDirty();
    await Db.saveProject(clone(state.project));
    await renderLocalProjects();
    setStatus("项目已保存到本地 IndexedDB。");
  }

  function setMode(mode) {
    if (mode === "select") {
      cancelPlacementSession({ silent: true });
      state.startPickMode = false;
    }
    state.mode = mode;
    state.snap = null;
    if (mode !== "select") state.movePlacementId = null;
    state.autoConnectSnap = null;
    els.selectModeBtn.classList.toggle("active", mode === "select");
    if (els.setStartPointBtn) els.setStartPointBtn.classList.toggle("active", state.startPickMode);
    updateFixedStartStatus();
    let hint;
    const piece = activePlacementPiece();
    if (state.placementSession && state.placementSession.kind === "move") {
      hint = "移动：轨道已粘到鼠标，单击/双击确认，Esc 取消";
    } else if (state.startPickMode) {
      hint = "设置起点：点击开放端点，或点击空白处作为任意起点";
    } else if (state.fixedStart) {
      hint = "已设置起点：从素材库选择轨道即可从起点继续延展";
    } else if (mode === "place" && piece) {
      hint = "放置：" + piece.name + "（单击放置，Esc/选择退出；靠近开放端自动连接）";
    } else {
      hint = "选择 / 移动模式（双击轨道后会粘到鼠标，靠近开放端自动吸附连接）";
    }
    els.toolHint.textContent = hint;
    queueRender();
  }

  function choosePiece(pieceId) {
    beginLibraryPlacement(pieceId);
  }

  function updateBoardFromInputs() {
    state.project.board.widthMm = Math.max(100, Number(els.boardWidthInput.value) || 1800);
    state.project.board.heightMm = Math.max(100, Number(els.boardHeightInput.value) || 900);
    state.project.board.gridMm = Math.max(5, Number(els.gridInput.value) || 20);
    markDirty();
    queueRender();
  }

  function rotateView(deltaDeg) {
    const cam = camera();
    cam.rotationDeg = G.normalizeDeg((cam.rotationDeg || 0) + deltaDeg);
    queueRender();
  }

  function rotateSelected(deltaDeg) {
    const placement = selectedPlacement();
    if (!placement) return;
    detachPlacement(placement.id);
    G.invalidatePlacementGeometry(placement.id);
    placement.yawDeg = G.normalizeDeg((placement.yawDeg || 0) + deltaDeg);
    markDirty();
    queueRender();
  }

  function applyPlanYaw() {
    const placement = selectedPlacement();
    if (!placement) return;
    detachPlacement(placement.id);
    G.invalidatePlacementGeometry(placement.id);
    placement.yawDeg = G.normalizeDeg(Number(els.planYawInput.value) || 0);
    markDirty();
    queueRender();
  }

  function applyPlanStepRotation() {
    const step = Math.abs(Number(els.planStepInput.value) || 0);
    const direction = els.planRotateDirection.value === "ccw" ? -1 : 1;
    rotateSelected(step * direction);
  }

  function flipSelected(axis) {
    const placement = selectedPlacement();
    if (!placement) return;
    detachPlacement(placement.id);
    G.invalidatePlacementGeometry(placement.id);
    if (axis === "x") placement.flipX = !placement.flipX;
    if (axis === "y") placement.flipY = !placement.flipY;
    markDirty();
    queueRender();
  }

  function toggle3dPreview() {
    state.show3d = !state.show3d;
    resizeCanvases();
    queueRender();
  }

  function reset3dView() {
    state.view3d.yawDeg = 0;
    state.view3d.tilt = 0.55;
    state.view3d.zoom = 1;
    state.view3d.panX = 0;
    state.view3d.panY = 0;
    queueRender();
  }

  function updateSelectedFromInputs() {
    const placement = selectedPlacement();
    if (!placement) return;
    detachPlacement(placement.id);
    G.invalidatePlacementGeometry(placement.id);
    placement.x = Number(els.selX.value) || 0;
    placement.y = Number(els.selY.value) || 0;
    placement.z = Number(els.selZ.value) || 0;
    const zEndRaw = els.selZEnd.value;
    placement.zEnd = zEndRaw === "" ? undefined : Number(zEndRaw);
    placement.yawDeg = G.normalizeDeg(Number(els.selYaw.value) || 0);
    markDirty();
    queueRender();
  }

  function deleteSelectedPlacement() {
    if (!state.selectedPlacementId) return;
    const id = state.selectedPlacementId;
    G.invalidatePlacementGeometry(id);
    state.project.placements = state.project.placements.filter(function (placement) {
      return placement.id !== id;
    });
    state.project.connections = state.project.connections.filter(function (connection) {
      return connection.from.placementId !== id && connection.to.placementId !== id;
    });
    state.selectedPlacementId = null;
    state.movePlacementId = null;
    markDirty();
    queueRender();
  }

  function detachPlacement(placementId) {
    state.project.connections = state.project.connections.filter(function (connection) {
      return connection.from.placementId !== placementId && connection.to.placementId !== placementId;
    });
  }

  function placementConnections(placementId) {
    return (state.project.connections || []).filter(function (connection) {
      return connection.from.placementId === placementId || connection.to.placementId === placementId;
    });
  }

  function beginLibraryPlacement(pieceId) {
    const piece = G.getPiece(state.index, pieceId);
    if (!piece) return;
    cancelPlacementSession({ silent: true });
    state.startPickMode = false;
    state.selectedPieceId = pieceId;
    state.selectedPlacementId = null;
    state.placementSession = {
      kind: "new",
      pieceId: pieceId,
      placementId: null,
      sourcePlacement: null,
      removedConnections: [],
      offset: null,
      repeat: false
    };
    state.mode = "place";
    state.snap = null;
    state.autoConnectSnap = null;
    els.selectModeBtn.classList.toggle("active", false);
    updateSnapPreview();
    updateFixedStartStatus();
    if (state.fixedStart && hasTrackConnectors(piece)) {
      const point = state.fixedStart.type === "point"
        ? { x: state.fixedStart.point.x + 1, y: state.fixedStart.point.y, z: state.fixedStart.point.z || 0 }
        : (state.pointerWorld || state.fixedStart.point);
      commitPlacementSession(point);
      return;
    }
    els.toolHint.textContent = "放置：" + piece.name + "（单击放置，Esc/选择退出；靠近开放端自动连接）";
    queueRender();
  }

  function beginMovePlacementSticky(placement, point) {
    const piece = G.getPiece(state.index, placement.pieceId);
    if (!piece) return;
    cancelPlacementSession({ silent: true });
    const removedConnections = placementConnections(placement.id).map(clone);
    detachPlacement(placement.id);
    G.invalidatePlacementGeometry(placement.id);
    state.selectedPlacementId = placement.id;
    state.selectedPieceId = null;
    state.movePlacementId = null;
    state.mode = "place";
    els.selectModeBtn.classList.toggle("active", false);
    state.placementSession = {
      kind: "move",
      pieceId: placement.pieceId,
      placementId: placement.id,
      sourcePlacement: clone(placement),
      removedConnections: removedConnections,
      offset: { x: placement.x - point.x, y: placement.y - point.y },
      repeat: false
    };
    state.autoConnectSnap = computeAutoConnectSnap(placement);
    markDirty();
    setStatus("轨道已粘到鼠标：移动预览，单击或双击确认，Esc 取消。");
    els.toolHint.textContent = "移动：轨道已粘到鼠标，单击/双击确认，Esc 取消";
    queueRender();
  }

  function clearPlacementSession() {
    state.placementSession = null;
    state.snap = null;
    state.autoConnectSnap = null;
    state.movePlacementId = null;
  }

  function cancelPlacementSession(options) {
    const opts = options || {};
    const session = state.placementSession;
    if (session && session.kind === "move") {
      const placement = state.project.placements.find(function (item) { return item.id === session.placementId; });
      if (placement && session.sourcePlacement) {
        G.invalidatePlacementGeometry(placement.id);
        Object.keys(placement).forEach(function (key) { delete placement[key]; });
        Object.assign(placement, clone(session.sourcePlacement));
      }
      if (session.removedConnections && session.removedConnections.length) {
        state.project.connections = (state.project.connections || []).filter(function (connection) {
          return connection.from.placementId !== session.placementId && connection.to.placementId !== session.placementId;
        }).concat(session.removedConnections.map(clone));
      }
      markDirty();
      if (!opts.silent) setStatus("已取消移动，并恢复轨道原位置与连接。");
    }
    clearPlacementSession();
    if (!opts.keepSelection) state.selectedPieceId = null;
    state.mode = "select";
    updateFixedStartStatus();
  }

  function commitPlacementSession(point) {
    const session = state.placementSession;
    if (!session) return;
    if (session.kind === "move") {
      const placement = state.project.placements.find(function (item) { return item.id === session.placementId; });
      if (placement) {
        state.selectedPlacementId = placement.id;
        state.autoConnectSnap = computeAutoConnectSnap(placement);
        const hadSnap = Boolean(state.autoConnectSnap);
        const connected = finalizeAutoConnect({ startPlacement: session.sourcePlacement });
        if (hadSnap && !connected && session.removedConnections && session.removedConnections.length) {
          state.project.connections = (state.project.connections || []).filter(function (connection) {
            return connection.from.placementId !== session.placementId && connection.to.placementId !== session.placementId;
          }).concat(session.removedConnections.map(clone));
          if (placement && session.sourcePlacement) {
            G.invalidatePlacementGeometry(placement.id);
            Object.keys(placement).forEach(function (key) { delete placement[key]; });
            Object.assign(placement, clone(session.sourcePlacement));
          }
        }
        markDirty();
        if (!hadSnap) setStatus("已固定移动轨道。");
      }
      clearPlacementSession();
      state.selectedPieceId = null;
      state.mode = "select";
      setMode("select");
      state.lastCommitAt = Date.now();
      return;
    }

    const candidate = candidatePlacementFor(point);
    if (!candidate || !isCandidateConnectionSafe(candidate)) return;
    if (candidateHasCollision(candidate)) {
      setStatus("放置取消：连接后会与其他轨道冲突，请换个位置或起点。");
      return;
    }
    state.project.placements.push(candidate.placement);
    if (candidate.connection) state.project.connections.push(candidate.connection);
    ensureProjectRefsForPiece(candidate.placement.pieceId);
    state.selectedPlacementId = candidate.placement.id;
    markDirty();
    const advancedStart = Boolean(state.fixedStart && candidate.sourceConnectorId);
    advanceFixedStartFromCandidate(candidate);
    clearPlacementSession();
    state.selectedPieceId = null;
    state.mode = "select";
    setMode("select");
    if (candidate.connection) {
      setStatus(advancedStart
        ? "已放置并连接。继续选择轨道可从当前起点延展。"
        : "已放置并连接。");
    } else {
      setStatus(advancedStart
        ? "已从起点放置轨道。继续选择轨道可从当前起点延展。"
        : "已放置轨道。");
    }
    state.lastCommitAt = Date.now();
    queueRender();
  }

  function beginStartPickMode() {
    cancelPlacementSession({ silent: true });
    state.startPickMode = true;
    state.mode = "select";
    state.selectedPieceId = null;
    state.snap = null;
    state.autoConnectSnap = null;
    setStatus("设置起点：点击开放端点作为连接起点，或点击空白处作为任意起点。");
    updateFixedStartStatus();
    els.toolHint.textContent = "设置起点：点击开放端点，或点击空白处作为任意起点";
    queueRender();
  }

  function clearFixedStart() {
    state.fixedStart = null;
    state.startPickMode = false;
    updateFixedStartStatus();
    setStatus("已清除固定起点。");
    queueRender();
  }

  function updateFixedStartStatus() {
    if (!els.fixedStartStatus) return;
    if (els.setStartPointBtn) els.setStartPointBtn.classList.toggle("active", Boolean(state.startPickMode));
    if (!state.fixedStart) {
      els.fixedStartStatus.textContent = "起点：未设置";
      return;
    }
    if (state.fixedStart.type === "connector" && state.fixedStart.connector) {
      els.fixedStartStatus.textContent = "起点：开放端 " + state.fixedStart.connector.placementId + ":" + state.fixedStart.connector.connectorId;
      return;
    }
    els.fixedStartStatus.textContent = "起点：任意点 " + Math.round(state.fixedStart.point.x) + ", " + Math.round(state.fixedStart.point.y);
  }

  function pickFixedStart(point) {
    const nearest = nearestConnector(point, { thresholdMm: Math.max(28, 24 / camera().zoom) });
    if (nearest) {
      const key = G.connectorKey({ placementId: nearest.connector.placementId, connectorId: nearest.connector.connectorId });
      if (frameOpenConnectorKeys().has(key)) {
        state.fixedStart = {
          type: "connector",
          point: { x: nearest.connector.x, y: nearest.connector.y, z: nearest.connector.z || 0 },
          connector: cloneConnector(nearest.connector)
        };
        setStatus("已将开放端点设为起点：" + nearest.connector.placementId + ":" + nearest.connector.connectorId + "。");
      } else {
        state.fixedStart = {
          type: "point",
          point: { x: nearest.connector.x, y: nearest.connector.y, z: nearest.connector.z || 0 },
          connector: null
        };
        setStatus("该端点已连接，已作为几何起点使用，不会创建重复连接。");
      }
    } else {
      state.fixedStart = { type: "point", point: { x: point.x, y: point.y, z: 0 }, connector: null };
      setStatus("已设置任意起点：" + Math.round(point.x) + ", " + Math.round(point.y) + "。");
    }
    state.startPickMode = false;
    updateFixedStartStatus();
    queueRender();
  }

  function cloneConnector(connector) {
    return {
      placementId: connector.placementId,
      connectorId: connector.connectorId,
      profile: connector.profile,
      x: connector.x,
      y: connector.y,
      z: connector.z || 0,
      yawDeg: connector.yawDeg || 0
    };
  }

  function nearestConnector(point, options) {
    const opts = options || {};
    const threshold = opts.thresholdMm || 28;
    let best = null;
    frameAllConnectors().forEach(function (connector) {
      const distance = Math.hypot(connector.x - point.x, connector.y - point.y);
      if (distance <= threshold && (!best || distance < best.distance)) {
        best = { connector, distance };
      }
    });
    return best;
  }

  function advanceFixedStartFromCandidate(candidate) {
    if (!state.fixedStart || !candidate || !candidate.placement || !candidate.sourceConnectorId) return;
    const piece = G.getPiece(state.index, candidate.placement.pieceId);
    if (!piece || !piece.geometry) return;
    const connected = G.connectedKeySet(state.project);
    const connectors = G.placementConnectors(candidate.placement, piece).filter(function (connector) {
      if (connector.connectorId === candidate.sourceConnectorId) return false;
      return !connected.has(G.connectorKey({ placementId: connector.placementId, connectorId: connector.connectorId }));
    });
    if (!connectors.length) return;
    const sourceConnector = G.placementConnectors(candidate.placement, piece).find(function (connector) {
      return connector.connectorId === candidate.sourceConnectorId;
    });
    const next = connectors.sort(function (a, b) {
      if (!sourceConnector) return 0;
      const da = Math.hypot(a.x - sourceConnector.x, a.y - sourceConnector.y);
      const db = Math.hypot(b.x - sourceConnector.x, b.y - sourceConnector.y);
      return db - da;
    })[0];
    state.fixedStart = {
      type: "connector",
      point: { x: next.x, y: next.y, z: next.z || 0 },
      connector: cloneConnector(next)
    };
    updateFixedStartStatus();
  }

  function isCandidateConnectionSafe(candidate) {
    if (!candidate.connection) return true;
    const connection = candidate.connection;
    const target = frameAllConnectors().find(function (connector) {
      return connector.placementId === connection.to.placementId && connector.connectorId === connection.to.connectorId;
    });
    if (!target) {
      setStatus("放置取消：目标端点已不存在。");
      return false;
    }
    const targetKey = G.connectorKey(connection.to);
    if (!frameOpenConnectorKeys().has(targetKey)) {
      setStatus("放置取消：目标端点已被连接，请重新设置起点或换一个端点。");
      return false;
    }
    const piece = G.getPiece(state.index, candidate.placement.pieceId);
    const source = piece && piece.geometry && piece.geometry.connectors.find(function (connector) {
      return connector.id === connection.from.connectorId;
    });
    if (source && !G.isCompatible(source.profile, target.profile, state.catalogs)) {
      setStatus("放置取消：接口 profile 不兼容。");
      return false;
    }
    return true;
  }

  function candidateHasCollision(candidate) {
    if (!candidate.connection || !window.RailPlanning || !window.RailPlanning.detectCollisions) return false;
    const testProject = Object.assign({}, state.project, {
      placements: (state.project.placements || []).concat([candidate.placement]),
      connections: (state.project.connections || []).concat([candidate.connection])
    });
    const overlaps = window.RailPlanning.detectCollisions(testProject, state.index, { clearanceMm: 2 });
    return overlaps.some(function (collision) {
      if (!(collision.a === candidate.placement.id || collision.b === candidate.placement.id)) return false;
      const otherId = collision.a === candidate.placement.id ? collision.b : collision.a;
      return !candidate.connection || otherId !== candidate.connection.to.placementId;
    });
  }

  function canvasSize(canvas) {
    return {
      width: canvas.clientWidth || canvas.getBoundingClientRect().width,
      height: canvas.clientHeight || canvas.getBoundingClientRect().height
    };
  }

  function resizeCanvases() {
    [els.planCanvas, els.viewCanvas].forEach(function (canvas) {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }

  function worldToScreen(point) {
    const size = canvasSize(els.planCanvas);
    const cam = camera();
    const rot = G.degToRad(cam.rotationDeg || 0);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const dx = point.x - cam.x;
    const dy = point.y - cam.y;
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    return {
      x: size.width / 2 + rx * cam.zoom,
      y: size.height / 2 - ry * cam.zoom
    };
  }

  function screenToWorld(x, y) {
    const size = canvasSize(els.planCanvas);
    const cam = camera();
    const rot = G.degToRad(cam.rotationDeg || 0);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const rx = (x - size.width / 2) / cam.zoom;
    const ry = -(y - size.height / 2) / cam.zoom;
    return {
      x: cam.x + rx * c + ry * s,
      y: cam.y - rx * s + ry * c
    };
  }

  function eventWorld(event) {
    const rect = els.planCanvas.getBoundingClientRect();
    return screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  }

  function onPlanPointerMove(event) {
    const point = eventWorld(event);
    state.pointerWorld = point;

    if (state.drag && state.drag.kind === "pan") {
      const prev = screenToWorld(state.drag.lastX, state.drag.lastY);
      const rect = els.planCanvas.getBoundingClientRect();
      const next = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const cam = camera();
      cam.x += prev.x - next.x;
      cam.y += prev.y - next.y;
      state.drag.lastX = event.clientX - rect.left;
      state.drag.lastY = event.clientY - rect.top;
      queueRender();
      return;
    }

    if (state.placementSession && state.placementSession.kind === "move") {
      const placement = state.project.placements.find(function (item) {
        return item.id === state.placementSession.placementId;
      });
      if (placement) {
        G.invalidatePlacementGeometry(placement.id);
        placement.x = point.x + state.placementSession.offset.x;
        placement.y = point.y + state.placementSession.offset.y;
        state.autoConnectSnap = computeAutoConnectSnap(placement);
        markDirty();
        queueRender();
      }
      return;
    }

    if (state.drag && state.drag.kind === "move") {
      const placement = selectedPlacement();
      if (placement) {
        G.invalidatePlacementGeometry(placement.id);
        placement.x = state.drag.startPlacement.x + point.x - state.drag.startWorld.x;
        placement.y = state.drag.startPlacement.y + point.y - state.drag.startWorld.y;
        state.autoConnectSnap = computeAutoConnectSnap(placement);
        markDirty();
        queueRender();
      }
      return;
    }

    if (state.startPickMode) {
      state.snap = null;
      queueRender();
      return;
    }

    updateSnapPreview();
    queueRender();
  }

  function computeAutoConnectSnap(draggedPlacement) {
    const piece = G.getPiece(state.index, draggedPlacement.pieceId);
    if (!piece || !piece.geometry) return null;
    const connected = G.connectedKeySet(state.project);
    const draggedConnectors = G.placementConnectors(draggedPlacement, piece);
    const threshold = Math.max(40, 30 / camera().zoom);
    let best = null;
    frameAllConnectors().forEach(function (other) {
      if (other.placementId === draggedPlacement.id) return;
      const otherKey = G.connectorKey({ placementId: other.placementId, connectorId: other.connectorId });
      if (connected.has(otherKey)) return; // target must be an OPEN endpoint
      draggedConnectors.forEach(function (dc) {
        const dKey = G.connectorKey({ placementId: dc.placementId, connectorId: dc.connectorId });
        if (connected.has(dKey)) return; // dragged connector already connected
        if (!G.isCompatible(dc.profile, other.profile, state.catalogs)) return;
        const dist = Math.hypot(dc.x - other.x, dc.y - other.y);
        if (dist <= threshold && (!best || dist < best.distance)) {
          best = { draggedConn: dc, target: other, distance: dist };
        }
      });
    });
    return best;
  }

  function finalizeAutoConnect(drag) {
    const placement = selectedPlacement();
    if (!placement || !state.autoConnectSnap) { state.autoConnectSnap = null; return false; }
    const piece = G.getPiece(state.index, placement.pieceId);
    const snap = state.autoConnectSnap;
    state.autoConnectSnap = null;
    const aligned = G.alignConnectorToTarget(piece, snap.draggedConn.connectorId, snap.target);
    const original = drag && drag.startPlacement
      ? { x: drag.startPlacement.x, y: drag.startPlacement.y, z: drag.startPlacement.z || 0, yawDeg: drag.startPlacement.yawDeg || 0 }
      : { x: placement.x, y: placement.y, z: placement.z, yawDeg: placement.yawDeg };
    G.invalidatePlacementGeometry(placement.id);
    placement.x = aligned.x;
    placement.y = aligned.y;
    placement.z = aligned.z;
    placement.yawDeg = aligned.yawDeg;
    // Collision check: does the aligned placement overlap any OTHER placement?
    // Exclude the just-joined pair (the dragged piece and its target legitimately touch at the connector).
    if (window.RailPlanning && window.RailPlanning.detectCollisions) {
      const overlaps = window.RailPlanning.detectCollisions(state.project, state.index, { clearanceMm: 2 });
      const conflict = overlaps.some(function (c) {
        if (!(c.a === placement.id || c.b === placement.id)) return false;
        const otherId = c.a === placement.id ? c.b : c.a;
        return otherId !== snap.target.placementId;
      });
      if (conflict) {
        G.invalidatePlacementGeometry(placement.id);
        placement.x = original.x;
        placement.y = original.y;
        placement.z = original.z;
        placement.yawDeg = original.yawDeg;
        setStatus("自动连接取消：对准后与其他轨道冲突，请先挪开附近轨道再试。");
        queueRender();
        return false;
      }
    }
    state.project.connections.push({
      from: { placementId: placement.id, connectorId: snap.draggedConn.connectorId },
      to: { placementId: snap.target.placementId, connectorId: snap.target.connectorId }
    });
    ensureProjectRefsForPiece(placement.pieceId);
    markDirty();
    setStatus("已自动连接并对准角度：" + snap.draggedConn.connectorId + " → " + snap.target.placementId + ":" + snap.target.connectorId + "。");
    queueRender();
    return true;
  }

  function onPlanPointerDown(event) {
    const point = eventWorld(event);
    state.pointerWorld = point;
    try {
      els.planCanvas.setPointerCapture(event.pointerId);
    } catch (error) {
      // Synthetic tests and some cancelled pointer streams do not have an active
      // pointer to capture; the interaction still works without capture.
    }

    if (state.startPickMode) {
      pickFixedStart(point);
      return;
    }

    if (state.placementSession) {
      if (event.button && event.button !== 0) return;
      if (event.detail && event.detail > 1 && state.placementSession.kind !== "move") return;
      commitPlacementSession(point);
      return;
    }

    if (state.mode === "place" && selectedPiece()) {
      placeSelectedPiece(point);
      return;
    }

    const hit = hitTestPlacement(point, Math.max(12, 14 / camera().zoom));
    if (hit) {
      state.selectedPlacementId = hit.id;
      state.selectedPieceId = null;
      if (state.movePlacementId === hit.id) {
        detachPlacement(hit.id);
        G.invalidatePlacementGeometry(hit.id);
        state.drag = {
          kind: "move",
          startWorld: point,
          startPlacement: { x: hit.x, y: hit.y, z: hit.z || 0, yawDeg: hit.yawDeg || 0 }
        };
        state.autoConnectSnap = null;
        markDirty();
      } else {
        state.drag = null;
      }
      queueRender();
      return;
    }

    state.selectedPlacementId = null;
    state.movePlacementId = null;
    state.autoConnectSnap = null;
    const rect = els.planCanvas.getBoundingClientRect();
    state.drag = {
      kind: "pan",
      lastX: event.clientX - rect.left,
      lastY: event.clientY - rect.top
    };
    queueRender();
  }

  function onPlanPointerUp() {
    if (state.drag && state.drag.kind === "move") {
      finalizeAutoConnect(state.drag);
      state.movePlacementId = null;
    }
    state.drag = null;
  }

  function onPlanDoubleClick(event) {
    const point = eventWorld(event);
    if (Date.now() - state.lastCommitAt < 350) return;
    if (state.placementSession && state.placementSession.kind === "move") {
      commitPlacementSession(point);
      return;
    }
    const hit = hitTestPlacement(point, Math.max(12, 14 / camera().zoom));
    if (!hit) return;
    beginMovePlacementSticky(hit, point);
  }

  function onPlanWheel(event) {
    event.preventDefault();
    const rect = els.planCanvas.getBoundingClientRect();
    const before = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    const cam = camera();
    cam.zoom = Math.max(0.12, Math.min(3.2, cam.zoom * (event.deltaY < 0 ? 1.12 : 0.88)));
    const after = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
    queueRender();
  }

  function onKeyDown(event) {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    if (event.key === "Escape") {
      if (state.startPickMode) {
        state.startPickMode = false;
        updateFixedStartStatus();
        setStatus("已取消设置起点。");
        setMode("select");
        event.preventDefault();
        return;
      }
      if (state.placementSession) {
        cancelPlacementSession();
        queueRender();
        event.preventDefault();
        return;
      }
      state.selectedPieceId = null;
      state.movePlacementId = null;
      setMode("select");
    }
    if ((event.key === "Delete" || event.key === "Backspace") && !state.placementSession && !state.startPickMode) deleteSelectedPlacement();
    if (event.key.toLowerCase() === "q") rotateSelected(-15);
    if (event.key.toLowerCase() === "e") rotateSelected(15);
  }

  function onViewPointerDown(event) {
    const rect = els.viewCanvas.getBoundingClientRect();
    els.viewCanvas.setPointerCapture(event.pointerId);
    state.view3d.drag = {
      mode: event.button === 2 || event.button === 1 || event.shiftKey ? "pan" : "rotate",
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      yawDeg: state.view3d.yawDeg,
      tilt: state.view3d.tilt,
      panX: state.view3d.panX,
      panY: state.view3d.panY
    };
  }

  function onViewPointerMove(event) {
    if (!state.view3d.drag) return;
    const rect = els.viewCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dx = x - state.view3d.drag.x;
    const dy = y - state.view3d.drag.y;
    if (state.view3d.drag.mode === "pan") {
      state.view3d.panX = state.view3d.drag.panX + dx;
      state.view3d.panY = state.view3d.drag.panY + dy;
    } else {
      state.view3d.yawDeg = G.normalizeDeg(state.view3d.drag.yawDeg + dx * 0.45);
      state.view3d.tilt = Math.max(0.18, Math.min(0.9, state.view3d.drag.tilt + dy * 0.003));
    }
    queueRender();
  }

  function onViewPointerUp() {
    state.view3d.drag = null;
  }

  function onViewWheel(event) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.88;
    state.view3d.zoom = Math.max(0.35, Math.min(4, state.view3d.zoom * factor));
    queueRender();
  }

  function updateSnapPreview() {
    state.snap = null;
    if (state.mode !== "place" || !state.pointerWorld) return;
    if (state.fixedStart && state.fixedStart.type === "connector") return;
    const piece = activePlacementPiece();
    if (!hasTrackConnectors(piece)) return;
    const source = piece.geometry.connectors[0];
    state.snap = nearestSnapConnector(state.pointerWorld, {
      thresholdMm: Math.max(26, 22 / camera().zoom),
      sourceProfile: source.profile
    });
  }

  function connectorStillOpen(connector) {
    if (!connector) return false;
    return frameOpenConnectorKeys().has(G.connectorKey({
      placementId: connector.placementId,
      connectorId: connector.connectorId
    }));
  }

  function compatibleSourceConnectors(piece, targetConnector) {
    return (piece.geometry.connectors || []).filter(function (source) {
      return !targetConnector.profile || G.isCompatible(source.profile, targetConnector.profile, state.catalogs);
    });
  }

  function bestAlignedCandidate(piece, id, point, targetConnector) {
    const sources = compatibleSourceConnectors(piece, targetConnector);
    if (!sources.length) return null;
    const candidates = sources.map(function (source) {
      const aligned = G.alignConnectorToTarget(piece, source.id, targetConnector);
      return {
        source,
        aligned,
        distance: Math.hypot(aligned.x - point.x, aligned.y - point.y)
      };
    }).sort(function (a, b) {
      return a.distance - b.distance;
    });
    const best = candidates[0];
    return {
      placement: {
        id,
        pieceId: piece.id,
        x: best.aligned.x,
        y: best.aligned.y,
        z: best.aligned.z,
        yawDeg: best.aligned.yawDeg,
        layerId: "base",
        locked: false
      },
      sourceConnectorId: best.source.id,
      targetConnector
    };
  }

  function candidatePlacementFor(point) {
    const piece = activePlacementPiece();
    const id = G.makeId("pl");
    if (!piece) return null;

    if (hasTrackConnectors(piece)) {
      if (state.fixedStart && state.fixedStart.type === "connector" && connectorStillOpen(state.fixedStart.connector)) {
        const anchored = bestAlignedCandidate(piece, id, point, state.fixedStart.connector);
        if (anchored) {
          anchored.connection = {
            from: { placementId: id, connectorId: anchored.sourceConnectorId },
            to: {
              placementId: state.fixedStart.connector.placementId,
              connectorId: state.fixedStart.connector.connectorId
            }
          };
          return anchored;
        }
      }

      updateSnapPreview();
      if (state.snap) {
        const snapped = bestAlignedCandidate(piece, id, point, state.snap.connector);
        if (snapped) {
          snapped.connection = {
            from: { placementId: id, connectorId: snapped.sourceConnectorId },
            to: {
              placementId: state.snap.connector.placementId,
              connectorId: state.snap.connector.connectorId
            }
          };
          return snapped;
        }
      }

      if (state.fixedStart && state.fixedStart.type === "point") {
        const start = state.fixedStart.point;
        const yawDeg = G.normalizeDeg(G.radToDeg(Math.atan2(point.y - start.y, point.x - start.x)));
        const target = {
          x: start.x,
          y: start.y,
          z: start.z || 0,
          yawDeg,
          profile: piece.geometry.connectors[0].profile
        };
        const anchoredPoint = bestAlignedCandidate(piece, id, point, target);
        if (anchoredPoint) {
          anchoredPoint.connection = null;
          return anchoredPoint;
        }
      }
    }

    return {
      placement: {
        id,
        pieceId: piece.id,
        x: point.x,
        y: point.y,
        z: 0,
        yawDeg: 0,
        layerId: "base",
        locked: false
      },
      connection: null
    };
  }

  function placeSelectedPiece(point) {
    if (!state.placementSession && state.selectedPieceId) beginLibraryPlacement(state.selectedPieceId);
    commitPlacementSession(point);
  }

  function ensureProjectRefsForPiece(pieceId) {
    const entry = state.index.byId[pieceId];
    if (!entry) return;
    const exists = state.project.catalogRefs.some(function (ref) {
      return ref.catalogId === entry.catalog.catalogId;
    });
    if (!exists) {
      state.project.catalogRefs.push({ catalogId: entry.catalog.catalogId, version: entry.catalog.version });
    }
  }

  function fitView() {
    const size = canvasSize(els.planCanvas);
    const board = state.project.board || { widthMm: 1800, heightMm: 900 };
    const projectBounds = G.projectBounds(state.project, state.index);
    const bounds = {
      minX: Math.min(projectBounds.minX, -board.widthMm / 2),
      maxX: Math.max(projectBounds.maxX, board.widthMm / 2),
      minY: Math.min(projectBounds.minY, -board.heightMm / 2),
      maxY: Math.max(projectBounds.maxY, board.heightMm / 2)
    };
    const width = Math.max(100, bounds.maxX - bounds.minX);
    const height = Math.max(100, bounds.maxY - bounds.minY);
    const cam = camera();
    cam.x = (bounds.minX + bounds.maxX) / 2;
    cam.y = (bounds.minY + bounds.maxY) / 2;
    cam.zoom = Math.max(0.12, Math.min(3, Math.min(size.width / (width * 1.15), size.height / (height * 1.18))));
    queueRender();
  }

  function queueRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(function () {
      state.renderQueued = false;
      renderAll();
    });
  }

  const frameCache = {};

  function resetFrameCache() {
    frameCache.allConnectors = null;
    frameCache.openConnectors = null;
    frameCache.openConnectorKeys = null;
    frameCache.spatial = null;
    frameCache.graph = null;
    frameCache.components = null;
  }

  function frameGraph() {
    if (!frameCache.graph && window.RailGraph) {
      frameCache.graph = window.RailGraph.buildTopologyGraph(state.project, state.index);
    }
    return frameCache.graph;
  }

  function frameConnectedComponents() {
    if (!frameCache.components && window.RailGraph) {
      frameCache.components = window.RailGraph.connectedComponents(frameGraph());
    }
    return frameCache.components;
  }

  function frameSpatialIndex() {
    if (!frameCache.spatial) {
      const grid = new RailSpatial.SpatialGrid(RailSpatial.DEFAULT_CELL);
      (state.project.placements || []).forEach(function (placement) {
        const piece = G.getPiece(state.index, placement.pieceId);
        if (!piece) return;
        const bounds = G.placementBounds(placement, piece);
        grid.insert(placement.id, bounds, { placement, piece });
      });
      frameCache.spatial = grid;
    }
    return frameCache.spatial;
  }

  function hitTestPlacement(point, threshold) {
    const grid = frameSpatialIndex();
    const candidates = grid.queryRadius(point.x, point.y, threshold + 20);
    let best = null;
    // When several placements are hit at the same location (e.g. a track sitting on
    // top of an embankment), prefer the one rendered "on top" — i.e. the placement
    // with the higher z. Within the same z, prefer the closer one (track edge over
    // accessory bounding box). Within both equal, prefer tracks (geometry) over
    // accessories so we never get stuck under a pier.
    function priority(placement, piece, distance) {
      const accessoryHeight = piece.dimensions ? (piece.dimensions.heightMm || 0) : 0;
      // For accessories, "top surface" = z + height; for tracks just z.
      const topZ = (placement.z || 0) + (piece.geometry ? 0 : accessoryHeight);
      const isTrack = piece.geometry ? 1 : 0;
      return { topZ: topZ, isTrack: isTrack, distance: distance };
    }
    function isBetter(candidate, current) {
      if (!current) return true;
      // Higher top first (covers lower items)
      if (candidate.topZ !== current.topZ) return candidate.topZ > current.topZ;
      // Same height: tracks beat accessories
      if (candidate.isTrack !== current.isTrack) return candidate.isTrack > current.isTrack;
      // Same height + same kind: closer wins
      return candidate.distance < current.distance;
    }
    candidates.forEach(function (entry) {
      const placement = entry.payload.placement;
      const piece = entry.payload.piece;
      if (!piece.geometry) {
        // Accessory: AABB containment + edge distance (long pieces like 3228 土坡).
        const bounds = G.placementBounds(placement, piece);
        const inside = point.x >= bounds.minX && point.x <= bounds.maxX &&
                       point.y >= bounds.minY && point.y <= bounds.maxY;
        let distance;
        if (inside) {
          distance = 0;
        } else {
          const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX);
          const dy = Math.max(bounds.minY - point.y, 0, point.y - bounds.maxY);
          distance = Math.hypot(dx, dy);
        }
        if (distance <= threshold) {
          const candidate = priority(placement, piece, distance);
          candidate.placement = placement;
          if (isBetter(candidate, best)) best = candidate;
        }
        return;
      }
      G.placementRoutes(placement, piece, 12).forEach(function (route) {
        for (let i = 1; i < route.points.length; i += 1) {
          const distance = G.pointLineDistance(point, route.points[i - 1], route.points[i]);
          if (distance <= threshold) {
            const candidate = priority(placement, piece, distance);
            candidate.placement = placement;
            if (isBetter(candidate, best)) best = candidate;
          }
        }
      });
    });
    return best ? best.placement : null;
  }

  function nearestSnapConnector(point, options) {
    const opts = options || {};
    const threshold = opts.thresholdMm || 28;
    const sourceProfile = opts.sourceProfile || null;
    let best = null;
    frameOpenConnectors().forEach(function (connector) {
      if (sourceProfile && !G.isCompatible(sourceProfile, connector.profile, state.catalogs)) return;
      const distance = Math.hypot(connector.x - point.x, connector.y - point.y);
      if (distance <= threshold && (!best || distance < best.distance)) {
        best = { connector, distance };
      }
    });
    return best;
  }

  function frameAllConnectors() {
    if (!frameCache.allConnectors) {
      frameCache.allConnectors = G.allConnectors(state.project, state.index);
    }
    return frameCache.allConnectors;
  }

  function frameOpenConnectors() {
    if (!frameCache.openConnectors) {
      const connected = G.connectedKeySet(state.project);
      frameCache.openConnectors = frameAllConnectors().filter(function (connector) {
        return !connected.has(G.connectorKey({
          placementId: connector.placementId,
          connectorId: connector.connectorId
        }));
      });
    }
    return frameCache.openConnectors;
  }

  function frameOpenConnectorKeys() {
    if (!frameCache.openConnectorKeys) {
      frameCache.openConnectorKeys = new Set(frameOpenConnectors().map(function (connector) {
        return connector.placementId + ":" + connector.connectorId;
      }));
    }
    return frameCache.openConnectorKeys;
  }

  function renderAll() {
    if (!state.project) return;
    ensureProjectShape();
    resetFrameCache();
    renderCatalogSelect();
    renderPieceLibrary();
    renderProjectFields();
    renderMetrics();
    renderSelectedForm();
    renderPlanInspector();
    render3dVisibility();
    updateFixedStartStatus();
    renderPlan();
    render3d();
  }

  function render3dVisibility() {
    els.canvasStack.classList.toggle("three-collapsed", !state.show3d);
    els.toggle3dBtn.textContent = state.show3d ? "收起 3D" : "展开 3D";
  }

  function renderCatalogSelect() {
    const selected = state.activeCatalogId;
    els.catalogSelect.innerHTML = state.catalogs.map(function (catalog) {
      return '<option value="' + escapeHtml(catalog.catalogId) + '">' + escapeHtml(catalog.manufacturer + " · " + catalog.productLine) + "</option>";
    }).join("");
    if (selected) els.catalogSelect.value = selected;
    const catalog = activeCatalog();
    els.catalogInfo.innerHTML = catalog
      ? escapeHtml(catalog.catalogId) + "<br>" + escapeHtml(catalog.scale + " / " + catalog.gaugeMm + "mm gauge") + "<br>" + escapeHtml((catalog.pieces || []).length + " pieces")
      : "尚未导入素材库。";
  }

  function displayPieceName(piece) {
    if (!piece) return "";
    return translateTomixName(piece.name || piece.id);
  }

  function displayPieceKind(kind) {
    const map = {
      "track.straight": "直轨",
      "track.curve": "曲轨",
      "track.turnout": "道岔",
      "track.crossing": "交叉轨",
      "track.flex": "可弯轨",
      "accessory.support": "立柱/支撑",
      "accessory.structure": "结构配件",
      "accessory.scenery": "景观配件"
    };
    return map[kind] || kind;
  }

  function translateTomixName(name) {
    let text = String(name || "");
    const replacements = [
      ["クロッシングレール", "交叉轨"],
      ["クロッシング", "交叉"],
      ["安全側線レール", "安全侧线轨"],
      ["エンドPCレール", "PC终端轨"],
      ["エンドレール", "终端轨"],
      ["解放ランプ付レール", "带解钩坡轨"],
      ["リレーラーPCレール", "PC上轨辅助轨"],
      ["リレーラーレール", "上轨辅助轨"],
      ["ジョイントPCレール", "PC接续轨"],
      ["ジョイントレール", "接续轨"],
      ["両ギャップレール", "双绝缘轨"],
      ["ワイドエンドレール", "宽终端轨"],
      ["複線スラブカーブレール", "复线板式曲轨"],
      ["複線スラブレール", "复线板式轨"],
      ["ストレートPCレール", "PC直轨"],
      ["ストレートレール", "直轨"],
      ["カーブPCレール", "PC曲轨"],
      ["カーブレール", "曲轨"],
      ["ワイドPCアプローチレール", "宽PC过渡轨"],
      ["ワイドPCカーブレール", "宽PC曲轨"],
      ["ワイドPCバリアブルレール", "宽PC可调轨"],
      ["ワイドPC端数レール", "宽PC零数轨"],
      ["ワイドPCレール", "宽PC轨"],
      ["スラブレール", "板式轨"],
      ["複線カーブレール", "复线曲轨"],
      ["複線レール", "复线直轨"],
      ["高架橋付PCレール", "带高架桥PC轨"],
      ["高架橋付", "带高架桥"],
      ["電動合成枕木ポイント", "电动合成枕木道岔"],
      ["電動ポイント", "电动道岔"],
      ["手動ポイント", "手动道岔"],
      ["ダブルクロスポイント", "双交叉道岔"],
      ["バリアブルPCレール", "PC可调轨"],
      ["バリアブルレール", "可调轨"],
      ["端数レール", "零数轨"],
      ["上路式単線トラス鉄橋", "上承式单线桁架桥"],
      ["単線トラス鉄橋", "单线桁架桥"],
      ["橋脚", "桥墩"],
      ["架線柱", "架线柱"],
      ["ホーム", "站台"],
      ["レール", "轨"],
      ["ポイント", "道岔"],
      ["まくら木", "枕木"],
      ["木製", "木制"],
      ["合成", "合成"],
      ["れんが", "砖色"],
      ["深緑", "深绿"],
      ["赤", "红"],
      ["グレー", "灰色"],
      ["セット", "套装"],
      ["本", "根"],
      ["各", "各"],
      ["画像なし", "无图"]
    ];
    replacements.forEach(function (pair) {
      text = text.replaceAll(pair[0], pair[1]);
    });
    text = text
      .replace(/（[^）]*本(?:套装|2组|[^）]*套装)?[^）]*）/g, "")
      .replace(/\([^)]*本(?:セット|2組|[^)]*セット)?[^)]*\)/g, "")
      .replace(/（F）|\(F\)/g, "")
      .replace(/\s+\(left\)|\s+\(right\)/g, "")
      .replace(/\((\d+)根套装\)/g, "（$1根套装）")
      .replace(/\((.*?)\)/g, "（$1）")
      .replace(/（F）/g, "（F）")
      .replace(/PC轨/g, "PC轨")
      .replace(/\s+/g, " ")
      .trim();
    return text;
  }

  function renderPieceLibrary() {
    const catalog = activeCatalog();
    if (!catalog) {
      els.pieceLibrary.innerHTML = '<div class="muted-block">请先导入 catalog JSON。</div>';
      return;
    }
    const visiblePieces = (catalog.pieces || []).filter(function (piece) {
      return !(piece.tags || []).includes("hidden");
    });
    els.pieceLibrary.innerHTML = visiblePieces.map(function (piece) {
      const icon = piece.kind.includes("curve") ? "curve" : piece.kind.includes("turnout") ? "turnout" : piece.kind.startsWith("accessory") ? "accessory" : "";
      const active = piece.id === state.selectedPieceId ? " active" : "";
      const zhName = displayPieceName(piece);
      const rawName = zhName === piece.name ? "" : "原名：" + piece.name;
      return [
        '<button class="piece-card' + active + '" data-piece-id="' + escapeHtml(piece.id) + '">',
        '<span class="piece-icon ' + icon + '"></span>',
        "<span><b>" + escapeHtml(zhName) + "</b>",
        "<span>" + escapeHtml(piece.sku + " · " + displayPieceKind(piece.kind)) + "</span>",
        rawName ? "<span>" + escapeHtml(rawName) + "</span>" : "",
        "</span>",
        "</button>"
      ].join("");
    }).join("");

    els.pieceLibrary.querySelectorAll("button[data-piece-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        choosePiece(button.dataset.pieceId);
      });
    });
  }

  function renderProjectFields() {
    els.projectNameInput.value = state.project.name || "";
    els.boardWidthInput.value = state.project.board.widthMm;
    els.boardHeightInput.value = state.project.board.heightMm;
    els.gridInput.value = state.project.board.gridMm || 20;
  }

  function renderMetrics() {
    const placements = state.project.placements || [];
    els.pieceCount.textContent = placements.length;
    els.trackLength.textContent = (G.projectLength(state.project, state.index) / 1000).toFixed(2) + " m";

    const validation = validateCurrentProject();
    els.validationBox.className = "validation " + validation.level;
    els.validationBox.textContent = validation.message;

    const bom = G.projectBom(state.project, state.index);
    const activePlacement = selectedPlacement();
    const activePiece = activePlacement ? G.getPiece(state.index, activePlacement.pieceId) : null;
    const activeBomId = activePiece && activePiece.bom && activePiece.bom.countAs ? activePiece.bom.countAs : activePiece ? activePiece.id : null;
    const rows = Object.keys(bom).sort().map(function (pieceId) {
      const piece = G.getPiece(state.index, pieceId);
      const active = pieceId === activeBomId ? " active" : "";
      return '<div class="list-row bom-row' + active + '"><strong>' + escapeHtml(piece ? displayPieceName(piece) : pieceId) + '</strong><span>' + escapeHtml(pieceId) + ' · x ' + bom[pieceId] + '</span></div>';
    });
    els.bomList.innerHTML = rows.length ? rows.join("") : '<div class="muted-block">暂无物料。</div>';
  }

  function renderSelectedForm() {
    const placement = selectedPlacement();
    els.selectedEmpty.classList.toggle("hidden", Boolean(placement));
    els.selectedForm.classList.toggle("hidden", !placement);
    if (!placement) return;
    const piece = selectedPlacementPiece();
    els.selectedName.innerHTML = piece
      ? '<strong>' + escapeHtml(displayPieceName(piece)) + '</strong><span>' + escapeHtml(piece.sku + " · " + displayPieceKind(piece.kind)) + '</span>'
      : '<strong>未知部件</strong><span>' + escapeHtml(placement.pieceId) + '</span>';
    els.selX.value = Math.round(placement.x * 100) / 100;
    els.selY.value = Math.round(placement.y * 100) / 100;
    els.selZ.value = Math.round((placement.z || 0) * 100) / 100;
    els.selZEnd.value = placement.zEnd != null ? Math.round(placement.zEnd * 100) / 100 : "";
    els.selYaw.value = Math.round((placement.yawDeg || 0) * 100) / 100;
  }

  function renderPlanInspector() {
    const placement = selectedPlacement();
    const piece = placement ? selectedPlacementPiece() : activePlacementPiece();
    const disabled = !placement;
    els.planInspector.classList.toggle("disabled", disabled);
    [
      els.planYawInput,
      els.planStepInput,
      els.planRotateDirection,
      els.planApplyYawBtn,
      els.planRotateStepBtn,
      els.planFlipHorizontalBtn,
      els.planFlipVerticalBtn
    ].forEach(function (control) {
      control.disabled = disabled;
    });

    if (!piece) {
      els.planInspectorName.textContent = "未选中部件";
      els.planInspectorHint.textContent = "单击选择，双击轨道后会粘到鼠标移动，避免误拆轨道。";
      els.planYawInput.value = "";
      return;
    }

    if (!placement) {
      els.planInspectorName.textContent = displayPieceName(piece) + " · " + piece.sku;
      els.planInspectorHint.textContent = pieceParameterSummary(piece) + "。轨道已粘到鼠标：单击放置；靠近开放端会自动连接；Esc 退出。";
      els.planYawInput.value = "";
      return;
    }

    els.planInspectorName.textContent = displayPieceName(piece) + " · " + piece.sku;
    els.planInspectorHint.textContent = state.placementSession && state.placementSession.kind === "move" && state.placementSession.placementId === placement.id
      ? "轨道已粘到鼠标：移动预览，单击或双击确认，Esc 取消。"
      : "已选中：" + pieceParameterSummary(piece) + "。双击该部件可粘到鼠标移动。";
    els.planYawInput.value = Math.round((placement.yawDeg || 0) * 100) / 100;
    els.planFlipHorizontalBtn.classList.toggle("active", Boolean(placement.flipX));
    els.planFlipVerticalBtn.classList.toggle("active", Boolean(placement.flipY));
  }

  function pieceParameterSummary(piece) {
    if (!piece) return "";
    if (piece.geometry) {
      const routes = piece.geometry.routes || [];
      const segments = routes.flatMap(function (route) { return route.segments || []; });
      const parts = [];
      const line = segments.find(function (segment) { return segment.type === "line"; });
      const arc = segments.find(function (segment) { return segment.type === "arc"; });
      if (line) parts.push("长度 " + formatMm(line.lengthMm));
      if (arc) {
        parts.push("半径 R" + formatMm(arc.radiusMm));
        parts.push("角度 " + formatAngle(arc.angleDeg));
      }
      parts.push("连接端 " + (piece.geometry.connectors || []).map(function (connector) { return connector.id; }).join("/"));
      return displayPieceKind(piece.kind) + " · " + parts.join(" · ");
    }
    if (piece.dimensions) {
      const d = piece.dimensions;
      return displayPieceKind(piece.kind) + " · " + ["宽 " + formatMm(d.widthMm), "深 " + formatMm(d.depthMm), "高 " + formatMm(d.heightMm)].filter(function (part) {
        return !part.includes("undefined");
      }).join(" · ");
    }
    return displayPieceKind(piece.kind);
  }

  function formatMm(value) {
    return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "mm";
  }

  function formatAngle(value) {
    return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "°";
  }

  async function renderLocalProjects() {
    const rows = await Db.listProjects();
    els.localProjects.innerHTML = rows.length ? rows.map(function (row) {
      return [
        '<div class="list-row">',
        '<strong>' + escapeHtml(row.name || row.projectId) + '</strong>',
        '<span>' + escapeHtml(row.projectId + " · " + (row.updatedAt || "")) + '</span>',
        '<div class="row-actions">',
        '<button data-load-project="' + escapeHtml(row.projectId) + '">加载</button>',
        '<button class="danger" data-delete-project="' + escapeHtml(row.projectId) + '">删除</button>',
        '</div>',
        '</div>'
      ].join("");
    }).join("") : '<div class="muted-block">还没有保存的项目。</div>';

    els.localProjects.querySelectorAll("button[data-load-project]").forEach(function (button) {
      button.addEventListener("click", async function () {
        const project = await Db.getProject(button.dataset.loadProject);
        if (!project) return;
        state.project = clone(project);
        G.clearGeometryCache();
        state.selectedPlacementId = null;
        state.fixedStart = null;
        state.startPickMode = false;
        clearPlacementSession();
        setMode("select");
        fitView();
        renderAll();
        setStatus("已从本地加载项目：" + project.name);
      });
    });

    els.localProjects.querySelectorAll("button[data-delete-project]").forEach(function (button) {
      button.addEventListener("click", async function () {
        if (!confirm("确定删除本地项目？")) return;
        await Db.deleteProject(button.dataset.deleteProject);
        await renderLocalProjects();
        setStatus("已删除本地项目。");
      });
    });
  }

  function validateCurrentProject() {
    const unknown = [];
    (state.project.placements || []).forEach(function (placement) {
      if (!G.getPiece(state.index, placement.pieceId)) unknown.push(placement.pieceId);
    });
    if (unknown.length) {
      return { level: "bad", message: "项目引用了未加载的素材：" + Array.from(new Set(unknown)).join(", ") };
    }

    const badConnections = (state.project.connections || []).filter(function (connection) {
      return !state.project.placements.some(function (placement) { return placement.id === connection.from.placementId; })
        || !state.project.placements.some(function (placement) { return placement.id === connection.to.placementId; });
    });
    if (badConnections.length) {
      return { level: "bad", message: "连接数据中存在失效 placement 引用：" + badConnections.length + " 条。" };
    }

    const open = frameOpenConnectors();
    if (!state.project.placements.length) return { level: "", message: "尚未放置部件。" };

    const components = frameConnectedComponents();
    const placementCount = state.project.placements.length;
    const componentsWithTrack = components.filter(function (comp) {
      return comp.some(function (nodeId) {
        const placementId = nodeId.split(":")[0];
        const placement = state.project.placements.find(function (p) { return p.id === placementId; });
        const piece = placement ? G.getPiece(state.index, placement.pieceId) : null;
        return piece && piece.kind.startsWith("track.");
      });
    }).length;

    const message = "开放端点 " + open.length + " · 连通分量 " + componentsWithTrack + "（共 " + components.length + "）";
    let level = "warn";
    if (!open.length && componentsWithTrack <= 1) level = "good";
    return { level, message };
  }

  function renderPlan() {
    const canvas = els.planCanvas;
    const ctx = els.planCtx;
    const size = canvasSize(canvas);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = "#fffaf1";
    ctx.fillRect(0, 0, size.width, size.height);
    drawGrid(ctx, size);
    drawBoard(ctx);
    drawPlacements2d(ctx);
    drawConnectors(ctx);
    drawFixedStart(ctx);
    drawPlacePreview(ctx);
    drawRulers(ctx, size);
  }

  function drawGrid(ctx, size) {
    const grid = state.project.board.gridMm || 20;
    const major = grid * 5;
    const corners = [
      screenToWorld(0, 0),
      screenToWorld(size.width, 0),
      screenToWorld(size.width, size.height),
      screenToWorld(0, size.height)
    ];
    const minX = Math.floor(Math.min.apply(null, corners.map(function (p) { return p.x; })) / grid) * grid;
    const maxX = Math.ceil(Math.max.apply(null, corners.map(function (p) { return p.x; })) / grid) * grid;
    const minY = Math.floor(Math.min.apply(null, corners.map(function (p) { return p.y; })) / grid) * grid;
    const maxY = Math.ceil(Math.max.apply(null, corners.map(function (p) { return p.y; })) / grid) * grid;

    ctx.lineWidth = 1;
    for (let x = minX; x <= maxX; x += grid) {
      const majorLine = Math.abs(x % major) < 0.001;
      drawWorldLine(ctx, { x, y: minY }, { x, y: maxY }, majorLine ? "#d6c7b2" : "#ece2d5");
    }
    for (let y = minY; y <= maxY; y += grid) {
      const majorLine = Math.abs(y % major) < 0.001;
      drawWorldLine(ctx, { x: minX, y }, { x: maxX, y }, majorLine ? "#d6c7b2" : "#ece2d5");
    }
    drawWorldLine(ctx, { x: minX, y: 0 }, { x: maxX, y: 0 }, "#b39464");
    drawWorldLine(ctx, { x: 0, y: minY }, { x: 0, y: maxY }, "#b39464");
  }

  function drawBoard(ctx) {
    const board = state.project.board;
    const hw = board.widthMm / 2;
    const hh = board.heightMm / 2;
    const points = [
      worldToScreen({ x: -hw, y: -hh }),
      worldToScreen({ x: hw, y: -hh }),
      worldToScreen({ x: hw, y: hh }),
      worldToScreen({ x: -hw, y: hh })
    ];
    ctx.save();
    ctx.fillStyle = "rgba(226, 216, 199, 0.32)";
    ctx.strokeStyle = "#8d7d67";
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach(function (point, index) {
      if (index) ctx.lineTo(point.x, point.y);
      else ctx.moveTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const label = worldToScreen({ x: -hw + 18, y: hh - 18 });
    ctx.fillStyle = "#5b5145";
    ctx.font = "12px system-ui";
    ctx.fillText(board.widthMm + "mm x " + board.heightMm + "mm", label.x, label.y);
    ctx.restore();
  }

  function drawWorldLine(ctx, a, b, color) {
    const sa = worldToScreen(a);
    const sb = worldToScreen(b);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
  }

  function drawPlacements2d(ctx) {
    (state.project.placements || []).forEach(function (placement) {
      const piece = G.getPiece(state.index, placement.pieceId);
      if (!piece) return;
      if (piece.geometry) drawTrackPiece2d(ctx, placement, piece, placement.id === state.selectedPlacementId, false);
      else drawAccessory2d(ctx, placement, piece, placement.id === state.selectedPlacementId, false);
    });
  }

  function drawTrackPiece2d(ctx, placement, piece, selected, ghost) {
    const routes = G.placementRoutes(placement, piece, 10);
    const render = piece.render || {};
    const roadbed = render.roadbedWidthMm || 18;
    const gauge = render.railGaugeMm || 9;
    const sleeperSpacing = render.sleeperSpacingMm || 8;

    routes.forEach(function (route) {
      drawPolyline(ctx, route.points, {
        color: ghost ? "rgba(36, 122, 104, .22)" : selected ? "#d69732" : "#8c8172",
        width: Math.max(2, roadbed * camera().zoom),
        cap: "round"
      });
      samplePath(route.points, sleeperSpacing * 2.5).forEach(function (sample) {
        const normal = sample.angle + Math.PI / 2;
        const half = roadbed * 0.45;
        drawWorldSegment(ctx,
          { x: sample.x + Math.cos(normal) * half, y: sample.y + Math.sin(normal) * half },
          { x: sample.x - Math.cos(normal) * half, y: sample.y - Math.sin(normal) * half },
          ghost ? "rgba(119, 84, 47, .35)" : "#7a583d",
          Math.max(1, 2.5 * camera().zoom)
        );
      });
      [-gauge / 2, gauge / 2].forEach(function (offset) {
        drawPolyline(ctx, offsetPolyline(route.points, offset), {
          color: ghost ? "rgba(20, 93, 80, .55)" : "#3f4747",
          width: Math.max(1, 2 * camera().zoom),
          cap: "round"
        });
      });
    });

    if (selected) drawPlacementBounds(ctx, placement, piece);
    if (!ghost) drawPlacementLabel(ctx, placement, piece, selected);
  }

  function drawAccessory2d(ctx, placement, piece, selected, ghost) {
    const dim = piece.dimensions || { widthMm: 24, depthMm: 24 };
    const hw = (dim.widthMm || 24) / 2;
    const hh = (dim.depthMm || 24) / 2;
    const points = [
      G.transformPoint({ x: -hw, y: -hh, z: 0 }, placement),
      G.transformPoint({ x: hw, y: -hh, z: 0 }, placement),
      G.transformPoint({ x: hw, y: hh, z: 0 }, placement),
      G.transformPoint({ x: -hw, y: hh, z: 0 }, placement)
    ].map(worldToScreen);
    ctx.save();
    ctx.fillStyle = ghost ? "rgba(36, 122, 104, .18)" : "#d5ddde";
    ctx.strokeStyle = selected ? "#d69732" : "#7f9092";
    ctx.lineWidth = selected ? 2 : 1.2;
    ctx.beginPath();
    points.forEach(function (point, index) {
      if (index) ctx.lineTo(point.x, point.y);
      else ctx.moveTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (!ghost) drawPlacementLabel(ctx, placement, piece, selected);
  }

  function placementCode(piece) {
    if (!piece) return "";
    if (piece.sku) return piece.sku;
    return String(piece.id || "").replace(/^[^.]+\./, "").slice(0, 8);
  }

  function drawPlacementLabel(ctx, placement, piece, selected) {
    const anchor = labelAnchorForPlacement(placement, piece);
    const screen = worldToScreen(anchor);
    const text = placementCode(piece);
    if (!text) return;
    ctx.save();
    ctx.font = selected ? "bold 11px system-ui" : "10px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = selected ? "#6d4918" : "#5b6258";
    ctx.fillText(text, screen.x, screen.y - 13);
    ctx.restore();
  }

  function labelAnchorForPlacement(placement, piece) {
    if (piece && piece.geometry) {
      const routes = G.placementRoutes(placement, piece, 18);
      if (routes.length && routes[0].points.length) {
        return routes[0].points[Math.floor(routes[0].points.length / 2)];
      }
    }
    return { x: placement.x, y: placement.y, z: placement.z || 0 };
  }

  function drawPlacementBounds(ctx, placement, piece) {
    const connectors = G.placementConnectors(placement, piece);
    const points = connectors.length
      ? connectors.map(worldToScreen)
      : [worldToScreen({ x: placement.x, y: placement.y })];
    const minX = Math.min.apply(null, points.map(function (p) { return p.x; })) - 12;
    const minY = Math.min.apply(null, points.map(function (p) { return p.y; })) - 12;
    const maxX = Math.max.apply(null, points.map(function (p) { return p.x; })) + 12;
    const maxY = Math.max.apply(null, points.map(function (p) { return p.y; })) + 12;
    ctx.save();
    ctx.strokeStyle = "#d69732";
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawConnectors(ctx) {
    const openKeys = frameOpenConnectorKeys();
    frameAllConnectors().forEach(function (connector) {
      const screen = worldToScreen(connector);
      const open = openKeys.has(connector.placementId + ":" + connector.connectorId);
      ctx.save();
      ctx.fillStyle = open ? "#247a68" : "#9b9388";
      ctx.strokeStyle = "#fffaf1";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, Math.max(3, 4 * camera().zoom), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });

    if (state.snap) {
      const screen = worldToScreen(state.snap.connector);
      ctx.save();
      ctx.strokeStyle = "#1a6fd0";
      ctx.fillStyle = "rgba(26, 111, 208, .12)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (state.autoConnectSnap) {
      const screen = worldToScreen(state.autoConnectSnap.target);
      ctx.save();
      ctx.strokeStyle = "#1a8c5a";
      ctx.fillStyle = "rgba(26, 140, 90, .22)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPlacePreview(ctx) {
    if (!state.placementSession || state.placementSession.kind !== "new" || !state.pointerWorld) return;
    const piece = activePlacementPiece();
    if (!piece) return;
    const candidate = candidatePlacementFor(state.pointerWorld);
    if (!candidate) return;
    if (piece.geometry) drawTrackPiece2d(ctx, candidate.placement, piece, false, true);
    else drawAccessory2d(ctx, candidate.placement, piece, false, true);
    if (candidate.sourceConnectorId && piece.geometry) {
      const source = G.placementConnectors(candidate.placement, piece).find(function (connector) {
        return connector.connectorId === candidate.sourceConnectorId;
      });
      if (source) drawConnectorRing(ctx, source, "#d69732", "rgba(214, 151, 50, .18)", 9);
    }
  }

  function drawFixedStart(ctx) {
    if (state.startPickMode && state.pointerWorld) {
      const nearest = nearestConnector(state.pointerWorld, { thresholdMm: Math.max(28, 24 / camera().zoom) });
      if (nearest) {
        drawConnectorRing(ctx, nearest.connector, "#6f45c9", "rgba(111, 69, 201, .18)", 13);
      } else {
        drawStartPointMarker(ctx, state.pointerWorld, "#6f45c9", "设置起点");
      }
    }
    if (!state.fixedStart) return;
    if (state.fixedStart.type === "connector" && state.fixedStart.connector) {
      drawConnectorRing(ctx, state.fixedStart.connector, "#6f45c9", "rgba(111, 69, 201, .22)", 15);
      drawStartLabel(ctx, state.fixedStart.connector, "起点");
      return;
    }
    drawStartPointMarker(ctx, state.fixedStart.point, "#6f45c9", "起点");
  }

  function drawStartPointMarker(ctx, point, color, label) {
    const screen = worldToScreen(point);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = "rgba(111, 69, 201, .16)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(screen.x - 13, screen.y);
    ctx.lineTo(screen.x + 13, screen.y);
    ctx.moveTo(screen.x, screen.y - 13);
    ctx.lineTo(screen.x, screen.y + 13);
    ctx.stroke();
    ctx.restore();
    drawStartLabel(ctx, point, label);
  }

  function drawStartLabel(ctx, point, label) {
    const screen = worldToScreen(point);
    ctx.save();
    ctx.fillStyle = "#4a2c91";
    ctx.font = "12px system-ui";
    ctx.fillText(label, screen.x + 10, screen.y - 10);
    ctx.restore();
  }

  function drawConnectorRing(ctx, connector, stroke, fill, radius) {
    const screen = worldToScreen(connector);
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawRulers(ctx, size) {
    const cam = camera();
    const major = (state.project.board.gridMm || 20) * 5;
    ctx.save();
    ctx.fillStyle = "rgba(255, 253, 248, .94)";
    ctx.fillRect(0, 0, size.width, 26);
    ctx.fillRect(0, 0, 44, size.height);
    ctx.strokeStyle = "#d5ccbd";
    ctx.beginPath();
    ctx.moveTo(0, 26);
    ctx.lineTo(size.width, 26);
    ctx.moveTo(44, 0);
    ctx.lineTo(44, size.height);
    ctx.stroke();
    ctx.fillStyle = "#665c50";
    ctx.font = "11px system-ui";
    if (Math.abs(cam.rotationDeg || 0) < 0.01) {
      const left = screenToWorld(44, 0).x;
      const right = screenToWorld(size.width, 0).x;
      for (let x = Math.ceil(left / major) * major; x < right; x += major) {
        const screen = worldToScreen({ x, y: cam.y });
        ctx.fillText(String(Math.round(x)), screen.x + 3, 17);
      }
      const top = screenToWorld(0, 26).y;
      const bottom = screenToWorld(0, size.height).y;
      for (let y = Math.floor(top / major) * major; y > bottom; y -= major) {
        const screen = worldToScreen({ x: cam.x, y });
        ctx.fillText(String(Math.round(y)), 6, screen.y - 3);
      }
    } else {
      ctx.fillText("view rotation " + Math.round(cam.rotationDeg) + " deg", 8, 17);
    }
    ctx.restore();
  }

  function drawPolyline(ctx, points, options) {
    if (!points.length) return;
    ctx.save();
    ctx.strokeStyle = options.color;
    ctx.lineWidth = options.width;
    ctx.lineCap = options.cap || "butt";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.map(worldToScreen).forEach(function (point, index) {
      if (index) ctx.lineTo(point.x, point.y);
      else ctx.moveTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawWorldSegment(ctx, a, b, color, width) {
    const sa = worldToScreen(a);
    const sb = worldToScreen(b);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    ctx.restore();
  }

  function offsetPolyline(points, offset) {
    return points.map(function (point, index) {
      const a = points[Math.max(0, index - 1)];
      const b = points[Math.min(points.length - 1, index + 1)];
      const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
      return {
        x: point.x + Math.cos(angle) * offset,
        y: point.y + Math.sin(angle) * offset,
        z: point.z || 0
      };
    });
  }

  function samplePath(points, spacingMm) {
    const samples = [];
    let carry = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (!len) continue;
      let d = carry === 0 ? 0 : spacingMm - carry;
      for (; d <= len; d += spacingMm) {
        const t = d / len;
        samples.push({
          x: a.x + dx * t,
          y: a.y + dy * t,
          z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t,
          angle: Math.atan2(dy, dx)
        });
      }
      carry = (carry + len) % spacingMm;
    }
    return samples;
  }

  function render3d() {
    if (!state.show3d) return;
    const canvas = els.viewCanvas;
    const ctx = els.viewCtx;
    const size = canvasSize(canvas);
    ctx.clearRect(0, 0, size.width, size.height);
    const gradient = ctx.createLinearGradient(0, 0, 0, size.height);
    gradient.addColorStop(0, "#fdf8ef");
    gradient.addColorStop(1, "#e1dacd");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size.width, size.height);

    const bounds = G.projectBounds(state.project, state.index);
    const maxElevation = Math.max(0, ...(state.project.placements || []).map(function (placement) {
      const piece = G.getPiece(state.index, placement.pieceId);
      const accessoryHeight = piece && piece.dimensions ? piece.dimensions.heightMm || 0 : 0;
      return (placement.z || 0) + accessoryHeight;
    }));
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 420);
    const scale = Math.min(size.width / (span * 1.25), size.height / (span * 0.78)) * state.view3d.zoom;
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    const yaw = G.degToRad(state.view3d.yawDeg);
    const tilt = state.view3d.tilt;
    const elevationScale = maxElevation > 0 ? 2.25 : 1;

    function project(point) {
      // Apply the 2D camera rotation so 3D yaw=0 aligns with the 2D plan exactly.
      const cam = camera();
      const rot = G.degToRad(cam.rotationDeg || 0);
      const cR = Math.cos(rot), sR = Math.sin(rot);
      const dx0 = point.x - center.x;
      const dy0 = point.y - center.y;
      // 2D-equivalent screen-space delta: rx2d points right, ry2d points up
      const rx2d = dx0 * cR - dy0 * sR;
      const ry2d = dx0 * sR + dy0 * cR;
      // Apply 3D yaw on top of the 2D-aligned frame
      const rx = rx2d * Math.cos(yaw) - ry2d * Math.sin(yaw);
      const depth = rx2d * Math.sin(yaw) + ry2d * Math.cos(yaw);
      // depth is "world-up" in the rotated frame; in screen y (which grows downward),
      // we subtract it like the 2D worldToScreen does, so up-in-world is up-on-screen.
      return {
        x: size.width / 2 + state.view3d.panX + rx * scale,
        y: size.height * 0.62 + state.view3d.panY - depth * scale * tilt - (point.z || 0) * scale * elevationScale
      };
    }

    drawGroundPlane(ctx, project, bounds);
    drawHeightScale(ctx, project, bounds, maxElevation);

    // Painter's algorithm: sort by (projected depth, then top-Z).
    // Higher z (top of pier + height for accessories; route z for tracks) drawn
    // last so it covers lower items — fixes the "track sitting on embankment"
    // visual where the support was painted on top of the track it supports.
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    function placementDepth(placement, piece) {
      // Use placement center as depth proxy
      let cx = placement.x || 0;
      let cy = placement.y || 0;
      if (piece && piece.geometry) {
        // For tracks use the route AABB centroid (more accurate than placement origin
        // which sits at connector A for straights/curves).
        const b = G.placementBounds(placement, piece);
        cx = (b.minX + b.maxX) / 2;
        cy = (b.minY + b.maxY) / 2;
      }
      const dx = cx - center.x;
      const dy = cy - center.y;
      return dx * sinYaw + dy * cosYaw;
    }
    function placementTopZ(placement, piece) {
      const baseZ = placement.z || 0;
      const endZ = placement.zEnd != null ? placement.zEnd : baseZ;
      const accessoryH = piece && !piece.geometry && piece.dimensions ? (piece.dimensions.heightMm || 0) : 0;
      return Math.max(baseZ, endZ) + accessoryH;
    }
    const ordered = [...(state.project.placements || [])].sort(function (a, b) {
      const pieceA = G.getPiece(state.index, a.pieceId);
      const pieceB = G.getPiece(state.index, b.pieceId);
      const depthA = placementDepth(a, pieceA);
      const depthB = placementDepth(b, pieceB);
      if (Math.abs(depthA - depthB) > 1) return depthA - depthB; // farther first
      // Same depth: lower top-Z first so higher items cover lower ones.
      const topA = placementTopZ(a, pieceA);
      const topB = placementTopZ(b, pieceB);
      if (Math.abs(topA - topB) > 0.5) return topA - topB;
      // Same top-Z (e.g. a track at z=55 sitting on top of a pier whose top is also 55):
      // tracks must paint LAST so they're not hidden by the support carrying them.
      const aIsTrack = pieceA && pieceA.geometry ? 1 : 0;
      const bIsTrack = pieceB && pieceB.geometry ? 1 : 0;
      return aIsTrack - bIsTrack; // 0 (accessory) before 1 (track)
    });
    ordered.forEach(function (placement) {
      const piece = G.getPiece(state.index, placement.pieceId);
      if (!piece) return;
      if (piece.geometry) {
        G.placementRoutes(placement, piece, 10).forEach(function (route) {
          const routeElevation = averageElevation(route.points);
          const selected = placement.id === state.selectedPlacementId;
          if (routeElevation > 1) {
            drawProjectedShadow(ctx, route.points, project);
            drawElevationSupports(ctx, route.points, project, routeElevation);
          }
          drawProjectedPolyline(ctx, route.points, project, selected ? "#d69732" : elevationColor(routeElevation), 10);
          const gauge = (piece.render && piece.render.railGaugeMm) || 9;
          [-gauge / 2, gauge / 2].forEach(function (offset) {
            drawProjectedPolyline(ctx, offsetPolyline(route.points, offset), project, routeElevation > 1 ? "#1f2f34" : "#303938", 2.4);
          });
          if (routeElevation > 1) drawHeightLabel(ctx, route.points, project, routeElevation);
        });
      } else {
        drawProjectedAccessory(ctx, placement, piece, project);
      }
    });

    ctx.fillStyle = "#665c50";
    ctx.font = "12px system-ui";
    ctx.fillText("3D预览 · 缩放 " + state.view3d.zoom.toFixed(2) + "x · 角度 " + Math.round(state.view3d.yawDeg) + "° · max Z " + Math.round(maxElevation) + "mm", 12, size.height - 14);
  }

  function drawGroundPlane(ctx, project, bounds) {
    const pad = 120;
    const points = [
      project({ x: bounds.minX - pad, y: bounds.minY - pad, z: -5 }),
      project({ x: bounds.maxX + pad, y: bounds.minY - pad, z: -5 }),
      project({ x: bounds.maxX + pad, y: bounds.maxY + pad, z: -5 }),
      project({ x: bounds.minX - pad, y: bounds.maxY + pad, z: -5 })
    ];
    ctx.save();
    ctx.fillStyle = "#d8d1c4";
    ctx.strokeStyle = "#b7aa97";
    ctx.beginPath();
    points.forEach(function (point, index) {
      if (index) ctx.lineTo(point.x, point.y);
      else ctx.moveTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawProjectedPolyline(ctx, points, project, color, width) {
    const screen = points.map(project);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    screen.forEach(function (point, index) {
      if (index) ctx.lineTo(point.x, point.y);
      else ctx.moveTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawProjectedShadow(ctx, points, project) {
    const ground = points.map(function (point) {
      return { x: point.x, y: point.y, z: 0 };
    });
    drawProjectedPolyline(ctx, ground, project, "rgba(68, 58, 42, .2)", 12);
    drawProjectedPolyline(ctx, ground, project, "rgba(68, 58, 42, .18)", 2);
  }

  function drawElevationSupports(ctx, points, project, elevationMm) {
    const samples = samplePath(points, 95);
    const supportPoints = [
      points[0],
      ...samples,
      points[points.length - 1]
    ].filter(Boolean);
    ctx.save();
    ctx.strokeStyle = elevationMm > 70 ? "rgba(59, 96, 103, .72)" : "rgba(86, 107, 106, .58)";
    ctx.lineWidth = 1.8;
    supportPoints.forEach(function (point) {
      const top = project(point);
      const base = project({ x: point.x, y: point.y, z: 0 });
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      ctx.fillStyle = "rgba(36, 122, 104, .18)";
      ctx.beginPath();
      ctx.arc(base.x, base.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawHeightLabel(ctx, points, project, elevationMm) {
    if (!points.length) return;
    const point = points[Math.floor(points.length / 2)];
    const screen = project(point);
    ctx.save();
    ctx.fillStyle = "rgba(255, 253, 248, .92)";
    ctx.strokeStyle = "rgba(36, 122, 104, .35)";
    ctx.lineWidth = 1;
    const text = "Z " + Math.round(elevationMm) + "mm";
    ctx.font = "11px system-ui";
    const width = ctx.measureText(text).width + 12;
    ctx.beginPath();
    ctx.roundRect(screen.x + 8, screen.y - 26, width, 20, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#145d50";
    ctx.fillText(text, screen.x + 14, screen.y - 12);
    ctx.restore();
  }

  function drawHeightScale(ctx, project, bounds, maxElevation) {
    if (maxElevation <= 0) return;
    const anchor = { x: bounds.maxX + 80, y: bounds.minY - 40 };
    const base = project({ ...anchor, z: 0 });
    const top = project({ ...anchor, z: maxElevation });
    ctx.save();
    ctx.strokeStyle = "rgba(36, 122, 104, .72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.fillStyle = "#145d50";
    ctx.font = "11px system-ui";
    ctx.fillText("0mm", base.x + 6, base.y + 4);
    ctx.fillText(Math.round(maxElevation) + "mm", top.x + 6, top.y + 4);
    ctx.restore();
  }

  function averageElevation(points) {
    if (!points.length) return 0;
    return points.reduce(function (sum, point) {
      return sum + (point.z || 0);
    }, 0) / points.length;
  }

  function elevationColor(elevationMm) {
    if (elevationMm > 80) return "#2e7485";
    if (elevationMm > 35) return "#3d8a78";
    if (elevationMm > 1) return "#5c8f6e";
    return "#5f6b6a";
  }

  function drawProjectedAccessory(ctx, placement, piece, project) {
    const dim = piece.dimensions || { widthMm: 24, depthMm: 24, heightMm: 20 };
    const w = dim.widthMm || 24;
    const d = dim.depthMm || 24;
    const h = dim.heightMm || 20;
    const z0 = placement.z || 0;
    const z1 = z0 + h;
    const yaw = (placement.yawDeg || 0) * Math.PI / 180;
    const c = Math.cos(yaw), s = Math.sin(yaw);

    // Local corners of the footprint (centered on placement.x,y), rotated by yaw
    const localCorners = [
      { lx: -w / 2, ly: -d / 2 },
      { lx:  w / 2, ly: -d / 2 },
      { lx:  w / 2, ly:  d / 2 },
      { lx: -w / 2, ly:  d / 2 }
    ];
    const worldCorners = localCorners.map(function (lc) {
      return {
        x: placement.x + lc.lx * c - lc.ly * s,
        y: placement.y + lc.lx * s + lc.ly * c
      };
    });

    // Decide rendering style:
    //  - thin column (max footprint dim < 40mm): pier/pillar style (line + cap)
    //  - long/wide piece: prism / box with footprint base + top
    const maxFootprint = Math.max(w, d);
    if (maxFootprint < 40) {
      // Pier/pillar — single line + top cap (preserves original look for 22x22 立柱)
      const base = project({ x: placement.x, y: placement.y, z: z0 });
      const top = project({ x: placement.x, y: placement.y, z: z1 });
      const lineWidth = Math.max(5, w * 0.08);
      ctx.save();
      ctx.strokeStyle = piece.render && piece.render.color ? piece.render.color : "#7f9092";
      ctx.fillStyle = piece.render && piece.render.color ? piece.render.color : "#aeb8c8";
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(top.x, top.y, lineWidth * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // Prism: project both top and bottom rectangles, draw faces from back to front (painter's algorithm)
    const bottom = worldCorners.map(function (wc) { return project({ x: wc.x, y: wc.y, z: z0 }); });
    const top = worldCorners.map(function (wc) { return project({ x: wc.x, y: wc.y, z: z1 }); });

    // Detect whether this is an embankment (土坡): long, flat, not multi-line beam.
    // Render as trapezoidal prism (slopes inward toward the top) — matches user's mental model.
    const isEmbankment = piece.tags && piece.tags.indexOf("embankment") !== -1;
    let topPts = top;
    if (isEmbankment) {
      // Shrink top rectangle inward by 25% on each side (slope-like trapezoid)
      const topLocal = localCorners.map(function (lc) {
        return { lx: lc.lx * 0.5, ly: lc.ly * 0.85 };
      });
      const topWorld = topLocal.map(function (lc) {
        return {
          x: placement.x + lc.lx * c - lc.ly * s,
          y: placement.y + lc.lx * s + lc.ly * c
        };
      });
      topPts = topWorld.map(function (wc) { return project({ x: wc.x, y: wc.y, z: z1 }); });
    }

    const baseColor = (piece.render && piece.render.color) || "#9aa3ab";
    const lightColor = lightenColor(baseColor, 0.15);
    const darkColor = lightenColor(baseColor, -0.2);

    ctx.save();

    // Draw 4 side faces: pair each bottom[i] with top[i] and bottom[i+1]/top[i+1]
    // Determine depth-order by average screen y (higher y = closer in our top-down 3D)
    const sides = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const pts = [bottom[i], bottom[j], topPts[j], topPts[i]];
      const avgY = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
      sides.push({ pts: pts, avgY: avgY });
    }
    sides.sort(function (a, b) { return a.avgY - b.avgY; }); // back faces first
    sides.forEach(function (side, idx) {
      ctx.fillStyle = idx < 2 ? darkColor : baseColor;
      ctx.strokeStyle = darkColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(side.pts[0].x, side.pts[0].y);
      side.pts.slice(1).forEach(function (pt) { ctx.lineTo(pt.x, pt.y); });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    // Top face (drawn last so it sits on top of side faces)
    ctx.fillStyle = lightColor;
    ctx.strokeStyle = darkColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(topPts[0].x, topPts[0].y);
    topPts.slice(1).forEach(function (pt) { ctx.lineTo(pt.x, pt.y); });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function lightenColor(hex, amount) {
    // Simple HSL-ish lighten/darken on hex color (#rrggbb)
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    if (!m) return hex || "#9aa3ab";
    const adj = function (v) {
      const n = parseInt(v, 16);
      const out = Math.max(0, Math.min(255, Math.round(n + amount * 255)));
      return out.toString(16).padStart(2, "0");
    };
    return "#" + adj(m[1]) + adj(m[2]) + adj(m[3]);
  }

  function openAiPlanner() {
    state.aiPlanner.open = true;
    els.aiPlannerPanel.classList.add("open");
    els.aiPlannerPanel.setAttribute("aria-hidden", "false");
    updateAiKeyUi(false);
    els.aiPromptInput.focus();
  }

  function closeAiPlanner() {
    state.aiPlanner.open = false;
    els.aiPlannerPanel.classList.remove("open");
    els.aiPlannerPanel.setAttribute("aria-hidden", "true");
  }

  function loadAiSettings() {
    const settings = readAiSettings();
    els.aiProviderSelect.value = settings.provider;
    els.aiBaseUrlInput.value = settings.baseUrl;
    els.aiModelInput.value = settings.model;
    updateAiKeyUi(false);
  }

  function readAiSettings() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) || "null");
    } catch (error) {
      saved = null;
    }
    const provider = saved && AI_DEFAULTS[saved.provider] ? saved.provider : "anthropic";
    const defaults = AI_DEFAULTS[provider];
    return {
      provider,
      baseUrl: saved && saved.baseUrl ? saved.baseUrl : defaults.baseUrl,
      model: saved && saved.model ? saved.model : defaults.model
    };
  }

  function saveAiSettings() {
    const provider = AI_DEFAULTS[els.aiProviderSelect.value] ? els.aiProviderSelect.value : "anthropic";
    const defaults = AI_DEFAULTS[provider];
    const settings = {
      provider,
      baseUrl: (els.aiBaseUrlInput.value || "").trim() || defaults.baseUrl,
      model: (els.aiModelInput.value || "").trim() || defaults.model
    };
    els.aiProviderSelect.value = settings.provider;
    els.aiBaseUrlInput.value = settings.baseUrl;
    els.aiModelInput.value = settings.model;
    try {
      localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      setStatus("AI 设置保存失败：" + error.message);
    }
    return settings;
  }

  function onAiProviderChange() {
    const provider = AI_DEFAULTS[els.aiProviderSelect.value] ? els.aiProviderSelect.value : "anthropic";
    els.aiBaseUrlInput.value = AI_DEFAULTS[provider].baseUrl;
    els.aiModelInput.value = AI_DEFAULTS[provider].model;
    saveAiSettings();
  }

  function readAiKey() {
    try {
      return localStorage.getItem(AI_KEY_STORAGE_KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function saveAiKey() {
    if (readAiKey() && els.aiApiKeyInput.readOnly) {
      updateAiKeyUi(true);
      return;
    }
    const key = (els.aiApiKeyInput.value || "").trim();
    if (!key || key === AI_MASK) {
      alert("请输入新的 API Key。");
      return;
    }
    try {
      localStorage.setItem(AI_KEY_STORAGE_KEY, key);
      updateAiKeyUi(false);
      setStatus("AI API Key 已保存到当前浏览器。");
    } catch (error) {
      alert("保存 API Key 失败：" + error.message);
    }
  }

  function deleteAiKey() {
    if (!readAiKey()) return;
    if (!confirm("确定删除当前浏览器保存的 API Key？")) return;
    try {
      localStorage.removeItem(AI_KEY_STORAGE_KEY);
      updateAiKeyUi(false);
      setStatus("AI API Key 已删除。");
    } catch (error) {
      alert("删除 API Key 失败：" + error.message);
    }
  }

  function updateAiKeyUi(editing) {
    const hasKey = Boolean(readAiKey());
    if (hasKey && !editing) {
      els.aiApiKeyInput.readOnly = true;
      els.aiApiKeyInput.value = AI_MASK;
      els.aiApiKeyInput.placeholder = "已保存，本界面不显示明文";
      els.aiSaveKeyBtn.textContent = "更换";
      els.aiDeleteKeyBtn.disabled = false;
      els.aiKeyStatus.textContent = "API Key 已保存在当前浏览器本地。静态网页无法真正保密，请使用低额度、可撤销的密钥。";
      return;
    }
    els.aiApiKeyInput.readOnly = false;
    els.aiApiKeyInput.value = "";
    els.aiApiKeyInput.placeholder = hasKey ? "输入新的 API Key 后保存" : "输入 API Key 后保存";
    els.aiSaveKeyBtn.textContent = "保存";
    els.aiDeleteKeyBtn.disabled = !hasKey;
    els.aiKeyStatus.textContent = "API Key 仅保存在当前浏览器本地；保存后界面只显示星号。";
  }

  function useAiTemplate(key) {
    els.aiPromptInput.value = AI_TEMPLATES[key] || "";
    els.aiPromptInput.focus();
  }

  async function generateAiPlan() {
    if (state.aiPlanner.busy) return;
    const prompt = (els.aiPromptInput.value || "").trim();
    if (!prompt) {
      alert("请先输入规划需求，或点击一个样板提示词。");
      return;
    }
    const apiKey = readAiKey();
    if (!apiKey) {
      alert("请先保存 API Key。");
      updateAiKeyUi(true);
      return;
    }

    const settings = saveAiSettings();
    const context = buildAiPlanningContext(prompt);
    const userMessage = buildAiUserMessage(prompt, context);
    const controller = new AbortController();
    state.aiPlanner.abort = controller;
    state.aiPlanner.generated = null;
    setAiBusy(true);
    els.aiResultBox.className = "ai-result muted-block";
    els.aiResultBox.textContent = "正在生成规划...";
    els.aiApplyBtn.disabled = true;
    els.aiCopyJsonBtn.disabled = true;

    try {
      const raw = await callAiPlannerApi(settings, apiKey, userMessage, controller.signal);
      const envelope = parseAiJson(raw);
      normalizeAiEnvelope(envelope);
      const validation = validateAiGeneratedEnvelope(envelope);
      const metrics = calculateProjectMetrics(envelope.project);
      state.aiPlanner.generated = {
        envelope,
        raw: JSON.stringify(envelope, null, 2),
        validation,
        metrics
      };
      renderAiGeneratedResult(state.aiPlanner.generated);
    } catch (error) {
      if (error.name === "AbortError") {
        els.aiResultBox.className = "ai-result muted-block";
        els.aiResultBox.textContent = "已停止生成。";
      } else {
        state.aiPlanner.generated = null;
        els.aiResultBox.className = "ai-result validation bad";
        els.aiResultBox.textContent = "生成失败：" + error.message;
      }
      els.aiApplyBtn.disabled = true;
      els.aiCopyJsonBtn.disabled = true;
    } finally {
      setAiBusy(false);
      state.aiPlanner.abort = null;
    }
  }

  function stopAiPlan() {
    if (state.aiPlanner.abort) state.aiPlanner.abort.abort();
  }

  function setAiBusy(busy) {
    state.aiPlanner.busy = busy;
    els.aiGenerateBtn.disabled = busy;
    els.aiStopBtn.disabled = !busy;
    els.aiProviderSelect.disabled = busy;
    els.aiBaseUrlInput.disabled = busy;
    els.aiModelInput.disabled = busy;
    els.aiPromptInput.disabled = busy;
  }

  async function callAiPlannerApi(settings, apiKey, userMessage, signal) {
    if (settings.provider === "anthropic") {
      return callAnthropicPlanner(settings, apiKey, userMessage, signal);
    }
    return callOpenAiCompatiblePlanner(settings, apiKey, userMessage, signal);
  }

  async function callAnthropicPlanner(settings, apiKey, userMessage, signal) {
    const response = await fetch(aiEndpoint(settings.baseUrl, "/v1/messages"), {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 16000,
        system: AI_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        output_config: {
          format: {
            type: "json_schema",
            schema: AI_GENERATED_PROJECT_SCHEMA
          }
        }
      })
    });
    if (!response.ok) throw await apiRequestError(response);
    const data = await response.json();
    const text = (data.content || []).map(function (part) {
      return part && part.type === "text" ? part.text : "";
    }).join("").trim();
    if (!text) throw new Error("Anthropic 响应中没有文本内容。");
    return text;
  }

  async function callOpenAiCompatiblePlanner(settings, apiKey, userMessage, signal) {
    const endpoint = aiEndpoint(settings.baseUrl, "/chat/completions");
    const body = {
      model: settings.model,
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ],
      max_tokens: 16000,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "rail_design_generated_project",
          schema: AI_GENERATED_PROJECT_SCHEMA,
          strict: false
        }
      }
    };
    let response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + apiKey
      },
      body: JSON.stringify(body)
    });
    if (!response.ok && (response.status === 400 || response.status === 422)) {
      const fallbackBody = clone(body);
      delete fallbackBody.response_format;
      response = await fetch(endpoint, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "authorization": "Bearer " + apiKey
        },
        body: JSON.stringify(fallbackBody)
      });
    }
    if (!response.ok) throw await apiRequestError(response);
    const data = await response.json();
    const message = data.choices && data.choices[0] && data.choices[0].message;
    if (message && message.refusal) throw new Error("模型拒绝生成：" + message.refusal);
    const content = message ? message.content : "";
    if (Array.isArray(content)) {
      return content.map(function (part) {
        return part.text || part.output_text || "";
      }).join("").trim();
    }
    if (!content) throw new Error("OpenAI-compatible 响应中没有 content。");
    return String(content).trim();
  }

  function aiEndpoint(baseUrl, path) {
    const base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!base) return path;
    if (base.endsWith(path)) return base;
    return base + path;
  }

  async function apiRequestError(response) {
    let detail = "";
    try {
      const data = await response.clone().json();
      detail = data.error && data.error.message ? data.error.message : JSON.stringify(data).slice(0, 500);
    } catch (error) {
      detail = (await response.text()).slice(0, 500);
    }
    return new Error("API 请求失败（HTTP " + response.status + "）" + (detail ? "：" + detail : ""));
  }

  function buildAiUserMessage(userPrompt, context) {
    return [
      "请根据以下上下文生成 RailDesign 轨道规划。",
      "",
      "用户需求：",
      userPrompt,
      "",
      "上下文 JSON：",
      JSON.stringify(context),
      "",
      "请只返回 JSON，格式必须是 raildesign.aiGeneratedProject.v1。"
    ].join("\n");
  }

  function buildAiPlanningContext(userPrompt) {
    syncProjectView();
    resetFrameCache();
    const project = state.project || makeBlankProject();
    return {
      app: {
        name: "RailDesign Planner",
        units: "mm",
        coordinateSystem: {
          origin: "board center",
          x: "right positive",
          y: "up positive",
          yawDeg: "0 is +x, 90 is +y"
        }
      },
      userRequest: userPrompt,
      currentProject: compactProjectForAi(project),
      fixedStart: compactFixedStartForAi(),
      openConnectors: frameOpenConnectors().map(compactConnectorForAi),
      validation: validateCurrentProject(),
      metrics: calculateProjectMetrics(project),
      catalog: compactCatalogForAi(),
      outputRequirements: {
        returnFullProject: true,
        replaceCurrentPlan: true,
        preserveProjectShellOnApply: ["projectId", "name", "board", "view", "layers"]
      }
    };
  }

  function compactProjectForAi(project) {
    return {
      schema: project.schema,
      projectId: project.projectId,
      name: project.name,
      units: project.units,
      board: clone(project.board || {}),
      catalogRefs: clone(project.catalogRefs || []),
      layers: clone(project.layers || []),
      placements: (project.placements || []).map(function (placement) {
        const out = {
          id: placement.id,
          pieceId: placement.pieceId,
          x: roundAiNumber(placement.x),
          y: roundAiNumber(placement.y),
          z: roundAiNumber(placement.z || 0),
          yawDeg: roundAiNumber(placement.yawDeg || 0)
        };
        if (placement.zEnd != null) out.zEnd = roundAiNumber(placement.zEnd);
        if (placement.flipX) out.flipX = true;
        if (placement.flipY) out.flipY = true;
        if (placement.layerId) out.layerId = placement.layerId;
        if (placement.locked) out.locked = true;
        return out;
      }),
      connections: clone(project.connections || [])
    };
  }

  function compactFixedStartForAi() {
    if (!state.fixedStart) return null;
    return {
      type: state.fixedStart.type,
      point: state.fixedStart.point ? compactPointForAi(state.fixedStart.point) : null,
      connector: state.fixedStart.connector ? compactConnectorForAi(state.fixedStart.connector) : null
    };
  }

  function compactCatalogForAi() {
    const ordered = state.catalogs.slice().sort(function (a, b) {
      if (a.catalogId === state.activeCatalogId) return -1;
      if (b.catalogId === state.activeCatalogId) return 1;
      return a.catalogId.localeCompare(b.catalogId);
    });
    const pieces = [];
    const seenPieces = new Set();
    const profiles = [];
    const seenProfiles = new Set();
    ordered.forEach(function (catalog) {
      (catalog.connectorProfiles || []).forEach(function (profile) {
        if (seenProfiles.has(profile.id)) return;
        seenProfiles.add(profile.id);
        profiles.push({
          id: profile.id,
          name: profile.name,
          compatibleWith: clone(profile.compatibleWith || [])
        });
      });
      (catalog.pieces || []).forEach(function (piece) {
        if (seenPieces.has(piece.id)) return;
        seenPieces.add(piece.id);
        pieces.push(compactPieceForAi(piece));
      });
    });
    return {
      catalogId: "loaded-catalogs",
      activeCatalogId: state.activeCatalogId,
      catalogRefs: ordered.map(function (catalog) {
        return { catalogId: catalog.catalogId, version: catalog.version };
      }),
      connectorProfiles: profiles,
      pieces
    };
  }

  function compactPieceForAi(piece) {
    const out = {
      id: piece.id,
      sku: piece.sku,
      name: piece.name,
      kind: piece.kind
    };
    if (piece.tags && piece.tags.length) out.tags = piece.tags.slice();
    if (piece.geometry) {
      out.connectors = (piece.geometry.connectors || []).map(function (connector) {
        return {
          id: connector.id,
          x: roundAiNumber(connector.x),
          y: roundAiNumber(connector.y),
          z: roundAiNumber(connector.z || 0),
          yawDeg: roundAiNumber(connector.yawDeg || 0),
          profile: connector.profile
        };
      });
      out.routes = (piece.geometry.routes || []).map(function (route) {
        return {
          id: route.id,
          connectorIds: clone(route.connectorIds || []),
          segments: (route.segments || []).map(compactSegmentForAi)
        };
      });
    }
    if (piece.dimensions) out.dimensions = clone(piece.dimensions);
    if (piece.placement) {
      out.placement = {
        anchor: piece.placement.anchor,
        canAutoGenerate: piece.placement.canAutoGenerate
      };
    }
    return out;
  }

  function compactSegmentForAi(segment) {
    if (segment.type === "line") {
      return { type: "line", lengthMm: roundAiNumber(segment.lengthMm) };
    }
    if (segment.type === "arc") {
      return {
        type: "arc",
        radiusMm: roundAiNumber(segment.radiusMm),
        angleDeg: roundAiNumber(segment.angleDeg),
        direction: segment.direction
      };
    }
    if (segment.type === "polyline") {
      return {
        type: "polyline",
        points: (segment.points || []).map(compactPointForAi)
      };
    }
    return clone(segment);
  }

  function compactConnectorForAi(connector) {
    return {
      placementId: connector.placementId,
      connectorId: connector.connectorId,
      profile: connector.profile,
      x: roundAiNumber(connector.x),
      y: roundAiNumber(connector.y),
      z: roundAiNumber(connector.z || 0),
      yawDeg: roundAiNumber(connector.yawDeg || 0)
    };
  }

  function compactPointForAi(point) {
    return {
      x: roundAiNumber(point.x),
      y: roundAiNumber(point.y),
      z: roundAiNumber(point.z || 0)
    };
  }

  function parseAiJson(rawText) {
    const text = extractJsonObjectText(rawText);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error("AI 返回内容不是合法 JSON：" + error.message);
    }
  }

  function extractJsonObjectText(rawText) {
    let text = String(rawText || "").trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    }
    if (text.startsWith("{") && text.endsWith("}")) return text;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) return text.slice(start, end + 1);
    return text;
  }

  function normalizeAiEnvelope(envelope) {
    if (!envelope || typeof envelope !== "object") return;
    if (!envelope.summary || typeof envelope.summary !== "object") {
      envelope.summary = {
        title: "AI 规划",
        description: "AI 返回了规划 JSON。",
        warnings: [],
        estimatedPlacementCount: 0,
        estimatedTrackLengthMm: 0,
        estimatedOpenConnectors: 0
      };
    }
    envelope.summary.warnings = Array.isArray(envelope.summary.warnings) ? envelope.summary.warnings : [];
    envelope.project = normalizeAiProject(envelope.project || {});
  }

  function normalizeAiProject(project) {
    const current = state.project || makeBlankProject();
    const out = clone(project);
    out.schema = out.schema || "raildesign.project.v1";
    out.projectId = out.projectId || current.projectId || "ai-candidate";
    out.name = out.name || "AI Generated Layout";
    out.units = out.units || "mm";
    out.board = out.board || clone(current.board || { widthMm: 1800, heightMm: 900, origin: "center", gridMm: 20 });
    out.catalogRefs = Array.isArray(out.catalogRefs) ? out.catalogRefs : clone(current.catalogRefs || []);
    out.layers = Array.isArray(out.layers) && out.layers.length ? out.layers : clone(current.layers || [{ id: "base", name: "Base Layout", visible: true, locked: false }]);
    out.placements = Array.isArray(out.placements) ? out.placements : [];
    out.connections = Array.isArray(out.connections) ? out.connections : [];
    out.metadata = out.metadata && typeof out.metadata === "object" ? out.metadata : {};
    out.placements = out.placements.map(function (placement, index) {
      return {
        ...placement,
        id: placement.id || "ai-pl-" + String(index + 1).padStart(3, "0"),
        x: Number(placement.x) || 0,
        y: Number(placement.y) || 0,
        z: Number(placement.z) || 0,
        yawDeg: Number(placement.yawDeg) || 0,
        layerId: placement.layerId || (out.layers[0] && out.layers[0].id) || "base"
      };
    });
    return out;
  }

  function validateAiGeneratedEnvelope(envelope) {
    const errors = [];
    const warnings = [];
    if (!envelope || typeof envelope !== "object") {
      return { errors: ["AI 返回值不是对象。"], warnings };
    }
    if (envelope.schema !== "raildesign.aiGeneratedProject.v1") {
      errors.push("根 schema 必须是 raildesign.aiGeneratedProject.v1。");
    }
    if (!envelope.project || envelope.project.schema !== "raildesign.project.v1") {
      errors.push("project.schema 必须是 raildesign.project.v1。");
    }
    validateAiProjectCandidate(envelope.project || {}, errors, warnings);
    return { errors, warnings };
  }

  function validateAiProjectCandidate(project, errors, warnings) {
    if (!Array.isArray(project.placements)) errors.push("project.placements 必须是数组。");
    if (!Array.isArray(project.connections)) errors.push("project.connections 必须是数组。");
    if (project.units !== "mm") errors.push("project.units 必须是 mm。");
    const placements = Array.isArray(project.placements) ? project.placements : [];
    const connections = Array.isArray(project.connections) ? project.connections : [];
    const placementById = new Map();
    placements.forEach(function (placement) {
      if (!placement.id) errors.push("存在缺少 id 的 placement。");
      if (placementById.has(placement.id)) errors.push("placement id 重复：" + placement.id);
      placementById.set(placement.id, placement);
      if (!placement.pieceId) errors.push("placement " + placement.id + " 缺少 pieceId。");
      const piece = G.getPiece(state.index, placement.pieceId);
      if (!piece) errors.push("pieceId 不存在：" + placement.pieceId);
      ["x", "y", "z", "yawDeg"].forEach(function (field) {
        if (typeof placement[field] !== "number" || Number.isNaN(placement[field])) {
          errors.push("placement " + placement.id + " 的 " + field + " 必须是数字。");
        }
      });
    });

    const usedConnectors = new Set();
    connections.forEach(function (connection, index) {
      const label = "connection #" + (index + 1);
      if (!connection || !connection.from || !connection.to) {
        errors.push(label + " 必须包含 from/to。");
        return;
      }
      const fromInfo = aiConnectorInfo(project, connection.from);
      const toInfo = aiConnectorInfo(project, connection.to);
      if (!fromInfo) errors.push(label + " 的 from 引用了不存在的 connector。");
      if (!toInfo) errors.push(label + " 的 to 引用了不存在的 connector。");
      const fromKey = G.connectorKey(connection.from);
      const toKey = G.connectorKey(connection.to);
      if (fromKey === toKey) errors.push(label + " 不能连接同一个 connector。");
      [fromKey, toKey].forEach(function (key) {
        if (usedConnectors.has(key)) errors.push("connector 被重复连接：" + key);
        usedConnectors.add(key);
      });
      if (!fromInfo || !toInfo) return;
      if (!G.isCompatible(fromInfo.connector.profile, toInfo.connector.profile, state.catalogs)) {
        errors.push(label + " 的 connector profile 不兼容：" + fromInfo.connector.profile + " / " + toInfo.connector.profile);
      }
      const distance = Math.hypot(fromInfo.connector.x - toInfo.connector.x, fromInfo.connector.y - toInfo.connector.y);
      if (distance > 5) {
        warnings.push(label + " 的端点距离约 " + Math.round(distance * 10) / 10 + "mm，可能没有对齐。");
      }
      const yawMiss = 180 - Math.abs(G.normalizeDeg(fromInfo.connector.yawDeg - toInfo.connector.yawDeg));
      if (Math.abs(yawMiss) > 15) {
        warnings.push(label + " 的端点朝向不是相反方向，可能无法真实拼接。");
      }
    });

    const boardWarnings = aiBoardWarnings(project);
    boardWarnings.forEach(function (message) { warnings.push(message); });
    const collisionCount = meaningfulCollisionCount(project);
    if (collisionCount > 0) warnings.push("检测到 " + collisionCount + " 组可能碰撞或重叠，请应用后检查画布。");
  }

  function aiConnectorInfo(project, ref) {
    if (!ref || !ref.placementId || !ref.connectorId) return null;
    const placement = (project.placements || []).find(function (item) {
      return item.id === ref.placementId;
    });
    if (!placement) return null;
    const piece = G.getPiece(state.index, placement.pieceId);
    if (!piece || !piece.geometry) return null;
    const connector = G.placementConnectors(placement, piece).find(function (item) {
      return item.connectorId === ref.connectorId;
    });
    return connector ? { placement, piece, connector } : null;
  }

  function aiBoardWarnings(project) {
    const board = (state.project && state.project.board) || project.board;
    if (!board || !board.widthMm || !board.heightMm || !(project.placements || []).length) return [];
    const bounds = G.projectBounds(project, state.index);
    const halfW = board.widthMm / 2;
    const halfH = board.heightMm / 2;
    const margin = 5;
    if (bounds.minX < -halfW - margin || bounds.maxX > halfW + margin || bounds.minY < -halfH - margin || bounds.maxY > halfH + margin) {
      return ["部分轨道超出当前画布范围。"];
    }
    return [];
  }

  function meaningfulCollisionCount(project) {
    if (!window.RailPlanning || !window.RailPlanning.detectCollisions) return 0;
    const connectedPairs = new Set();
    (project.connections || []).forEach(function (connection) {
      const a = connection.from.placementId;
      const b = connection.to.placementId;
      connectedPairs.add(a < b ? a + "|" + b : b + "|" + a);
    });
    return window.RailPlanning.detectCollisions(project, state.index, { clearanceMm: 2 }).filter(function (collision) {
      const key = collision.a < collision.b ? collision.a + "|" + collision.b : collision.b + "|" + collision.a;
      return !connectedPairs.has(key);
    }).length;
  }

  function calculateProjectMetrics(project) {
    const open = G.openConnectors(project, state.index);
    const graph = window.RailGraph ? window.RailGraph.buildTopologyGraph(project, state.index) : null;
    const components = graph ? window.RailGraph.connectedComponents(graph) : [];
    const componentsWithTrack = components.filter(function (comp) {
      return comp.some(function (nodeId) {
        const placementId = nodeId.split(":")[0];
        const placement = (project.placements || []).find(function (p) { return p.id === placementId; });
        const piece = placement ? G.getPiece(state.index, placement.pieceId) : null;
        return piece && piece.kind.startsWith("track.");
      });
    }).length;
    return {
      placementCount: (project.placements || []).length,
      connectionCount: (project.connections || []).length,
      trackLengthMm: Math.round(G.projectLength(project, state.index) * 10) / 10,
      openConnectors: open.length,
      components: components.length,
      trackComponents: componentsWithTrack,
      collisionCount: meaningfulCollisionCount(project)
    };
  }

  function renderAiGeneratedResult(result) {
    const summary = result.envelope.summary || {};
    const errors = result.validation.errors;
    const warnings = result.validation.warnings.concat(summary.warnings || []);
    const level = errors.length ? "bad" : warnings.length ? "warn" : "good";
    const metricRows = [
      ["部件数量", result.metrics.placementCount],
      ["轨道长度", (result.metrics.trackLengthMm / 1000).toFixed(2) + " m"],
      ["开放端点", result.metrics.openConnectors],
      ["连接数量", result.metrics.connectionCount],
      ["连通分量", result.metrics.trackComponents + " / " + result.metrics.components]
    ];
    els.aiResultBox.className = "ai-result validation " + level;
    els.aiResultBox.innerHTML = [
      '<div class="ai-result-title">' + escapeHtml(summary.title || "AI 规划") + "</div>",
      '<p class="ai-result-desc">' + escapeHtml(summary.description || "AI 已生成候选规划。") + "</p>",
      '<div class="ai-result-metrics">' + metricRows.map(function (row) {
        return '<div><b>' + escapeHtml(row[1]) + '</b><span>' + escapeHtml(row[0]) + '</span></div>';
      }).join("") + "</div>",
      renderAiIssueList("校验错误", errors),
      renderAiIssueList("警告", warnings)
    ].join("");
    els.aiCopyJsonBtn.disabled = false;
    els.aiApplyBtn.disabled = Boolean(errors.length);
  }

  function renderAiIssueList(title, items) {
    if (!items || !items.length) return "";
    return '<div class="ai-issues"><strong>' + escapeHtml(title) + '</strong><ul>' + items.slice(0, 12).map(function (item) {
      return '<li>' + escapeHtml(item) + '</li>';
    }).join("") + (items.length > 12 ? '<li>还有 ' + (items.length - 12) + ' 条未显示。</li>' : "") + "</ul></div>";
  }

  async function copyAiGeneratedJson() {
    if (!state.aiPlanner.generated || !state.aiPlanner.generated.raw) return;
    try {
      await copyText(state.aiPlanner.generated.raw);
      setStatus("已复制 AI 生成 JSON。");
    } catch (error) {
      alert("复制失败：" + error.message);
    }
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function applyAiGeneratedPlan() {
    const generated = state.aiPlanner.generated;
    if (!generated || generated.validation.errors.length) return;
    if (!confirm("确定要用 AI 生成结果替换当前规划吗？建议先导出当前项目 JSON 备份。")) return;
    const current = state.project || makeBlankProject();
    const aiProject = generated.envelope.project;
    const summary = generated.envelope.summary || {};
    const nextProject = clone(current);
    nextProject.placements = clone(aiProject.placements || []);
    nextProject.connections = clone(aiProject.connections || []);
    if (Array.isArray(aiProject.catalogRefs) && aiProject.catalogRefs.length) {
      nextProject.catalogRefs = clone(aiProject.catalogRefs);
    }
    if (!nextProject.metadata) nextProject.metadata = {};
    nextProject.metadata.notes = [
      "AI 规划：" + (summary.title || "未命名方案"),
      summary.description || "",
      generated.validation.warnings.length ? "警告：" + generated.validation.warnings.join("；") : ""
    ].filter(Boolean).join("\n");
    state.project = nextProject;
    G.clearGeometryCache();
    ensureProjectShape();
    markDirty();
    state.selectedPlacementId = null;
    state.selectedPieceId = null;
    state.fixedStart = null;
    state.startPickMode = false;
    clearPlacementSession();
    setMode("select");
    fitView();
    renderAll();
    setStatus("已应用 AI 规划。点击“保存到本地”写入 IndexedDB。");
  }

  function roundAiNumber(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function validateCatalog(catalog) {
    if (!catalog || catalog.schema !== "raildesign.catalog.v1") throw new Error("不是 raildesign.catalog.v1 文件");
    if (!catalog.catalogId) throw new Error("catalogId 缺失");
    if (!Array.isArray(catalog.pieces) || catalog.pieces.length === 0) throw new Error("pieces 数组为空");
    catalog.pieces.forEach(function (piece) {
      if (!piece.id || !piece.kind) throw new Error("piece 缺少 id 或 kind");
      if (piece.kind.startsWith("track.") && (!piece.geometry || !Array.isArray(piece.geometry.connectors) || !Array.isArray(piece.geometry.routes))) {
        throw new Error(piece.id + " 缺少 track geometry");
      }
    });
  }

  function validateProject(project) {
    if (!project || project.schema !== "raildesign.project.v1") throw new Error("不是 raildesign.project.v1 文件");
    if (!project.projectId) throw new Error("projectId 缺失");
    if (!Array.isArray(project.placements)) throw new Error("placements 必须是数组");
    if (!Array.isArray(project.connections)) throw new Error("connections 必须是数组");
  }

  async function importJsonFile(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.schema === "raildesign.catalog.v1") {
        validateCatalog(data);
        await Db.saveCatalog(data);
        await reloadCatalogs();
        state.activeCatalogId = data.catalogId;
        renderAll();
        setStatus("已导入素材库：" + data.catalogId);
        return;
      }
      if (data.schema === "raildesign.project.v1") {
        validateProject(data);
        state.project = data;
        G.clearGeometryCache();
        ensureProjectShape();
        await Db.saveProject(clone(data));
        renderAll();
        await renderLocalProjects();
        fitView();
        setStatus("已导入并保存项目：" + data.name);
        return;
      }
      throw new Error("无法识别 schema 字段。");
    } catch (error) {
      alert("导入失败：" + error.message);
    }
  }

  function exportCurrentProject() {
    syncProjectView();
    markDirty();
    downloadJson(safeFileName(state.project.projectId || "raildesign-project") + ".json", state.project);
  }

  function exportCurrentCatalog() {
    const catalog = activeCatalog();
    if (!catalog) return alert("没有可导出的素材库。");
    downloadJson(safeFileName(catalog.catalogId) + ".json", catalog);
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function safeFileName(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  init().catch(function (error) {
    console.error(error);
    alert("初始化失败：" + error.message);
  });
})();
