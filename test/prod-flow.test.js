import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createIdentityGatewayHttpServer,
  createIdentityGatewayService
} from "../services/identity-gateway/index.js";
import {
  createSaveHttpServer,
  createSaveService,
  InMemorySaveStore
} from "../services/save-service/index.js";
import {
  createSignedJwt,
  createStaticKeyStore,
  generateRsaKeyPair
} from "../tools/test-helpers/jwtTestUtils.js";

describe("production flow", () => {
  const sessionSecret = "prod-flow-session-secret-12345";
  const { privateKey, publicKey } = generateRsaKeyPair();
  const keyStore = createStaticKeyStore(publicKey, "kid-prod-flow");
  const identityService = createIdentityGatewayService({
    sessionSecret,
    sessionIssuer: "terapixel.identity",
    sessionAudience: "terapixel.game"
  });
  const identityServer = createIdentityGatewayHttpServer({
    service: identityService,
    authConfig: {
      keyStore,
      expectedIssuer: "https://auth.crazygames.com",
      expectedAudience: "lumarush"
    }
  });
  const saveService = createSaveService({
    saveStore: new InMemorySaveStore()
  });
  const saveServer = createSaveHttpServer({
    service: saveService,
    sessionSecret,
    sessionIssuer: "terapixel.identity",
    sessionAudience: "terapixel.game"
  });

  let identityBaseUrl = "";
  let saveBaseUrl = "";

  before(async () => {
    identityBaseUrl = (await identityServer.listen(0, "127.0.0.1")).baseUrl;
    saveBaseUrl = (await saveServer.listen(0, "127.0.0.1")).baseUrl;
  });

  after(async () => {
    await identityServer.close();
    await saveServer.close();
  });

  it("authenticates then syncs save with session token", async () => {
    const now = 1_800_000_000;
    const providerToken = createSignedJwt(
      {
        userId: "cg_player_prod",
        username: "Prod Flow User",
        iss: "https://auth.crazygames.com",
        aud: "lumarush",
        exp: now + 300
      },
      { privateKey, kid: "kid-prod-flow" }
    );
    const authResponse = await fetch(`${identityBaseUrl}/v1/auth/crazygames`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        token: providerToken,
        nowSeconds: now
      })
    });
    assert.equal(authResponse.status, 200);
    const authBody = await authResponse.json();
    assert.ok(authBody.session_token);

    const syncResponse = await fetch(`${saveBaseUrl}/v1/save/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${authBody.session_token}`
      },
      body: JSON.stringify({
        game_id: "lumarush",
        now_seconds: now + 1
      })
    });
    assert.equal(syncResponse.status, 200);
    const syncBody = await syncResponse.json();
    assert.equal(syncBody.envelope.profile_id, authBody.player_id);
    assert.equal(syncBody.source, "created_default");
  });
});
