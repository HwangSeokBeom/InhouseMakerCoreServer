import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import {
  InhouseHistoryQueryDto,
  InhouseHistoryResponseDto,
} from './dto/profile.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':userId/inhouse-history')
  @ApiOperation({ summary: 'Get inhouse match history for a user.' })
  @ApiOkResponse({ type: InhouseHistoryResponseDto })
  getInhouseHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Query() query: InhouseHistoryQueryDto,
  ): Promise<InhouseHistoryResponseDto> {
    return this.usersService.getInhouseHistory(user, userId, query);
  }
}

