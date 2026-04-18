import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import {
  InhouseHistoryQueryDto,
  InhouseHistoryResponseDto,
  MeResponseDto,
  UserProfileResponseDto,
  UserStatsQueryDto,
  UserStatsResponseDto,
} from './dto/profile.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user profile.' })
  @ApiOkResponse({ type: MeResponseDto })
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    return this.usersService.getMe(user.userId);
  }

  @Get(':userId/profile')
  @ApiOperation({ summary: 'Get a user profile summary for group and match surfaces.' })
  @ApiOkResponse({ type: UserProfileResponseDto })
  getUserProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<UserProfileResponseDto> {
    return this.usersService.getUserProfile(user.userId, userId);
  }

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

  @Get(':userId/stats')
  @ApiOperation({ summary: 'Get user-level inhouse stats summary.' })
  @ApiOkResponse({ type: UserStatsResponseDto })
  getUserStats(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Query() query: UserStatsQueryDto,
  ): Promise<UserStatsResponseDto> {
    return this.usersService.getUserStats(user, userId, query);
  }
}
