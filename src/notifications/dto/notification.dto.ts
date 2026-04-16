import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationStatus, NotificationType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class NotificationQueryDto {
  @ApiPropertyOptional({ enum: NotificationType })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @ApiPropertyOptional({ description: 'Filter read notifications.' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) {
      return true;
    }
    if (value === 'false' || value === false) {
      return false;
    }
    return value;
  })
  @IsBoolean()
  isRead?: boolean;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class NotificationItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: NotificationType })
  type!: NotificationType;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ enum: NotificationStatus })
  status!: NotificationStatus;

  @ApiProperty()
  isRead!: boolean;

  @ApiPropertyOptional({ type: Object })
  payload!: Record<string, unknown> | null;

  @ApiPropertyOptional()
  relatedEntityType!: string | null;

  @ApiPropertyOptional()
  relatedEntityId!: string | null;

  @ApiPropertyOptional()
  readAt!: string | null;

  @ApiPropertyOptional()
  sentAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}

class NotificationPaginationDto {
  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty()
  hasMore!: boolean;

  @ApiPropertyOptional()
  nextOffset!: number | null;
}

export class NotificationListResponseDto {
  @ApiProperty({ type: [NotificationItemDto] })
  items!: NotificationItemDto[];

  @ApiProperty()
  unreadCount!: number;

  @ApiProperty({ type: NotificationPaginationDto })
  pagination!: NotificationPaginationDto;
}

export class NotificationReadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  isRead!: boolean;

  @ApiPropertyOptional()
  readAt!: string | null;
}

export class NotificationReadAllResponseDto {
  @ApiProperty()
  updatedCount!: number;
}
