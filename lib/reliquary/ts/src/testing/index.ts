// exported test utilities: doubles and fixtures consuming apps use in
// their own suites instead of re-rolling mocks. no restriction on what
// this subpath imports at runtime (it is only ever imported by test
// files), but its own exports stay framework-free where practical - none
// of these doubles need solid-js.

export { createMockBiStream, createMockMidden, type MockBiStream, type MockMidden } from "./mock-node.js";
export {
  CollectingStream,
  makeServingStream,
  encodeJsonMessage,
  decodeJsonMessage,
  type CollectingStreamOptions,
  type MakeServingStreamOptions,
  type ServingStreamEntry,
} from "./streams.js";
export { makeWav, type MakeWavOptions } from "./media.js";
export { deterministicBytes, randomBlobBytes, DEFAULT_RANDOM_BLOB_SIZE } from "./blob-fixtures.js";
export { fakeIdbHarness } from "./idb-harness.js";
export { createMockBlobFetcher, type MockBlobBehaviour, type MockBlobFetcher } from "./mock-blob-fetch.js";

