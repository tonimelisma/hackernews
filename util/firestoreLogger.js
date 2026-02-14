const createFirestoreContext = () => {
  const startTime = Date.now();
  const collections = new Set();
  let reads = 0;
  let writes = 0;
  let cacheHits = 0;
  let cacheMisses = 0;

  return {
    get reads() { return reads; },
    get writes() { return writes; },
    get cacheHits() { return cacheHits; },
    get cacheMisses() { return cacheMisses; },
    get collections() { return collections; },

    read(collection, docCount = 1) {
      collections.add(collection);
      reads += docCount;
    },

    write(collection, docCount = 1) {
      collections.add(collection);
      writes += docCount;
    },

    cacheHit() {
      cacheHits++;
    },

    cacheMiss() {
      cacheMisses++;
    },

    log(label, extra = {}) {
      const ms = Date.now() - startTime;
      const cacheStr = (cacheHits || cacheMisses)
        ? [cacheHits && `HIT:${cacheHits}`, cacheMisses && `MISS:${cacheMisses}`].filter(Boolean).join(",")
        : "-";
      const colStr = collections.size ? Array.from(collections).join(",") : "-";
      const extraStr = Object.entries(extra)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      const parts = [
        `[firestore] ${label}`,
        `cache=${cacheStr}`,
        `reads=${reads}`,
        `writes=${writes}`,
        `collections=${colStr}`,
        `ms=${ms}`,
      ];
      if (extraStr) parts.push(extraStr);
      console.log(parts.join(" "));
    },
  };
};

module.exports = { createFirestoreContext };
