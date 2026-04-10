import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import {
  ConfirmResultDto,
  MatchResultResponseDto,
  QuickResultDto,
  ResultSubmissionResponseDto,
} from './dto/results.dto';
import { ResultsService } from './results.service';

@ApiTags('results')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('matches/:matchId/results')
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Post('quick')
  @ApiOperation({ summary: 'Submit a quick result for a match.' })
  @ApiHeader({
    name: 'idempotency-key',
    required: false,
    description: 'Optional idempotency key for retry-safe quick result submissions.',
  })
  @ApiCreatedResponse({ type: ResultSubmissionResponseDto })
  submitQuickResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
    @Body() dto: QuickResultDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ResultSubmissionResponseDto> {
    return this.resultsService.submitQuickResult(
      user.userId,
      matchId,
      dto,
      idempotencyKey,
    );
  }

  @Post(':resultId/confirm')
  @ApiOperation({ summary: 'Confirm, dispute, or suggest changes to a match result.' })
  @ApiOkResponse({ type: ResultSubmissionResponseDto })
  confirmResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
    @Param('resultId') resultId: string,
    @Body() dto: ConfirmResultDto,
  ): Promise<ResultSubmissionResponseDto> {
    return this.resultsService.confirmResult(user.userId, matchId, resultId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get match result details and confirmations.' })
  @ApiOkResponse({ type: MatchResultResponseDto })
  getResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
  ): Promise<MatchResultResponseDto> {
    return this.resultsService.getMatchResult(user.userId, matchId);
  }
}

