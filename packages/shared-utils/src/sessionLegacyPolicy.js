export function resolveSessionLegacyPolicy(env = {}, options = {}) {
  const targetEnv = normalizeEnvironment(
    env.SESSION_POLICY_ENVIRONMENT ||
      env.DEPLOY_ENV ||
      options.defaultEnvironment ||
      "prod"
  );
  const nowMs = resolveNowMs(env.SESSION_POLICY_NOW_UTC);
  const cutoffRaw = resolveCutoffRaw(env, targetEnv);
  const cutoffMs = parseDateMs(cutoffRaw);
  const cutoffReached = Number.isFinite(cutoffMs) && nowMs >= cutoffMs;
  const defaultAllowLegacy = !cutoffReached;
  const defaultRequireSub = cutoffReached;
  return {
    environment: targetEnv,
    cutoffUtc: cutoffRaw || "",
    cutoffReached,
    allowLegacyHs256: parseBooleanWithDefault(
      env.SESSION_ALLOW_LEGACY_HS256,
      defaultAllowLegacy
    ),
    allowLegacyNakamaSubject: parseBooleanWithDefault(
      env.SESSION_ALLOW_LEGACY_NAKAMA_SUBJECT,
      defaultAllowLegacy
    ),
    requireSub: parseBooleanWithDefault(env.SESSION_REQUIRE_SUB, defaultRequireSub)
  };
}

function resolveCutoffRaw(env, targetEnv) {
  if (targetEnv === "prod") {
    return String(
      env.SESSION_LEGACY_CUTOFF_PROD_UTC || env.SESSION_LEGACY_CUTOFF_UTC || ""
    ).trim();
  }
  if (targetEnv === "staging") {
    return String(
      env.SESSION_LEGACY_CUTOFF_STAGING_UTC || env.SESSION_LEGACY_CUTOFF_UTC || ""
    ).trim();
  }
  return String(env.SESSION_LEGACY_CUTOFF_UTC || "").trim();
}

function resolveNowMs(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) {
    return Date.now();
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return Date.now();
  }
  return parsed;
}

function parseDateMs(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) {
    return NaN;
  }
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return NaN;
}

function normalizeEnvironment(value) {
  const out = String(value || "").trim().toLowerCase();
  if (out === "production") {
    return "prod";
  }
  if (out === "stage") {
    return "staging";
  }
  return out || "prod";
}

function parseBooleanWithDefault(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}
