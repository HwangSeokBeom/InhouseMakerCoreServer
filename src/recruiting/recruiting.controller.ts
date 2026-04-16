import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
  CreateRecruitingPostDto,
  RecruitingApplicantListResponseDto,
  RecruitingPostListResponseDto,
  RecruitingPostResponseDto,
  RecruitingQueryDto,
} from './dto/recruiting.dto';
import { RecruitingService } from './recruiting.service';

@ApiTags('recruiting-posts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('recruiting-posts')
export class RecruitingController {
  constructor(private readonly recruitingService: RecruitingService) {}

  @Post()
  @ApiOperation({ summary: 'Create a recruiting post.' })
  @ApiCreatedResponse({ type: RecruitingPostResponseDto })
  createPost(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRecruitingPostDto,
  ): Promise<RecruitingPostResponseDto> {
    return this.recruitingService.createPost(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List recruiting posts.' })
  @ApiOkResponse({ type: RecruitingPostListResponseDto })
  listPosts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RecruitingQueryDto,
  ): Promise<RecruitingPostListResponseDto> {
    return this.recruitingService.listPosts(user.userId, query);
  }

  @Get(':postId')
  @ApiOperation({ summary: 'Get recruiting post detail.' })
  @ApiOkResponse({ type: RecruitingPostResponseDto })
  getPost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
  ): Promise<RecruitingPostResponseDto> {
    return this.recruitingService.getPost(user.userId, postId);
  }

  @Post(':postId/apply')
  @ApiOperation({ summary: 'Apply to a recruiting post.' })
  @ApiOkResponse({ type: RecruitingPostResponseDto })
  applyToPost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
  ): Promise<RecruitingPostResponseDto> {
    return this.recruitingService.applyToPost(user.userId, postId);
  }

  @Delete(':postId/apply')
  @ApiOperation({ summary: 'Cancel a recruiting post application.' })
  @ApiOkResponse({ type: RecruitingPostResponseDto })
  cancelApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
  ): Promise<RecruitingPostResponseDto> {
    return this.recruitingService.cancelApplication(user.userId, postId);
  }

  @Get(':postId/applicants')
  @ApiOperation({ summary: 'List applicants for a recruiting post.' })
  @ApiOkResponse({ type: RecruitingApplicantListResponseDto })
  getApplicants(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
  ): Promise<RecruitingApplicantListResponseDto> {
    return this.recruitingService.listApplicants(user.userId, postId);
  }
}
