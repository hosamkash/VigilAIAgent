/**
 * Live SQL Server + PostgreSQL connector for Support / DB Copilot.
 * Passwords are never stored here — pass per connect (from OS keychain / UI).
 */

import { applyRowLimit, classifySql, isReadOnlyMode } from "./sql-safety.mjs";
import { getDbProfile, listDbProfiles, saveDbProfile } from "./db-profiles.mjs";
import {
  getCaptureStatus,
  sql_activity_live as activityLive,
  sql_capture_list as captureList,
  sql_capture_start as captureStart,
  sql_capture_stop as captureStop,
} from "./sql-activity.mjs";

/** @type {null | {
 *   engine: 'mssql' | 'postgres',
 *   profileId: string | null,
 *   label: string,
 *   database: string | null,
 *   readOnly: boolean,
 *   pool: any,
 *   mssql?: any,
 * }} */
let session = null;

export function getSqlSession() {
  if (!session) {
    return {
      connected: false,
      engine: null,
      profileId: null,
      label: null,
      database: null,
      readOnly: true,
    };
  }
  return {
    connected: true,
    engine: session.engine,
    profileId: session.profileId,
    label: session.label,
    database: session.database,
    readOnly: session.readOnly,
  };
}

async function closePool() {
  if (!session) return;
  try {
    if (session.engine === "mssql" && session.pool) {
      await session.pool.close();
    } else if (session.engine === "postgres" && session.pool) {
      await session.pool.end();
    }
  } catch {
    /* ignore */
  }
  session = null;
}

/**
 * @param {object} input
 * @param {string} [cwd]
 */
export async function sql_connect(input = {}, cwd = process.cwd()) {
  const profileId = String(input.profileId || input.profile || "").trim();
  let engine = String(input.engine || "").trim().toLowerCase();
  let host = String(input.host || "").trim();
  let port = input.port != null ? Number(input.port) : undefined;
  let database = String(input.database || "").trim() || "";
  let username = String(input.username || input.user || "").trim();
  let instance = String(input.instance || "").trim();
  let encrypt = input.encrypt !== false;
  let trustServerCertificate = input.trustServerCertificate === true;
  let sslMode = String(input.sslMode || "prefer").trim();
  let label = String(input.label || input.name || "").trim();
  const password = String(
    input.password || process.env.VIGIL_SQL_PASSWORD || "",
  );
  const readOnly = isReadOnlyMode(
    input.mode || (input.readOnly === false ? "write" : "read"),
  );

  if (profileId) {
    const profile = await getDbProfile(cwd, profileId);
    if (!profile) {
      return { ok: false, error: `DB profile not found: ${profileId}` };
    }
    engine = profile.engine;
    host = profile.host;
    port = profile.port;
    database = profile.database || database;
    username = profile.username;
    instance = profile.instance || "";
    encrypt = profile.encrypt !== false;
    trustServerCertificate = profile.trustServerCertificate === true;
    sslMode = profile.sslMode || sslMode;
    label = profile.name;
  }

  if (!engine || (engine !== "mssql" && engine !== "postgres")) {
    return { ok: false, error: "engine must be mssql or postgres" };
  }
  if (!host || !username) {
    return { ok: false, error: "host and username are required" };
  }
  if (!password) {
    return {
      ok: false,
      error:
        "password required (pass password arg, or save in OS keychain and pass from UI, or VIGIL_SQL_PASSWORD).",
    };
  }

  await closePool();

  try {
    if (engine === "mssql") {
      const sql = await import("mssql");
      const config = {
        server: host,
        port: port || 1433,
        user: username,
        password,
        database: database || undefined,
        options: {
          encrypt,
          trustServerCertificate,
          enableArithAbort: true,
          instanceName: instance || undefined,
        },
        connectionTimeout: 15000,
        requestTimeout: 30000,
        pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
      };
      const pool = await new sql.default.ConnectionPool(config).connect();
      session = {
        engine: "mssql",
        profileId: profileId || null,
        label: label || `${host}/${database || "default"}`,
        database: database || null,
        readOnly,
        pool,
        mssql: sql.default,
      };
    } else {
      const pg = await import("pg");
      const pool = new pg.default.Pool({
        host,
        port: port || 5432,
        user: username,
        password,
        database: database || "postgres",
        ssl:
          sslMode === "disable"
            ? false
            : sslMode === "require" || sslMode === "verify-full"
              ? { rejectUnauthorized: sslMode === "verify-full" }
              : undefined,
        connectionTimeoutMillis: 15000,
        max: 5,
      });
      await pool.query("select 1 as ok");
      session = {
        engine: "postgres",
        profileId: profileId || null,
        label: label || `${host}/${database || "postgres"}`,
        database: database || "postgres",
        readOnly,
        pool,
      };
    }
  } catch (err) {
    session = null;
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    ok: true,
    output: `Connected (${session.engine}) · ${session.label}${session.readOnly ? " · read-only" : ""}`,
    session: getSqlSession(),
  };
}

