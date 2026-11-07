/**
 * Guess the local preview URL for the open workspace (Vite / Next / CRA / Flask…).
 * Used by Vigil Browser and the agent when the user says "open the project".
 */

import { readTextFile } from "./workspace-fs";

const PORT_HINTS: { re: RegExp; port: number }[] = [
  { re: /\bvite\b/i, port: 5173 },
  { re: /\bnext\b/i, port: 3000 },
  { re: /\breact-scripts\b/i, port: 3000 },
  { re: /\bnuxt\b/i, port: 3000 },
  { re: /\bastro\b/i, port: 4321 },
  { re: /\bsvelte\b/i, port: 5173 },
  { re: /\bangular\b/i, port: 4200 },
  { re: /\btauri\b/i, port: 1420 },
  { re: /\bdjango\b/i, port: 8000 },
  { re: /\bflask\b/i, port: 5000 },
  { re: /\bfastapi\b/i, port: 8000 },
];

function portFromText(text: string): number | null {
  const patterns = [
    /--port[=\s]+(\d{2,5})/i,
    /-p[=\s]+(\d{2,5})\b/,
    /PORT[=\s:]+(\d{2,5})/i,
    /localhost:(\d{2,5})/i,
    /127\.0\.0\.1:(\d{2,5})/i,
    /:\s*(\d{4,5})\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 65535) return n;
    }
  }
  return null;
}

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await readTextFile(path);
  } catch {
    return null;
  }
}

export async function detectProjectPreviewUrl(
  workspaceRoot: string | null | undefined,
): Promise<string | null> {
  if (!workspaceRoot) return null;
  const root = workspaceRoot.replace(/\/$/, "");

  const pkgRaw = await readMaybe(`${root}/package.json`);
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const scripts = Object.values(pkg.scripts ?? {}).join("\n");
      const fromScripts = portFromText(scripts);
      if (fromScripts) return `http://localhost:${fromScripts}`;

      const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      const depNames = Object.keys(deps).join(" ");
      for (const hint of PORT_HINTS) {
        if (hint.re.test(depNames) || hint.re.test(scripts)) {
          return `http://localhost:${hint.port}`;
        }
      }
    } catch {
      /* ignore bad package.json */
    }
  }

  const vite = await readMaybe(`${root}/vite.config.ts`)
    ?? (await readMaybe(`${root}/vite.config.js`))
    ?? (await readMaybe(`${root}/vite.config.mjs`));
  if (vite) {
    const port = portFromText(vite) ?? 5173;
    return `http://localhost:${port}`;
  }

  const next = await readMaybe(`${root}/next.config.js`)
    ?? (await readMaybe(`${root}/next.config.mjs`))
    ?? (await readMaybe(`${root}/next.config.ts`));
  if (next) return "http://localhost:3000";

  const compose = await readMaybe(`${root}/docker-compose.yml`)
    ?? (await readMaybe(`${root}/compose.yml`));
  if (compose) {
    const port = portFromText(compose);
    if (port) return `http://localhost:${port}`;
  }

  return "http://localhost:3000";
}
