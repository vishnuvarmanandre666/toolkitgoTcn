-- AlterTable
ALTER TABLE `Technician` ADD COLUMN `supabaseUserId` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Technician_supabaseUserId_key` ON `Technician`(`supabaseUserId`);

