export function createPaypalWebProvider(options = {}) {
  const clientId = String(options.clientId || "");
  const clientSecret = String(options.clientSecret || "");
  const baseUrl =
    String(options.baseUrl || "").trim() || "https://api-m.paypal.com";
  const tokenUrl = `${baseUrl}/v1/oauth2/token`;

  return {
    verifyPurchase: async ({ provider, payload, catalogEntry, nowSeconds }) => {
      const orderId = String(payload?.order_id || payload?.orderId || "").trim();
      if (!orderId) {
        throw new Error("paypal payload.order_id is required");
      }
      if (!clientId || !clientSecret) {
        throw new Error("paypal credentials are not configured");
      }
      const token = await getPaypalAccessToken(tokenUrl, clientId, clientSecret);
      const order = await getJson(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`, token);
      const status = String(order?.status || "").toUpperCase();
      if (!["COMPLETED", "APPROVED"].includes(status)) {
        throw new Error(`paypal order not complete (status=${status || "unknown"})`);
      }

      if (catalogEntry.type === "consumable") {
        return {
          provider,
          externalTransactionId: orderId,
          type: "consumable",
          gameId: catalogEntry.gameId,
          coinsDelta: Number(catalogEntry.coins) || 0,
          subscription: null
        };
      }
      const expiresAt = Number(payload?.expires_at || 0);
      const now = normalizeNow(nowSeconds);
      const active = Number.isFinite(expiresAt) ? expiresAt > now : true;
      return {
        provider,
        externalTransactionId: orderId,
        type: "subscription",
        gameId: "",
        coinsDelta: 0,
        subscription: {
          provider,
          externalSubscriptionId: orderId,
          status: active ? "active" : "expired",
          active,
          expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? Math.floor(expiresAt) : undefined
        }
      };
    }
  };
}

async function getPaypalAccessToken(tokenUrl, clientId, clientSecret) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error(`paypal token request failed (${response.status})`);
  }
  return String(json.access_token);
}

async function getJson(url, accessToken) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`paypal verify failed (${response.status})`);
  }
  return json;
}

function normalizeNow(nowSeconds) {
  if (Number.isFinite(Number(nowSeconds)) && Number(nowSeconds) > 0) {
    return Math.floor(Number(nowSeconds));
  }
  return Math.floor(Date.now() / 1000);
}
