export interface Verification {
    /** Stable identifier returned with the result, such as `no_overlap`. */
    id: string;
    /** The visual condition the model should evaluate. */
    description: string;
}

export interface VerificationResult {
    id: string;
    passed: boolean;
    /** Observation supporting the result; failed checks should identify the issue and location. */
    details: string;
}

export interface AnalysisResult {
    /** True exactly when every requested verification passed. */
    passed: boolean;
    summary: string;
    /** All requested checks, in the order returned by the model. */
    verifications: VerificationResult[];
    /** Convenience list containing only failed checks. */
    problems: VerificationResult[];
}

export interface AnalyzeInput {
    /** Screenshot bytes, e.g. the Buffer returned by `node:fs/promises` readFile. */
    image: Uint8Array;
    /** Required, non-empty set of checks to run. IDs must be unique. */
    verifications: Verification[];
    /** Defaults to `image/png`. */
    mimeType?: string;
    /** Optional context to help interpret the screenshot. */
    context?: string;
    /** Optional cancellation signal. */
    signal?: AbortSignal;
}

export interface ImageVerifierOptions {
    /** Optional MeetCache or supported upstream provider API key, used only when a cache miss needs upstream generation. Defaults to `MEETCACHE_API_KEY` when set. */
    apiKey?: string;
    /** MeetCache API base URL; defaults to `https://api.meetcache.ai/v1`. */
    baseURL?: string;
    /** Required model name, for example `gpt-6-sol`. */
    model: string;
    /** Request timeout in milliseconds; defaults to 60 seconds. */
    timeoutMs?: number;
    /** Optional Fetch API implementation, useful for custom runtimes and tests. */
    fetch?: typeof globalThis.fetch;
}

export class VerificationError extends Error {
    readonly name: "VerificationError";
    readonly result: AnalysisResult;
    readonly problems: VerificationResult[];
}

export class ImageVerifier {
    constructor(options?: ImageVerifierOptions);
    analyze(input: AnalyzeInput): Promise<AnalysisResult>;
    /** Returns the full result if all checks pass; otherwise throws VerificationError. */
    verify(input: AnalyzeInput): Promise<AnalysisResult>;
}
