import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createControlPlaneHttpServer } from "../services/control-plane/index.js";

describe("control-plane http", () => {
  const calls = [];
  const store = {
    async getRuntimeIdentityConfig({ gameId, environment }) {
      if (gameId !== "color_crunch" || environment !== "prod") {
        return null;
      }
      return {
        gameId,
        environment,
        notifyTarget: {
          notifyUrl: "https://colorcrunch-nakama.onrender.com/v2/rpc/tpx_account_magic_link_notify",
          notifyHttpKey: "http-key",
          sharedSecret: "secret"
        }
      };
    },
    async upsertAdminUserFromGoogle(claims) {
      return {
        adminUserId: "admin_1",
        email: claims.email,
        displayName: claims.displayName,
        role: "platform_owner"
      };
    },
    async listTitles() {
      calls.push("listTitles");
      return [{ gameId: "color_crunch", environment: "prod" }];
    },
    async onboardTitle(input) {
      calls.push("onboardTitle");
      return {
        tenantId: "tenant_1",
        titleId: "title_1",
        tenantSlug: input.tenantSlug,
        tenantName: input.tenantName,
        gameId: input.gameId,
        titleName: input.titleName,
        environments: input.environments || ["staging", "prod"]
      };
    },
    async writeAudit() {
      calls.push("writeAudit");
    },
    async setTitleStatus() {
      calls.push("setTitleStatus");
      return {
        titleId: "title_1",
        gameId: "color_crunch",
        titleName: "Color Crunch",
        status: "offboarded",
        offboardedAt: ""
      };
    },
    async upsertMagicLinkNotifyTarget() {
      calls.push("upsertMagicLinkNotifyTarget");
      return {
        gameId: "color_crunch",
        environment: "prod",
        notifyUrl: "https://colorcrunch-nakama.onrender.com/v2/rpc/tpx_account_magic_link_notify",
        status: "active",
        metadata: {}
      };
    },
    async upsertServiceEndpoint() {
      calls.push("upsertServiceEndpoint");
      return {
        gameId: "color_crunch",
        environment: "prod",
        serviceKey: "identity_gateway",
        baseUrl: "https://identity.terapixel.games",
        healthcheckUrl: "",
        status: "active",
        metadata: {}
      };
    },
    async publishFeatureFlagsVersion() {
      calls.push("publishFeatureFlagsVersion");
      return {
        gameId: "color_crunch",
        environment: "prod",
        versionNumber: 1,
        status: "active",
        flags: {}
      };
    },
    async publishIapCatalogVersion() {
      calls.push("publishIapCatalogVersion");
      return {
        gameId: "color_crunch",
        environment: "prod",
        versionNumber: 1,
        status: "active",
        catalog: {}
      };
    },
    async upsertIapSchedule() {
      calls.push("upsertIapSchedule");
      return {
        gameId: "color_crunch",
        environment: "prod",
        scheduleName: "launch",
        status: "active",
        payload: {}
      };
    },
    async upsertIapProviderConfig() {
      calls.push("upsertIapProviderConfig");
      return {
        gameId: "color_crunch",
        environment: "prod",
        providerKey: "paypal_web",
        baseUrl: "https://api-m.sandbox.paypal.com",
        status: "active",
        metadata: {},
        hasClientId: true,
        hasClientSecret: true
      };
    },
    async listServiceEvents() {
      calls.push("listServiceEvents");
      return [];
    }
  };

  const auth = {
    bootstrapEmails: ["admin@terapixel.games"],
    async verifyIdToken(token) {
      assert.equal(token, "test-token");
      return {
        googleSub: "google-sub-1",
        email: "admin@terapixel.games",
        displayName: "Admin User"
      };
    }
  };

  const server = createControlPlaneHttpServer({
    store,
    auth,
    internalServiceKey: "internal-key",
    allowedOrigins: "*"
  });

  let baseUrl = "";
  before(async () => {
    const listenInfo = await server.listen(0, "127.0.0.1");
    baseUrl = listenInfo.baseUrl;
  });

  after(async () => {
    await server.close();
  });

  it("serves internal runtime config with internal key", async () => {
    const response = await fetch(
      `${baseUrl}/v1/internal/runtime/identity-config?game_id=color_crunch&environment=prod`,
      {
        headers: {
          "x-admin-key": "internal-key"
        }
      }
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.config.gameId, "color_crunch");
  });

  it("serves admin title list with bearer auth", async () => {
    const response = await fetch(`${baseUrl}/v1/admin/titles`, {
      headers: {
        authorization: "Bearer test-token"
      }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(Array.isArray(body.titles), true);
    assert.ok(calls.includes("listTitles"));
  });

  it("upserts iap provider config", async () => {
    const response = await fetch(
      `${baseUrl}/v1/admin/titles/color_crunch/environments/prod/iap-providers/paypal_web`,
      {
        method: "PUT",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          client_id: "paypal_client_id",
          client_secret: "paypal_client_secret",
          base_url: "https://api-m.sandbox.paypal.com",
          status: "active"
        })
      }
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.iap_provider.providerKey, "paypal_web");
    assert.ok(calls.includes("upsertIapProviderConfig"));
  });
});
