import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const R2_BUCKET = process.env.R2_BUCKET_NAME as string;

// R2's S3-compatible endpoint — https://developers.cloudflare.com/r2/api/s3/api/
export const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
  },
});

const PART_URL_EXPIRY_SECONDS = 60 * 60; // 1 hour per part — generous for slow mobile uplinks

export function videoStorageKey(tourId: string, videoId: string, filename: string): string {
  const ext = filename.split(".").pop() ?? "mp4";
  return `videos/${tourId}/${videoId}.${ext}`;
}

export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const result = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType }),
  );
  if (!result.UploadId) throw new Error("R2 did not return an UploadId");
  return result.UploadId;
}

export async function getPartUploadUrl(key: string, uploadId: string, partNumber: number): Promise<string> {
  const command = new UploadPartCommand({
    Bucket: R2_BUCKET,
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
      Bucket: R2_BUCKET,
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
  await s3.send(new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, UploadId: uploadId }));
}
