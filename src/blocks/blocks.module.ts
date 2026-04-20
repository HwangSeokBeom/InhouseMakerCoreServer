import { Module } from '@nestjs/common';

import { BlockVisibilityPolicy } from './block-visibility-policy.service';
import { BlocksController } from './blocks.controller';
import { BlocksService } from './blocks.service';

@Module({
  controllers: [BlocksController],
  providers: [BlocksService, BlockVisibilityPolicy],
  exports: [BlockVisibilityPolicy],
})
export class BlocksModule {}
