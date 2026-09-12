import { describe, expect, it } from "vitest";
import { roomsDeclaredFromLabel } from "./rooms-label.js";

describe("roomsDeclaredFromLabel", () => {
  it("maps known Serbian structure words, stripping markdown junk", () => {
    expect(roomsDeclaredFromLabel("##### Troiposoban")).toBe(3.5);
    expect(roomsDeclaredFromLabel("Troiposoban")).toBe(3.5);
    expect(roomsDeclaredFromLabel("Garsonjera")).toBe(0.5);
    expect(roomsDeclaredFromLabel("jednosoban")).toBe(1);
    expect(roomsDeclaredFromLabel("Jednoiposoban")).toBe(1.5);
    expect(roomsDeclaredFromLabel("Dvosoban")).toBe(2);
    expect(roomsDeclaredFromLabel("Četvorosoban")).toBe(4);
    expect(roomsDeclaredFromLabel("Cetvorosoban")).toBe(4);
  });

  it("leaves unknown labels unset instead of inventing a number", () => {
    expect(roomsDeclaredFromLabel("Penthouse")).toBeUndefined();
    expect(roomsDeclaredFromLabel("##### ")).toBeUndefined();
    expect(roomsDeclaredFromLabel(undefined)).toBeUndefined();
  });
});
