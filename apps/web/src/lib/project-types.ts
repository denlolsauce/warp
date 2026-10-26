import type { JobStage, JobStatus, ProductStatus, StageStatus } from "@prisma/client";

export interface ProjectDto {
  id: string;
  name: string;
  description: string;
  location: string | null;
  captureProfile: string;
  status: ProductStatus;
  createdAt: string;
  shared: boolean;
  shareToken: string | null;
  sogUrl: string | null;
  plyUrl: string | null;
  sizeBytes: number | null;
  job: {
    id: string;
    status: JobStatus;
    currentStage: JobStage | null;
    errorMessage: string | null;
    stages: Array<{
      stage: JobStage;
      status: StageStatus;
      metrics: Record<string, unknown> | null;
    }>;
  } | null;
}

export interface CreateProjectInput {
  name: string;
  description: string;
  location: string | null;
  uploadId: string;
  key?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  location?: string | null;
}

export interface UploadPartInput {
  partNumber: number;
  etag: string;
}

export interface WorkerAssetInput {
  key: string;
  url: string;
  sizeBytes: number;
  contentHash: string;
}

export type WorkerCompletionInput =
  | { status: "success"; assets: { sog: WorkerAssetInput; ply: WorkerAssetInput } }
  | { status: "failure"; errorMessage: string };

const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const VIDEO_CONTENT_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const text = value.trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return boundedText(value, maxLength);
}

export function parseCreateProjectInput(value: unknown): CreateProjectInput | null {
  const body = asRecord(value);
  if (!body) return null;
  const name = boundedText(body.name, 120);
  const description = body.description === undefined || body.description === null || body.description === ""
    ? ""
    : boundedText(body.description, 2000);
  const location = body.location === undefined ? null : optionalText(body.location, 200);
  const uploadId = boundedText(body.uploadId, 512);
  const key = body.key === undefined ? undefined : boundedText(body.key, 1024);
  if (
    !name || description === null || description === undefined || location === undefined ||
    (body.location !== undefined && body.location !== null && body.location !== "" && location === null) ||
    !uploadId || (body.key !== undefined && !key)
  ) return null;
  return { name, description, location, uploadId, ...(key ? { key } : {}) };
}

export function parseUpdateProjectInput(value: unknown): UpdateProjectInput | null {
  const body = asRecord(value);
  if (!body) return null;
  const allowed = new Set(["name", "description", "location"]);
  if (Object.keys(body).some((key) => !allowed.has(key)) || !Object.keys(body).length) return null;

  const input: UpdateProjectInput = {};
  if ("name" in body) {
    const name = boundedText(body.name, 120);
    if (!name) return null;
    input.name = name;
  }
  if ("description" in body) {
    const description = body.description === null || body.description === "" ? "" : boundedText(body.description, 2000);
    if (description === null) return null;
    input.description = description;
  }
  if ("location" in body) {
    const location = optionalText(body.location, 200);
    if (location === undefined) return null;
    if (body.location !== null && body.location !== "" && location === null) return null;
    input.location = location;
  }
  return input;
}

export function parseUploadInitiateInput(value: unknown): {
  filename: string;
  contentType: string;
  extension: string;
  sizeBytes: number | null;
} | null {
  const body = asRecord(value);
  if (!body) return null;
  const filename = boundedText(body.filename, 255);
  const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
  const extension = VIDEO_CONTENT_TYPES[contentType];
  const sizeBytes = body.sizeBytes === undefined ? null : body.sizeBytes;
  if (
    !filename || !extension ||
    (sizeBytes !== null && (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_VIDEO_BYTES))
  ) return null;
  return { filename, contentType, extension, sizeBytes: sizeBytes as number | null };
}

export function parseUploadParts(value: unknown): UploadPartInput[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10_000) return null;
  const parts: UploadPartInput[] = [];
  const seen = new Set<number>();
  for (const valuePart of value) {
    const part = asRecord(valuePart);
    const partNumber = part?.partNumber;
    const etag = part?.etag;
    if (
      typeof partNumber !== "number" || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000 ||
      seen.has(partNumber as number) || typeof etag !== "string" || !etag.trim() || etag.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(etag)
    ) return null;
    seen.add(partNumber as number);
    parts.push({ partNumber: partNumber as number, etag });
  }
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

function parseWorkerAsset(value: unknown): WorkerAssetInput | null {
  const asset = asRecord(value);
  if (!asset) return null;
  const key = boundedText(asset.key, 1024);
  const url = boundedText(asset.url, 4096);
  const contentHash = boundedText(asset.contentHash, 128);
  const sizeBytes = asset.sizeBytes;
  if (!key || !url || !contentHash || typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) return null;
  return { key, url, sizeBytes: sizeBytes as number, contentHash };
}

export function parseWorkerCompletionInput(value: unknown): WorkerCompletionInput | null {
  const body = asRecord(value);
  if (body?.status === "success") {
    const assets = asRecord(body.assets);
    const sog = parseWorkerAsset(assets?.sog);
    const ply = parseWorkerAsset(assets?.ply);
    return sog && ply ? { status: "success", assets: { sog, ply } } : null;
  }
  if (body?.status === "failure") {
    const errorMessage = boundedText(body.errorMessage, 2000);
    return errorMessage ? { status: "failure", errorMessage } : null;
  }
  return null;
}
