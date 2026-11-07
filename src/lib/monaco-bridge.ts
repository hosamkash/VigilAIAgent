type Bridge = {
  trigger: (command: string) => void;
  readSelection: () => string;
  insert: (text: string) => boolean;
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
