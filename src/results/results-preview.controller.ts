import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PublicThrottle } from '../common/decorators/public-throttle.decorator';
import { PublicThrottleGuard } from '../common/guards/public-throttle.guard';
import { QuickResultPreviewDto, QuickResultPreviewResponseDto } from './dto/results.dto';
import { ResultsService } from './results.service';

@ApiTags('results')
@Controller('matches')
export class ResultsPreviewController {
  constructor(private readonly resultsService: ResultsService) {}

  @Post('result/preview')
  @UseGuards(PublicThrottleGuard)
  @PublicThrottle({ scope: 'matches-result-preview', limit: 20, windowSeconds: 60 })
  @ApiOperation({ summary: 'Validate and summarize a quick result payload without saving it.' })
  @ApiOkResponse({ type: QuickResultPreviewResponseDto })
  previewQuickResult(
    @Body() dto: QuickResultPreviewDto,
  ): QuickResultPreviewResponseDto {
    return this.resultsService.previewQuickResult(dto);
  }
}
