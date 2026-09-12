import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";

/**
 * Share tokens: 32 random bytes, base64url on the wire, only the SHA-256
 * stored. Scope is the exact set of published revisions; every asset request
 * re-checks expiry, revocation, and scope.
 */
export function generateShareToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashShareToken(token) };
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface ShareAccess {
  shareLinkId: string;
  revisionIds: string[];
}

/** Resolve a presented token to its scope, or null when invalid/expired/revoked. */
export async function resolveShareToken(token: string): Promise<ShareAccess | null> {
  const link = await prisma.shareLink.findUnique({
    where: { tokenHash: hashShareToken(token) },
    include: { revisions: { select: { revisionId: true } } },
  });
  if (!link) return null;
  if (link.revokedAt) return null;
  if (link.expiresAt.getTime() <= Date.now()) return null;
  return { shareLinkId: link.id, revisionIds: link.revisions.map((r) => r.revisionId) };
}
