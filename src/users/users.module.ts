import { Module } from '@nestjs/common';

import { RiotModule } from '../riot/riot.module';
import { MeController } from './me.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [RiotModule],
  controllers: [MeController, UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UserModule {}
