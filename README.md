# @meetcache/image-verifier

Node.js SDK for checking screenshots against a required set of visual verifications using MeetCache.

## Install

```sh
npm install @meetcache/image-verifier
```

Requires Node.js 20.3 or newer. The SDK has no runtime dependencies and uses Node's built-in Fetch API.

## Quick start

```js
import { readFile } from "node:fs/promises";
import { ImageVerifier, VerificationError } from "@meetcache/image-verifier";

const verifier = new ImageVerifier({ model: "gpt-6-sol" });
const input = {
  image: await readFile("./screenshot.png"),
  verifications: [
    { id: "no_text_cut_off", description: "No text is unintentionally clipped or truncated." },
    { id: "text_readable", description: "Visible text is legible and has sufficient contrast." },
    { id: "alignment_consistent", description: "Related elements are aligned consistently." },
    { id: "no_overlap", description: "Text and UI elements do not overlap improperly." },
  ],
};

try {
  const result = await verifier.verify(input);
  console.log("Screenshot passed:", result.summary);
} catch (error) {
  if (!(error instanceof VerificationError)) throw error;
  console.error(error.message);
  for (const problem of error.problems) {
    console.error(`${problem.id}: ${problem.details}`);
  }
}
```

Set `MEETCACHE_API_KEY` in the environment, or pass `apiKey` to `new ImageVerifier({ model: "gpt-6-sol", apiKey })`. The key is optional: cached results can be served without one, while a cache miss that needs upstream generation requires a key. Supply either a MeetCache API key or a supported upstream provider API key.

## API

`analyze(input)` returns an `AnalysisResult` whether checks pass or fail. `verify(input)` returns the same result when every check passes and throws `VerificationError` otherwise. The error exposes both `.result` (the complete result) and `.problems` (failed checks only), making it convenient to fail a test while printing useful diagnostics.

Each input requires screenshot `image` bytes and a non-empty `verifications` array. Every verification needs a unique, non-empty `id` and a non-empty `description`. The screenshot `mimeType` defaults to `image/png`; set it for JPEG, WebP, or another supported image format. Optional `context` can identify the page or explain what the screenshot should show.

```js
const result = await verifier.analyze({
  image: screenshotBuffer,
  mimeType: "image/png",
  context: "Billing settings page, desktop viewport",
  verifications: [
    { id: "balance", description: "The balance is shown as $15.00." },
  ],
});

console.log(result.passed);
console.log(result.verifications); // every requested check
console.log(result.problems);      // only failed checks
```

`ImageVerifier` requires a `model` option and also accepts optional `baseURL`, `timeoutMs`, and `fetch` settings. These are intended for alternate compatible endpoints, timeout tuning, and custom Fetch implementations.

## License

MIT
