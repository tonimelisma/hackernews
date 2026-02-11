/**
 * In-memory Firestore mock that implements the exact API surface used by this project.
 * Storage: flat Map<collectionPath, Map<docId, data>> where subcollection paths
 * are like "dev-users/testuser/hidden".
 */

class MockTimestamp {
  constructor(date) {
    this._date = date;
  }
  toDate() {
    return this._date;
  }
}

function wrapDates(data) {
  if (data === null || data === undefined || typeof data !== "object") return data;
  if (data instanceof Date) return new MockTimestamp(data);
  if (data instanceof MockTimestamp) return data;
  if (Array.isArray(data)) return data.map(wrapDates);
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = wrapDates(value);
  }
  return result;
}

function toMillis(value) {
  if (value instanceof MockTimestamp) return value._date.getTime();
  if (value instanceof Date) return value.getTime();
  return value;
}

class MockFirestore {
  constructor() {
    this._collections = new Map();
  }

  collection(name) {
    return new MockCollectionRef(this, name);
  }

  batch() {
    return new MockWriteBatch(this);
  }

  _getCollection(path) {
    if (!this._collections.has(path)) {
      this._collections.set(path, new Map());
    }
    return this._collections.get(path);
  }

  _clear() {
    this._collections.clear();
  }
}

class MockCollectionRef {
  constructor(db, path) {
    this._db = db;
    this._path = path;
  }

  doc(id) {
    return new MockDocRef(this._db, this._path, String(id));
  }

  async get() {
    const collection = this._db._getCollection(this._path);
    const docs = [];
    for (const [id, data] of collection) {
      docs.push(
        new MockDocSnapshot(id, data, new MockDocRef(this._db, this._path, id))
      );
    }
    return new MockQuerySnapshot(docs);
  }

  where(field, op, value) {
    return new MockQuery(this._db, this._path, [{ field, op, value }], [], null);
  }

  orderBy(field, direction = "asc") {
    return new MockQuery(this._db, this._path, [], [{ field, direction }], null);
  }

  limit(n) {
    return new MockQuery(this._db, this._path, [], [], n);
  }
}

class MockDocRef {
  constructor(db, collectionPath, id) {
    this._db = db;
    this._collectionPath = collectionPath;
    this.id = id;
    this.ref = this;
  }

  async set(data, options = {}) {
    const collection = this._db._getCollection(this._collectionPath);
    const wrapped = wrapDates(data);
    if (options.merge && collection.has(this.id)) {
      const existing = collection.get(this.id);
      collection.set(this.id, { ...existing, ...wrapped });
    } else {
      collection.set(this.id, wrapped);
    }
  }

  async get() {
    const collection = this._db._getCollection(this._collectionPath);
    const data = collection.get(this.id);
    if (data === undefined) {
      return new MockDocSnapshot(this.id, undefined, this);
    }
    return new MockDocSnapshot(this.id, data, this);
  }

  async update(data) {
    const collection = this._db._getCollection(this._collectionPath);
    const existing = collection.get(this.id);
    if (existing === undefined) {
      throw new Error(
        `No document to update: ${this._collectionPath}/${this.id}`
      );
    }
    const wrapped = wrapDates(data);
    collection.set(this.id, { ...existing, ...wrapped });
  }

  async delete() {
    const collection = this._db._getCollection(this._collectionPath);
    collection.delete(this.id);
  }

  collection(name) {
    return new MockCollectionRef(
      this._db,
      `${this._collectionPath}/${this.id}/${name}`
    );
  }

  async listCollections() {
    const prefix = `${this._collectionPath}/${this.id}/`;
    const results = [];
    const seen = new Set();
    for (const path of this._db._collections.keys()) {
      if (path.startsWith(prefix)) {
        const name = path.slice(prefix.length).split("/")[0];
        if (!seen.has(name)) {
          seen.add(name);
          results.push(new MockCollectionRef(this._db, `${prefix}${name}`));
        }
      }
    }
    return results;
  }
}

class MockQuery {
  constructor(db, collectionPath, filters, orderBys, limitN) {
    this._db = db;
    this._collectionPath = collectionPath;
    this._filters = filters;
    this._orderBys = orderBys;
    this._limit = limitN;
  }

  where(field, op, value) {
    return new MockQuery(
      this._db,
      this._collectionPath,
      [...this._filters, { field, op, value }],
      this._orderBys,
      this._limit
    );
  }

  orderBy(field, direction = "asc") {
    return new MockQuery(
      this._db,
      this._collectionPath,
      this._filters,
      [...this._orderBys, { field, direction }],
      this._limit
    );
  }

  limit(n) {
    return new MockQuery(
      this._db,
      this._collectionPath,
      this._filters,
      this._orderBys,
      n
    );
  }

  async get() {
    const collection = this._db._getCollection(this._collectionPath);
    let docs = [];

    for (const [id, data] of collection) {
      let matches = true;
      for (const { field, op, value } of this._filters) {
        const fieldValue = toMillis(data[field]);
        const compareValue = toMillis(value);

        switch (op) {
          case ">":
            if (!(fieldValue > compareValue)) matches = false;
            break;
          case "<":
            if (!(fieldValue < compareValue)) matches = false;
            break;
          case ">=":
            if (!(fieldValue >= compareValue)) matches = false;
            break;
          case "<=":
            if (!(fieldValue <= compareValue)) matches = false;
            break;
          case "==":
            if (fieldValue !== compareValue) matches = false;
            break;
          default:
            throw new Error(`Unsupported operator: ${op}`);
        }
        if (!matches) break;
      }

      if (matches) {
        docs.push(
          new MockDocSnapshot(
            id,
            data,
            new MockDocRef(this._db, this._collectionPath, id)
          )
        );
      }
    }

    for (const { field, direction } of this._orderBys) {
      docs.sort((a, b) => {
        const aVal = toMillis(a.data()[field]);
        const bVal = toMillis(b.data()[field]);
        if (aVal < bVal) return direction === "desc" ? 1 : -1;
        if (aVal > bVal) return direction === "desc" ? -1 : 1;
        return 0;
      });
    }

    if (this._limit !== null && this._limit !== undefined) {
      docs = docs.slice(0, this._limit);
    }

    return new MockQuerySnapshot(docs);
  }
}

class MockDocSnapshot {
  constructor(id, data, ref) {
    this.id = id;
    this._data = data;
    this.exists = data !== undefined;
    this.ref = ref;
  }

  data() {
    return this._data;
  }
}

class MockQuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.empty = docs.length === 0;
    this.size = docs.length;
  }
}

class MockWriteBatch {
  constructor(db) {
    this._db = db;
    this._ops = [];
  }

  delete(ref) {
    this._ops.push({ type: "delete", ref });
    return this;
  }

  async commit() {
    for (const op of this._ops) {
      if (op.type === "delete") {
        await op.ref.delete();
      }
    }
    this._ops = [];
  }
}

module.exports = { MockFirestore, MockTimestamp };
