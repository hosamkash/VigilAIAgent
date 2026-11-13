import { useCallback, useEffect, useState } from "react";
import {
  connectDb,
  disconnectDb,
  listDbProfilesUi,
  saveDbPassword,
  saveDbProfileUi,
  testDbConnection,
  type DbEngine,
  type DbProfile,
} from "../lib/db-sidecar";
import { useSqlCatalogStore } from "../store/sqlCatalogStore";
import { useSqlSessionStore } from "../store/sqlSessionStore";

type Props = { compact?: boolean };

export function SupportDbCard({ compact = false }: Props) {
  const setSession = useSqlSessionStore((s) => s.setSession);
  const clearSession = useSqlSessionStore((s) => s.clear);
  const connected = useSqlSessionStore((s) => s.connected);
  const label = useSqlSessionStore((s) => s.label);

  const [profiles, setProfiles] = useState<DbProfile[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("UAT");
  const [engine, setEngine] = useState<DbEngine>("mssql");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("1433");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("sa");
  const [password, setPassword] = useState("");
  const [trustCert, setTrustCert] = useState(true);
  const [selectedId, setSelectedId] = useState("");

  const refresh = useCallback(async () => {
    try {
      const list = await listDbProfilesUi();
      setProfiles(list);
      if (!selectedId && list[0]) setSelectedId(list[0].id);
    } catch (err) {
      setError(String(err));
    }
  }, [selectedId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setPort(engine === "mssql" ? "1433" : "5432");
  }, [engine]);

  async function onSave() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const profile = await saveDbProfileUi({
        id: selectedId || undefined,
        name,
        engine,
        host,
        port: Number(port) || undefined,
        database: database || undefined,
        username,
        trustServerCertificate: trustCert,
      });
      if (password.trim()) {
        await saveDbPassword(profile.id, password.trim());
      }
      setSelectedId(profile.id);
      setNote(`Saved profile ${profile.id}${password ? " + password" : ""}`);
      setPassword("");
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const id = selectedId;
      let pwd = password.trim();
      if (!pwd && id) {
        try {
          const { getDbPassword } = await import("../lib/db-sidecar");
          pwd = await getDbPassword(id);
        } catch {
          /* */
        }
      }
      const out = await testDbConnection({
        profileId: id || undefined,
        password: pwd || undefined,
        engine: id ? undefined : engine,
        host: id ? undefined : host,
        username: id ? undefined : username,
        database: id ? undefined : database || undefined,
        trustServerCertificate: trustCert,
      });
      setNote(out);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onConnect() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      if (!selectedId) throw new Error("اختر أو احفظ بروفايل أولًا");
      const session = await connectDb({
        profileId: selectedId,
        password: password.trim() || undefined,
      });
      setSession({
        connected: !!session.connected,
        engine: session.engine,
        profileId: session.profileId,
        label: session.label,
        database: session.database,
        readOnly: session.readOnly !== false,
      });
      setNote(`Connected · ${session.label || selectedId}`);
      setPassword("");
      void useSqlCatalogStore.getState().refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    setBusy(true);
    try {
      await disconnectDb();
      clearSession();
      useSqlCatalogStore.getState().clear();
      setNote("Disconnected");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={
        compact
          ? "mb-3 rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-3"
          : "max-w-2xl rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-4"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Support / DB Copilot</div>
          <p className="mt-1 text-xs text-[var(--vigil-muted)]">
            SQL Server أو PostgreSQL على الشبكة المحلية. كلمة السر محلية فقط —
            مش في Firestore.
          </p>
        </div>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
            connected
              ? "bg-[rgba(56,138,52,0.18)] text-[var(--vigil-success)]"
              : "bg-[rgba(0,0,0,0.06)] text-[var(--vigil-muted)]"
          }`}
        >
          {connected ? label || "Connected" : "Offline"}
        </span>
      </div>

      <label className="mt-3 block text-xs">
        Saved profiles
        <select
          className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-sm"
          value={selectedId}
          onChange={(e) => {
            const id = e.target.value;
            setSelectedId(id);
            const p = profiles.find((x) => x.id === id);
            if (!p) return;
            setName(p.name);
            setEngine(p.engine);
            setHost(p.host);
            setPort(String(p.port || (p.engine === "mssql" ? 1433 : 5432)));
            setDatabase(p.database || "");
            setUsername(p.username);
            setTrustCert(p.trustServerCertificate === true);
          }}
        >
          <option value="">— new —</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.engine}) {p.host}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs">
          Name
          <input
            className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Engine
          <select
            className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-sm"
            value={engine}
            onChange={(e) => setEngine(e.target.value as DbEngine)}
          >
            <option value="mssql">SQL Server</option>
            <option value="postgres">PostgreSQL</option>
          </select>
        </label>
        <label className="text-xs">
          Host
          <input
            className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-sm"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Port
          <input
            className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-sm"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Database
          <input
            className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-sm"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Username
          <input
            className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-sm"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
      </div>

      <label className="mt-2 block text-xs">
        Password (local only)
        <input
          type="password"
          className="mt-1 w-full rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] px-2 py-1.5 text-sm"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
        />
      </label>

      {engine === "mssql" ? (
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={trustCert}
            onChange={(e) => setTrustCert(e.target.checked)}
          />
          Trust server certificate
        </label>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-xs !text-white disabled:opacity-50"
          onClick={() => void onSave()}
        >
          Save profile
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs disabled:opacity-50"
          onClick={() => void onTest()}
        >
          Test
        </button>
        {connected ? (
          <button
            type="button"
            disabled={busy}
            className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={() => void onDisconnect()}
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={() => void onConnect()}
          >
            Connect (agent session)
          </button>
        )}
      </div>

      {note ? <p className="mt-2 text-xs text-[var(--vigil-muted)]">{note}</p> : null}
      {error ? <p className="mt-2 text-xs text-[var(--vigil-danger)]">{error}</p> : null}
    </div>
  );
}
