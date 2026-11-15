/**
 * SQL Activity Capture ("Vigil Profiler") — DMV / pg_stat_activity sampling.
 * No classic Profiler UI; short capture windows with caps.
 */

/** @type {null | {
 *   timer: ReturnType<typeof setInterval>,
 *   startedAt: number,
 *   maxMs: number,
 *   maxEvents: number,
 *   filter: { login?: string, host?: string, app?: string, database?: string },
 *   events: Array<Record<string, unknown>>,
 *   seen: Set<string>,
 * }} */
let capture = null;

const VIGIL_APP_MARKERS = [/vigil/i, /node/i];

function requireConnected(session) {
  if (!session?.pool) {
    return { ok: false, error: "Not connected. Call sql_connect first." };
  }
  return null;
}

function normalizeFilter(input = {}) {
  return {
    login: String(input.login || input.loginName || "").trim() || undefined,
    host: String(input.host || input.hostName || "").trim() || undefined,
    app: String(input.app || input.applicationName || "").trim() || undefined,
    database: String(input.database || "").trim() || undefined,
  };
}

function matchesFilter(row, filter) {
  if (filter.login && !String(row.login || "").includes(filter.login)) return false;
  if (filter.host && !String(row.host || "").includes(filter.host)) return false;
  if (filter.app && !String(row.app || "").includes(filter.app)) return false;
  if (
    filter.database &&
    !String(row.database || "").includes(filter.database)
  ) {
    return false;
  }
  return true;
}

function looksLikeVigil(row) {
  const blob = `${row.app || ""} ${row.login || ""}`;
  return VIGIL_APP_MARKERS.some((re) => re.test(blob));
}

function rowKey(row) {
  return `${row.spid}|${row.sqlPreview || ""}|${row.elapsedMs || 0}`;
}

function formatEvents(events) {
  if (!events.length) return "(no activity captured)";
  return events
    .slice(0, 80)
    .map((e, i) => {
      const head = `${i + 1}. spid=${e.spid} ${e.login || "?"}@${e.host || "?"} app=${e.app || "?"} db=${e.database || "?"} wait=${e.wait || "-"} ${e.elapsedMs != null ? `${e.elapsedMs}ms` : ""}`;
      const sql = String(e.sqlPreview || "").replace(/\s+/g, " ").slice(0, 200);
      return `${head}\n   ${sql || "(no text)"}`;
    })
    .join("\n");
}

async function sampleMssql(pool) {
  const sql = `
SELECT TOP (40)
  r.session_id AS spid,
  s.login_name AS login_name,
  s.host_name AS host_name,
  s.program_name AS program_name,
  DB_NAME(r.database_id) AS db_name,
  r.status AS status,
  r.wait_type AS wait_type,
  r.total_elapsed_time AS elapsed_ms,
  r.cpu_time AS cpu_ms,
  SUBSTRING(
    t.text,
    (r.statement_start_offset / 2) + 1,
    CASE
      WHEN r.statement_end_offset = -1 THEN 4000
      ELSE ((r.statement_end_offset - r.statement_start_offset) / 2) + 1
    END
  ) AS sql_text
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
INNER JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
WHERE r.session_id <> @@SPID
ORDER BY r.total_elapsed_time DESC;
`;
  const r = await pool.request().query(sql);
  return (r.recordset || []).map((row) => ({
    spid: row.spid,
    login: row.login_name,
    host: row.host_name,
    app: row.program_name,
    database: row.db_name,
    status: row.status,
    wait: row.wait_type,
    elapsedMs: row.elapsed_ms,
    cpuMs: row.cpu_ms,
    sqlPreview: row.sql_text,
    at: Date.now(),
  }));
}

async function samplePostgres(pool) {
  const sql = `
SELECT
  pid AS spid,
  usename AS login_name,
  client_addr::text AS host_name,
  application_name AS program_name,
  datname AS db_name,
  state AS status,
  wait_event AS wait_type,
  EXTRACT(EPOCH FROM (now() - COALESCE(query_start, now()))) * 1000 AS elapsed_ms,
  LEFT(query, 2000) AS sql_text
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND state IS NOT NULL
  AND state <> 'idle'
ORDER BY query_start NULLS LAST
LIMIT 40;
`;
  const r = await pool.query(sql);
  return (r.rows || []).map((row) => ({
    spid: row.spid,
    login: row.login_name,
    host: row.host_name,
    app: row.program_name,
    database: row.db_name,
    status: row.status,
    wait: row.wait_type,
    elapsedMs: row.elapsed_ms != null ? Math.round(Number(row.elapsed_ms)) : null,
    sqlPreview: row.sql_text,
    at: Date.now(),
  }));
}

