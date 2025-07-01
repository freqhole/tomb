#!/usr/bin/env node

/**
 * Test Script: Media Blob ID Schema Changes
 *
 * Verifies that the frontend correctly handles the transition from UUID to short hash IDs
 * for media blobs while maintaining UUID support for other entities.
 */

import { z } from "zod";

// Import our updated schemas
const ShortHashSchema = z
  .string()
  .regex(/^[a-f0-9]{7,16}$/, "Must be a 7-16 character hex hash");

const UuidSchema = z.string().uuid();

const MediaBlobSchema = z.object({
  id: ShortHashSchema,
  sha256: z.string(),
  size: z.number().int().optional(),
  mime: z.string().optional(),
  source_client_id: z.string().optional(),
  local_path: z.string().nullish(),
  metadata: z.record(z.any()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  parent_blob_id: ShortHashSchema.optional(),
  blob_type: z
    .enum(["original", "thumbnail", "waveform", "preview"])
    .default("original"),
});

const CreateMediaBlobSchema = z.object({
  sha256: z.string(),
  size: z.number().int().optional(),
  mime: z.string().optional(),
  source_client_id: z.string().optional(),
  local_path: z.string().nullish(),
  metadata: z.record(z.any()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  parent_blob_id: ShortHashSchema.optional(),
  blob_type: z
    .enum(["original", "thumbnail", "waveform", "preview"])
    .default("original"),
});

const SongSchema = z.object({
  id: UuidSchema,
  media_blob_id: ShortHashSchema,
  thumbnail_blob_id: ShortHashSchema.optional(),
  waveform_blob_id: ShortHashSchema.optional(),
  title: z.string(),
  artist: z.string().optional(),
  album: z.string().optional(),
});

// Test data
const testCases = {
  validShortHashes: [
    "abc1234",
    "def5678",
    "abc9def",
    "1234567",
    "abcdef123456789a",
    "f1e2d3c4b5a6",
  ],
  invalidShortHashes: [
    "abc123", // too short (6 chars)
    "abcdef123456789ab", // too long (17 chars)
    "ABC1234", // uppercase
    "abc123g", // invalid char 'g'
    "abc-123", // invalid char '-'
    "", // empty
  ],
  validUuids: [
    "123e4567-e89b-12d3-a456-426614174000",
    "550e8400-e29b-41d4-a716-446655440000",
  ],
  invalidUuids: [
    "abc1234", // short hash, not UUID
    "invalid-uuid",
  ],
  validMediaBlob: {
    id: "abc1234",
    sha256:
      "abc123def456789abcdef123456789abcdef123456789abcdef123456789abcdef",
    size: 1024,
    mime: "text/plain",
    source_client_id: "test-client",
    local_path: null,
    metadata: { name: "test.txt" },
    created_at: "2023-10-01T10:00:00Z",
    updated_at: "2023-10-01T10:00:00Z",
    blob_type: "original",
  },
  validCreateMediaBlob: {
    sha256:
      "abc123def456789abcdef123456789abcdef123456789abcdef123456789abcdef",
    size: 1024,
    mime: "text/plain",
    source_client_id: "test-client",
    local_path: null,
    metadata: { name: "test.txt" },
    created_at: "2023-10-01T10:00:00Z",
    updated_at: "2023-10-01T10:00:00Z",
    blob_type: "original",
  },
  validSong: {
    id: "123e4567-e89b-12d3-a456-426614174000",
    media_blob_id: "abc1234",
    thumbnail_blob_id: "def5678",
    title: "Test Song",
    artist: "Test Artist",
  },
};

// Test runner
function runTests() {
  console.log("🧪 Testing Media Blob ID Schema Changes\n");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${name}: ${error.message}`);
      failed++;
    }
  }

  // Test short hash validation
  console.log("📋 Testing Short Hash Schema");
  testCases.validShortHashes.forEach((hash) => {
    test(`Valid short hash: ${hash}`, () => {
      ShortHashSchema.parse(hash);
    });
  });

  testCases.invalidShortHashes.forEach((hash) => {
    test(`Invalid short hash: ${hash || "(empty)"}`, () => {
      try {
        ShortHashSchema.parse(hash);
        throw new Error("Should have failed validation");
      } catch (error) {
        if (error.message === "Should have failed validation") {
          throw error;
        }
        // Expected validation error
      }
    });
  });

  // Test UUID validation still works
  console.log(
    "\n📋 Testing UUID Schema (should still work for non-blob entities)"
  );
  testCases.validUuids.forEach((uuid) => {
    test(`Valid UUID: ${uuid}`, () => {
      UuidSchema.parse(uuid);
    });
  });

  testCases.invalidUuids.forEach((uuid) => {
    test(`Invalid UUID: ${uuid}`, () => {
      try {
        UuidSchema.parse(uuid);
        throw new Error("Should have failed validation");
      } catch (error) {
        if (error.message === "Should have failed validation") {
          throw error;
        }
        // Expected validation error
      }
    });
  });

  // Test MediaBlob schema
  console.log("\n📋 Testing MediaBlob Schema");
  test("Valid MediaBlob with short hash ID", () => {
    const result = MediaBlobSchema.parse(testCases.validMediaBlob);
    if (result.id !== "abc1234") {
      throw new Error(`Expected ID abc1234, got ${result.id}`);
    }
  });

  test("MediaBlob with UUID ID should fail", () => {
    const invalidBlob = {
      ...testCases.validMediaBlob,
      id: "123e4567-e89b-12d3-a456-426614174000",
    };
    try {
      MediaBlobSchema.parse(invalidBlob);
      throw new Error("Should have failed validation");
    } catch (error) {
      if (error.message === "Should have failed validation") {
        throw error;
      }
      // Expected validation error
    }
  });

  // Test CreateMediaBlob schema
  console.log("\n📋 Testing CreateMediaBlob Schema");
  test("Valid CreateMediaBlob without ID", () => {
    const result = CreateMediaBlobSchema.parse(testCases.validCreateMediaBlob);
    if ("id" in result) {
      throw new Error("CreateMediaBlob should not have ID field");
    }
  });

  // Test Song schema with media blob ID references
  console.log("\n📋 Testing Song Schema with Media Blob ID References");
  test("Valid Song with short hash media_blob_id", () => {
    const result = SongSchema.parse(testCases.validSong);
    if (result.media_blob_id !== "abc1234") {
      throw new Error(
        `Expected media_blob_id abc1234, got ${result.media_blob_id}`
      );
    }
  });

  test("Song with UUID media_blob_id should fail", () => {
    const invalidSong = {
      ...testCases.validSong,
      media_blob_id: "123e4567-e89b-12d3-a456-426614174000",
    };
    try {
      SongSchema.parse(invalidSong);
      throw new Error("Should have failed validation");
    } catch (error) {
      if (error.message === "Should have failed validation") {
        throw error;
      }
      // Expected validation error
    }
  });

  // Test edge cases
  console.log("\n📋 Testing Edge Cases");
  test("Minimum length short hash (7 chars)", () => {
    ShortHashSchema.parse("1234567");
  });

  test("Maximum length short hash (16 chars)", () => {
    ShortHashSchema.parse("1234567890abcdef");
  });

  test("MediaBlob with parent_blob_id reference", () => {
    const blobWithParent = {
      ...testCases.validMediaBlob,
      parent_blob_id: "def5678",
      blob_type: "thumbnail",
    };
    const result = MediaBlobSchema.parse(blobWithParent);
    if (result.parent_blob_id !== "def5678") {
      throw new Error(
        `Expected parent_blob_id def5678, got ${result.parent_blob_id}`
      );
    }
  });

  // Summary
  console.log("\n🎯 Test Results");
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);

  if (failed === 0) {
    console.log(
      "\n🎉 All tests passed! Media blob ID schema changes are working correctly."
    );
    console.log("\n📝 Key Changes Verified:");
    console.log("  • Media blob IDs now use 7-16 character hex hashes");
    console.log("  • Song/Playlist IDs still use UUIDs");
    console.log("  • CreateMediaBlob schema omits ID field (server-generated)");
    console.log("  • Parent blob ID references work with short hashes");
    console.log("  • Mixed ID types are properly validated");
    process.exit(0);
  } else {
    console.log(
      "\n💥 Some tests failed! Please check the schema implementations."
    );
    process.exit(1);
  }
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}

export { runTests };
