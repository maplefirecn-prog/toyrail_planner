(function () {
  if (window.Dexie) return;

  function requestToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function transactionDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  }

  function keyPathFromStoreSpec(spec) {
    return String(spec).split(",")[0].trim().replace(/^\+\+/, "");
  }

  function parseIndexes(spec) {
    return String(spec).split(",").map(function (part) {
      return part.trim().replace(/^\+\+/, "");
    }).filter(Boolean).slice(1);
  }

  function FallbackTable(db, name) {
    this.db = db;
    this.name = name;
  }

  FallbackTable.prototype.put = function (value) {
    return this.db._withStore(this.name, "readwrite", function (store) {
      return requestToPromise(store.put(value));
    });
  };

  FallbackTable.prototype.bulkPut = function (values) {
    var self = this;
    return Promise.all(values.map(function (value) { return self.put(value); }));
  };

  FallbackTable.prototype.get = function (key) {
    return this.db._withStore(this.name, "readonly", function (store) {
      return requestToPromise(store.get(key));
    });
  };

  FallbackTable.prototype.delete = function (key) {
    return this.db._withStore(this.name, "readwrite", function (store) {
      return requestToPromise(store.delete(key));
    });
  };

  FallbackTable.prototype.clear = function () {
    return this.db._withStore(this.name, "readwrite", function (store) {
      return requestToPromise(store.clear());
    });
  };

  FallbackTable.prototype.toArray = function () {
    return this.db._withStore(this.name, "readonly", function (store) {
      if (store.getAll) return requestToPromise(store.getAll());
      return new Promise(function (resolve, reject) {
        var rows = [];
        var req = store.openCursor();
        req.onsuccess = function () {
          var cursor = req.result;
          if (!cursor) return resolve(rows);
          rows.push(cursor.value);
          cursor.continue();
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  };

  function DexieFallback(name) {
    this.name = name;
    this._stores = {};
    this._dbPromise = null;
  }

  DexieFallback.prototype.version = function () {
    var self = this;
    return {
      stores: function (schema) {
        self._stores = schema;
        Object.keys(schema).forEach(function (storeName) {
          self[storeName] = new FallbackTable(self, storeName);
        });
        return self;
      }
    };
  };

  DexieFallback.prototype.open = function () {
    var self = this;
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise(function (resolve, reject) {
      var request = indexedDB.open(self.name, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        Object.keys(self._stores).forEach(function (storeName) {
          var spec = self._stores[storeName];
          var keyPath = keyPathFromStoreSpec(spec);
          var store = db.objectStoreNames.contains(storeName)
            ? request.transaction.objectStore(storeName)
            : db.createObjectStore(storeName, { keyPath: keyPath });
          parseIndexes(spec).forEach(function (indexName) {
            if (!store.indexNames.contains(indexName)) {
              store.createIndex(indexName, indexName, { unique: false });
            }
          });
        });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    return this._dbPromise;
  };

  DexieFallback.prototype._withStore = function (storeName, mode, operation) {
    return this.open().then(function (db) {
      var tx = db.transaction(storeName, mode);
      var store = tx.objectStore(storeName);
      return Promise.resolve(operation(store)).then(function (result) {
        return transactionDone(tx).then(function () { return result; });
      });
    });
  };

  DexieFallback.prototype.close = function () {
    if (!this._dbPromise) return;
    this._dbPromise.then(function (db) { db.close(); });
    this._dbPromise = null;
  };

  window.Dexie = DexieFallback;
  window.__RAILDESIGN_DEXIE_FALLBACK__ = true;
})();
