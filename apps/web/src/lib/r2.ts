import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const R2_BUCKET = process.env.R2_BUCKET_NAME ?? "";

function bucketName(): string {
  if (!R2_BUCKET) throw new Error("R2_BUCKET_NAME is required for object storage");
  return R2_BUCKET;
}

const customEndpoint = process.env.S3_ENDPOINT?.trim() || undefined;
const accountEndpoint = process.env.R2_ACCOUNT_ID
  ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  : undefined;

export const s3 = new S3Client({
  region: process.env.S3_REGION ?? (customEndpoint ? "us-east-1" : "auto"),
  endpoint: customEndpoint ?? accountEndpoint,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
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
    new CreateMultipartUploadCommand({ Bucket: bucketName(), Key: key, ContentType: contentType }),
  );
  if (!result.UploadId) throw new Error("R2 did not return an UploadId");
  return result.UploadId;
}

export async function getPartUploadUrl(key: string, uploadId: string, partNumber: number): Promise<string> {
  const command = new UploadPartCommand({
    Bucket: bucketName(),
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
      Bucket: bucketName(),
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
  await s3.send(new AbortMultipartUploadCommand({ Bucket: bucketName(), Key: key, UploadId: uploadId }));
}

export async function getObjectSize(key: string): Promise<number | null> {
  const result = await s3.send(new HeadObjectCommand({ Bucket: bucketName(), Key: key }));
  return result.ContentLength ?? null;
}

export async function getSignedObjectUrl(key: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucketName(), Key: key }), { expiresIn: 900 });
}

export async function deleteStorageObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName(), Key: key }));
}
