import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useBreakpoint } from "./BreakpointProvider";
import { withBreakpoint } from "./withBreakpoint";

// jsdom does not implement matchMedia. This mock mirrors the two media
// queries useBreakpoint registers (min-width: 768px, min-width: 1280px) and
// lets tests flip window.innerWidth and fire "change" the way a real browser
// would when the window is resized.
type Listener = (event: MediaQueryListEvent) => void;

function installMatchMediaMock() {
  const lists = new Map<string, { listeners: Set<Listener>; mql: MediaQueryList }>();

  function widthFromQuery(query: string): number {
    const match = query.match(/min-width:\s*(\d+)px/);
    if (!match) throw new Error(`unsupported query in test mock: ${query}`);
    return Number(match[1]);
  }

  window.matchMedia = ((query: string) => {
    const minWidth = widthFromQuery(query);
    const listeners = new Set<Listener>();
    const mql = {
      get matches() {
        return window.innerWidth >= minWidth;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: Listener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: Listener) => {
        listeners.delete(listener);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
    lists.set(query, { listeners, mql });
    return mql;
  }) as typeof window.matchMedia;

  function resizeTo(width: number) {
    window.innerWidth = width;
    for (const { listeners, mql } of lists.values()) {
      for (const listener of listeners) {
        listener({ matches: mql.matches } as MediaQueryListEvent);
      }
    }
  }

  return { resizeTo };
}

function Probe() {
  const tier = useBreakpoint();
  return <div data-testid="tier">{tier}</div>;
}

describe("useBreakpoint (real matchMedia)", () => {
  afterEach(() => {
    // @ts-expect-error resetting the test-installed mock between tests
    delete window.matchMedia;
  });

  it("resolves to mobile below 768px", () => {
    const { resizeTo } = installMatchMediaMock();
    resizeTo(500);
    render(<Probe />);
    expect(screen.getByTestId("tier")).toHaveTextContent("mobile");
  });

  it("resolves to compact between 768px and 1279px", () => {
    const { resizeTo } = installMatchMediaMock();
    resizeTo(900);
    render(<Probe />);
    expect(screen.getByTestId("tier")).toHaveTextContent("compact");
  });

  it("resolves to expanded at 1280px and above", () => {
    const { resizeTo } = installMatchMediaMock();
    resizeTo(1440);
    render(<Probe />);
    expect(screen.getByTestId("tier")).toHaveTextContent("expanded");
  });

  it("updates live when the window is resized", () => {
    const { resizeTo } = installMatchMediaMock();
    resizeTo(1440);
    render(<Probe />);
    expect(screen.getByTestId("tier")).toHaveTextContent("expanded");

    act(() => {
      resizeTo(500);
    });
    expect(screen.getByTestId("tier")).toHaveTextContent("mobile");

    act(() => {
      resizeTo(900);
    });
    expect(screen.getByTestId("tier")).toHaveTextContent("compact");
  });
});

describe("withBreakpoint / BreakpointProvider override", () => {
  it("forces the resolved tier for a subtree, with no matchMedia mocking required", () => {
    render(<Probe />, { wrapper: withBreakpoint("mobile") });
    expect(screen.getByTestId("tier")).toHaveTextContent("mobile");
  });

  it("forces compact", () => {
    render(<Probe />, { wrapper: withBreakpoint("compact") });
    expect(screen.getByTestId("tier")).toHaveTextContent("compact");
  });

  it("forces expanded", () => {
    render(<Probe />, { wrapper: withBreakpoint("expanded") });
    expect(screen.getByTestId("tier")).toHaveTextContent("expanded");
  });
});
