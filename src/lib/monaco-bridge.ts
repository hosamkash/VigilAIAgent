export type MonacoSelectionContext = {
  text: string;
  startLine: number;
  endLine: number;
  before: string;
  after: string;
  path: string;
  language: string;
  top: number;
  left: number;
};

type Bridge = {
  trigger: (command: string) => void;
  readSelection: () => string;
  insert: (text: string) => boolean;
  replaceSelection: (text: string) => boolean;
  getSelectionContext: () => MonacoSelectionContext | null;
};

let bridge: Bridge | null = null;

export function setMonacoBridge(next: Bridge | null) {
  bridge = next;
}

export function monacoTrigger(command: string): boolean {
  if (!bridge) return false;
  bridge.trigger(command);
  return true;
}

export function readMonacoSelection(): string {
  return bridge?.readSelection() ?? "";
}

export function insertMonacoText(text: string): boolean {
  if (!bridge) return false;
  return bridge.insert(text);
}

export function replaceMonacoSelection(text: string): boolean {
  if (!bridge) return false;
  return bridge.replaceSelection(text);
}

export function getMonacoSelectionContext(): MonacoSelectionContext | null {
  return bridge?.getSelectionContext() ?? null;
}
