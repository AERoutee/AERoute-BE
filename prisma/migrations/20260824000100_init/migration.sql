CREATE TYPE "TravelMode" AS ENUM ('WALK', 'BICYCLE');
CREATE TYPE "RoutePreference" AS ENUM ('balanced', 'lower_exposure');
CREATE TYPE "DataQuality" AS ENUM ('modeled_estimate', 'partial_estimate');

CREATE TABLE "MsUser" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "image" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "TrSession" (
  "id" TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "MsUser"("id") ON DELETE CASCADE
);
CREATE INDEX "TrSession_userId_idx" ON "TrSession"("userId");

CREATE TABLE "MsAccount" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "MsUser"("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "refreshTokenExpiresAt" TIMESTAMP(3),
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MsAccount_providerId_accountId_key" UNIQUE ("providerId", "accountId")
);
CREATE INDEX "MsAccount_userId_idx" ON "MsAccount"("userId");

CREATE TABLE "TrVerification" (
  "id" TEXT PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "TrVerification_identifier_idx" ON "TrVerification"("identifier");

CREATE TABLE "TrRateLimit" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL
);

CREATE TABLE "TrRouteComparison" (
  "id" UUID PRIMARY KEY,
  "userId" TEXT REFERENCES "MsUser"("id") ON DELETE CASCADE,
  "originLabel" VARCHAR(180),
  "destinationLabel" VARCHAR(180),
  "mode" "TravelMode" NOT NULL,
  "preference" "RoutePreference" NOT NULL,
  "sensitiveUser" BOOLEAN NOT NULL DEFAULT false,
  "routeSource" VARCHAR(80) NOT NULL,
  "airQualitySource" VARCHAR(120) NOT NULL,
  "calculationVersion" VARCHAR(32) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TrRouteComparison_userId_createdAt_idx" ON "TrRouteComparison"("userId", "createdAt" DESC);

CREATE TABLE "TrRouteResult" (
  "id" UUID PRIMARY KEY,
  "comparisonId" UUID NOT NULL REFERENCES "TrRouteComparison"("id") ON DELETE CASCADE,
  "providerRouteId" VARCHAR(80) NOT NULL,
  "labels" TEXT[] NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "distanceMeters" INTEGER NOT NULL,
  "estimatedExposureIndex" DOUBLE PRECISION NOT NULL,
  "averagePm25" DOUBLE PRECISION NOT NULL,
  "reductionPercent" INTEGER NOT NULL,
  "dataQuality" "DataQuality" NOT NULL,
  "airQualityTimestamp" TIMESTAMP(3) NOT NULL,
  "encodedPolyline" TEXT NOT NULL
);
CREATE INDEX "TrRouteResult_comparisonId_idx" ON "TrRouteResult"("comparisonId");
