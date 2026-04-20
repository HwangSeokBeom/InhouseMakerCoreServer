import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AppConfigService } from './app-config.service';
import { PublicAppConfigResponseDto } from './dto/app-config.dto';

@ApiTags('app-config')
@Controller('app-config')
export class AppConfigController {
  constructor(private readonly appConfigService: AppConfigService) {}

  @Get('public')
  @ApiOperation({ summary: 'Get public app review and client configuration values.' })
  @ApiOkResponse({ type: PublicAppConfigResponseDto })
  getPublicConfig(): PublicAppConfigResponseDto {
    return this.appConfigService.getPublicConfig();
  }
}
