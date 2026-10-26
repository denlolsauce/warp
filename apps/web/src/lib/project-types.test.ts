import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isStorageConfigured } from "./r2";
import {
  parseCreateProjectInput,
  parseUploadInitiateInput,
  parseUploadParts,
  parseUpdateProjectInput,
  parseWorkerCompletionInput,
} from "./project-types";

describe("workspace API input parsing", () => {
  it("normalizes project creation while allowing an omitted location and storage key", () => {
    assert.deepEqual(parseCreateProjectInput({ name: "  North lot  ", uploadId: "u-1" }), {
      name: "North lot",
      description: "",
      location: null,
      uploadId: "u-1",
    });
  });

  it("rejects project fields outside their limits", () => {
    assert.equal(parseCreateProjectInput({ name: "\ninvalid", uploadId: "u-1" }), null);
    assert.equal(parseCreateProjectInput({ name: "Valid", uploadId: "u-1", role: "OWNER" }), null);
    assert.equal(parseUpdateProjectInput({ name: "a".repeat(121) }), null);
    assert.equal(parseUpdateProjectInput({ shareToken: "attacker-controlled" }), null);
  });

  it("accepts nullable project location and empty descriptions on updates", () => {
    assert.deepEqual(parseUpdateProjectInput({ location: null, description: "" }), {
      location: null,
      description: "",
    });
  });

  it("limits uploads to supported video content types and bounded sizes", () => {
    assert.equal(parseUploadInitiateInput({ filename: "flight.mp4", contentType: "video/mp4" })?.extension, "mp4");
    assert.equal(parseUploadInitiateInput({ filename: "flight.exe", contentType: "application/octet-stream" }), null);
    assert.equal(parseUploadInitiateInput({ filename: "flight.mp4", contentType: "video/mp4", sizeBytes: 2_000_000_001 }), null);
  });

  it("sorts valid unique multipart parts and rejects duplicate numbers", () => {
    assert.deepEqual(parseUploadParts([
      { partNumber: 2, etag: "b" },
      { partNumber: 1, etag: "a" },
    ]), [
      { partNumber: 1, etag: "a" },
      { partNumber: 2, etag: "b" },
    ]);
    assert.equal(parseUploadParts([{ partNumber: 1, etag: "a" }, { partNumber: 1, etag: "b" }]), null);
  });

  it("requires both valid output assets before a successful worker callback", () => {
    const asset = { key: "products/p/hash.sog", url: "https://assets.example/hash.sog", sizeBytes: 1, contentHash: "hash" };
    assert.equal(parseWorkerCompletionInput({ status: "success", assets: { sog: asset } }), null);
    assert.equal(parseWorkerCompletionInput({ status: "failure", errorMessage: "  " }), null);
    assert.deepEqual(parseWorkerCompletionInput({ status: "failure", errorMessage: "ingest: invalid video" }), {
      status: "failure",
      errorMessage: "ingest: invalid video",
    });
  });
});

describe("object storage availability", () => {
  it("requires bucket, credentials, and an R2 or S3-compatible endpoint", () => {
    const names = ["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ACCOUNT_ID", "S3_ENDPOINT"] as const;
    const previous = new Map(names.map((name) => [name, process.env[name]]));
    try {
      for (const name of names) delete process.env[name];
      assert.equal(isStorageConfigured(), false);
      process.env.R2_BUCKET_NAME = "test-bucket";
      process.env.R2_ACCESS_KEY_ID = "test-access";
      process.env.R2_SECRET_ACCESS_KEY = "test-secret";
      assert.equal(isStorageConfigured(), false);
      process.env.S3_ENDPOINT = "http://minio.invalid";
      assert.equal(isStorageConfigured(), true);
    } finally {
      for (const name of names) {
        const value = previous.get(name);
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
