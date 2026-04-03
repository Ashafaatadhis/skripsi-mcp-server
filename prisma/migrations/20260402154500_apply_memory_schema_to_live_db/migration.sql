ALTER TABLE "LongTermMemory"
ADD COLUMN IF NOT EXISTS "canonicalKey" TEXT,
ADD COLUMN IF NOT EXISTS "category" TEXT,
ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "importanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "memoryType" TEXT,
ADD COLUMN IF NOT EXISTS "mentionCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "sourceType" TEXT,
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

UPDATE "LongTermMemory"
SET
  "category" = COALESCE("category", 'general'),
  "memoryType" = COALESCE("memoryType", 'fact'),
  "updatedAt" = COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP);

ALTER TABLE "LongTermMemory"
ALTER COLUMN "category" SET NOT NULL,
ALTER COLUMN "memoryType" SET NOT NULL,
ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "LongTermMemory_chatId_memoryType_isActive_idx"
ON "LongTermMemory"("chatId", "memoryType", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "LongTermMemory_chatId_canonicalKey_key"
ON "LongTermMemory"("chatId", "canonicalKey");

DROP TABLE IF EXISTS "_prisma_migrations_backup_20260402";