/**
 * @param {{ engine: string, pool: any }} session
 * @param {object} [input]
 */
export async function sql_activity_live(session, input = {}) {
  const err = requireConnected(session);
  if (err) return err;
  const filter = normalizeFilter(input);
  const excludeSelf = input.excludeVigil !== false;
  try {
    const rows =
      session.engine === "mssql"
        ? await sampleMssql(session.pool)
        : await samplePostgres(session.pool);
    const filtered = rows.filter((row) => {
      if (excludeSelf && looksLikeVigil(row)) return false;
      return matchesFilter(row, filter);
    });
    return {
      ok: true,
      output: formatEvents(filtered),
      events: filtered,
      count: filtered.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error:
        `${msg}\n(Hint: SQL Server needs VIEW SERVER STATE for DMVs; Postgres needs pg_stat_activity access.)`,
    };
  }
}

/**
 * @param {{ engine: string, pool: any }} session
 * @param {object} [input]
 */
export async function sql_capture_start(session, input = {}) {
  const err = requireConnected(session);
  if (err) return err;
  if (capture?.timer) {
    clearInterval(capture.timer);
    capture = null;
  }
  const maxMs = Math.min(Math.max(Number(input.maxMs) || 15000, 2000), 60000);
  const maxEvents = Math.min(Math.max(Number(input.maxEvents) || 100, 10), 200);
  const intervalMs = Math.min(Math.max(Number(input.intervalMs) || 750, 250), 5000);
  const filter = normalizeFilter(input);
  const excludeSelf = input.excludeVigil !== false;

  const state = {
    timer: /** @type {any} */ (null),
    startedAt: Date.now(),
    maxMs,
    maxEvents,
    filter,
    events: /** @type {Array<Record<string, unknown>>} */ ([]),
    seen: new Set(),
  };

  const tick = async () => {
    if (!capture) return;
    if (Date.now() - capture.startedAt >= capture.maxMs) {
      await sql_capture_stop(session);
      return;
    }
    try {
      const snap = await sql_activity_live(session, {
        ...filter,
        excludeVigil: excludeSelf,
      });
      if (!snap.ok || !Array.isArray(snap.events)) return;
      for (const ev of snap.events) {
        const key = rowKey(ev);
        if (capture.seen.has(key)) continue;
        capture.seen.add(key);
        capture.events.push(ev);
        if (capture.events.length >= capture.maxEvents) {
          await sql_capture_stop(session);
          return;
        }
      }
    } catch {
      /* keep sampling */
    }
  };

  state.timer = setInterval(() => {
    void tick();
  }, intervalMs);
  capture = state;
  void tick();

  return {
    ok: true,
    output: `Capture started (max ${Math.round(maxMs / 1000)}s, cap ${maxEvents} events). Open the report / click in the EXE, then sql_capture_stop.`,
    capturing: true,
    maxMs,
    maxEvents,
  };
}

export async function sql_capture_stop(_session) {
  if (!capture) {
    return { ok: true, output: "No capture in progress.", events: [], count: 0 };
  }
  if (capture.timer) clearInterval(capture.timer);
  const events = capture.events.slice();
  capture = null;
  return {
    ok: true,
    output: formatEvents(events),
    events,
    count: events.length,
    capturing: false,
  };
}

export function sql_capture_list() {
  if (capture) {
    return {
      ok: true,
      output:
        `Capturing… ${capture.events.length} event(s) so far\n` +
        formatEvents(capture.events),
      events: capture.events.slice(),
      count: capture.events.length,
      capturing: true,
    };
  }
  return {
    ok: true,
    output: "Not capturing. Use sql_capture_start then sql_capture_stop.",
    events: [],
    count: 0,
    capturing: false,
  };
}

export function getCaptureStatus() {
  if (!capture) return { capturing: false, count: 0 };
  return {
    capturing: true,
    count: capture.events.length,
    startedAt: capture.startedAt,
    maxMs: capture.maxMs,
  };
}
