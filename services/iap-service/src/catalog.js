const DEFAULT_CATALOG = {
  consumables: {
    "coins_100_lumarush": {
      gameId: "lumarush",
      coins: 100,
      price: 0.99,
      currency: "USD"
    },
    "coins_550_lumarush": {
      gameId: "lumarush",
      coins: 550,
      price: 3.99,
      currency: "USD"
    }
  },
  subscriptions: {
    "no_ads_monthly": {
      entitlementKey: "no_ads",
      plan: "monthly"
    },
    "no_ads_yearly": {
      entitlementKey: "no_ads",
      plan: "yearly"
    }
  }
};

export function createCatalog(seed = {}) {
  const merged = {
    consumables: {
      ...DEFAULT_CATALOG.consumables,
      ...(seed.consumables || {})
    },
    subscriptions: {
      ...DEFAULT_CATALOG.subscriptions,
      ...(seed.subscriptions || {})
    }
  };
  return deepClone(merged);
}

export function resolveCatalogEntry(catalog, productId) {
  const key = String(productId || "").trim().toLowerCase();
  if (!key) {
    return null;
  }
  const consumable = catalog?.consumables?.[key];
  if (consumable) {
    return {
      type: "consumable",
      productId: key,
      ...consumable
    };
  }
  const sub = catalog?.subscriptions?.[key];
  if (sub) {
    return {
      type: "subscription",
      productId: key,
      ...sub
    };
  }
  return null;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
