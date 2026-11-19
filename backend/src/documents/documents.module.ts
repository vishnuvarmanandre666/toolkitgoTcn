import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { LocalFilesController, TechnicianDocumentsController } from './documents.controller';
import { MalwareScannerService } from './malware-scanner.service';
import { StorageService } from './storage/storage.service';

@Module({
  controllers: [TechnicianDocumentsController, LocalFilesController],
  providers: [DocumentsService, StorageService, MalwareScannerService],
  exports: [DocumentsService, StorageService],
})
export class DocumentsModule {}
