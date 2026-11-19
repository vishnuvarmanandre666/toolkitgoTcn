-- AlterTable
ALTER TABLE `AadhaarDetail` MODIFY `verificationMethod` ENUM('PROVIDER', 'OFFLINE_EKYC', 'MANUAL', 'DIGILOCKER') NULL;

-- AlterTable
ALTER TABLE `BankDetail` MODIFY `verificationMethod` ENUM('PROVIDER', 'OFFLINE_EKYC', 'MANUAL', 'DIGILOCKER') NULL;

-- AlterTable
ALTER TABLE `PanDetail` MODIFY `verificationMethod` ENUM('PROVIDER', 'OFFLINE_EKYC', 'MANUAL', 'DIGILOCKER') NULL;

