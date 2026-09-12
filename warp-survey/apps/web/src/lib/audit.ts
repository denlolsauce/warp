import { prisma } from "./prisma";

export interface AuditInput {
  orgId: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  context?: Record<string, unknown>;
}

/** Append an audit event. Never logs tokens or customer file contents. */
export async function recordAudit(input: AuditInput): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      context: (input.context ?? undefined) as object | undefined,
    },
  });
}
