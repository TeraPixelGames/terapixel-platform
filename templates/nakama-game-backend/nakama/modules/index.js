function InitModule(ctx, logger, nk, initializer) {
  initializer.registerRpc("platform_auth_exchange", function (rpcCtx, payload) {
    return rpcPlatformAuthExchange(rpcCtx, payload, logger, nk);
  });
  logger.info("Nakama module template loaded with platform_auth_exchange RPC.");
}

function rpcPlatformAuthExchange(ctx, payload, logger, nk) {
  const parsed = parsePayload(payload);
  const platformUrl = String(ctx.env.PLATFORM_IDENTITY_URL || "").trim();
  const gameId = String(ctx.env.GAME_ID || "").trim();
  if (!platformUrl) {
    throw new Error("PLATFORM_IDENTITY_URL is required");
  }
  if (!gameId) {
    throw new Error("GAME_ID is required");
  }
  if (!parsed.nakama_user_id) {
    throw new Error("nakama_user_id is required");
  }

  const response = nk.httpRequest(
    `${platformUrl}/v1/auth/nakama`,
    "post",
    {
      "content-type": "application/json"
    },
    JSON.stringify({
      game_id: gameId,
      nakama_user_id: parsed.nakama_user_id,
      display_name: parsed.display_name || ""
    }),
    5000
  );

  if (response.code < 200 || response.code >= 300) {
    logger.error(
      `platform_auth_exchange failed code=${response.code} body=${response.body}`
    );
    throw new Error("platform auth exchange failed");
  }

  return response.body;
}

function parsePayload(payload) {
  if (!payload) {
    return {};
  }
  return JSON.parse(payload);
}
