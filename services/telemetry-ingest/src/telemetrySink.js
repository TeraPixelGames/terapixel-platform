import fs from "node:fs/promises";
import path from "node:path";

export class InMemoryTelemetrySink {
  constructor() {
    this._batches = [];
  }

  async appendBatch(batch) {
    this._batches.push(deepClone(batch));
  }

  async getRecent(limit = 100) {
    const max = normalizeLimit(limit);
    return this._batches.slice(-max).map((batch) => deepClone(batch));
  }
}

export class JsonFileTelemetrySink {
  constructor(options = {}) {
    const filePath = String(options.filePath || "").trim();
    if (!filePath) {
      throw new Error("JsonFileTelemetrySink filePath is required");
    }
    this._filePath = filePath;
    this._ready = false;
    this._writeQueue = Promise.resolve();
  }

  async appendBatch(batch) {
    await this._ensureReady();
    const line = `${JSON.stringify(deepClone(batch))}\n`;
    this._writeQueue = this._writeQueue.then(() =>
      fs.appendFile(this._filePath, line, "utf8")
    );
    await this._writeQueue;
  }

  async getRecent(limit = 100) {
    await this._ensureReady();
    const max = normalizeLimit(limit);
    let raw = "";
    try {
      raw = await fs.readFile(this._filePath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const recent = lines.slice(-max);
    const parsed = [];
    for (const line of recent) {
      try {
        const value = JSON.parse(line);
        if (value && typeof value === "object") {
          parsed.push(value);
        }
      } catch (_error) {
        // Ignore malformed lines so one bad row does not break debug reads.
      }
    }
    return parsed.map((batch) => deepClone(batch));
  }

  async _ensureReady() {
    if (this._ready) {
      return;
    }
    this._ready = true;
    await fs.mkdir(path.dirname(this._filePath), { recursive: true });
  }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.floor(parsed);
}
