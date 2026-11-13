import { invoke } from "@tauri-apps/api/core";

export type UiDriverStatus = {
  platform: string;
  isWindows: boolean;
  appRoot: string;
  driverDir: string;
  driverPath: string;
  ready: boolean;
  hasDotnet: boolean;
  dotnetVersion: string | null;
};

export type UiDriverInstallResult = {
  ok: boolean;
  ready: boolean;
  driverPath: string;
  log: string;
};

export async function getUiDriverStatus(): Promise<UiDriverStatus> {
  return invoke<UiDriverStatus>("get_ui_driver_status");
}

export async function installUiDriver(): Promise<UiDriverInstallResult> {
  return invoke<UiDriverInstallResult>("install_ui_driver");
}
