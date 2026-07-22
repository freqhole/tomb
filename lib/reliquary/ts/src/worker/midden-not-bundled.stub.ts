// test-only stand-in for the "midden" bare specifier that `midden-blake3.ts`
// dynamically imports. aliased in vitest.config.ts so that import resolves
// to a real, existing module (satisfying the bundler's static import
// analysis) instead of failing the transform outright - but this module
// throws on evaluation, so `loadMiddenBlake3()`'s dynamic import still
// rejects and is caught the same way it would be in a real embedding app
// that hasn't aliased "midden" to anything, exercising the genuine
// "no midden module bundled" degraded-behavior path.
throw new Error("midden not bundled in this test environment");

