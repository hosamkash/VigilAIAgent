import { describe, expect, it } from "vitest";
import { formatAccel, formatAccelParts } from "./menu-accel";

describe("formatAccelParts", () => {
  it("uses Mac symbols", () => {
    expect(
      formatAccelParts(
        { mod: true, shift: true, key: "l", label: "L" },
        true,
      ),
    ).toEqual(["⇧", "⌘", "L"]);
    expect(
      formatAccelParts({ mod: true, alt: true, key: "b", label: "B" }, true),
    ).toEqual(["⌥", "⌘", "B"]);
  });

  it("uses Ctrl/Alt/Shift words on Windows/Linux", () => {
    expect(
      formatAccelParts(
        { mod: true, shift: true, key: "l", label: "L" },
        false,
      ),
    ).toEqual(["Ctrl", "Shift", "L"]);
    expect(
      formatAccelParts({ mod: true, alt: true, key: "a", label: "A" }, false),
    ).toEqual(["Ctrl", "Alt", "A"]);
  });

  it("formatAccel joins parts", () => {
    expect(
      formatAccel({ mod: true, shift: true, key: "l", label: "L" }, true),
    ).toBe("⇧⌘L");
    expect(
      formatAccel({ mod: true, shift: true, key: "l", label: "L" }, false),
    ).toBe("Ctrl+Shift+L");
  });
});
