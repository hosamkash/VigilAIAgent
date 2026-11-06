type Bridge = {
  trigger: (command: string) => void;
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
