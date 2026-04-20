import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';

export class BlockUserResponseDto {
  @ApiProperty()
  targetUserId!: string;

  @ApiProperty()
  blocked!: boolean;

  @ApiPropertyOptional({ nullable: true })
  createdAt!: string | null;
}

export class BlockedUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiPropertyOptional({ nullable: true })
  profileImageUrl!: string | null;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiProperty()
  blockedAt!: string;
}

export class BlockListResponseDto {
  @ApiProperty({ type: [BlockedUserDto] })
  items!: BlockedUserDto[];
}
