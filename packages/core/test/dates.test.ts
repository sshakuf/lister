import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDateShorthand, formatDateShorthand, parsePriorityShorthand, todayIso } from "../src/dates.ts";

test("parseDateShorthand day-first forms", () => {
  const now = new Date(2026, 8, 19);
  assert.equal(parseDateShorthand("@15/9/27", now), "2027-09-15");
  assert.equal(parseDateShorthand("@15/9/2027", now), "2027-09-15");
  assert.equal(parseDateShorthand("@1/2", now), "2026-02-01");
  assert.equal(parseDateShorthand("@15/9/27 10:30", now), "2027-09-15T10:30");
  assert.equal(parseDateShorthand("@31/2/27", now), null);
  assert.equal(parseDateShorthand("15/9/27", now), null);
  assert.equal(parseDateShorthand("@x", now), null);
});

test("formatDateShorthand", () => {
  assert.equal(formatDateShorthand("2027-09-15"), "15/9/27");
  assert.equal(formatDateShorthand("2027-09-15T10:30"), "15/9/27 10:30");
  assert.equal(formatDateShorthand("junk"), "junk");
});

test("priority shorthand", () => {
  assert.equal(parsePriorityShorthand("!2"), 2);
  assert.equal(parsePriorityShorthand("!4"), null);
  assert.equal(parsePriorityShorthand("2"), null);
});

test("todayIso", () => {
  assert.equal(todayIso(new Date(2026, 0, 5)), "2026-01-05");
});
