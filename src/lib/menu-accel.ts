export interface Accel {
  key: string;
  label: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
}

export interface PressedKey {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  code?: string;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return true;
  return /Mac|iPhone|iPad/.test(`${navigator.platform}${navigator.userAgent}`);
}

export function formatAccel(accel: Accel, mac = isMacPlatform()): string {
  if (mac) {
    return `${accel.ctrl ? "⌃" : ""}${accel.alt ? "⌥" : ""}${accel.shift ? "⇧" : ""}${accel.mod ? "⌘" : ""}${accel.label}`;
  }
  const parts: string[] = [];
  if (accel.ctrl || accel.mod) parts.push("Ctrl");
  if (accel.alt) parts.push("Alt");
  if (accel.shift) parts.push("Shift");
  parts.push(accel.label);
  return parts.join("+");
}

export function accelMatches(
  pressed: PressedKey,
  accel: Accel,
  mac: boolean,
): boolean {
  const wantMod = !!accel.mod;
  const wantCtrl = !!accel.ctrl;
  if (mac) {
    if (pressed.meta !== wantMod) return false;
    if (pressed.ctrl !== wantCtrl) return false;
  } else {
    if (pressed.meta) return false;
    if (pressed.ctrl !== (wantMod || wantCtrl)) return false;
  }
  if (pressed.alt !== !!accel.alt) return false;

  const key = pressed.key.toLowerCase();
  const want = accel.key.toLowerCase();
  if (want === "=" && (key === "=" || key === "+")) return true;
  if (want === "-" && (key === "-" || key === "_")) {
    const shifted = key === "_" || pressed.shift;
    return shifted === !!accel.shift;
  }
  if (want === "`") {
    const isBackquote = pressed.code === "Backquote" || key === "`" || key === "~";
    if (!isBackquote) return false;
    return pressed.shift === !!accel.shift;
  }
  if (pressed.shift !== !!accel.shift) return false;
  return key === want;
}
