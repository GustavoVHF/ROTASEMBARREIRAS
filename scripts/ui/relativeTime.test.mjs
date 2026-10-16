// Testes de relativeDayLabel (node:test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { relativeDayLabel } from "../../src/lib/relativeTime.ts";

const now = new Date("2026-10-16T12:00:00Z");
const ago = (h) => new Date(now.getTime() - h * 3600 * 1000).toISOString();

test("hoje, ontem e há N dias", () => {
  assert.equal(relativeDayLabel(ago(0), now), "hoje");
  assert.equal(relativeDayLabel(ago(23.9), now), "hoje");
  assert.equal(relativeDayLabel(ago(24), now), "ontem");
  assert.equal(relativeDayLabel(ago(47.9), now), "ontem");
  assert.equal(relativeDayLabel(ago(48), now), "há 2 dias");
  assert.equal(relativeDayLabel(ago(24 * 13), now), "há 13 dias");
});

test("data futura ou inválida vira hoje", () => {
  assert.equal(relativeDayLabel(ago(-5), now), "hoje");
  assert.equal(relativeDayLabel("x", now), "hoje");
});
