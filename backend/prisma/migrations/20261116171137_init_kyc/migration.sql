-- CreateTable
CREATE TABLE `Technician` (
    `id` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(15) NOT NULL,
    `countryCode` VARCHAR(5) NOT NULL DEFAULT '+91',
    `mobileVerification` ENUM('PENDING', 'IN_PROGRESS', 'VERIFIED', 'FAILED', 'MANUAL_REVIEW', 'UNAVAILABLE') NOT NULL DEFAULT 'PENDING',
    `phoneVerifiedAt` DATETIME(3) NULL,
    `fullName` VARCHAR(150) NULL,
    `dateOfBirth` DATE NULL,
    `gender` ENUM('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY') NULL,
    `email` VARCHAR(190) NULL,
    `emergencyContact` VARCHAR(15) NULL,
    `addressesSame` BOOLEAN NOT NULL DEFAULT false,
    `addressProofRequested` BOOLEAN NOT NULL DEFAULT false,
    `kycStatus` ENUM('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'NOT_STARTED',
    `submittedAt` DATETIME(3) NULL,
    `reviewStartedAt` DATETIME(3) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `rejectionReason` TEXT NULL,
    `submissionCount` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `activatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Technician_phone_key`(`phone`),
    INDEX `Technician_kycStatus_updatedAt_idx`(`kycStatus`, `updatedAt`),
    INDEX `Technician_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AadhaarDetail` (
    `id` VARCHAR(191) NOT NULL,
    `technicianId` VARCHAR(191) NOT NULL,
    `aadhaarLast4` VARCHAR(4) NULL,
    `aadhaarHash` VARCHAR(64) NULL,
    `aadhaarEncrypted` TEXT NULL,
    `nameOnAadhaar` VARCHAR(150) NULL,
    `dobOnAadhaar` DATE NULL,
    `consentGiven` BOOLEAN NOT NULL DEFAULT false,
    `consentVersion` VARCHAR(20) NULL,
    `consentAt` DATETIME(3) NULL,
    `consentIp` VARCHAR(64) NULL,
    `verificationStatus` ENUM('PENDING', 'IN_PROGRESS', 'VERIFIED', 'FAILED', 'MANUAL_REVIEW', 'UNAVAILABLE') NOT NULL DEFAULT 'PENDING',
    `verificationMethod` ENUM('PROVIDER', 'OFFLINE_EKYC', 'MANUAL') NULL,
    `providerName` VARCHAR(50) NULL,
    `providerRefId` VARCHAR(120) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `nameMatchScore` DOUBLE NULL,
    `nameMatched` BOOLEAN NULL,
    `dobMatched` BOOLEAN NULL,
    `failureReason` VARCHAR(500) NULL,
    `reviewNote` TEXT NULL,
    `reviewedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AadhaarDetail_technicianId_key`(`technicianId`),
    INDEX `AadhaarDetail_aadhaarHash_idx`(`aadhaarHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PanDetail` (
    `id` VARCHAR(191) NOT NULL,
    `technicianId` VARCHAR(191) NOT NULL,
    `panEncrypted` TEXT NULL,
    `panHash` VARCHAR(64) NULL,
    `panMasked` VARCHAR(10) NULL,
    `holderName` VARCHAR(150) NULL,
    `verificationStatus` ENUM('PENDING', 'IN_PROGRESS', 'VERIFIED', 'FAILED', 'MANUAL_REVIEW', 'UNAVAILABLE') NOT NULL DEFAULT 'PENDING',
    `verificationMethod` ENUM('PROVIDER', 'OFFLINE_EKYC', 'MANUAL') NULL,
    `providerName` VARCHAR(50) NULL,
    `providerRefId` VARCHAR(120) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `nameMatchScore` DOUBLE NULL,
    `nameMatched` BOOLEAN NULL,
    `failureReason` VARCHAR(500) NULL,
    `reviewNote` TEXT NULL,
    `reviewedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PanDetail_technicianId_key`(`technicianId`),
    INDEX `PanDetail_panHash_idx`(`panHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AadhaarAddress` (
    `id` VARCHAR(191) NOT NULL,
    `technicianId` VARCHAR(191) NOT NULL,
    `houseNumber` VARCHAR(100) NULL,
    `buildingName` VARCHAR(150) NULL,
    `street` VARCHAR(150) NULL,
    `locality` VARCHAR(150) NULL,
    `villageCity` VARCHAR(100) NOT NULL,
    `mandalTaluka` VARCHAR(100) NULL,
    `district` VARCHAR(100) NOT NULL,
    `state` VARCHAR(60) NOT NULL,
    `pinCode` VARCHAR(6) NOT NULL,
    `country` VARCHAR(60) NOT NULL DEFAULT 'India',
    `source` ENUM('VERIFICATION_PROVIDER', 'SELF_DECLARED', 'COPIED_FROM_AADHAAR') NOT NULL DEFAULT 'SELF_DECLARED',
    `verificationStatus` ENUM('PENDING', 'VERIFIED', 'UNVERIFIED', 'REJECTED', 'UNAVAILABLE') NOT NULL DEFAULT 'UNVERIFIED',
    `reviewNote` TEXT NULL,
    `reviewedById` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AadhaarAddress_technicianId_key`(`technicianId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CurrentAddress` (
    `id` VARCHAR(191) NOT NULL,
    `technicianId` VARCHAR(191) NOT NULL,
    `houseNumber` VARCHAR(100) NULL,
    `buildingName` VARCHAR(150) NULL,
    `street` VARCHAR(150) NULL,
    `locality` VARCHAR(150) NULL,
    `villageCity` VARCHAR(100) NOT NULL,
    `mandalTaluka` VARCHAR(100) NULL,
    `district` VARCHAR(100) NOT NULL,
    `state` VARCHAR(60) NOT NULL,
    `pinCode` VARCHAR(6) NOT NULL,
    `country` VARCHAR(60) NOT NULL DEFAULT 'India',
    `landmark` VARCHAR(150) NULL,
    `source` ENUM('VERIFICATION_PROVIDER', 'SELF_DECLARED', 'COPIED_FROM_AADHAAR') NOT NULL DEFAULT 'SELF_DECLARED',
    `verificationStatus` ENUM('SELF_DECLARED', 'DOCUMENT_SUPPORTED', 'MANUALLY_VERIFIED', 'REJECTED') NOT NULL DEFAULT 'SELF_DECLARED',
    `reviewNote` TEXT NULL,
    `reviewedById` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CurrentAddress_technicianId_key`(`technicianId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BankDetail` (
    `id` VARCHAR(191) NOT NULL,
    `technicianId` VARCHAR(191) NOT NULL,
    `accountHolderName` VARCHAR(150) NOT NULL,
    `accountEncrypted` TEXT NOT NULL,
    `accountLast4` VARCHAR(4) NOT NULL,
    `accountHash` VARCHAR(64) NOT NULL,
    `ifsc` VARCHAR(11) NOT NULL,
    `bankName` VARCHAR(120) NOT NULL,
    `branchName` VARCHAR(120) NULL,
    `verificationStatus` ENUM('PENDING', 'IN_PROGRESS', 'VERIFIED', 'FAILED', 'MANUAL_REVIEW', 'UNAVAILABLE') NOT NULL DEFAULT 'PENDING',
    `verificationMethod` ENUM('PROVIDER', 'OFFLINE_EKYC', 'MANUAL') NULL,
    `verifiedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `reviewedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BankDetail_technicianId_key`(`technicianId`),
    INDEX `BankDetail_accountHash_idx`(`accountHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Document` (
    `id` VARCHAR(191) NOT NULL,
    `technicianId` VARCHAR(191) NOT NULL,
    `category` ENUM('AADHAAR', 'PAN', 'PROFILE_PHOTO', 'ADDRESS_PROOF', 'BANK_PROOF', 'CERTIFICATE', 'OTHER') NOT NULL,
    `label` VARCHAR(120) NULL,
    `status` ENUM('NOT_UPLOADED', 'UPLOADED', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'REUPLOAD_REQUIRED') NOT NULL DEFAULT 'NOT_UPLOADED',
    `currentVersionId` VARCHAR(191) NULL,
    `rejectionReason` VARCHAR(500) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Document_currentVersionId_key`(`currentVersionId`),
    INDEX `Document_technicianId_category_idx`(`technicianId`, `category`),
    INDEX `Document_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentVersion` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `objectKey` VARCHAR(255) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `scanStatus` ENUM('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `scanDetail` VARCHAR(255) NULL,
    `status` ENUM('NOT_UPLOADED', 'UPLOADED', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'REUPLOAD_REQUIRED') NOT NULL DEFAULT 'UPLOADED',
    `reviewNote` VARCHAR(500) NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `supersededAt` DATETIME(3) NULL,
    `purgedAt` DATETIME(3) NULL,

    UNIQUE INDEX `DocumentVersion_objectKey_key`(`objectKey`),
    INDEX `DocumentVersion_supersededAt_purgedAt_idx`(`supersededAt`, `purgedAt`),
    UNIQUE INDEX `DocumentVersion_documentId_version_key`(`documentId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KycFeedback` (
    `id` VARCHAR(191) NOT NULL,
    `technicianId` VARCHAR(191) NOT NULL,
    `section` ENUM('MOBILE', 'PERSONAL', 'AADHAAR', 'PAN', 'ADDRESS', 'DOCUMENTS', 'BANK', 'GENERAL') NOT NULL,
    `documentId` VARCHAR(191) NULL,
    `message` VARCHAR(1000) NOT NULL,
    `resolved` BOOLEAN NOT NULL DEFAULT false,
    `resolvedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `KycFeedback_technicianId_resolved_idx`(`technicianId`, `resolved`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminUser` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(190) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `passwordHash` VARCHAR(100) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'ADMIN', 'REVIEWER') NOT NULL DEFAULT 'REVIEWER',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AdminUser_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorType` ENUM('TECHNICIAN', 'ADMIN', 'SYSTEM') NOT NULL,
    `actorId` VARCHAR(40) NULL,
    `technicianId` VARCHAR(191) NULL,
    `action` VARCHAR(80) NOT NULL,
    `entityType` VARCHAR(50) NULL,
    `entityId` VARCHAR(40) NULL,
    `metadata` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_technicianId_createdAt_idx`(`technicianId`, `createdAt`),
    INDEX `AuditLog_actorType_actorId_idx`(`actorType`, `actorId`),
    INDEX `AuditLog_action_idx`(`action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Technician` ADD CONSTRAINT `Technician_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AadhaarDetail` ADD CONSTRAINT `AadhaarDetail_technicianId_fkey` FOREIGN KEY (`technicianId`) REFERENCES `Technician`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PanDetail` ADD CONSTRAINT `PanDetail_technicianId_fkey` FOREIGN KEY (`technicianId`) REFERENCES `Technician`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AadhaarAddress` ADD CONSTRAINT `AadhaarAddress_technicianId_fkey` FOREIGN KEY (`technicianId`) REFERENCES `Technician`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CurrentAddress` ADD CONSTRAINT `CurrentAddress_technicianId_fkey` FOREIGN KEY (`technicianId`) REFERENCES `Technician`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BankDetail` ADD CONSTRAINT `BankDetail_technicianId_fkey` FOREIGN KEY (`technicianId`) REFERENCES `Technician`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_technicianId_fkey` FOREIGN KEY (`technicianId`) REFERENCES `Technician`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_currentVersionId_fkey` FOREIGN KEY (`currentVersionId`) REFERENCES `DocumentVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentVersion` ADD CONSTRAINT `DocumentVersion_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KycFeedback` ADD CONSTRAINT `KycFeedback_technicianId_fkey` FOREIGN KEY (`technicianId`) REFERENCES `Technician`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KycFeedback` ADD CONSTRAINT `KycFeedback_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_technicianId_fkey` FOREIGN KEY (`technicianId`) REFERENCES `Technician`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
