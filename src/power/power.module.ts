import { Module } from '@nestjs/common';

import { RiotModule } from '../riot/riot.module';
import { UserModule } from '../users/users.module';
import { BasePowerCalculator } from './calculators/base-power.calculator';
import { FormScoreCalculator } from './calculators/form-score.calculator';
import { InhouseMmrCalculator } from './calculators/inhouse-mmr.calculator';
import { LanePowerCalculator } from './calculators/lane-power.calculator';
import { OverallPowerCalculator } from './calculators/overall-power.calculator';
import { StyleScoreCalculator } from './calculators/style-score.calculator';
import { PowerController } from './power.controller';
import { PowerProcessor } from './power.processor';
import { PowerService } from './power.service';

@Module({
  imports: [UserModule, RiotModule],
  controllers: [PowerController],
  providers: [
    PowerService,
    PowerProcessor,
    BasePowerCalculator,
    FormScoreCalculator,
    InhouseMmrCalculator,
    LanePowerCalculator,
    StyleScoreCalculator,
    OverallPowerCalculator,
  ],
  exports: [PowerService],
})
export class PowerModule {}
