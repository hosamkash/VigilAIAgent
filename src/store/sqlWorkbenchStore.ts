import { create } from "zustand";
import { selectStarSql } from "../lib/sql-result-grid";
import type { DbEngine } from "../lib/db-sidecar";

type SqlWorkbenchState = {
  draftSql: string;
  /** Bump so panel can focus/scroll when catalog opens a query. */
  draftNonce: number;
  setDraftSql: (sql: string) => void;
  /** Replace draft and focus the SQL panel (catalog SQL/DDL). */
  loadDraftSql: (sql: string) => void;
  openSelectForTable: (opts: {
    schema: string;
    name: string;
    engine?: DbEngine | null;
  }) => void;
};

export const useSqlWorkbenchStore = create<SqlWorkbenchState>((set) => ({
  draftSql: "SELECT 1 AS ok",
  draftNonce: 0,
  setDraftSql: (sql) => set({ draftSql: sql }),
  loadDraftSql: (sql) =>
    set((s) => ({ draftSql: sql, draftNonce: s.draftNonce + 1 })),
  openSelectForTable: ({ schema, name, engine }) => {
    const sql = selectStarSql(schema, name, engine);
    if (!sql) return;
    set((s) => ({ draftSql: sql, draftNonce: s.draftNonce + 1 }));
  },
}));
