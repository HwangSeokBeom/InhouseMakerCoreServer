import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import {
  ApplyRecruitingPostDto,
  CreateRecruitingPostDto,
  DeleteRecruitingPostResponseDto,
  RecruitingApplicantListResponseDto,
  RecruitingPostListResponseDto,
  RecruitingPostResponseDto,
  RecruitingQueryDto,
  UpdateRecruitingPostDto,
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
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  @ApiForbiddenResponse({ description: 'Requester is not a member of the target private group.' })
  @ApiNotFoundResponse({ description: 'Recruiting post was not found.' })
  getPost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
  ): Promise<RecruitingPostResponseDto> {
    return this.recruitingService.getPost(user.userId, postId);
  }

  @Patch(':postId')
  @ApiOperation({ summary: 'Update a recruiting post.' })
  @ApiOkResponse({ type: RecruitingPostResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  @ApiForbiddenResponse({ description: 'Only the author or admin can update this post.' })
  @ApiNotFoundResponse({ description: 'Recruiting post was not found.' })
  @ApiBadRequestResponse({ description: 'Payload is invalid.' })
  updatePost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
    @Body() dto: UpdateRecruitingPostDto,
  ): Promise<RecruitingPostResponseDto> {
    return this.recruitingService.updatePost(user.userId, postId, dto);
  }

  @Delete(':postId')
  @ApiOperation({ summary: 'Delete a recruiting post.' })
  @ApiOkResponse({ type: DeleteRecruitingPostResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  @ApiForbiddenResponse({ description: 'Only the author or admin can delete this post.' })
  @ApiNotFoundResponse({ description: 'Recruiting post was not found.' })
  deletePost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
  ): Promise<DeleteRecruitingPostResponseDto> {
    return this.recruitingService.deletePost(user.userId, postId);
  }

  @Post(':postId/apply')
  @ApiOperation({ summary: 'Apply to a recruiting post.' })
  @ApiOkResponse({ type: RecruitingPostResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  @ApiForbiddenResponse({ description: 'Requester cannot apply to this recruiting post.' })
  @ApiNotFoundResponse({ description: 'Recruiting post was not found.' })
  @ApiBadRequestResponse({ description: 'Payload is invalid or the recruiting post cannot accept applications.' })
  applyToPost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
    @Body() dto: ApplyRecruitingPostDto,
  ): Promise<RecruitingPostResponseDto> {
    return this.recruitingService.applyToPost(user.userId, postId, dto);
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
