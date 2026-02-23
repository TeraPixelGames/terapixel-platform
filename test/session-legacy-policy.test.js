import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSessionLegacyPolicy } from "../packages/shared-utils/index.js";

describe("session legacy policy", () => {
  it("defaults to legacy-allowed when no cutoff is configured", () => {
    const policy = resolveSessionLegacyPolicy(
      {
        DEPLOY_ENV: "prod"
      },
      {
        defaultEnvironment: "prod"
      }
    );
    assert.equal(policy.cutoffReached, false);
    assert.equal(policy.allowLegacyHs256, true);
    assert.equal(policy.allowLegacyNakamaSubject, true);
    assert.equal(policy.requireSub, false);
  });

  it("flips to strict mode once cutoff is reached for target environment", () => {
    const policy = resolveSessionLegacyPolicy({
      DEPLOY_ENV: "prod",
      SESSION_LEGACY_CUTOFF_UTC: "2026-05-31T00:00:00Z",
      SESSION_POLICY_NOW_UTC: "2026-06-01T00:00:00Z"
    });
    assert.equal(policy.cutoffReached, true);
    assert.equal(policy.allowLegacyHs256, false);
    assert.equal(policy.allowLegacyNakamaSubject, false);
    assert.equal(policy.requireSub, true);
  });

  it("supports per-environment cutoff overrides", () => {
    const stagingPolicy = resolveSessionLegacyPolicy({
      DEPLOY_ENV: "staging",
      SESSION_LEGACY_CUTOFF_UTC: "2026-09-01T00:00:00Z",
      SESSION_LEGACY_CUTOFF_STAGING_UTC: "2026-04-01T00:00:00Z",
      SESSION_POLICY_NOW_UTC: "2026-05-01T00:00:00Z"
    });
    assert.equal(stagingPolicy.environment, "staging");
    assert.equal(stagingPolicy.cutoffReached, true);
    assert.equal(stagingPolicy.requireSub, true);
    assert.equal(stagingPolicy.allowLegacyHs256, false);
  });

  it("honors explicit env overrides even after cutoff", () => {
    const policy = resolveSessionLegacyPolicy({
      DEPLOY_ENV: "prod",
      SESSION_LEGACY_CUTOFF_UTC: "2026-05-31T00:00:00Z",
      SESSION_POLICY_NOW_UTC: "2026-06-01T00:00:00Z",
      SESSION_ALLOW_LEGACY_HS256: "true",
      SESSION_ALLOW_LEGACY_NAKAMA_SUBJECT: "false",
      SESSION_REQUIRE_SUB: "false"
    });
    assert.equal(policy.cutoffReached, true);
    assert.equal(policy.allowLegacyHs256, true);
    assert.equal(policy.allowLegacyNakamaSubject, false);
    assert.equal(policy.requireSub, false);
  });
});
