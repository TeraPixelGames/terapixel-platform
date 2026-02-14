import { InMemoryPlayerStore } from "./playerStore.js";

export function createPlayerService(options = {}) {
  const store = options.store || new InMemoryPlayerStore();

  return {
    store,
    getPlayer: async (playerId) => {
      if (!playerId || typeof playerId !== "string") {
        throw new Error("playerId is required");
      }
      return store.get(playerId);
    },
    upsertPlayer: async (input) => {
      if (!input || typeof input !== "object") {
        throw new Error("upsertPlayer input is required");
      }
      const playerId = String(input.playerId || "");
      if (!playerId) {
        throw new Error("playerId is required");
      }
      const now = normalizeNow(input.nowSeconds);
      const existing = await store.get(playerId);
      const createdAt = existing?.createdAt ?? now;
      const merged = {
        playerId,
        displayName: normalizeDisplayName(input.displayName, existing?.displayName || ""),
        createdAt,
        lastSeenAt: now,
        attributes: mergeAttributes(existing?.attributes, input.attributes)
      };
      return store.put(merged);
    },
    listPlayers: async () => store.list()
  };
}

function normalizeNow(nowSeconds) {
  if (Number.isFinite(Number(nowSeconds)) && Number(nowSeconds) > 0) {
    return Math.floor(Number(nowSeconds));
  }
  return Math.floor(Date.now() / 1000);
}

function normalizeDisplayName(displayName, fallback) {
  if (typeof displayName === "string" && displayName.trim()) {
    return displayName.trim();
  }
  return fallback;
}

function mergeAttributes(existing, incoming) {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  if (!incoming || typeof incoming !== "object") {
    return base;
  }
  for (const [key, value] of Object.entries(incoming)) {
    base[key] = value;
  }
  return base;
}
