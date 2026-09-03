CREATE TYPE "RoutePlaceKind" AS ENUM ('REST_STOP', 'TRANSIT_STOP');

CREATE TABLE "TrRoutePlace" (
  "id" UUID NOT NULL,
  "routeResultId" UUID NOT NULL,
  "placeId" TEXT NOT NULL,
  "kind" "RoutePlaceKind" NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "role" VARCHAR(16),
  "placeIdRefreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrRoutePlace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrRoutePlace_routeResultId_fkey" FOREIGN KEY ("routeResultId") REFERENCES "TrRouteResult"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "TrRoutePlace_routeResultId_kind_ordinal_key" ON "TrRoutePlace"("routeResultId", "kind", "ordinal");
CREATE INDEX "TrRoutePlace_routeResultId_kind_idx" ON "TrRoutePlace"("routeResultId", "kind");
CREATE INDEX "TrRoutePlace_placeIdRefreshedAt_idx" ON "TrRoutePlace"("placeIdRefreshedAt");
