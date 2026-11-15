import { SupportActivityCard } from "../../SupportActivityCard";
import { SupportCatalogPanel } from "../../SupportCatalogPanel";
import { SupportDbCard } from "../../SupportDbCard";
import { SupportGlossaryCard } from "../../SupportGlossaryCard";
import { SupportSqlPanel } from "../../SupportSqlPanel";

/** Dedicated Support / SQL workspace — not mixed into Run and Debug. */
export function DatabaseSidebar() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-[var(--vigil-border)] px-2 py-2 pr-12">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#038387]">
          Database
        </div>
        <p className="mt-0.5 text-[10px] leading-snug text-[var(--vigil-muted)]">
          SQL Server / PostgreSQL — وصل، كتالوج، SQL، بروفايلر
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        <SupportDbCard compact />
        <SupportCatalogPanel compact />
        <SupportSqlPanel compact />
        <SupportGlossaryCard compact />
        <SupportActivityCard compact />
      </div>
    </div>
  );
}
