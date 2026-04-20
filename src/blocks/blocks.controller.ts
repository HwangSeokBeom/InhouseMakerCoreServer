import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import { BlocksService } from './blocks.service';
import { BlockListResponseDto, BlockUserResponseDto } from './dto/blocks.dto';

@ApiTags('blocks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Post('blocks/:targetUserId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Block a user.' })
  @ApiOkResponse({ type: BlockUserResponseDto })
  blockUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('targetUserId') targetUserId: string,
  ): Promise<BlockUserResponseDto> {
    return this.blocksService.blockUser(user.userId, targetUserId);
  }

  @Delete('blocks/:targetUserId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unblock a user.' })
  @ApiOkResponse({ type: BlockUserResponseDto })
  unblockUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('targetUserId') targetUserId: string,
  ): Promise<BlockUserResponseDto> {
    return this.blocksService.unblockUser(user.userId, targetUserId);
  }

  @Get('me/blocks')
  @ApiOperation({ summary: 'List users blocked by the current user.' })
  @ApiOkResponse({ type: BlockListResponseDto })
  listMyBlocks(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BlockListResponseDto> {
    return this.blocksService.listMyBlocks(user.userId);
  }
}
