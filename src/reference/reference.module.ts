import { Module } from '@nestjs/common';

import { PublicThrottleGuard } from '../common/guards/public-throttle.guard';
import { ReferenceController } from './reference.controller';

@Module({
  controllers: [ReferenceController],
  providers: [PublicThrottleGuard],
})
export class ReferenceModule {}
