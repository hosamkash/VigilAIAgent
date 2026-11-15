import { useEffect } from "react";
import { useVercelEnvStore } from "../store/vercelEnvStore";

type Props = {
  compact?: boolean;
};

function formatWhen(ms: number | null | undefined): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

/** Settings / Run: one-click `npm run env:vercel:push` with a “not run yet” badge. */
export function VercelLiveCard({ compact = false }: Props) {
  const status = useVercelEnvStore((s) => s.status);
  const loading = useVercelEnvStore((s) => s.loading);
  const pushing = useVercelEnvStore((s) => s.pushing);
  const error = useVercelEnvStore((s) => s.error);
  const log = useVercelEnvStore((s) => s.log);
  const refresh = useVercelEnvStore((s) => s.refresh);
  const pushLive = useVercelEnvStore((s) => s.pushLive);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pushed = status?.pushed === true;
  const missingRepo = status?.foundRepo === false;

  return (
    <div
      className={
        compact
          ? "mb-3 rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-3"
          : "rounded-lg border border-[var(--vigil-border)] bg-[var(--vigil-panel)] p-4"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Vercel Live — مفاتيح الويب</div>
          <p
            className={
              compact
                ? "mt-1 text-[11px] leading-snug text-[var(--vigil-muted)]"
                : "mt-1 text-xs leading-relaxed text-[var(--vigil-muted)]"
            }
          >
            يشغّل{" "}
            <code className="text-[10px]">npm run env:vercel:push</code> في
            Vigil-AI-Agent-Web (بما فيه FIREBASE_SERVICE_ACCOUNT_JSON ومفاتيح
            Kashier). الزر موجود هنا عشان متعملش الرفع من الطرفية وتنسى.
          </p>
        </div>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${
            pushed
              ? "bg-[var(--vigil-hover)] text-[var(--vigil-accent)]"
              : "bg-[var(--vigil-danger)]/15 text-[var(--vigil-danger)]"
          }`}
        >
          {pushed ? "اترفع" : "لسه ما اشتغلش"}
        </span>
      </div>

      <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--vigil-muted)]">
        <li>
          ريبو الويب:{" "}
          {missingRepo
            ? "مش متلاقي — حط المجلد جنب الديسكتوب أو VIGIL_WEB_REPO"
            : status?.webRoot || (loading ? "…" : "—")}
        </li>
        <li>
          .env.local: {status?.envLocalExists ? "موجود" : "ناقص"} · حساب Firebase:{" "}
          {status?.hadServiceAccountJson || status?.hasServiceAccountPath
            ? "جاهز"
            : "ناقص JSON"}{" "}
          · Kashier: {status?.kashierMode || "—"}
          {status?.hasKashierLive ? " + Live keys" : ""}
        </li>
        {pushed ? (
          <li>آخر رفع: {formatWhen(status?.pushedAt)} · {status?.keyCount || 0} مفتاح</li>
        ) : (
          <li>مفيش سجل رفع في .vigil/vercel-env-last-push.json</li>
        )}
      </ul>

      {status?.warning ? (
        <p className="mt-2 text-[11px] text-[var(--vigil-danger)]">{status.warning}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pushing || missingRepo}
          className="rounded bg-[var(--vigil-accent)] px-3 py-1.5 text-xs !text-white disabled:opacity-50"
          onClick={() => void pushLive()}
        >
          {pushing ? "بيرفع على فيرسل…" : "تشغيل رفع المفاتيح (Live)"}
        </button>
        <button
          type="button"
          disabled={loading || pushing}
          className="rounded border border-[var(--vigil-border)] px-3 py-1.5 text-xs disabled:opacity-50"
          onClick={() => void refresh()}
        >
          تحديث الحالة
        </button>
      </div>
      <p className="mt-2 text-[10px] text-[var(--vigil-muted)]">
        قبل الزر: vercel login + vercel link مرة واحدة داخل مجلد الويب. بعد
        النجاح: Redeploy على فيرسل ثم حط رابط الإنتاج في URL تحت.
      </p>
      {error ? (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-[var(--vigil-bg)] p-2 text-[10px] text-[var(--vigil-danger)]">
          {error}
        </pre>
      ) : null}
      {log && !compact ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[var(--vigil-bg)] p-2 text-[10px] text-[var(--vigil-muted)]">
          {log}
        </pre>
      ) : null}
    </div>
  );
}
