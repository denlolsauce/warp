import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Vendored from upstream apps/web/src/lib/r2.ts (see VENDORED.md), made
// provider-neutral: any S3-compatible endpoint (MinIO locally, an EU-region
// bucket in production). The bucket is private; nothing here produces a
// permanent public URL.
export const STORAGE_BUCKET = process.env.SURVEY_STORAGE_BUCKET as string;

export const s3 = new S3Client({
  region: process.env.SURVEY_STORAGE_REGION ?? "auto",
  endpoint: process.env.SURVEY_STORAGE_ENDPOINT,
  forcePathStyle: process.env.SURVEY_STORAGE_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: process.env.SURVEY_STORAGE_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.SURVEY_STORAGE_SECRET_ACCESS_KEY as string,
  },
});

const PART_URL_EXPIRY_SECONDS = 60 * 60; // generous for slow field uplinks
const DOWNLOAD_URL_EXPIRY_SECONDS = 10 * 60; // short-lived; every request re-authorizes

export function captureFileStorageKey(surveyId: string, captureFileId: string, filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "bin";
  return `surveys/${surveyId}/capture/${captureFileId}.${ext}`;
}

export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const result = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: STORAGE_BUCKET, Key: key, ContentType: contentType }),
  );
  if (!result.UploadId) throw new Error("storage did not return an UploadId");
  return result.UploadId;
}

export async function getPartUploadUrl(key: string, uploadId: string, partNumber: number): Promise<string> {
  const command = new UploadPartCommand({
    Bucket: STORAGE_BUCKET,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(s3, command, { expiresIn: PART_URL_EXPIRY_SECONDS });
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: CompletedPart[],
): Promise<void> {
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: STORAGE_BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    }),
  );
}

export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  await s3.send(new AbortMultipartUploadCommand({ Bucket: STORAGE_BUCKET, Key: key, UploadId: uploadId }));
}

/** Short-lived signed GET. Callers must authorize (tenant or share-link scope) first. */
export async function getDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: STORAGE_BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS });
}