export async function sql_disconnect() {
  await closePool();
  return { ok: true, output: "Disconnected", session: getSqlSession() };
}

export async function sql_test_connection(input = {}, cwd = process.cwd()) {
  const result = await sql_connect(input, cwd);
  if (!result.ok) return result;
  const info = getSqlSession();
  await sql_disconnect();
  return {
    ok: true,
    output: `Test OK · ${info.engine} · ${info.label}`,
  };
}

function requireSession() {
  if (!session) {
    return { ok: false, error: "Not connected. Call sql_connect first." };
  }
  return null;
}

export async function sql_list_databases() {
  const err = requireSession();
  if (err) return err;
  try {
    if (session.engine === "mssql") {
      const r = await session.pool
        .request()
        .query(
          "SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name",
        );
      const names = (r.recordset || []).map((row) => row.name);
      return {
        ok: true,
        output: names.length
          ? names.map((n) => `- ${n}`).join("\n")
          : "(no user databases)",
        databases: names,
      };
    }
    const r = await session.pool.query(
      "SELECT datname AS name FROM pg_database WHERE datistemplate = false ORDER BY datname",
    );
    const names = (r.rows || []).map((row) => row.name);
    return {
      ok: true,
      output: names.map((n) => `- ${n}`).join("\n"),
      databases: names,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sql_list_objects(input = {}) {
  const err = requireSession();
  if (err) return err;
  const schema = String(input.schema || "").trim();
  const kind = String(input.kind || "table").toLowerCase();
  try {
    if (session.engine === "mssql") {
      const schemaFilter = schema
        ? `AND TABLE_SCHEMA = N'${schema.replace(/'/g, "''")}'`
        : "";
      const type =
        kind === "view" ? "VIEW" : kind === "all" ? null : "BASE TABLE";
      const typeSql = type
        ? `AND TABLE_TYPE = '${type}'`
        : "AND TABLE_TYPE IN ('BASE TABLE','VIEW')";
      const r = await session.pool.request().query(`
        SELECT TOP (200) TABLE_SCHEMA AS s, TABLE_NAME AS n, TABLE_TYPE AS t
        FROM INFORMATION_SCHEMA.TABLES
        WHERE 1=1 ${schemaFilter} ${typeSql}
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `);
      const rows = r.recordset || [];
      return {
        ok: true,
        output: rows
          .map((row) => `- ${row.s}.${row.n} (${row.t})`)
          .join("\n") || "(none)",
        objects: rows.map((row) => ({
          schema: row.s,
          name: row.n,
          type: row.t,
        })),
      };
    }
    const schemaFilter = schema
      ? `AND table_schema = '${schema.replace(/'/g, "''")}'`
      : "AND table_schema NOT IN ('pg_catalog','information_schema')";
    const typeSql =
      kind === "view"
        ? "AND table_type = 'VIEW'"
        : kind === "all"
          ? ""
          : "AND table_type = 'BASE TABLE'";
    const r = await session.pool.query(`
      SELECT table_schema AS s, table_name AS n, table_type AS t
      FROM information_schema.tables
      WHERE 1=1 ${schemaFilter} ${typeSql}
      ORDER BY table_schema, table_name
      LIMIT 200
    `);
    const rows = r.rows || [];
    return {
      ok: true,
      output: rows
        .map((row) => `- ${row.s}.${row.n} (${row.t})`)
        .join("\n") || "(none)",
      objects: rows.map((row) => ({
        schema: row.s,
        name: row.n,
        type: row.t,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sql_describe_table(input = {}) {
  const err = requireSession();
  if (err) return err;
  const table = String(input.table || input.name || "").trim();
  if (!table) return { ok: false, error: "table is required (schema.table or table)" };
  let schema = String(input.schema || "").trim();
  let name = table;
  if (table.includes(".")) {
    const parts = table.split(".");
    schema = parts[0];
    name = parts.slice(1).join(".");
  }
  try {
    if (session.engine === "mssql") {
      const schemaSql = schema
        ? `AND c.TABLE_SCHEMA = N'${schema.replace(/'/g, "''")}'`
        : "";
      const r = await session.pool.request().query(`
        SELECT c.TABLE_SCHEMA AS s, c.COLUMN_NAME AS col, c.DATA_TYPE AS typ,
               c.IS_NULLABLE AS nullable, c.CHARACTER_MAXIMUM_LENGTH AS len
        FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_NAME = N'${name.replace(/'/g, "''")}' ${schemaSql}
        ORDER BY c.ORDINAL_POSITION
      `);
      const rows = r.recordset || [];
      if (!rows.length) return { ok: false, error: `Table not found: ${table}` };
      return {
        ok: true,
        output: rows
          .map(
            (row) =>
              `- ${row.s}.${name}.${row.col} ${row.typ}${row.len != null ? `(${row.len})` : ""} ${row.nullable === "YES" ? "NULL" : "NOT NULL"}`,
          )
          .join("\n"),
        columns: rows,
      };
    }
    const schemaSql = schema
      ? `AND table_schema = '${schema.replace(/'/g, "''")}'`
      : "AND table_schema NOT IN ('pg_catalog','information_schema')";
    const r = await session.pool.query(`
      SELECT table_schema AS s, column_name AS col, data_type AS typ,
             is_nullable AS nullable, character_maximum_length AS len
      FROM information_schema.columns
      WHERE table_name = '${name.replace(/'/g, "''")}' ${schemaSql}
      ORDER BY ordinal_position
    `);
    const rows = r.rows || [];
    if (!rows.length) return { ok: false, error: `Table not found: ${table}` };
    return {
      ok: true,
      output: rows
        .map(
          (row) =>
            `- ${row.s}.${name}.${row.col} ${row.typ}${row.len != null ? `(${row.len})` : ""} ${row.nullable === "YES" ? "NULL" : "NOT NULL"}`,
        )
        .join("\n"),
      columns: rows,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sql_run(input = {}) {
  const err = requireSession();
  if (err) return err;
  const sqlText = String(input.sql || input.query || "").trim();
  const maxRows = Math.min(Math.max(Number(input.maxRows) || 100, 1), 500);
  if (session.readOnly) {
    const gate = classifySql(sqlText);
    if (!gate.ok) return gate;
  }
  const limited = applyRowLimit(sqlText, session.engine, maxRows);
  try {
    if (session.engine === "mssql") {
      const r = await session.pool.request().query(limited);
      const rows = r.recordset || [];
      const preview = rows.slice(0, maxRows);
      return {
        ok: true,
        output: formatResult(preview, rows.length),
        rowCount: rows.length,
        rows: preview,
      };
    }
    const r = await session.pool.query(limited);
    const rows = r.rows || [];
    const preview = rows.slice(0, maxRows);
    return {
      ok: true,
      output: formatResult(preview, rows.length),
      rowCount: rows.length,
      rows: preview,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function formatResult(rows, total) {
  if (!rows.length) return `(0 rows)`;
  const keys = Object.keys(rows[0] || {});
  const header = keys.join(" | ");
  const lines = rows.slice(0, 40).map((row) =>
    keys
      .map((k) => {
        const v = row[k];
        if (v == null) return "NULL";
        const s = String(v);
        return s.length > 80 ? `${s.slice(0, 77)}…` : s;
      })
      .join(" | "),
  );
  const more =
    total > lines.length ? `\n… ${total - lines.length} more row(s)` : "";
  return `${header}\n${"-".repeat(Math.min(header.length, 80))}\n${lines.join("\n")}${more}\n(${total} row(s))`;
}

export async function sql_activity_live(input = {}) {
  const err = requireSession();
  if (err) return err;
  return activityLive(session, input);
}

export async function sql_capture_start(input = {}) {
  const err = requireSession();
  if (err) return err;
  return captureStart(session, input);
}

export async function sql_capture_stop() {
  return captureStop(session);
}

export async function sql_capture_list() {
  return captureList();
}

export function getSqlCaptureStatus() {
  return getCaptureStatus();
}

export {
  listDbProfiles,
  saveDbProfile,
  getDbProfile,
};
