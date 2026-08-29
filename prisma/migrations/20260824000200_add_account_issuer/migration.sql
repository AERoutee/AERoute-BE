ALTER TABLE "MsAccount" ADD COLUMN "issuer" TEXT;

UPDATE "MsAccount"
SET "issuer" = CASE
  WHEN "providerId" = 'credential' THEN 'local:credential'
  ELSE 'local:oauth:' || replace(replace(replace("providerId", '%', '%25'), ':', '%3A'), '/', '%2F')
END
WHERE "issuer" IS NULL;

ALTER TABLE "MsAccount" ALTER COLUMN "issuer" SET NOT NULL;
ALTER TABLE "MsAccount" DROP CONSTRAINT "MsAccount_providerId_accountId_key";
ALTER TABLE "MsAccount" ADD CONSTRAINT "MsAccount_issuer_accountId_uidx" UNIQUE ("issuer", "accountId");
