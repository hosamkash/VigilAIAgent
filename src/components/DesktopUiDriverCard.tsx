import { useCallback, useEffect, useState } from "react";
import {
  getUiDriverStatus,
  installUiDriver,
  type UiDriverStatus,
} from "../lib/ui-driver-setup";

type Props = {
  /** Compact card for Run sidebar; fuller copy in Settings. */
  compact?: boolean;
};

export function DesktopUiDriverCard({ compact = false }: Props) {
  const [status, setStatus] = useState<UiDriverStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getUiDriverStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setStatus(null);
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onInstall() {
    setBusy(true);
    setError(null);
    setLog(null);
    try {
      const result = await installUiDriver();
      setLog(result.log.trim() || null);
      if (!result.ok) {
        setError(
          result.ready
            ? "Build finished with warnings — check the log."
            : "فشل التثبيت — راجع السجل أو ثبّت .NET 8 SDK.",
        );
      }
      await refresh();
    } catch (err) {
      setError(String(err));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const ready = status?.ready === true;
  const windows = status?.isWindows === true;
  const hasDotnet = status?.hasDotnet === true;

  return (
    <div
      className={
        compact
          ? "mb-3 rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-3"
          : "max-w-2xl rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-4"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--vigil-text)]">
            اختبار تطبيقات ويندوز (EXE)
          </div>
          <p
            className={
              compact
                ? "mt-1 text-[11px] leading-snug text-[var(--vigil-muted)]"
                : "mt-1 text-xs leading-relaxed text-[var(--vigil-muted)]"
            }
          >
            زر واحد يبني محرك الأتمتة (FlaUI). بعده الوكيل يقدر يفتح
            WinForms / DevExpress ويضغط ويكتب من الشات — من غير أوامر تيرمينال.
          </p>
        </div>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
            ready
              ? "bg-[rgba(56,138,52,0.18)] text-[var(--vigil-success)]"
              : "bg-[rgba(0,0,0,0.06)] text-[var(--vigil-muted)]"
          }`}
        >
          {ready ? "جاهز" : "غير مثبت"}
        </span>
      </div>

      {!compact && status && (
        <dl className="mt-3 grid gap-1 text-[11px] text-[var(--vigil-muted)]">
          <div>
            النظام:{" "}
            <span className="text-[var(--vigil-text)]">{status.platform}</span>
          </div>
          <div>
            .NET SDK:{" "}
            <span className="text-[var(--vigil-text)]">
              {hasDotnet
                ? status.dotnetVersion ?? "موجود"
                : "غير موجود — ثبّت .NET 8"}
            </span>
          </div>
          <div className="truncate" title={status.driverPath}>
            المسار:{" "}
            <span className="font-mono text-[var(--vigil-text)]">
              {status.driverPath}
            </span>
          </div>
        </dl>
      )}

      {compact && status && !windows && (
        <p className="mt-2 text-[11px] text-[var(--vigil-muted)]">
          التثبيت يعمل على ويندوز فقط (هذا الجهاز: {status.platform}).
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !windows || !hasDotnet}
          className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-xs font-medium !text-white disabled:opacity-50"
          onClick={() => void onInstall()}
        >
          {busy
            ? "جاري التثبيت…"
            : ready
              ? "إعادة التثبيت"
              : "تثبيت محرك الاختبار"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs text-[var(--vigil-text)] hover:bg-[var(--vigil-hover)] disabled:opacity-50"
          onClick={() => void refresh()}
        >
          تحديث الحالة
        </button>
      </div>

      {windows && !hasDotnet && (
        <p className="mt-2 text-[11px] text-[var(--vigil-danger)]">
          ثبّت{" "}
          <a
            className="underline"
            href="https://dotnet.microsoft.com/download/dotnet/8.0"
            target="_blank"
            rel="noreferrer"
          >
            .NET 8 SDK
          </a>{" "}
          مرة واحدة، ثم اضغط الزر مرة تانية.
        </p>
      )}

      {!windows && !compact && (
        <p className="mt-2 text-xs text-[var(--vigil-muted)]">
          افتح Vigil على جهاز ويندوز اللي عليه برامج الـ EXE، ثم اضغط «تثبيت
          محرك الاختبار» من هنا أو من سايدبار Run.
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-[var(--vigil-danger)] whitespace-pre-wrap">
          {error}
        </p>
      )}

      {log && !compact && (
        <pre className="mt-3 max-h-40 overflow-auto rounded border border-[var(--vigil-border)] bg-[var(--vigil-bg)] p-2 font-mono text-[10px] text-[var(--vigil-muted)] whitespace-pre-wrap">
          {log}
        </pre>
      )}
    </div>
  );
}
