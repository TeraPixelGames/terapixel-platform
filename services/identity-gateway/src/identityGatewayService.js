import crypto from "node:crypto";
import { verifyCrazyGamesToken } from "../../../adapters/crazygames-auth/index.js";
import { createSessionToken } from "../../../packages/shared-utils/index.js";
import { InMemoryIdentityStore } from "./identityStore.js";

export function createIdentityGatewayService(options = {}) {
  const identityStore = options.identityStore || new InMemoryIdentityStore();
  const mergeCoordinator = options.mergeCoordinator || createNoopMergeCoordinator();
  const sessionConfig = {
    secret: String(options.sessionSecret || ""),
    issuer: String(options.sessionIssuer || "terapixel.identity"),
    audience: String(options.sessionAudience || "terapixel.game"),
    ttlSeconds: Number.isFinite(Number(options.sessionTtlSeconds))
      ? Math.max(60, Math.floor(Number(options.sessionTtlSeconds)))
      : 60 * 60
  };

  return {
    identityStore,
    authenticateCrazyGamesUser: async (input) => {
      const now = normalizeNow(input?.nowSeconds);
      const verified = await verifyCrazyGamesToken(input);
      const existing = await identityStore.findPlayerByProvider(
        verified.provider,
        verified.providerUserId
      );
      if (existing) {
        const updated = {
          ...existing,
          displayName: verified.displayName || existing.displayName,
          lastSeenAt: now
        };
        await identityStore.upsertProviderLink(
          verified.provider,
          verified.providerUserId,
          updated
        );
        return {
          isNewPlayer: false,
          player: updated,
          provider: verified.provider,
          providerUserId: verified.providerUserId,
          ...buildSession(updated.playerId, now, sessionConfig, {
            nakamaUserId: updated.nakamaUserId
          })
        };
      }

      const player = {
        playerId: createDeterministicPlayerId(
          verified.provider,
          verified.providerUserId
        ),
        displayName: verified.displayName,
        createdAt: now,
        lastSeenAt: now
      };
      await identityStore.upsertProviderLink(
        verified.provider,
        verified.providerUserId,
        player
      );
      return {
        isNewPlayer: true,
        player,
        provider: verified.provider,
        providerUserId: verified.providerUserId,
        ...buildSession(player.playerId, now, sessionConfig)
      };
    },
    authenticateNakamaUser: async (input) => {
      const gameId = normalizeGameId(input?.gameId);
      const nakamaUserId = normalizeNakamaUserId(input?.nakamaUserId);
      if (!gameId) {
        throw new Error("gameId is required");
      }
      if (!nakamaUserId) {
        throw new Error("nakamaUserId is required");
      }
      const now = normalizeNow(input?.nowSeconds);
      const existing = await identityStore.findPlayerByNakama(gameId, nakamaUserId);
      if (existing) {
        const resolvedProfileId = await identityStore.resolvePrimaryProfileId(
          existing.playerId
        );
        const updated = {
          ...existing,
          playerId: resolvedProfileId,
          gameId,
          nakamaUserId,
          displayName: normalizeDisplayName(input?.displayName) || existing.displayName,
          lastSeenAt: now
        };
        await identityStore.upsertNakamaLink(gameId, nakamaUserId, updated);
        return {
          isNewPlayer: false,
          player: updated,
          ...buildSession(updated.playerId, now, sessionConfig, {
            nakamaUserId
          })
        };
      }

      const profileId = createDeterministicPlayerId("nakama", `${gameId}:${nakamaUserId}`);
      const primaryProfileId = await identityStore.resolvePrimaryProfileId(profileId);
      const player = {
        playerId: primaryProfileId,
        gameId,
        nakamaUserId,
        displayName: normalizeDisplayName(input?.displayName),
        createdAt: now,
        lastSeenAt: now
      };
      await identityStore.upsertNakamaLink(gameId, nakamaUserId, player);
      return {
        isNewPlayer: true,
        player,
        ...buildSession(primaryProfileId, now, sessionConfig, {
          nakamaUserId
        })
      };
    },
    createMergeCodeForProfile: async ({ primaryProfileId, nowSeconds, ttlSeconds }) => {
      const primary = await identityStore.resolvePrimaryProfileId(primaryProfileId);
      const created = await identityStore.createMergeCode(primary, {
        nowSeconds,
        ttlSeconds
      });
      return {
        mergeCode: created.code,
        expiresAt: created.expiresAt
      };
    },
    redeemMergeCodeForProfile: async ({
      secondaryProfileId,
      mergeCode,
      nowSeconds
    }) => {
      const redeemed = await identityStore.redeemMergeCode(
        secondaryProfileId,
        mergeCode,
        { nowSeconds }
      );
      await mergeCoordinator.mergeAll({
        primaryProfileId: redeemed.primaryProfileId,
        secondaryProfileId: redeemed.secondaryProfileId
      });
      return redeemed;
    }
  };
}

export function createDeterministicPlayerId(provider, providerUserId) {
  const digest = crypto
    .createHash("sha256")
    .update(`${provider}:${providerUserId}`)
    .digest("hex");
  return `player_${digest.slice(0, 24)}`;
}

export function createHttpMergeCoordinator(config = {}) {
  const adminKey = String(config.adminKey || "");
  const services = {
    iap: String(config.iapMergeUrl || "").trim(),
    save: String(config.saveMergeUrl || "").trim(),
    flags: String(config.flagsMergeUrl || "").trim(),
    telemetry: String(config.telemetryMergeUrl || "").trim()
  };
  return {
    mergeAll: async ({ primaryProfileId, secondaryProfileId }) => {
      const body = {
        primary_profile_id: primaryProfileId,
        secondary_profile_id: secondaryProfileId
      };
      for (const url of Object.values(services)) {
        if (!url) {
          continue;
        }
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-admin-key": adminKey
          },
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`merge downstream failed (${url}): ${response.status} ${text}`);
        }
      }
    }
  };
}

function createNoopMergeCoordinator() {
  return {
    mergeAll: async () => {}
  };
}

function buildSession(profileId, now, sessionConfig, identityContext = {}) {
  if (!sessionConfig.secret) {
    return {};
  }
  const nakamaUserId = normalizeNakamaUserId(identityContext.nakamaUserId);
  const sessionToken = createSessionToken(
    {
      sub: profileId,
      scope: "player_session",
      nakama_user_id: nakamaUserId || undefined
    },
    sessionConfig.secret,
    {
      issuer: sessionConfig.issuer,
      audience: sessionConfig.audience,
      ttlSeconds: sessionConfig.ttlSeconds,
      nowSeconds: now
    }
  );
  return {
    sessionToken,
    sessionExpiresAt: now + sessionConfig.ttlSeconds
  };
}

function normalizeGameId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeNakamaUserId(value) {
  return String(value || "").trim();
}

function normalizeDisplayName(value) {
  return String(value || "").trim();
}

function normalizeNow(nowSeconds) {
  if (Number.isFinite(Number(nowSeconds)) && Number(nowSeconds) > 0) {
    return Math.floor(Number(nowSeconds));
  }
  return Math.floor(Date.now() / 1000);
}
