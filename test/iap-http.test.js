import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createIapHttpServer,
  createIapService,
  InMemoryIapStore
} from "../services/iap-service/index.js";
import { createSessionToken } from "../packages/shared-utils/index.js";

describe("iap-service http", () => {
  const sessionSecret = "iap-session-secret-12345";
  const providerRegistry = {
    verifyPurchase: async ({ provider, catalogEntry, payload }) => ({
      provider,
      externalTransactionId: String(payload.transaction_id || "http_tx"),
      type: catalogEntry.type,
      gameId: catalogEntry.type === "consumable" ? catalogEntry.gameId : "",
      coinsDelta: catalogEntry.type === "consumable" ? Number(catalogEntry.coins) || 0 : 0,
      subscription:
        catalogEntry.type === "subscription"
          ? {
              provider,
              externalSubscriptionId: String(payload.transaction_id || "sub"),
              status: "active",
              active: true
            }
          : null
    })
  };
  const service = createIapService({
    store: new InMemoryIapStore(),
    providerRegistry
  });
  const httpServer = createIapHttpServer({
    service,
    allowedOrigins: "*",
    sessionSecret,
    sessionIssuer: "terapixel.identity",
    sessionAudience: "terapixel.game",
    adminKey: "internal-key"
  });
  let baseUrl = "";

  before(async () => {
    const listenInfo = await httpServer.listen(0, "127.0.0.1");
    baseUrl = listenInfo.baseUrl;
  });

  after(async () => {
    await httpServer.close();
  });

  it("verifies and returns entitlements", async () => {
    const token = createSessionToken(
      { sub: "legacy", nakama_user_id: "nk_http_1" },
      sessionSecret,
      {
        issuer: "terapixel.identity",
        audience: "terapixel.game",
        ttlSeconds: 600,
        nowSeconds: 1_800_000_000
      }
    );

    const verifyResponse = await fetch(`${baseUrl}/v1/iap/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        provider: "google",
        export_target: "android",
        product_id: "coins_100_lumarush",
        payload: {
          transaction_id: "http_tx_1"
        }
      })
    });
    assert.equal(verifyResponse.status, 200);
    const verifyBody = await verifyResponse.json();
    assert.equal(verifyBody.entitlements.coins.lumarush.balance, 100);

    const getResponse = await fetch(`${baseUrl}/v1/iap/entitlements`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(getResponse.status, 200);
    const getBody = await getResponse.json();
    assert.equal(getBody.profile_id, "nk_http_1");
    assert.equal(getBody.coins.lumarush.balance, 100);
  });

  it("supports internal merge endpoint", async () => {
    const response = await fetch(`${baseUrl}/v1/iap/internal/merge-profile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-key": "internal-key"
      },
      body: JSON.stringify({
        primary_profile_id: "a",
        secondary_profile_id: "b"
      })
    });
    assert.equal(response.status, 200);
  });
});
