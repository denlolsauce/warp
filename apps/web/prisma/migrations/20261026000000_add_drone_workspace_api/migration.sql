CREATE TYPE "UploadSessionStatus" AS ENUM ('ACTIVE', 'COMPLETING', 'COMPLETED', 'ABORTED');

CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "expectedSizeBytes" INTEGER,
    "completedSizeBytes" INTEGER,
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "completedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Product"
    ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "location" TEXT,
    ADD COLUMN "captureProfile" TEXT NOT NULL DEFAULT 'product',
    ADD COLUMN "shareToken" TEXT,
    ADD COLUMN "uploadSessionId" TEXT;

CREATE UNIQUE INDEX "UploadSession_uploadId_key" ON "UploadSession"("uploadId");
CREATE UNIQUE INDEX "UploadSession_storageKey_key" ON "UploadSession"("storageKey");
CREATE INDEX "UploadSession_userId_status_idx" ON "UploadSession"("userId", "status");
CREATE UNIQUE INDEX "Product_shareToken_key" ON "Product"("shareToken");
CREATE UNIQUE INDEX "Product_uploadSessionId_key" ON "Product"("uploadSessionId");

ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_uploadSessionId_fkey"
    FOREIGN KEY ("uploadSessionId") REFERENCES "UploadSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
