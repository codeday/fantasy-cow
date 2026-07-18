import assert from "node:assert/strict";
import test from "node:test";

import { isCowJsonFile } from "./validation-helpers.js";

test("accepts JSON files in the cows directory", () => {
    assert.equal(isCowJsonFile("cows/moonlight.json"), true);
});

test("rejects JSON files outside the cows directory", () => {
    assert.equal(isCowJsonFile("moonlight.json"), false);
    assert.equal(isCowJsonFile("examples/moonlight.json"), false);
});

test("rejects non-JSON files", () => {
    assert.equal(isCowJsonFile("cows/moonlight.png"), false);
});
