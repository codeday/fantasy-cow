import assert from "node:assert/strict";
import test from "node:test";

import {
    isCowJsonFile,
    isValidatorMaintenancePullRequest
} from "./validation-helpers.js";

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

test("identifies validator maintenance pull requests", () => {
    const files = [
        { filename: ".github/scripts/validate-pr.js" },
        { filename: ".github/scripts/validation-helpers.test.js" },
        { filename: ".github/workflows/validate-pr.yml" },
        { filename: "package.json" }
    ];

    assert.equal(isValidatorMaintenancePullRequest(files), true);
});

test("does not skip cow submissions or unrelated changes", () => {
    assert.equal(isValidatorMaintenancePullRequest([]), false);
    assert.equal(
        isValidatorMaintenancePullRequest([{ filename: "cows/moonlight.json" }]),
        false
    );
    assert.equal(
        isValidatorMaintenancePullRequest([{ filename: "README.md" }]),
        false
    );
});
