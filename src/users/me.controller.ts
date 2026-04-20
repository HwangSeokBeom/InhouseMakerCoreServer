import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppErrorCode, AppException } from '../common/app.exception';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import {
  DeleteMyAccountResponseDto,
  MeResponseDto,
  UpdateMyProfileDto,
} from './dto/profile.dto';
import {
  PROFILE_IMAGE_ALLOWED_MIME_TYPES,
  PROFILE_IMAGE_MAX_BYTES,
} from './profile-image.constants';
import { UsersService } from './users.service';

interface UploadedProfileImageFile {
  buffer?: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user profile.' })
  @ApiOkResponse({ type: MeResponseDto })
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    return this.usersService.getMe(user.userId);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update current user profile settings.' })
  @ApiOkResponse({ type: MeResponseDto })
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMyProfileDto,
  ): Promise<MeResponseDto> {
    return this.usersService.updateMyProfile(user.userId, dto);
  }

  @Patch('profile-image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: PROFILE_IMAGE_MAX_BYTES,
        files: 1,
      },
      fileFilter: (_request, file, callback) => {
        if (
          !(PROFILE_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)
        ) {
          callback(
            new AppException(
              HttpStatus.BAD_REQUEST,
              AppErrorCode.PROFILE_IMAGE_INVALID_TYPE,
              'Only JPEG and PNG profile images are allowed.',
              {
                allowedMimeTypes: PROFILE_IMAGE_ALLOWED_MIME_TYPES,
                receivedMimeType: file.mimetype,
              },
            ),
            false,
          );
          return;
        }

        callback(null, true);
      },
    }),
  )
  @ApiOperation({ summary: 'Upload or replace current user profile image.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOkResponse({ type: MeResponseDto })
  updateProfileImage(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: UploadedProfileImageFile,
  ): Promise<MeResponseDto> {
    return this.usersService.updateProfileImage(user.userId, file);
  }

  @Delete('profile-image')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete current user profile image.' })
  @ApiOkResponse({ type: MeResponseDto })
  deleteProfileImage(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MeResponseDto> {
    return this.usersService.deleteProfileImage(user.userId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw current user account.' })
  @ApiOkResponse({ type: DeleteMyAccountResponseDto })
  deleteMe(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DeleteMyAccountResponseDto> {
    return this.usersService.withdrawMe(user.userId);
  }
}
