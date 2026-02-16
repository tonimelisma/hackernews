const createFirestoreContext = () => {
  const startTime = Date.now();
  const readsByCollection = new Map();
  const writesByCollection = new Map();
  let l1Hits = 0;
  let l2Hits = 0;
  let misses = 0;

  const addToMap = (map, collection, count) => {
    map.set(collection, (map.get(collection) || 0) + count);
  };

  const sumMap = (map) => {
    let total = 0;
    for (const v of map.values()) total += v;
    return total;
  };

  const formatMap = (map) => {
    if (map.size === 0) return "0";
    return Array.from(map.entries()).map(([k, v]) => `${k}:${v}`).join(",");
  };

  return {
    // Backward-compat aggregate getters
    get reads() { return sumMap(readsByCollection); },
    get writes() { return sumMap(writesByCollection); },
    get cacheHits() { return l1Hits + l2Hits; },
    get cacheMisses() { return misses; },
    get collections() {
      const s = new Set([...readsByCollection.keys(), ...writesByCollection.keys()]);
      return s;
    },

    // Per-collection breakdown getters
    get readsByCollection() { return readsByCollection; },
    get writesByCollection() { return writesByCollection; },

    read(collection, docCount = 1) {
      addToMap(readsByCollection, collection, docCount);
    },

    write(collection, docCount = 1) {
      addToMap(writesByCollection, collection, docCount);
    },

    // Legacy cache methods (backward compat)
    cacheHit() {
      l1Hits++;
    },

    cacheMiss() {
      misses++;
    },

    // New L1/L2 cache tracking
    l1CacheHit() {
      l1Hits++;
    },

    l2CacheHit() {
      l2Hits++;
    },

    // Inline query logging
    query(collection, description, docCount, ms) {
      console.log(`[firestore-query] ${collection} ${description} docs=${docCount} ms=${ms}`);
    },

    log(label, extra = {}) {
      const ms = Date.now() - startTime;
      const cacheStr = (l1Hits || l2Hits || misses)
        ? [l1Hits && `L1:${l1Hits}`, l2Hits && `L2:${l2Hits}`, misses && `MISS:${misses}`].filter(Boolean).join(",")
        : "-";
      const colStr = readsByCollection.size || writesByCollection.size
        ? Array.from(new Set([...readsByCollection.keys(), ...writesByCollection.keys()])).join(",")
        : "-";
      const extraStr = Object.entries(extra)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      const parts = [
        `[firestore] ${label}`,
        `cache=${cacheStr}`,
        `reads=${formatMap(readsByCollection)}`,
        `writes=${formatMap(writesByCollection)}`,
        `collections=${colStr}`,
        `ms=${ms}`,
      ];
      if (extraStr) parts.push(extraStr);
      console.log(parts.join(" "));
    },
  };
};

module.exports = { createFirestoreContext };
