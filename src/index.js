const DEFAULT_BASE_URL = "https://api.meetcache.ai/v1";
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * @typedef {{ id: string, description: string }} Verification
 * @typedef {{ id: string, passed: boolean, details: string }} VerificationResult
 * @typedef {{ passed: boolean, summary: string, verifications: VerificationResult[], problems: VerificationResult[] }} AnalysisResult
 */

/** Thrown by `verify()` when one or more requested checks fail. */
export class VerificationError extends Error {
    /** @param {AnalysisResult} result */
    constructor(result) {
        const count = result.problems.length;
        super(`Screenshot verification failed (${count} ${count === 1 ? "problem" : "problems"}).`);
        this.name = "VerificationError";
        this.result = result;
        this.problems = result.problems;
    }
}

/**
 * Screenshot verifier.
 *
 * @example
 * const verifier = new ImageVerifier({ model: "gpt-6-sol" });
 * const result = await verifier.verify({
 *   image: await readFile("screenshot.png"),
 *   verifications: [{ id: "no_overlap", description: "UI elements do not overlap." }],
 * });
 */
export class ImageVerifier {
    /**
     * @param {{ model: string, apiKey?: string, baseURL?: string, timeoutMs?: number, fetch?: typeof globalThis.fetch }} options
     * @param {string} options.apiKey Optional MeetCache or supported upstream API key, used only when a cache miss needs upstream generation. Defaults to `MEETCACHE_API_KEY` when set.
     */
    constructor(options = {}) {
        this.apiKey = options.apiKey ?? process.env.MEETCACHE_API_KEY;
        this.baseURL = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
        this.model = options.model;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.fetch = options.fetch ?? globalThis.fetch;

        if (typeof this.model !== "string" || !this.model.trim()) {
            throw new TypeError("model is required and must be a non-empty string.");
        }
        if (typeof this.fetch !== "function") {
            throw new TypeError("A Fetch API implementation is required (Node.js 20 or newer is recommended).");
        }
        if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
            throw new RangeError("timeoutMs must be a positive number.");
        }
    }

    /**
     * Analyze a screenshot and return every check plus the failed checks.
     * Findings do not throw; request and malformed-response errors do.
     *
     * @param {{ image: Uint8Array, verifications: Verification[], mimeType?: string, context?: string, signal?: AbortSignal }} input
     * @returns {Promise<AnalysisResult>}
     */
    async analyze(input) {
        const normalized = validateInput(input);
        const response = await this.#request(normalized);
        const bodyText = await response.text();
        if (!response.ok) {
            throw new Error(extractErrorMessage(bodyText) ?? (bodyText || response.statusText || "Request failed."));
        }

        const completion = parseJson(bodyText, "API response");
        const content = completion?.choices?.[0]?.message?.content;
        if (typeof content !== "string") {
            throw new Error("API response did not contain choices[0].message.content.");
        }

        const modelResult = parseJson(content, "verification result");
        validateResult(modelResult, normalized.verifications);
        const problems = modelResult.verifications.filter((verification) => !verification.passed);

        return {
            passed: modelResult.passed,
            summary: modelResult.summary,
            verifications: modelResult.verifications,
            problems,
        };
    }

    /** Analyze a screenshot, throwing `VerificationError` if any check fails. */
    async verify(input) {
        const result = await this.analyze(input);
        if (!result.passed) throw new VerificationError(result);
        return result;
    }

    async #request(input) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error("Request timed out.")), this.timeoutMs);
        const signal = input.signal
            ? AbortSignal.any([input.signal, controller.signal])
            : controller.signal;

        const headers = { "content-type": "application/json" };
        if (typeof this.apiKey === "string" && this.apiKey.trim()) {
            headers.authorization = `Bearer ${this.apiKey.trim()}`;
        }

        try {
            return await this.fetch(`${this.baseURL}/chat/completions`, {
                method: "POST",
                headers,
                signal,
                body: JSON.stringify(createRequestBody(input, this.model)),
            });
        } finally {
            clearTimeout(timeout);
        }
    }
}

