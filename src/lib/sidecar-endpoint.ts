/** Sidecar HTTP base for this Vigil window (multi-instance uses a unique port). */

export const DEFAULT_SIDECAR_PORT = 47821;

let port = DEFAULT_SIDECAR_PORT;

export function setSidecarPort(next: number): void {
  if (Number.isFinite(next) && next > 0 && next < 65536) {
    port = Math.floor(next);
  }
}

export function getSidecarPort(): number {
  return port;
}

export function sidecarBaseUrl(): string {
  return `http://127.0.0.1:${port}`;
}
