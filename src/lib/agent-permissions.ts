/** Fine-grained agent tool permissions beyond Auto-run on/off. */

export const DEFAULT_COMMAND_ALLOWLIST = [
  "npm test",
  "npm run test*",
  "npm run lint*",
  "npx vitest*",
  "pnpm test*",
  "pnpm run test*",
  "yarn test*",
  "cargo test*",
  "pytest*",
];

export const DEFAULT_PATH_DENYLIST = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa*",
  "**/*credentials*",
  "**/secrets.*",
];

/** Glob-ish match: `*` = any run of non-newline chars. */
export function matchGlobish(pattern: string, value: string): boolean {
  const p = pattern.trim().toLowerCase();
  const v = value.trim().toLowerCase();
  if (!p) return false;
  if (p === v) return true;
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(v);
}

export function commandMatchesAllowlist(
  command: string,
  allowlist: string[],
): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  return allowlist.some((pattern) => matchGlobish(pattern, cmd));
}

export function pathMatchesDenylist(path: string, denylist: string[]): boolean {
  const norm = path.replace(/\\/g, "/");
  const base = norm.split("/").pop() || norm;
  return denylist.some(
    (pattern) => matchGlobish(pattern, norm) || matchGlobish(pattern, base),
  );
}

export function extractCommandFromToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  if (typeof obj.command === "string") return obj.command;
  if (Array.isArray(obj.commands)) {
    return obj.commands.map(String).join(" && ");
  }
  return "";
}

export function extractPathFromToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  if (typeof obj.path === "string") return obj.path;
  if (typeof obj.file === "string") return obj.file;
  return "";
}
