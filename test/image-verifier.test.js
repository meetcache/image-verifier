import test from "node:test";
import assert from "node:assert/strict";
import { ImageVerifier, VerificationError } from "../src/index.js";

const checks = [
    { id: "readable", description: "Text is readable." },
    { id: "no_overlap", description: "UI elements do not overlap." },
];

function mockFetch(result) {
    return async (_url, init) => {
        const request = JSON.parse(init.body);
        assert.equal(request.response_format.type, "json_schema");
        return new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify(result) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
    };
}

test("analyze returns all checks and just the failures as problems", async () => {
    const expected = {
        passed: false,
        summary: "Text is clipped.",
        verifications: [
            { id: "readable", passed: true, details: "Text is legible." },
            { id: "no_overlap", passed: false, details: "The button overlaps the heading." },
        ],
    };
    const verifier = new ImageVerifier({ model: "gpt-6-sol", fetch: mockFetch(expected) });
    const result = await verifier.analyze({ image: Buffer.from("png"), verifications: checks });

    assert.deepEqual(result.verifications, expected.verifications);
    assert.deepEqual(result.problems, [expected.verifications[1]]);
});

test("verify throws VerificationError with the analysis when a check fails", async () => {
    const failed = {
        passed: false,
        summary: "One issue.",
        verifications: [
            { id: "readable", passed: true, details: "Readable." },
            { id: "no_overlap", passed: false, details: "Overlap." },
        ],
    };
    const verifier = new ImageVerifier({ model: "gpt-6-sol", fetch: mockFetch(failed) });

    await assert.rejects(
        verifier.verify({ image: Buffer.from("png"), verifications: checks }),
        (error) => error instanceof VerificationError && error.problems.length === 1,
    );
});

test("verifications are required, non-empty, and unique", async () => {
    const verifier = new ImageVerifier({ model: "gpt-6-sol", fetch: mockFetch({}) });
    await assert.rejects(verifier.analyze({ image: Buffer.from("png"), verifications: [] }), /non-empty/);
    await assert.rejects(verifier.analyze({
        image: Buffer.from("png"),
        verifications: [checks[0], checks[0]],
    }), /unique/);
});

test("rejects results that do not match the requested checks", async () => {
    const verifier = new ImageVerifier({
        model: "gpt-6-sol",
        fetch: mockFetch({
            passed: true,
            summary: "Fine.",
            verifications: [{ id: "other", passed: true, details: "Fine." }],
        }),
    });
    await assert.rejects(
        verifier.analyze({ image: Buffer.from("png"), verifications: checks }),
        /invalid or duplicate/,
    );
});
