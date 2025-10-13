import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGuardrails } from "../guardrails.js";
import { buildContext } from "../context.js";

test("deny keywords block sensitive questions", () => {
  const result = evaluateGuardrails("Can you tell me my password?", {});
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "deny");
});

test("allow keywords restrict topics when provided", () => {
  const result = evaluateGuardrails("Tell me about billing", { allowKeywords: ["shipping", "returns"] });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "allow");
});

test("context builder trims content when limit is set", () => {
  const hits = [
    { payload: { title: "Doc One", url: "http://a.example", text: "abcdefghijklmnopqrstuvwxyz" } },
    { payload: { title: "Doc Two", url: "http://b.example", text: "0123456789" } },
  ];
  const limited = buildContext(hits, 40);
  assert.match(limited, /\[#1]/);
  assert(!limited.includes("[#2]"));
});

test("context builder includes all hits when unlimited", () => {
  const hits = [
    { payload: { title: "Doc One", url: "http://a.example", text: "abc" } },
    { payload: { title: "Doc Two", url: "http://b.example", text: "def" } },
  ];
  const context = buildContext(hits);
  assert(context.includes("[#1]"));
  assert(context.includes("[#2]"));
});
