(function () {
  const db = new Dexie("RailDesignLocalMvp");

  db.version(1).stores({
    catalogs: "catalogId, manufacturer, productLine, updatedAt",
    projects: "projectId, name, updatedAt"
  });

  function stamp(record) {
    return {
      ...record,
      updatedAt: new Date().toISOString()
    };
  }

  async function saveCatalog(catalog) {
    const row = stamp({
      catalogId: catalog.catalogId,
      version: catalog.version,
      manufacturer: catalog.manufacturer,
      productLine: catalog.productLine,
      scale: catalog.scale,
      data: catalog
    });
    await db.catalogs.put(row);
    return row;
  }

  async function listCatalogs() {
    const rows = await db.catalogs.toArray();
    return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function getCatalog(catalogId) {
    const row = await db.catalogs.get(catalogId);
    return row ? row.data : null;
  }

  async function deleteCatalog(catalogId) {
    await db.catalogs.delete(catalogId);
  }

  async function saveProject(project) {
    const row = stamp({
      projectId: project.projectId,
      name: project.name,
      data: project
    });
    await db.projects.put(row);
    return row;
  }

  async function listProjects() {
    const rows = await db.projects.toArray();
    return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function getProject(projectId) {
    const row = await db.projects.get(projectId);
    return row ? row.data : null;
  }

  async function deleteProject(projectId) {
    await db.projects.delete(projectId);
  }

  window.RailDesignDb = {
    db,
    saveCatalog,
    listCatalogs,
    getCatalog,
    deleteCatalog,
    saveProject,
    listProjects,
    getProject,
    deleteProject
  };
})();
