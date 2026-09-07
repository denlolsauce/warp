-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStage" AS ENUM ('INGEST', 'FRAME_EXTRACTION', 'POSE_ESTIMATION', 'TRAINING', 'CLEANUP', 'COMPRESSION', 'PUBLISH');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('PLY', 'SOG', 'POSTER', 'TURNTABLE_VIDEO');

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_tourId_fkey";

-- DropForeignKey
ALTER TABLE "Tour" DROP CONSTRAINT "Tour_userId_fkey";

-- DropForeignKey
ALTER TABLE "Video" DROP CONSTRAINT "Video_tourId_fkey";

-- DropIndex
DROP INDEX "Job_tourId_idx";

-- AlterTable
ALTER TABLE "Job" DROP COLUMN "stage",
DROP COLUMN "state",
DROP COLUMN "tourId",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "currentStage" "JobStage",
ADD COLUMN     "gpuSeconds" DOUBLE PRECISION,
ADD COLUMN     "productId" TEXT NOT NULL,
ADD COLUMN     "status" "JobStatus" NOT NULL DEFAULT 'QUEUED';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "credits";

-- DropTable
DROP TABLE "Tour";

-- DropTable
DROP TABLE "Video";

-- DropEnum
DROP TYPE "TourStatus";

-- DropEnum
DROP TYPE "VideoRole";

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVideo" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobStageRun" (
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

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Membership_orgId_idx" ON "Membership"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_orgId_key" ON "Membership"("userId", "orgId");

-- CreateIndex
CREATE INDEX "Product_orgId_idx" ON "Product"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVideo_productId_key" ON "ProductVideo"("productId");

-- CreateIndex
CREATE INDEX "JobStageRun_jobId_idx" ON "JobStageRun"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobStageRun_jobId_stage_attempt_key" ON "JobStageRun"("jobId", "stage", "attempt");

-- CreateIndex
CREATE INDEX "Asset_productId_idx" ON "Asset"("productId");

-- CreateIndex
CREATE INDEX "Job_productId_idx" ON "Job"("productId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVideo" ADD CONSTRAINT "ProductVideo_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobStageRun" ADD CONSTRAINT "JobStageRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
