const createDbContext = () => {
  const startTime = Date.now();
  const readsByTable = new Map();
  const writesByTable = new Map();
  let l1Hits = 0;
  let misses = 0;

  const addToMap = (map, table, count) => {
    map.set(table, (map.get(table) || 0) + count);
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
    get reads() { return sumMap(readsByTable); },
    get writes() { return sumMap(writesByTable); },
    get cacheHits() { return l1Hits; },
    get cacheMisses() { return misses; },
    get collections() {
      const s = new Set([...readsByTable.keys(), ...writesByTable.keys()]);
      return s;
    },

    get readsByCollection() { return readsByTable; },
    get writesByCollection() { return writesByTable; },

    read(table, count = 1) {
      addToMap(readsByTable, table, count);
    },

    write(table, count = 1) {
      addToMap(writesByTable, table, count);
    },

    cacheHit() {
      l1Hits++;
    },

    cacheMiss() {
      misses++;
    },

    l1CacheHit() {
      l1Hits++;
    },

    query(table, description, count, ms) {
      console.log(`[db-query] ${table} ${description} rows=${count} ms=${ms}`);
    },

    log(label, extra = {}) {
      const ms = Date.now() - startTime;
      const cacheStr = (l1Hits || misses)
        ? [l1Hits && `L1:${l1Hits}`, misses && `MISS:${misses}`].filter(Boolean).join(",")
        : "-";
      const tableStr = readsByTable.size || writesByTable.size
        ? Array.from(new Set([...readsByTable.keys(), ...writesByTable.keys()])).join(",")
        : "-";
      const extraStr = Object.entries(extra)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      const parts = [
        `[db] ${label}`,
        `cache=${cacheStr}`,
        `reads=${formatMap(readsByTable)}`,
        `writes=${formatMap(writesByTable)}`,
        `tables=${tableStr}`,
        `ms=${ms}`,
      ];
      if (extraStr) parts.push(extraStr);
      console.log(parts.join(" "));
    },
  };
};

module.exports = { createDbContext };
