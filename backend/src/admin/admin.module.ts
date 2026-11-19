import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { AdminAuthController, AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [DocumentsModule],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminService],
})
export class AdminModule {}
