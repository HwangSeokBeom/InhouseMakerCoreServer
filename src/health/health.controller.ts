import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ description: 'Service is alive.' })
  getLiveness(): { status: string; timestamp: string } {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiOkResponse({ description: 'Service dependencies are reachable.' })
  getReadiness(): Promise<{
    status: string;
    database: string;
    redis: string;
    queues: string;
    timestamp: string;
  }> {
    return this.healthService.getReadiness();
  }
}
