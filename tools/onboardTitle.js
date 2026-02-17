import pg from "pg";
import { PostgresControlPlaneStore } from "../services/control-plane/index.js";
const { Pool } = pg;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const databaseUrl = requiredValue(
    args.databaseUrl || process.env.DATABASE_URL,
    "DATABASE_URL or --database-url is required"
  );
  const encryptionKey =
    String(args.encryptionKey || process.env.PLATFORM_CONFIG_ENCRYPTION_KEY || "").trim();
  const tenantSlug = String(args.tenantSlug || "terapixel").trim();
  const tenantName = String(args.tenantName || "TeraPixel").trim();
  const gameId = requiredValue(args.gameId, "--game-id is required");
  const titleName = String(args.titleName || gameId).trim();
  const environments = parseEnvironments(args.environments || "staging,prod");

  const pool = new Pool({
    connectionString: databaseUrl
  });
  const store = new PostgresControlPlaneStore({
    pool,
    encryptionKey
  });

  try {
    const title = await store.onboardTitle({
      tenantSlug,
      tenantName,
      gameId,
      titleName,
      environments
    });

    const notifyTargets = [];
    for (const environment of environments) {
      const notifyInput = resolveNotifyInput(args, environment);
      if (!notifyInput) {
        continue;
      }
      if (!encryptionKey) {
        throw new Error(
          "PLATFORM_CONFIG_ENCRYPTION_KEY is required when writing notify targets"
        );
      }
      const target = await store.upsertMagicLinkNotifyTarget({
        gameId,
        environment,
        notifyUrl: notifyInput.notifyUrl,
        notifyHttpKey: notifyInput.notifyHttpKey,
        sharedSecret: notifyInput.sharedSecret,
        status: "active",
        metadata: {
          managedBy: "tools/onboardTitle.js"
        }
      });
      notifyTargets.push({
        environment: target.environment,
        notifyUrl: target.notifyUrl,
        status: target.status
      });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          title,
          notifyTargets
        },
        null,
        2
      )
    );
  } finally {
    await store.close();
  }
}

function resolveNotifyInput(args, environment) {
  const prefix = environment === "prod" ? "prod" : "staging";
  const baseUrlKey = `${prefix}NakamaBaseUrl`;
  const directNotifyUrlKey = `${prefix}NotifyUrl`;
  const httpKeyKey = `${prefix}NotifyHttpKey`;
  const sharedSecretKey = `${prefix}SharedSecret`;

  const baseUrl = String(args[baseUrlKey] || "").trim();
  const directNotifyUrl = String(args[directNotifyUrlKey] || "").trim();
  const notifyUrl = directNotifyUrl || deriveNotifyUrl(baseUrl);
  const notifyHttpKey = String(args[httpKeyKey] || "").trim();
  const sharedSecret = String(args[sharedSecretKey] || "").trim();

  if (!notifyUrl && !notifyHttpKey && !sharedSecret) {
    return null;
  }
  if (!notifyUrl || !notifyHttpKey || !sharedSecret) {
    throw new Error(
      `${environment} notify target is partial. Provide all of: ` +
        `--${toKebabCase(directNotifyUrlKey)} (or --${toKebabCase(baseUrlKey)}), ` +
        `--${toKebabCase(httpKeyKey)}, --${toKebabCase(sharedSecretKey)}`
    );
  }
  return {
    notifyUrl,
    notifyHttpKey,
    sharedSecret
  };
}

function deriveNotifyUrl(baseUrl) {
  const root = String(baseUrl || "").trim();
  if (!root) {
    return "";
  }
  return `${root.replace(/\/+$/, "")}/v2/rpc/tpx_account_magic_link_notify`;
}

function parseEnvironments(raw) {
  const values = String(raw || "")
    .split(",")
    .map((it) => it.trim().toLowerCase())
    .filter(Boolean);
  const out = [];
  for (const value of values) {
    if (value !== "staging" && value !== "prod") {
      throw new Error("environments must contain only staging/prod");
    }
    if (!out.includes(value)) {
      out.push(value);
    }
  }
  if (!out.length) {
    return ["staging", "prod"];
  }
  return out;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = String(argv[i] || "");
    if (!raw.startsWith("--")) {
      continue;
    }
    const token = raw.slice(2);
    if (!token) {
      continue;
    }
    const eqIndex = token.indexOf("=");
    if (eqIndex >= 0) {
      const key = toCamelCase(token.slice(0, eqIndex));
      const value = token.slice(eqIndex + 1);
      out[key] = value;
      continue;
    }
    const key = toCamelCase(token);
    const next = argv[i + 1];
    if (next && !String(next).startsWith("--")) {
      out[key] = String(next);
      i += 1;
      continue;
    }
    out[key] = true;
  }
  return out;
}

function toCamelCase(value) {
  return String(value || "")
    .trim()
    .replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
}

function toKebabCase(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

function requiredValue(value, message) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(message);
  }
  return text;
}

function printUsage() {
  console.log(`Usage:
  node tools/onboardTitle.js \\
    --game-id color_crunch \\
    --title-name "Color Crunch" \\
    --tenant-slug terapixel \\
    --tenant-name "TeraPixel" \\
    --environments staging,prod \\
    --staging-nakama-base-url https://colorcrunch-staging-nakama.onrender.com \\
    --staging-notify-http-key <staging_http_key> \\
    --staging-shared-secret <staging_notify_secret> \\
    --prod-nakama-base-url https://colorcrunch-nakama.onrender.com \\
    --prod-notify-http-key <prod_http_key> \\
    --prod-shared-secret <prod_notify_secret>

Options:
  --database-url                Defaults to DATABASE_URL
  --encryption-key              Defaults to PLATFORM_CONFIG_ENCRYPTION_KEY
  --tenant-slug                Defaults to terapixel
  --tenant-name                Defaults to TeraPixel
  --game-id                    Required
  --title-name                 Defaults to game_id
  --environments               CSV of staging/prod (default staging,prod)

Notify target options per environment:
  --<env>-nakama-base-url      Base Nakama URL, auto-derives /v2/rpc/tpx_account_magic_link_notify
  --<env>-notify-url           Full notify URL (overrides derived URL)
  --<env>-notify-http-key      Nakama runtime http key
  --<env>-shared-secret        TPX_MAGIC_LINK_NOTIFY_SECRET

Example env values:
  env=staging or prod`);
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: String(error?.message || error)
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
