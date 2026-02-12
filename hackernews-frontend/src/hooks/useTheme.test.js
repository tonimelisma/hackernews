import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import useTheme from "./useTheme";

describe("useTheme", () => {
  let listeners;
  let matchesDark;

  beforeEach(() => {
    listeners = {};
    matchesDark = false;
    document.documentElement.removeAttribute("data-bs-theme");

    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: matchesDark,
      media: query,
      addEventListener: (event, handler) => {
        listeners[event] = handler;
      },
      removeEventListener: (event, handler) => {
        if (listeners[event] === handler) {
          delete listeners[event];
        }
      },
    }));
  });

  it("sets light theme when system prefers light", () => {
    matchesDark = false;
    renderHook(() => useTheme());
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe(
      "light"
    );
  });

  it("sets dark theme when system prefers dark", () => {
    matchesDark = true;
    renderHook(() => useTheme());
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("dark");
  });

  it("updates theme when system preference changes", () => {
    matchesDark = false;
    renderHook(() => useTheme());
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe(
      "light"
    );

    listeners.change({ matches: true });
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("dark");
  });

  it("removes listener on unmount", () => {
    matchesDark = false;
    renderHook(() => useTheme());
    expect(listeners.change).toBeDefined();

    cleanup();
    expect(listeners.change).toBeUndefined();
  });
});
