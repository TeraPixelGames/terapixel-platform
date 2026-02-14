import {
  createDefaultSaveEnvelope,
  mergeSaveEnvelopes,
  validateSaveEnvelope
} from "./saveEnvelope.js";
import { InMemorySaveStore } from "./saveStore.js";

export function createSaveService(options = {}) {
  const saveStore = options.saveStore || new InMemorySaveStore();

  return {
    saveStore,
    getServerEnvelope: async ({ gameId, profileId }) => {
      assertRequiredString(gameId, "gameId");
      assertRequiredString(profileId, "profileId");
      return saveStore.get(gameId, profileId);
    },
    syncSave: async ({ gameId, profileId, clientEnvelope, nowSeconds }) => {
      assertRequiredString(gameId, "gameId");
      assertRequiredString(profileId, "profileId");
      const now = normalizeNow(nowSeconds);

      const serverEnvelope = await saveStore.get(gameId, profileId);
      if (!clientEnvelope && serverEnvelope) {
        return {
          envelope: serverEnvelope,
          source: "server"
        };
      }

      if (!clientEnvelope && !serverEnvelope) {
        const created = createDefaultSaveEnvelope({
          gameId,
          profileId,
          updatedAt: now
        });
        const persisted = await saveStore.put(created);
        return {
          envelope: persisted,
          source: "created_default"
        };
      }

      if (clientEnvelope) {
        validateSaveEnvelope(clientEnvelope);
        assertEnvelopeIdentity(clientEnvelope, gameId, profileId);
      }

      if (!serverEnvelope && clientEnvelope) {
        const firstWrite = {
          ...clientEnvelope,
          updated_at: Math.max(Number(clientEnvelope.updated_at) || 0, now),
          revision: Math.max(1, Number(clientEnvelope.revision) || 1)
        };
        const persisted = await saveStore.put(firstWrite);
        return {
          envelope: persisted,
          source: "client_first_write"
        };
      }

      const merged = mergeSaveEnvelopes(clientEnvelope, serverEnvelope, {
        nowSeconds: now
      });
      const persisted = await saveStore.put(merged);
      return {
        envelope: persisted,
        source: "merged"
      };
    }
  };
}

function assertRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
}

function normalizeNow(nowSeconds) {
  if (Number.isFinite(Number(nowSeconds)) && Number(nowSeconds) > 0) {
    return Math.floor(Number(nowSeconds));
  }
  return Math.floor(Date.now() / 1000);
}

function assertEnvelopeIdentity(envelope, gameId, profileId) {
  if (envelope.game_id !== gameId) {
    throw new Error("client envelope game_id mismatch");
  }
  if (envelope.profile_id !== profileId) {
    throw new Error("client envelope profile_id mismatch");
  }
}
