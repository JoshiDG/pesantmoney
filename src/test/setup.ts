import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// Grid virtualization (#95): @tanstack/react-virtual measures its scroll
// container's `offsetHeight` to decide how many rows fit the viewport.
// jsdom has no layout engine, so every element's offsetHeight/offsetWidth
// is permanently 0 -- without a default here, the virtualizer would believe
// every TransactionsGrid has a zero-height viewport and mount only a
// handful of rows, breaking every pre-#95 test that renders a few rows and
// expects them all present. 600px is arbitrary but generous relative to the
// 2-4 row fixtures those tests use; TransactionsGrid's own virtualization
// tests override this per-element (see mockElementSize in
// TransactionsGrid.test.tsx) to force a small, deterministic viewport when
// they need to assert that only a subset of thousands of rows are mounted.
// `configurable: true` lets those per-element overrides shadow this
// prototype default.
if (typeof HTMLElement !== "undefined" && !("__pesantmoneyOffsetMocked" in HTMLElement.prototype)) {
  Object.defineProperties(HTMLElement.prototype, {
    __pesantmoneyOffsetMocked: { value: true },
    offsetHeight: {
      configurable: true,
      get() {
        return 600;
      },
    },
    offsetWidth: {
      configurable: true,
      get() {
        return 600;
      },
    },
  });
}
