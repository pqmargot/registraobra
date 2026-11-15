/* Capa de datos: IndexedDB nativo (sin librerías externas). Todo se guarda en el celular. */
const DB = (() => {
  const NAME = 'registraobra', VERSION = 3;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VERSION);
      r.onupgradeneeded = (ev) => {
        const db = r.result;
        const has = n => db.objectStoreNames.contains(n);
        if (!has('config')) db.createObjectStore('config', { keyPath: 'k' });
        if (!has('participantes')) db.createObjectStore('participantes', { keyPath: 'id', autoIncrement: true });
        if (!has('registros')) {
          const reg = db.createObjectStore('registros', { keyPath: 'id' });
          reg.createIndex('tipo', 'tipo');
          reg.createIndex('fecha', 'fecha');
        }
        if (!has('tiempos')) db.createObjectStore('tiempos', { keyPath: 'id', autoIncrement: true });
        if (!has('entregas')) db.createObjectStore('entregas', { keyPath: 'id', autoIncrement: true });
        if (!has('eventos')) db.createObjectStore('eventos', { keyPath: 'id', autoIncrement: true });
        // v2: fotos para el panel fotográfico
        if (!has('fotos')) { const f = db.createObjectStore('fotos', { keyPath: 'id', autoIncrement: true }); f.createIndex('ref', 'ref'); }
        // v3: días no laborables (feriados, lluvia, paralización)
        if (!has('nolab')) db.createObjectStore('nolab', { keyPath: 'fecha' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    all: (store) => tx(store, 'readonly', s => req(s.getAll())),
    get: (store, key) => tx(store, 'readonly', s => req(s.get(key))),
    put: (store, val) => tx(store, 'readwrite', s => req(s.put(val))),
    add: (store, val) => tx(store, 'readwrite', s => req(s.add(val))),
    del: (store, key) => tx(store, 'readwrite', s => req(s.delete(key))),
    clear: (store) => tx(store, 'readwrite', s => req(s.clear())),
    async getConfig(k, def) { const r = await this.get('config', k); return r ? r.v : def; },
    setConfig(k, v) { return this.put('config', { k, v }); },
    async dump() {
      const out = {};
      for (const s of ['config', 'participantes', 'registros', 'tiempos', 'entregas', 'eventos', 'fotos', 'nolab']) out[s] = await this.all(s);
      return out;
    },
    async restore(data) {
      for (const s of ['config', 'participantes', 'registros', 'tiempos', 'entregas', 'eventos', 'fotos', 'nolab']) {
        if (!data[s]) continue;
        await this.clear(s);
        for (const v of data[s]) await this.put(s, v);
      }
    }
  };
})();
