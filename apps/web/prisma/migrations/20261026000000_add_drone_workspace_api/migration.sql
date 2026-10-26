DO $$ BEGIN
    CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "PlanTier" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "JobStage" AS ENUM ('INGEST', 'FRAME_EXTRACTION', 'POSE_ESTIMATION', 'TRAINING', 'CLEANUP', 'COMPRESSION', 'PUBLISH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "AssetKind" AS ENUM ('PLY', 'SOG', 'POSTER', 'TURNTABLE_VIDEO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "UploadSessionStatus" AS ENUM ('ACTIVE', 'COMPLETING', 'COMPLETED', 'ABORTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The original scaffold used Job for Tour processing. Keep that history intact
-- while reserving Job for the current Product pipeline state machine.
DO $$ BEGIN
    IF to_regclass('public."Job"') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'Job' AND column_name = 'tourId'
       )
       AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'Job' AND column_name = 'productId'
       )
       AND to_regclass('public."LegacyJob"') IS NULL THEN
        ALTER TABLE "Job" RENAME TO "LegacyJob";
    END IF;
END $$;

DO $$ BEGIN
    IF to_regclass('public."LegacyJob"') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conrelid = to_regclass('public."LegacyJob"') AND conname = 'Job_pkey'
       ) THEN
        ALTER TABLE "LegacyJob" RENAME CONSTRAINT "Job_pkey" TO "LegacyJob_pkey";
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UploadSession" (
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

CREATE TABLE IF NOT EXISTS "Product" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "captureProfile" TEXT NOT NULL DEFAULT 'product',
    "shareToken" TEXT,
    "uploadSessionId" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "captureProfile" TEXT NOT NULL DEFAULT 'product';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shareToken" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "uploadSessionId" TEXT;

CREATE TABLE IF NOT EXISTS "ProductVideo" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductVideo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Job" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStage" "JobStage",
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "gpuSeconds" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JobStageRun" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stage" "JobStage" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metrics" JSONB,
    "artifactKey" TEXT,
    CONSTRAINT "JobStageRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Asset" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Membership_userId_orgId_key" ON "Membership"("userId", "orgId");
CREATE INDEX IF NOT EXISTS "Membership_orgId_idx" ON "Membership"("orgId");
CREATE INDEX IF NOT EXISTS "UploadSession_userId_status_idx" ON "UploadSession"("userId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "UploadSession_uploadId_key" ON "UploadSession"("uploadId");
CREATE UNIQUE INDEX IF NOT EXISTS "UploadSession_storageKey_key" ON "UploadSession"("storageKey");
CREATE INDEX IF NOT EXISTS "Product_orgId_idx" ON "Product"("orgId");
CREATE UNIQUE INDEX IF NOT EXISTS "Product_shareToken_key" ON "Product"("shareToken");
CREATE UNIQUE INDEX IF NOT EXISTS "Product_uploadSessionId_key" ON "Product"("uploadSessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductVideo_productId_key" ON "ProductVideo"("productId");
CREATE INDEX IF NOT EXISTS "Job_productId_idx" ON "Job"("productId");
CREATE UNIQUE INDEX IF NOT EXISTS "JobStageRun_jobId_stage_attempt_key" ON "JobStageRun"("jobId", "stage", "attempt");
CREATE INDEX IF NOT EXISTS "JobStageRun_jobId_idx" ON "JobStageRun"("jobId");
CREATE INDEX IF NOT EXISTS "Asset_productId_idx" ON "Asset"("productId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Membership_userId_fkey' AND conrelid = 'public."Membership"'::regclass) THEN
        ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Membership_orgId_fkey' AND conrelid = 'public."Membership"'::regclass) THEN
        ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UploadSession_userId_fkey' AND conrelid = 'public."UploadSession"'::regclass) THEN
        ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_orgId_fkey' AND conrelid = 'public."Product"'::regclass) THEN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_uploadSessionId_fkey' AND conrelid = 'public."Product"'::regclass) THEN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_uploadSessionId_fkey" FOREIGN KEY ("uploadSessionId") REFERENCES "UploadSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductVideo_productId_fkey' AND conrelid = 'public."ProductVideo"'::regclass) THEN
        ALTER TABLE "ProductVideo" ADD CONSTRAINT "ProductVideo_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Job_productId_fkey' AND conrelid = 'public."Job"'::regclass) THEN
        ALTER TABLE "Job" ADD CONSTRAINT "Job_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobStageRun_jobId_fkey' AND conrelid = 'public."JobStageRun"'::regclass) THEN
        ALTER TABLE "JobStageRun" ADD CONSTRAINT "JobStageRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Asset_productId_fkey' AND conrelid = 'public."Asset"'::regclass) THEN
        ALTER TABLE "Asset" ADD CONSTRAINT "Asset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
