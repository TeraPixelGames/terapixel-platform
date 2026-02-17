import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

async function main() {
  const config = readConfig(process.env);
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: config.databaseUrl
  });

  try {
    await ensureMigrationTable(pool);
    const migrations = await loadMigrations(config.migrationsDir);
    if (migrations.length === 0) {
      console.info(JSON.stringify({ event: "migrate_noop", reason: "no_files" }));
      return;
    }

    const applied = await readAppliedMigrations(pool);
    for (const migration of migrations) {
      await applyMigration(pool, migration, applied);
    }
    console.info(JSON.stringify({ event: "migrate_complete", count: migrations.length }));
  } finally {
    await pool.end();
  }
}

function readConfig(env) {
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const migrationsDir = path.resolve(
    process.cwd(),
    env.SQL_MIGRATIONS_DIR || "infra/sql-migrations"
  );
  return { databaseUrl, migrationsDir };
}

async function ensureMigrationTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id TEXT PRIMARY KEY,
      checksum_sha256 TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function loadMigrations(migrationsDir) {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const migrations = [];
  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const sql = await fs.readFile(fullPath, "utf8");
    migrations.push({
      id: file,
      sql,
      checksum: sha256(sql)
    });
  }
  return migrations;
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

async function readAppliedMigrations(pool) {
  const result = await pool.query(
    `SELECT migration_id, checksum_sha256 FROM schema_migrations`
  );
  const out = new Map();
  for (const row of result.rows) {
    out.set(String(row.migration_id), String(row.checksum_sha256));
  }
  return out;
}

async function applyMigration(pool, migration, applied) {
  const previousChecksum = applied.get(migration.id);
  if (previousChecksum) {
    if (previousChecksum !== migration.checksum) {
      throw new Error(
        `migration checksum mismatch for ${migration.id}; expected ${previousChecksum}, got ${migration.checksum}`
      );
    }
    console.info(JSON.stringify({ event: "migrate_skip", migration_id: migration.id }));
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO schema_migrations (migration_id, checksum_sha256) VALUES ($1, $2)`,
      [migration.id, migration.checksum]
    );
    await client.query("COMMIT");
    console.info(JSON.stringify({ event: "migrate_apply", migration_id: migration.id }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
