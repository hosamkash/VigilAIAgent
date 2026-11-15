/**
 * Live SQL Server + PostgreSQL connector for Support / DB Copilot.
 * Passwords are never stored here — pass per connect (from OS keychain / UI).
 */

import { applyRowLimit, classifySql, isReadOnlyMode } from "./sql-safety.mjs";
import {
  getDbProfile,
  listDbProfiles,
  patchDbProfile,
  saveDbProfile,
} from "./db-profiles.mjs";
import {
  isSafeDbName,
  quoteIdent,
  synthesizeCreateTable,
} from "./sql-ident.mjs";
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
 *   creds?: {
 *     engine: 'mssql' | 'postgres',
 *     host: string,
 *     port?: number,
 *     username: string,
 *     password: string,
 *     instance?: string,
 *     encrypt?: boolean,
 *     trustServerCertificate?: boolean,
 *     sslMode?: string,
 *     profileId: string | null,
 *     label: string,
 *   },
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
  const databaseExplicit = Boolean(String(input.database || "").trim());
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
    // Prefer explicit database (e.g. sql_use_database) over profile default.
    if (!databaseExplicit) database = profile.database || database;
    username = profile.username;
    instance = profile.instance || "";
    encrypt = profile.encrypt !== false;
    trustServerCertificate = profile.trustServerCertificate === true;
    sslMode = profile.sslMode || sslMode;
    if (!label) label = profile.name;
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
      const resolvedLabel = label || `${host}/${database || "default"}`;
      session = {
        engine: "mssql",
        profileId: profileId || null,
        label: resolvedLabel,
        database: database || null,
        readOnly,
        pool,
        mssql: sql.default,
        creds: {
          engine: "mssql",
          host,
          port: port || 1433,
          username,
          password,
          instance: instance || undefined,
          encrypt,
          trustServerCertificate,
          profileId: profileId || null,
          label: resolvedLabel,
        },
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
      const resolvedLabel = label || `${host}/${database || "postgres"}`;
      session = {
        engine: "postgres",
        profileId: profileId || null,
        label: resolvedLabel,
        database: database || "postgres",
        readOnly,
        pool,
        creds: {
          engine: "postgres",
          host,
          port: port || 5432,
          username,
          password,
          sslMode,
          profileId: profileId || null,
          label: resolvedLabel,
        },
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
  const wantTables =
    kind === "table" || kind === "all" || kind === "view";
  const wantRoutines =
    kind === "all" ||
    kind === "procedure" ||
    kind === "proc" ||
    kind === "function" ||
    kind === "routine";
  try {
    /** @type {Array<{ schema: string, name: string, type: string }>} */
    const objects = [];

    if (session.engine === "mssql") {
      if (wantTables && kind !== "procedure" && kind !== "proc" && kind !== "function" && kind !== "routine") {
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
        for (const row of r.recordset || []) {
          objects.push({ schema: row.s, name: row.n, type: row.t });
        }
      }
      if (wantRoutines) {
        const schemaFilter = schema
          ? `AND ROUTINE_SCHEMA = N'${schema.replace(/'/g, "''")}'`
          : "";
        const typeFilter =
          kind === "function"
            ? "AND ROUTINE_TYPE = 'FUNCTION'"
            : kind === "procedure" || kind === "proc"
              ? "AND ROUTINE_TYPE = 'PROCEDURE'"
              : "AND ROUTINE_TYPE IN ('PROCEDURE','FUNCTION')";
        const r = await session.pool.request().query(`
          SELECT TOP (100) ROUTINE_SCHEMA AS s, ROUTINE_NAME AS n, ROUTINE_TYPE AS t
          FROM INFORMATION_SCHEMA.ROUTINES
          WHERE 1=1 ${schemaFilter} ${typeFilter}
          ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
        `);
        for (const row of r.recordset || []) {
          objects.push({ schema: row.s, name: row.n, type: row.t });
        }
      }
    } else {
      if (wantTables && kind !== "procedure" && kind !== "proc" && kind !== "function" && kind !== "routine") {
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
        for (const row of r.rows || []) {
          objects.push({ schema: row.s, name: row.n, type: row.t });
        }
      }
      if (wantRoutines) {
        const schemaFilter = schema
          ? `AND n.nspname = '${schema.replace(/'/g, "''")}'`
          : "AND n.nspname NOT IN ('pg_catalog','information_schema')";
        const r = await session.pool.query(`
          SELECT n.nspname AS s, p.proname AS n,
                 CASE p.prokind
                   WHEN 'f' THEN 'FUNCTION'
                   WHEN 'p' THEN 'PROCEDURE'
                   WHEN 'a' THEN 'AGGREGATE'
                   ELSE 'ROUTINE'
                 END AS t
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE 1=1 ${schemaFilter}
            AND p.prokind IN ('f','p')
          ORDER BY n.nspname, p.proname
          LIMIT 100
        `);
        for (const row of r.rows || []) {
          if (kind === "function" && row.t !== "FUNCTION") continue;
          if ((kind === "procedure" || kind === "proc") && row.t !== "PROCEDURE")
            continue;
          objects.push({ schema: row.s, name: row.n, type: row.t });
        }
      }
    }

    objects.sort((a, b) =>
      `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`),
    );
    return {
      ok: true,
      output: objects.length
        ? objects.map((o) => `- ${o.schema}.${o.name} (${o.type})`).join("\n")
        : "(none)",
      objects,
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

/**
 * Switch active database by reconnecting with cached session credentials.
 */
export async function sql_use_database(input = {}) {
  const err = requireSession();
  if (err) return err;
  const database = String(input.database || input.name || "").trim();
  if (!isSafeDbName(database)) {
    return { ok: false, error: "Invalid database name." };
  }
  if (session.database === database) {
    return {
      ok: true,
      output: `Already using database ${database}`,
      session: getSqlSession(),
    };
  }
  if (!session.creds?.password) {
    return {
      ok: false,
      error: "Cannot switch database — reconnect with a saved profile/password.",
    };
  }
  const creds = session.creds;
  const readOnly = session.readOnly;
  const hostLabel = String(creds.label || "").split("/")[0] || creds.host;
  return sql_connect({
    engine: creds.engine,
    host: creds.host,
    port: creds.port,
    username: creds.username,
    password: creds.password,
    instance: creds.instance,
    encrypt: creds.encrypt,
    trustServerCertificate: creds.trustServerCertificate,
    sslMode: creds.sslMode,
    profileId: creds.profileId || undefined,
    database,
    mode: readOnly ? "read" : "write",
    label: `${hostLabel}/${database}`,
  });
}

/**
 * Toggle read-only vs write. Write requires confirm: true.
 */
export async function sql_set_mode(input = {}) {
  const err = requireSession();
  if (err) return err;
  const modeRaw = String(input.mode || "").toLowerCase();
  const wantWrite =
    modeRaw === "write" ||
    input.readOnly === false ||
    String(input.readOnly).toLowerCase() === "false";

  if (wantWrite) {
    const confirmed =
      input.confirm === true ||
      String(input.confirm || "").toLowerCase() === "yes" ||
      String(input.confirm || "").toLowerCase() === "true";
    if (!confirmed) {
      return {
        ok: false,
        error:
          "Write mode requires confirm: true (INSERT/UPDATE/DELETE/DDL will be allowed).",
      };
    }
    session.readOnly = false;
    return {
      ok: true,
      output:
        "Write mode ON — destructive SQL allowed on this session. Switch back to read when done.",
      session: getSqlSession(),
    };
  }

  session.readOnly = true;
  return {
    ok: true,
    output: "Read-only mode restored.",
    session: getSqlSession(),
  };
}

/**
 * Script object DDL (view/proc/function definition, or synthesized CREATE TABLE).
 */
export async function sql_get_object_ddl(input = {}) {
  const err = requireSession();
  if (err) return err;
  const raw = String(input.table || input.name || input.object || "").trim();
  if (!raw) return { ok: false, error: "name/table is required" };
  let schema = String(input.schema || "").trim();
  let name = raw;
  if (raw.includes(".")) {
    const parts = raw.split(".");
    schema = parts[0];
    name = parts.slice(1).join(".");
  }
  if (!schema) schema = session.engine === "postgres" ? "public" : "dbo";
  const kind = String(input.kind || input.type || "auto").toLowerCase();

  try {
    if (session.engine === "mssql") {
      if (kind === "table" || kind === "auto") {
        const mod = await session.pool.request().query(`
          SELECT m.definition AS def, o.type_desc AS typ
          FROM sys.objects o
          JOIN sys.schemas s ON o.schema_id = s.schema_id
          LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id
          WHERE s.name = N'${schema.replace(/'/g, "''")}'
            AND o.name = N'${name.replace(/'/g, "''")}'
        `);
        const hit = (mod.recordset || [])[0];
        if (hit?.def) {
          return {
            ok: true,
            output: String(hit.def),
            ddl: String(hit.def),
            kind: String(hit.typ || "MODULE"),
          };
        }
        if (kind !== "auto" && kind !== "table") {
          return { ok: false, error: `No module definition for ${schema}.${name}` };
        }
        const cols = await session.pool.request().query(`
          SELECT c.COLUMN_NAME AS col, c.DATA_TYPE AS typ,
                 c.IS_NULLABLE AS nullable, c.CHARACTER_MAXIMUM_LENGTH AS len
          FROM INFORMATION_SCHEMA.COLUMNS c
          WHERE c.TABLE_SCHEMA = N'${schema.replace(/'/g, "''")}'
            AND c.TABLE_NAME = N'${name.replace(/'/g, "''")}'
          ORDER BY c.ORDINAL_POSITION
        `);
        const rows = cols.recordset || [];
        if (!rows.length) {
          return { ok: false, error: `Object not found: ${schema}.${name}` };
        }
        const ddl = synthesizeCreateTable(schema, name, rows, "mssql");
        return { ok: true, output: ddl, ddl, kind: "TABLE" };
      }

      const mod = await session.pool.request().query(`
        SELECT m.definition AS def, o.type_desc AS typ
        FROM sys.objects o
        JOIN sys.schemas s ON o.schema_id = s.schema_id
        JOIN sys.sql_modules m ON m.object_id = o.object_id
        WHERE s.name = N'${schema.replace(/'/g, "''")}'
          AND o.name = N'${name.replace(/'/g, "''")}'
      `);
      const hit = (mod.recordset || [])[0];
      if (!hit?.def) {
        return { ok: false, error: `No DDL for ${schema}.${name}` };
      }
      return {
        ok: true,
        output: String(hit.def),
        ddl: String(hit.def),
        kind: String(hit.typ || kind),
      };
    }

    // postgres
    if (kind === "view" || kind === "auto") {
      try {
        const viewMeta = await session.pool.query(
          `
          SELECT 1 FROM information_schema.views
          WHERE table_schema = $1 AND table_name = $2
          `,
          [schema, name],
        );
        if (viewMeta.rows?.length) {
          const view = await session.pool.query(
            `
            SELECT pg_get_viewdef(($1 || '.' || $2)::regclass, true) AS def
            `,
            [schema, name],
          );
          const def = view.rows?.[0]?.def;
          if (def) {
            const ddl = `CREATE OR REPLACE VIEW ${quoteIdent(schema, "postgres")}.${quoteIdent(name, "postgres")} AS\n${def}`;
            return { ok: true, output: ddl, ddl, kind: "VIEW" };
          }
        }
      } catch {
        /* try function/table */
      }
    }

    if (kind === "function" || kind === "procedure" || kind === "auto") {
      try {
        const fn = await session.pool.query(
          `
          SELECT pg_get_functiondef(p.oid) AS def
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = $1 AND p.proname = $2
          LIMIT 1
          `,
          [schema, name],
        );
        const def = fn.rows?.[0]?.def;
        if (def) {
          return {
            ok: true,
            output: String(def),
            ddl: String(def),
            kind: "FUNCTION",
          };
        }
      } catch {
        /* try table */
      }
    }

    const cols = await session.pool.query(
      `
      SELECT column_name AS col, data_type AS typ,
             is_nullable AS nullable, character_maximum_length AS len
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
      `,
      [schema, name],
    );
    const rows = cols.rows || [];
    if (!rows.length) {
      return { ok: false, error: `Object not found: ${schema}.${name}` };
    }
    const ddl = synthesizeCreateTable(schema, name, rows, "postgres");
    return { ok: true, output: ddl, ddl, kind: "TABLE" };
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

/**
 * Estimated / analyze explain plan (read-only safe).
 * Postgres: EXPLAIN [ANALYZE] — ANALYZE needs confirmAnalyze:true.
 * SQL Server: SET SHOWPLAN_TEXT / estimated plan via SET SHOWPLAN_ALL.
 */
export async function sql_explain(input = {}) {
  const err = requireSession();
  if (err) return err;
  const sqlText = String(input.sql || input.query || "").trim();
  if (!sqlText) return { ok: false, error: "sql is required" };
  const gate = classifySql(sqlText);
  if (!gate.ok) {
    return {
      ok: false,
      error: `Explain only for read queries: ${gate.error}`,
    };
  }
  const analyze =
    input.analyze === true ||
    String(input.analyze || "").toLowerCase() === "true";
  if (analyze) {
    const confirmed =
      input.confirmAnalyze === true ||
      String(input.confirmAnalyze || "").toLowerCase() === "true";
    if (!confirmed) {
      return {
        ok: false,
        error:
          "EXPLAIN ANALYZE runs the query. Pass confirmAnalyze:true to proceed.",
      };
    }
  }

  try {
    if (session.engine === "mssql") {
      // Estimated plan on a dedicated pooled connection (SET options are connection-scoped).
      const conn = await session.pool.connect();
      try {
        await conn.request().batch("SET SHOWPLAN_TEXT ON");
        const r = await conn.request().query(sqlText);
        const rows = r.recordset || [];
        const lines = rows
          .map((row) => {
            const vals = Object.values(row || {});
            return vals.map((v) => (v == null ? "" : String(v))).join(" ");
          })
          .filter(Boolean);
        const output =
          lines.join("\n") ||
          "(empty showplan — permissions or statement may not support SHOWPLAN_TEXT)";
        return { ok: true, output, rows: lines.map((l) => ({ plan: l })) };
      } finally {
        try {
          await conn.request().batch("SET SHOWPLAN_TEXT OFF");
        } catch {
          /* ignore */
        }
        conn.release();
      }
    }

    const prefix = analyze ? "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)" : "EXPLAIN";
    const r = await session.pool.query(`${prefix}\n${sqlText}`);
    const rows = r.rows || [];
    const output = rows
      .map((row) => String(row["QUERY PLAN"] ?? Object.values(row)[0] ?? ""))
      .join("\n");
    return {
      ok: true,
      output: output || "(empty plan)",
      rows: rows.map((row) => ({
        plan: String(row["QUERY PLAN"] ?? Object.values(row)[0] ?? ""),
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
  patchDbProfile,
};
