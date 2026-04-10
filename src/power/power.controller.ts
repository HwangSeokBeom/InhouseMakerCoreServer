import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import { PowerProfileResponseDto } from './dto/power-profile.dto';
import { PowerService } from './power.service';

@ApiTags('power')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class PowerController {
  constructor(private readonly powerService: PowerService) {}

  @Get(':userId/power-profile')
  @ApiOperation({ summary: 'Get a user power profile.' })
  @ApiOkResponse({ type: PowerProfileResponseDto })
  getPowerProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<PowerProfileResponseDto> {
    return this.powerService.getProfile(user.userId, userId);
  }
}

