DO $$ BEGIN
  CREATE TYPE "AccessibilityMode" AS ENUM ('STANDARD', 'REDUCED_EXERTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TransitPreference" AS ENUM ('LESS_WALKING', 'FEWER_TRANSFERS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'TrRouteResult' AND column_name = 'hazardsAvoided')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'TrRouteResult' AND column_name = 'fewerConfirmedReportSignals') THEN
    ALTER TABLE "TrRouteResult" RENAME COLUMN "hazardsAvoided" TO "fewerConfirmedReportSignals";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'TrTripImpact' AND column_name = 'hazardsAvoided')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'TrTripImpact' AND column_name = 'fewerConfirmedReportSignals') THEN
    ALTER TABLE "TrTripImpact" RENAME COLUMN "hazardsAvoided" TO "fewerConfirmedReportSignals";
  END IF;
END $$;

ALTER TABLE "MsSavedCommute"
  ADD COLUMN IF NOT EXISTS "transitModes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "transitPreference" "TransitPreference",
  ADD COLUMN IF NOT EXISTS "accessibilityMode" "AccessibilityMode" NOT NULL DEFAULT 'STANDARD';

CREATE UNIQUE INDEX IF NOT EXISTS "TrTripImpact_routeResultId_key" ON "TrTripImpact"("routeResultId");

ALTER TABLE "TrTripImpact" DROP CONSTRAINT IF EXISTS "TrTripImpact_comparisonId_fkey";
DROP INDEX IF EXISTS "TrTripImpact_comparisonId_idx";
ALTER TABLE "TrTripImpact" DROP COLUMN IF EXISTS "comparisonId";
