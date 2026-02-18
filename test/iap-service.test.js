import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createIapService, InMemoryIapStore } from "../services/iap-service/index.js";

describe("iap-service", () => {
  const providerRegistry = {
    verifyPurchase: async ({ provider, catalogEntry, payload }) => {
      if (catalogEntry.type === "consumable") {
        return {
          provider,
          externalTransactionId: String(payload.transaction_id || "tx_default"),
          type: "consumable",
          gameId: catalogEntry.gameId,
          coinsDelta: Number(catalogEntry.coins) || 0,
          subscription: null
        };
      }
      return {
        provider,
        externalTransactionId: String(payload.transaction_id || "sub_default"),
        type: "subscription",
        gameId: "",
        coinsDelta: 0,
        subscription: {
          provider,
          externalSubscriptionId: String(payload.transaction_id || "sub_default"),
          status: String(payload.status || "active"),
          active: String(payload.status || "active") == "active",
          expiresAt: Number(payload.expires_at || 0) > 0 ? Number(payload.expires_at) : undefined
        }
      };
    }
  };

  it("is idempotent for repeated transaction", async () => {
    const service = createIapService({
      store: new InMemoryIapStore(),
      providerRegistry
    });
    const first = await service.verifyPurchase({
      profileId: "nk_1",
      provider: "google",
      productId: "coins_500_lumarush",
      exportTarget: "android",
      payload: { transaction_id: "tx_same" }
    });
    const second = await service.verifyPurchase({
      profileId: "nk_1",
      provider: "google",
      productId: "coins_500_lumarush",
      exportTarget: "android",
      payload: { transaction_id: "tx_same" }
    });
    assert.equal(first.deduplicated, false);
    assert.equal(second.deduplicated, true);
    assert.equal(second.entitlements.coins.lumarush.balance, 500);
  });

  it("returns entitlements shape", async () => {
    const service = createIapService({
      store: new InMemoryIapStore(),
      providerRegistry
    });
    await service.verifyPurchase({
      profileId: "nk_2",
      provider: "apple",
      productId: "coins_500_lumarush",
      exportTarget: "ios",
      payload: { transaction_id: "tx_1" }
    });
    const ent = await service.getEntitlements({ profileId: "nk_2" });
    assert.equal(ent.profile_id, "nk_2");
    assert.ok(ent.coins.lumarush);
    assert.equal(typeof ent.no_ads.active, "boolean");
  });

  it("supports color crunch catalog skus", async () => {
    const service = createIapService({
      store: new InMemoryIapStore(),
      providerRegistry
    });
    const purchase = await service.verifyPurchase({
      profileId: "nk_cc_1",
      provider: "paypal_web",
      productId: "coins_500_color_crunch",
      exportTarget: "web",
      payload: { transaction_id: "cc_tx_1" }
    });
    assert.equal(purchase.entitlements.coins.color_crunch.balance, 500);
  });

  it("upserts subscription", async () => {
    const service = createIapService({
      store: new InMemoryIapStore(),
      providerRegistry
    });
    await service.verifyPurchase({
      profileId: "nk_3",
      provider: "apple",
      productId: "no_ads_monthly",
      exportTarget: "ios",
      payload: {
        transaction_id: "sub_1",
        status: "active",
        expires_at: 1_900_000_000
      }
    });
    const ent = await service.getEntitlements({ profileId: "nk_3" });
    assert.equal(ent.no_ads.active, true);
    assert.equal(ent.no_ads.status, "active");
    assert.equal(ent.no_ads.expires_at, 1_900_000_000);
  });

  it("rejects purchase when game_id does not match product catalog game", async () => {
    const service = createIapService({
      store: new InMemoryIapStore(),
      providerRegistry
    });
    await assert.rejects(
      () =>
        service.verifyPurchase({
          profileId: "nk_bad_game_1",
          provider: "paypal_web",
          productId: "coins_500_color_crunch",
          exportTarget: "web",
          gameId: "lumarush",
          payload: { transaction_id: "bad_game_tx_1" }
        }),
      /product_id does not belong to game_id/
    );
  });

  it("uses runtime provider config for per-game credential routing", async () => {
    let capturedProviderConfig = null;
    const runtimeAwareRegistry = {
      verifyPurchase: async ({ provider, catalogEntry, payload, providerConfig, gameId }) => {
        capturedProviderConfig = { ...(providerConfig || {}), gameId };
        return {
          provider,
          externalTransactionId: String(payload.transaction_id || "tx_default"),
          type: "consumable",
          gameId: catalogEntry.gameId,
          coinsDelta: Number(catalogEntry.coins) || 0,
          subscription: null
        };
      }
    };
    const runtimeConfigProvider = {
      async getIapRuntimeConfig() {
        return {
          iapCatalog: {},
          iapProviderConfigs: {
            paypal_web: {
              clientId: "runtime-client-id",
              clientSecret: "runtime-client-secret",
              baseUrl: "https://api-m.sandbox.paypal.com"
            }
          }
        };
      }
    };
    const service = createIapService({
      store: new InMemoryIapStore(),
      providerRegistry: runtimeAwareRegistry,
      runtimeConfigProvider
    });
    const purchase = await service.verifyPurchase({
      profileId: "nk_runtime_cfg_1",
      provider: "paypal_web",
      productId: "coins_500_color_crunch",
      exportTarget: "web",
      gameId: "color_crunch",
      payload: { transaction_id: "runtime_cfg_tx_1" }
    });
    assert.equal(capturedProviderConfig.clientId, "runtime-client-id");
    assert.equal(capturedProviderConfig.clientSecret, "runtime-client-secret");
    assert.equal(capturedProviderConfig.baseUrl, "https://api-m.sandbox.paypal.com");
    assert.equal(capturedProviderConfig.gameId, "color_crunch");
    assert.equal(purchase.entitlements.coins.color_crunch.balance, 500);
  });
});
