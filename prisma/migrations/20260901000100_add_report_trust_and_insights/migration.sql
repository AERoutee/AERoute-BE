ALTER TYPE "TravelMode" ADD VALUE 'TRANSIT';

CREATE TYPE "RoadReportVerdict" AS ENUM ('CONFIRM', 'DISPUTE');
CREATE TYPE "AccessibilityMode" AS ENUM ('STANDARD', 'REDUCED_EXERTION');
CREATE TYPE "TransitPreference" AS ENUM ('LESS_WALKING', 'FEWER_TRANSFERS');

ALTER TABLE "TrRouteComparison"
  ADD COLUMN "originLatitude" DOUBLE PRECISION,
  ADD COLUMN "originLongitude" DOUBLE PRECISION,
  ADD COLUMN "destinationLatitude" DOUBLE PRECISION,
  ADD COLUMN "destinationLongitude" DOUBLE PRECISION,
  ADD CONSTRAINT "TrRouteComparison_originLatitude_check" CHECK ("originLatitude" IS NULL OR "originLatitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "TrRouteComparison_originLongitude_check" CHECK ("originLongitude" IS NULL OR "originLongitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "TrRouteComparison_destinationLatitude_check" CHECK ("destinationLatitude" IS NULL OR "destinationLatitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "TrRouteComparison_destinationLongitude_check" CHECK ("destinationLongitude" IS NULL OR "destinationLongitude" BETWEEN -180 AND 180);

ALTER TABLE "TrRoadReport" ADD COLUMN "resolvedAt" TIMESTAMP(3);

ALTER TABLE "TrRouteResult"
  ADD COLUMN "fewerConfirmedReportSignals" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "activeDistanceMeters" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "activeDurationSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "TrRouteResult_fewerConfirmedReportSignals_check" CHECK ("fewerConfirmedReportSignals" >= 0),
  ADD CONSTRAINT "TrRouteResult_activeDistanceMeters_check" CHECK ("activeDistanceMeters" >= 0),
  ADD CONSTRAINT "TrRouteResult_activeDurationSeconds_check" CHECK ("activeDurationSeconds" >= 0);

CREATE TABLE "TrRoadReportVerification" (
  "id" UUID NOT NULL,
  "reportId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "verdict" "RoadReportVerdict" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrRoadReportVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MsSavedCommute" (
  "id" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "originLabel" VARCHAR(180) NOT NULL,
  "originLatitude" DOUBLE PRECISION NOT NULL,
  "originLongitude" DOUBLE PRECISION NOT NULL,
  "destinationLabel" VARCHAR(180) NOT NULL,
  "destinationLatitude" DOUBLE PRECISION NOT NULL,
  "destinationLongitude" DOUBLE PRECISION NOT NULL,
  "mode" "TravelMode" NOT NULL,
  "preference" "RoutePreference" NOT NULL,
  "transitModes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "transitPreference" "TransitPreference",
  "accessibilityMode" "AccessibilityMode" NOT NULL DEFAULT 'STANDARD',
  "sensitiveUser" BOOLEAN NOT NULL DEFAULT false,
  "watchEnabled" BOOLEAN NOT NULL DEFAULT true,
  "watchHour" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MsSavedCommute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MsSavedCommute_originLatitude_check" CHECK ("originLatitude" BETWEEN -90 AND 90),
  CONSTRAINT "MsSavedCommute_originLongitude_check" CHECK ("originLongitude" BETWEEN -180 AND 180),
  CONSTRAINT "MsSavedCommute_destinationLatitude_check" CHECK ("destinationLatitude" BETWEEN -90 AND 90),
  CONSTRAINT "MsSavedCommute_destinationLongitude_check" CHECK ("destinationLongitude" BETWEEN -180 AND 180),
  CONSTRAINT "MsSavedCommute_watchHour_check" CHECK ("watchHour" IS NULL OR "watchHour" BETWEEN 0 AND 23)
);

CREATE TABLE "TrTripImpact" (
  "id" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "comparisonId" UUID NOT NULL,
  "routeResultId" UUID NOT NULL,
  "mode" "TravelMode" NOT NULL,
  "distanceMeters" INTEGER NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "activeDistanceMeters" INTEGER NOT NULL,
  "activeDurationSeconds" INTEGER NOT NULL,
  "baselineExposureIndex" DOUBLE PRECISION NOT NULL,
  "selectedExposureIndex" DOUBLE PRECISION NOT NULL,
  "fewerConfirmedReportSignals" INTEGER NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrTripImpact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrTripImpact_distanceMeters_check" CHECK ("distanceMeters" >= 0),
  CONSTRAINT "TrTripImpact_durationSeconds_check" CHECK ("durationSeconds" >= 0),
  CONSTRAINT "TrTripImpact_activeDistanceMeters_check" CHECK ("activeDistanceMeters" >= 0),
  CONSTRAINT "TrTripImpact_activeDurationSeconds_check" CHECK ("activeDurationSeconds" >= 0),
  CONSTRAINT "TrTripImpact_baselineExposureIndex_check" CHECK ("baselineExposureIndex" >= 0 AND "baselineExposureIndex" <= 1000000),
  CONSTRAINT "TrTripImpact_selectedExposureIndex_check" CHECK ("selectedExposureIndex" >= 0 AND "selectedExposureIndex" <= 1000000),
  CONSTRAINT "TrTripImpact_fewerConfirmedReportSignals_check" CHECK ("fewerConfirmedReportSignals" >= 0)
);

CREATE UNIQUE INDEX "TrRoadReportVerification_reportId_userId_key" ON "TrRoadReportVerification"("reportId", "userId");
CREATE INDEX "TrRoadReportVerification_reportId_verdict_idx" ON "TrRoadReportVerification"("reportId", "verdict");
CREATE INDEX "TrRoadReportVerification_userId_createdAt_idx" ON "TrRoadReportVerification"("userId", "createdAt" DESC);
CREATE INDEX "MsSavedCommute_userId_createdAt_idx" ON "MsSavedCommute"("userId", "createdAt" DESC);
CREATE INDEX "TrTripImpact_userId_completedAt_idx" ON "TrTripImpact"("userId", "completedAt" DESC);
CREATE INDEX "TrTripImpact_comparisonId_idx" ON "TrTripImpact"("comparisonId");
CREATE UNIQUE INDEX "TrTripImpact_routeResultId_key" ON "TrTripImpact"("routeResultId");

ALTER TABLE "TrRoadReportVerification" ADD CONSTRAINT "TrRoadReportVerification_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TrRoadReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrRoadReportVerification" ADD CONSTRAINT "TrRoadReportVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MsUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MsSavedCommute" ADD CONSTRAINT "MsSavedCommute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MsUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrTripImpact" ADD CONSTRAINT "TrTripImpact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MsUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrTripImpact" ADD CONSTRAINT "TrTripImpact_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "TrRouteComparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrTripImpact" ADD CONSTRAINT "TrTripImpact_routeResultId_fkey" FOREIGN KEY ("routeResultId") REFERENCES "TrRouteResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
