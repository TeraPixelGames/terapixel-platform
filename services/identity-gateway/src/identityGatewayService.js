import crypto from "node:crypto";
import { verifyCrazyGamesToken } from "../../../adapters/crazygames-auth/index.js";
import { createSessionToken } from "../../../packages/shared-utils/index.js";
import { InMemoryIdentityStore } from "./identityStore.js";

export function createIdentityGatewayService(options = {}) {
  const identityStore = options.identityStore || new InMemoryIdentityStore();
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
      const now = Number.isFinite(input?.nowSeconds)
        ? Math.floor(input.nowSeconds)
        : Math.floor(Date.now() / 1000);
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
          ...buildSession(updated.playerId, now, sessionConfig)
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

function buildSession(playerId, now, sessionConfig) {
  if (!sessionConfig.secret) {
    return {};
  }
  const sessionToken = createSessionToken(
    {
      sub: playerId,
      scope: "player_session"
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
