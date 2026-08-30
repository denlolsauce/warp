import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

function createRedisClient(): Redis {
  return new Redis(process.env.REDIS_URL as string);
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

// Plain list, not a framework-specific queue (e.g. BullMQ): the consumer is
// the Python worker (CLAUDE.md), so the wire format needs to stay a simple,
// language-agnostic JSON payload rather than a Node-only job encoding.
export const PIPELINE_QUEUE_KEY = "products:pipeline:jobs";

export interface PipelineJobMessage {
  jobId: string;
  productId: string;
}

export async function enqueuePipelineJob(message: PipelineJobMessage): Promise<void> {
  await redis.lpush(PIPELINE_QUEUE_KEY, JSON.stringify(message));
}
