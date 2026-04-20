import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
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
import { CreateReportDto, ReportListResponseDto, ReportResponseDto } from './dto/reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Report a user or recruiting post.' })
  @ApiCreatedResponse({ type: ReportResponseDto })
  createReport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReportDto,
  ): Promise<ReportResponseDto> {
    return this.reportsService.createReport(user.userId, dto);
  }

  @Get('me/reports')
  @ApiOperation({ summary: 'List reports created by the current user.' })
  @ApiOkResponse({ type: ReportListResponseDto })
  listMyReports(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReportListResponseDto> {
    return this.reportsService.listMyReports(user.userId);
  }
}
