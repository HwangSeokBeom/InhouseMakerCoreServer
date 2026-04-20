import { Module } from '@nestjs/common';

import { FILE_STORAGE_PROVIDER } from './file-storage.provider';
import { LocalFileStorageProvider } from './local-file-storage.provider';

@Module({
  providers: [
    LocalFileStorageProvider,
    {
      provide: FILE_STORAGE_PROVIDER,
      useExisting: LocalFileStorageProvider,
    },
  ],
  exports: [FILE_STORAGE_PROVIDER],
})
export class FilesModule {}
