/** Lightweight Seti-inspired file icons (emoji/glyph) by extension. */

const EXT_ICON: Record<string, string> = {
  ts: "🟦",
  tsx: "⚛️",
  js: "🟨",
  jsx: "⚛️",
  mjs: "🟨",
  cjs: "🟨",
  json: "📋",
  md: "📝",
  rs: "🦀",
  css: "🎨",
  scss: "🎨",
  html: "🌐",
  py: "🐍",
  toml: "⚙️",
  yml: "⚙️",
  yaml: "⚙️",
  sh: "💻",
  bash: "💻",
  zsh: "💻",
  txt: "📄",
  svg: "🖼️",
  png: "🖼️",
  jpg: "🖼️",
  jpeg: "🖼️",
  gif: "🖼️",
  webp: "🖼️",
  lock: "🔒",
  env: "🔐",
  gitignore: "🚫",
  dockerfile: "🐳",
};

export function fileIcon(name: string, isDir: boolean): string {
  if (isDir) return "📁";
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "🐳";
  if (lower === "package.json") return "📦";
  if (lower === "cargo.toml") return "📦";
  if (lower === "readme.md") return "📖";
  const ext = lower.includes(".") ? lower.split(".").pop()! : lower;
  return EXT_ICON[ext] ?? "📄";
}
