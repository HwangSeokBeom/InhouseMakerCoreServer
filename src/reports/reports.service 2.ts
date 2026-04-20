import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Report,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  UserStatus,
} from '@prisma/client';

import { AppErrorCode, AppException } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReportDto, ReportListResponseDto, ReportResponseDto } from './dto/reports.dto';

const RECENT_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

@Injectable()
export class ReportsService {
  constructor(private readonly prismaService: PrismaService) {}

  async createReport(
    reporterUserId: string,
    dto: CreateReportDto,
  ): Promise<ReportResponseDto> {
    await this.assertReportTargetExists(reporterUserId, dto.targetType, dto.targetId);
    await this.assertNoRecentDuplicate(reporterUserId, dto.targetType, dto.targetId);

    const report = await this.prismaService.report.create({
      data: {
        reporterUserId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        detail: dto.detail || null,
        status: ReportStatus.PENDING,
      },
    });

    return this.toResponse(report);
  }

  async listMyReports(reporterUserId: string): Promise<ReportListResponseDto> {
    const reports = await this.prismaService.report.findMany({
      where: {
        reporterUserId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });

    return {
      items: reports.map((report) => this.toResponse(report)),
    };
  }

  private async assertReportTargetExists(
    reporterUserId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<void> {
    if (targetType === ReportTargetType.USER) {
      if (reporterUserId === targetId) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          AppErrorCode.REPORT_SELF_NOT_ALLOWED,
          'You cannot report yourself.',
          {
            targetType,
            targetId,
          },
        );
      }

      const targetUser = await this.prismaService.user.findFirst({
        where: {
          id: targetId,
          status: UserStatus.ACTIVE,
        },
        select: { id: true },
      });

      if (!targetUser) {
        throw this.createTargetNotFoundException(targetType, targetId);
      }

      return;
    }

    if (targetType === ReportTargetType.RECRUITMENT) {
      const post = await this.prismaService.recruitingPost.findFirst({
        where: {
          id: targetId,
          deletedAt: null,
          group: {
            is: {
              archivedAt: null,
            },
          },
        },
        select: { id: true },
      });

      if (!post) {
        throw this.createTargetNotFoundException(targetType, targetId);
      }

      return;
    }

    throw new AppException(
      HttpStatus.BAD_REQUEST,
      AppErrorCode.REPORT_TARGET_UNSUPPORTED,
      'This report target type is not supported yet.',
      {
        targetType,
        targetId,
        supportedTargetTypes: [ReportTargetType.USER, ReportTargetType.RECRUITMENT],
      },
    );
  }

  private async assertNoRecentDuplicate(
    reporterUserId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<void> {
    const createdAfter = new Date(Date.now() - RECENT_DUPLICATE_WINDOW_MS);
    const recent = await this.prismaService.report.findFirst({
      where: {
        reporterUserId,
        targetType,
        targetId,
        createdAt: {
          gte: createdAfter,
        },
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    if (!recent) {
      return;
    }

    throw new AppException(
      HttpStatus.CONFLICT,
      AppErrorCode.REPORT_RECENT_DUPLICATE,
      'You already reported this target recently.',
      {
        targetType,
        targetId,
        recentReportId: recent.id,
        recentReportedAt: recent.createdAt.toISOString(),
        windowSeconds: RECENT_DUPLICATE_WINDOW_MS / 1000,
      },
    );
  }

  private createTargetNotFoundException(
    targetType: ReportTargetType,
    targetId: string,
  ): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      AppErrorCode.REPORT_TARGET_NOT_FOUND,
      'Report target not found.',
      {
        targetType,
        targetId,
      },
    );
  }

  private toResponse(report: Report): ReportResponseDto {
    return {
      id: report.id,
      reporterUserId: report.reporterUserId,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason as ReportReason,
      detail: report.detail,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  }
}
