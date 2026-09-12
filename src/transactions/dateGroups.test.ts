import { describe, expect, it } from "vitest";
import { dateGroupLabel, groupRowsByDate } from "./dateGroups";

const NOW = new Date("2026-09-11T09:30:00");

describe("dateGroupLabel", () => {
  it("labels the reference date as Today", () => {
    expect(dateGroupLabel("2026-09-11", NOW)).toBe("Today");
  });

  it("labels the day before the reference date as Yesterday", () => {
    expect(dateGroupLabel("2026-09-10", NOW)).toBe("Yesterday");
  });

  it("labels any other date as an explicit Mon D, YYYY string", () => {
    expect(dateGroupLabel("2026-09-01", NOW)).toBe("Sep 1, 2026");
  });

  it("labels a future date as an explicit string too", () => {
    expect(dateGroupLabel("2026-09-12", NOW)).toBe("Sep 12, 2026");
  });

  it("handles Yesterday correctly across a month boundary", () => {
    const firstOfMonth = new Date("2026-10-01T09:00:00");
    expect(dateGroupLabel("2026-09-30", firstOfMonth)).toBe("Yesterday");
  });

  it("handles Yesterday correctly across a year boundary", () => {
    const newYearsDay = new Date("2027-01-01T09:00:00");
    expect(dateGroupLabel("2026-12-31", newYearsDay)).toBe("Yesterday");
  });

  it("defaults `now` to the real clock when not provided", () => {
    // Just asserts it doesn't throw and returns a string -- the real-clock
    // path is exercised by every other pure function in this codebase the
    // same way (see filters.test.ts's datePresetRange coverage).
    expect(typeof dateGroupLabel("2020-01-01")).toBe("string");
  });
});

describe("groupRowsByDate", () => {
  interface Row {
    id: number;
    date: string;
  }

  function row(id: number, date: string): Row {
    return { id, date };
  }

  it("buckets consecutive same-date rows into one group", () => {
    const rows = [row(1, "2026-09-11"), row(2, "2026-09-11"), row(3, "2026-09-10")];
    const groups = groupRowsByDate(rows, (r) => r.date, NOW);

    expect(groups).toEqual([
      { label: "Today", rows: [row(1, "2026-09-11"), row(2, "2026-09-11")] },
      { label: "Yesterday", rows: [row(3, "2026-09-10")] },
    ]);
  });

  it("preserves row order within and across groups", () => {
    const rows = [row(1, "2026-09-01"), row(2, "2026-08-31"), row(3, "2026-08-31")];
    const groups = groupRowsByDate(rows, (r) => r.date, NOW);

    expect(groups.map((g) => g.label)).toEqual(["Sep 1, 2026", "Aug 31, 2026"]);
    expect(groups[1].rows.map((r) => r.id)).toEqual([2, 3]);
  });

  it("starts a new group every time the date changes, even if a label repeats non-consecutively", () => {
    // Not chronologically ordered (e.g. a non-date column sort) -- each
    // transition still starts a fresh group rather than merging with an
    // earlier group of the same label.
    const rows = [row(1, "2026-09-01"), row(2, "2026-09-02"), row(3, "2026-09-01")];
    const groups = groupRowsByDate(rows, (r) => r.date, NOW);

    expect(groups.map((g) => g.label)).toEqual(["Sep 1, 2026", "Sep 2, 2026", "Sep 1, 2026"]);
  });

  it("returns an empty array for an empty row list", () => {
    expect(groupRowsByDate([], (r: Row) => r.date, NOW)).toEqual([]);
  });
});