function validateInput(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Input must be an object.");
    }
    if (!(input.image instanceof Uint8Array) || input.image.byteLength === 0) {
        throw new TypeError("image must be a non-empty Buffer or Uint8Array.");
    }
    const mimeType = input.mimeType ?? "image/png";
    if (typeof mimeType !== "string" || !/^image\/[a-z0-9.+-]+$/i.test(mimeType)) {
        throw new TypeError("mimeType must be a valid image media type, such as image/png.");
    }
    if (!Array.isArray(input.verifications) || input.verifications.length === 0) {
        throw new TypeError("verifications must be a non-empty array.");
    }

    const seen = new Set();
    const verifications = input.verifications.map((verification, index) => {
        if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
            throw new TypeError(`verifications[${index}] must be an object with id and description.`);
        }
        const { id, description } = verification;
        if (typeof id !== "string" || !id.trim()) {
            throw new TypeError(`verifications[${index}].id must be a non-empty string.`);
        }
        if (seen.has(id)) throw new TypeError(`Verification IDs must be unique: ${id}.`);
        if (typeof description !== "string" || !description.trim()) {
            throw new TypeError(`verifications[${index}].description must be a non-empty string.`);
        }
        seen.add(id);
        return { id, description };
    });

    if (input.context !== undefined && typeof input.context !== "string") {
        throw new TypeError("context must be a string when provided.");
    }
    if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
        throw new TypeError("signal must be an AbortSignal when provided.");
    }

    return { image: input.image, mimeType, verifications, context: input.context, signal: input.signal };
}

function createRequestBody(input, model) {
    const ids = input.verifications.map(({ id }) => id);
    const prompt = [
        input.context?.trim() ? `Context: ${input.context.trim()}` : null,
        "Inspect the attached screenshot and evaluate every verification using only visible evidence.",
        "Return one result for each verification ID, without adding or omitting IDs.",
        ...input.verifications.map(({ id, description }) => `- ${id}: ${description}`),
        "Mark each check passed only when the screenshot supports it.",
        "For a failed check, explain what is wrong and where it appears.",
        "Set overall passed to true if and only if every verification passed.",
    ].filter(Boolean).join("\n");

    return {
        model,
        messages: [{
            role: "user",
            content: [
                { type: "text", text: prompt },
                {
                    type: "image_url",
                    image_url: {
                        url: `data:${input.mimeType};base64,${Buffer.from(input.image).toString("base64")}`,
                        detail: "high",
                    },
                },
            ],
        }],
        response_format: {
            type: "json_schema",
            json_schema: {
                name: "ui_validation_result",
                strict: true,
                schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["passed", "summary", "verifications"],
                    properties: {
                        passed: { type: "boolean" },
                        summary: { type: "string" },
                        verifications: {
                            type: "array",
                            minItems: ids.length,
                            maxItems: ids.length,
                            items: {
                                type: "object",
                                additionalProperties: false,
                                required: ["id", "passed", "details"],
                                properties: {
                                    id: { type: "string", enum: ids },
                                    passed: { type: "boolean" },
                                    details: { type: "string" },
                                },
                            },
                        },
                    },
                },
            },
        },
        temperature: 0,
        max_tokens: 1200,
        stream: false,
    };
}

function validateResult(result, requested) {
    if (!result || typeof result !== "object" || Array.isArray(result)
        || typeof result.passed !== "boolean" || typeof result.summary !== "string"
        || !Array.isArray(result.verifications)) {
        throw new Error("API returned a verification result with an invalid shape.");
    }

    const remaining = new Set(requested.map(({ id }) => id));
    for (const item of result.verifications) {
        if (!item || typeof item !== "object" || Array.isArray(item)
            || typeof item.id !== "string" || !remaining.delete(item.id)
            || typeof item.passed !== "boolean" || typeof item.details !== "string") {
            throw new Error("API returned an invalid or duplicate verification result.");
        }
    }
    if (remaining.size > 0) {
        throw new Error(`API omitted verification results: ${[...remaining].join(", ")}.`);
    }
    if (result.passed !== result.verifications.every(({ passed }) => passed)) {
        throw new Error("API returned an overall result inconsistent with its checks.");
    }
}

function parseJson(value, label) {
    try {
        return JSON.parse(value);
    } catch (error) {
        throw new Error(`Could not parse ${label} as JSON: ${error.message}`);
    }
}

function extractErrorMessage(bodyText) {
    try {
        const body = JSON.parse(bodyText);
        if (typeof body === "string") return body;
        if (typeof body?.error === "string") return body.error;
        if (typeof body?.error?.message === "string") return body.error.message;
        if (typeof body?.message === "string") return body.message;
    } catch {
        // Keep non-JSON error bodies verbatim.
    }
    return undefined;
}
