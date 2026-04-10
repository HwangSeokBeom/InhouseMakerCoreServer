import { Module } from '@nestjs/common';

import { MeController } from './me.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [MeController, UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UserModule {}
