import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import {
  NotificationListResponseDto,
  NotificationQueryDto,
  NotificationReadAllResponseDto,
  NotificationReadResponseDto,
} from './dto/notification.dto';
import { NotificationService } from './notification.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for the current user.' })
  @ApiOkResponse({ type: NotificationListResponseDto })
  listNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationQueryDto,
  ): Promise<NotificationListResponseDto> {
    return this.notificationService.listForUser(user.userId, query);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a single notification as read.' })
  @ApiOkResponse({ type: NotificationReadResponseDto })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') notificationId: string,
  ): Promise<NotificationReadResponseDto> {
    return this.notificationService.markRead(user.userId, notificationId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read.' })
  @ApiOkResponse({ type: NotificationReadAllResponseDto })
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationReadAllResponseDto> {
    return this.notificationService.markAllRead(user.userId);
  }
}
