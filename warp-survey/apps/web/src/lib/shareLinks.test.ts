import { describe, expect, it } from "vitest";
import { generateShareToken, hashShareToken } from "./shareLinks";

describe("share tokens", () => {
  it("stores only the hash of a high-entropy token", () => {
    const { token, tokenHash } = generateShareToken();
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashShareToken(token));
    expect(tokenHash).not.toContain(token);
  });

  it("generates unique tokens", () => {
    expect(generateShareToken().token).not.toBe(generateShareToken().token);
  });
});
