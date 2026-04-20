import { Module } from '@nestjs/common';

import { BlocksModule } from '../blocks/blocks.module';
import { FilesModule } from '../files/files.module';
import { RiotModule } from '../riot/riot.module';
import { MeController } from './me.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [BlocksModule, FilesModule, RiotModule],
  controllers: [MeController, UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UserModule {}
