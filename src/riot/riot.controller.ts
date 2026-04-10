import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import {
  CreateRiotAccountDto,
  RiotAccountListResponseDto,
  RiotAccountResponseDto,
  RiotAccountSyncAcceptedDto,
} from './dto/riot-account.dto';
import { RiotService } from './riot.service';

@ApiTags('riot-accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('riot-accounts')
export class RiotController {
  constructor(private readonly riotService: RiotService) {}

  @Post()
  @ApiOperation({ summary: 'Connect a Riot account by Riot ID and TagLine.' })
  @ApiCreatedResponse({ type: RiotAccountResponseDto })
  connectAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRiotAccountDto,
  ): Promise<RiotAccountResponseDto> {
    return this.riotService.createForUser(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List the current user connected Riot accounts.' })
  @ApiOkResponse({ type: RiotAccountListResponseDto })
  listAccounts(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RiotAccountListResponseDto> {
    return this.riotService.listForUser(user.userId);
  }

  @Post(':id/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue a Riot account synchronization job.' })
  @ApiOkResponse({ type: RiotAccountSyncAcceptedDto })
  async syncAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<RiotAccountSyncAcceptedDto> {
    await this.riotService.enqueueSync(user.userId, id);
    return {
      riotAccountId: id,
      queued: true,
    };
  }
}

