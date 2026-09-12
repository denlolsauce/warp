import Redis from "ioredis";
import type { ProcessingJobMessage } from "@warp-survey/contracts";
import { prisma } from "./prisma";

const globalForRedis = globalThis as unknown as { surveyRedis: Redis | undefined };

function createRedisClient(): Redis {
  return new Redis(process.env.REDIS_URL as string);
}

export const redis = globalForRedis.surveyRedis ?? createRedisClient();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.surveyRedis = redis;
}

// Plain JSON on a Redis list — the consumer is the Python worker, so the wire
// format must stay language-neutral. Reliability comes from the worker-side
// pending/in-flight claiming with leases (services/pipeline/queue.py) plus
// the transactional outbox below; the web side only appends.
export const PIPELINE_PENDING_KEY = "warp-survey:jobs:pending";

/**
 * Transactional outbox: the ProcessingRun and its queue message commit in one
 * database transaction; a relay then pushes undelivered messages to Redis.
 * A run can therefore never exist without an eventually delivered message,
 * and a Redis failure never strands a half-created run.
 */
export async function enqueueViaOutbox(
  tx: Pick<typeof prisma, "outboxMessage">,
  message: ProcessingJobMessage,
): Promise<void> {
  await tx.outboxMessage.create({
    data: { queue: PIPELINE_PENDING_KEY, payload: message as object },
  });
}

/**
 * Relay undelivered outbox rows to Redis. Called opportunistically after each
 * submission and safe to run concurrently: the updateMany guard means a row
 * is only marked delivered once, and duplicate LPUSHes are tolerated because
 * the worker deduplicates by (runId) idempotency at claim time.
 */
export async function relayOutbox(limit = 20): Promise<number> {
  const pending = await prisma.outboxMessage.findMany({
    where: { deliveredAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let delivered = 0;
  for (const row of pending) {
    await redis.lpush(row.queue, JSON.stringify(row.payload));
    const updated = await prisma.outboxMessage.updateMany({
      where: { id: row.id, deliveredAt: null },
      data: { deliveredAt: new Date() },
    });
    delivered += updated.count;
  }
  return delivered;
}
