CREATE TYPE "RoadReportCategory" AS ENUM ('HAZARD', 'BLOCKED_PATH', 'CRASH', 'CONSTRUCTION', 'MAP_ISSUE');

CREATE TABLE "TrRoadReport" (
  "id" UUID NOT NULL,
  "userId" TEXT,
  "category" "RoadReportCategory" NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrRoadReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrRoadReport_latitude_check" CHECK ("latitude" BETWEEN -90 AND 90),
  CONSTRAINT "TrRoadReport_longitude_check" CHECK ("longitude" BETWEEN -180 AND 180)
);

CREATE TABLE "TrRoadReportImage" (
  "id" UUID NOT NULL,
  "reportId" UUID NOT NULL,
  "objectKey" VARCHAR(300) NOT NULL,
  "imageUrl" VARCHAR(1000) NOT NULL,
  "position" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  CONSTRAINT "TrRoadReportImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrRoadReport_expiresAt_idx" ON "TrRoadReport"("expiresAt");
CREATE INDEX "TrRoadReport_latitude_longitude_expiresAt_idx" ON "TrRoadReport"("latitude", "longitude", "expiresAt");
CREATE INDEX "TrRoadReport_userId_createdAt_idx" ON "TrRoadReport"("userId", "createdAt" DESC);
CREATE UNIQUE INDEX "TrRoadReportImage_reportId_position_key" ON "TrRoadReportImage"("reportId", "position");
CREATE INDEX "TrRoadReportImage_reportId_idx" ON "TrRoadReportImage"("reportId");

ALTER TABLE "TrRoadReport" ADD CONSTRAINT "TrRoadReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MsUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrRoadReportImage" ADD CONSTRAINT "TrRoadReportImage_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TrRoadReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
