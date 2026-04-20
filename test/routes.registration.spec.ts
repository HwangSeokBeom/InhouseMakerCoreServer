import 'reflect-metadata';

import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigController } from '../src/app-config/app-config.controller';
import { AppConfigService } from '../src/app-config/app-config.service';
import { BlocksController } from '../src/blocks/blocks.controller';
import { BlocksService } from '../src/blocks/blocks.service';
import { GroupsController } from '../src/groups/groups.controller';
import { GroupsService } from '../src/groups/groups.service';
import { ReportsController } from '../src/reports/reports.controller';
import { ReportsService } from '../src/reports/reports.service';
import { RecruitingController } from '../src/recruiting/recruiting.controller';
import { RecruitingService } from '../src/recruiting/recruiting.service';
import { MeController } from '../src/users/me.controller';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';

function collectRoutes(stack: any[] | undefined, routes: string[] = []): string[] {
  if (!Array.isArray(stack)) {
    return routes;
  }

  for (const layer of stack) {
    if (layer?.route?.path && layer.route.methods) {
      const methods = Object.keys(layer.route.methods)
        .filter((method) => layer.route.methods[method])
        .map((method) => method.toUpperCase());
      methods.forEach((method) => routes.push(`${method} ${layer.route.path}`));
      continue;
    }

    if (Array.isArray(layer?.handle?.stack)) {
      collectRoutes(layer.handle.stack, routes);
    }
  }

  return routes;
}

describe('HTTP route registration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [
        AppConfigController,
        BlocksController,
        GroupsController,
        MeController,
        RecruitingController,
        ReportsController,
        UsersController,
      ],
      providers: [
        {
          provide: AppConfigService,
          useValue: {
            getPublicConfig: jest.fn(),
          },
        },
        {
          provide: BlocksService,
          useValue: {
            blockUser: jest.fn(),
            unblockUser: jest.fn(),
            listMyBlocks: jest.fn(),
          },
        },
        {
          provide: RecruitingService,
          useValue: {
            createPost: jest.fn(),
            listPosts: jest.fn(),
            getPost: jest.fn(),
            updatePost: jest.fn(),
            deletePost: jest.fn(),
            applyToPost: jest.fn(),
            cancelApplication: jest.fn(),
            listApplicants: jest.fn(),
          },
        },
        {
          provide: GroupsService,
          useValue: {
            createGroup: jest.fn(),
            getGroup: jest.fn(),
            updateGroup: jest.fn(),
            deleteGroup: jest.fn(),
            addMember: jest.fn(),
            searchMemberCandidates: jest.fn(),
            listMembers: jest.fn(),
            getLeaderboard: jest.fn(),
            getRecentMatches: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            getMe: jest.fn(),
            updateMyProfile: jest.fn(),
            updateProfileImage: jest.fn(),
            deleteProfileImage: jest.fn(),
            withdrawMe: jest.fn(),
            searchInviteUsers: jest.fn(),
            getUserProfile: jest.fn(),
            getInhouseHistory: jest.fn(),
            getUserStats: jest.fn(),
          },
        },
        {
          provide: ReportsService,
          useValue: {
            createReport: jest.fn(),
            listMyReports: jest.fn(),
          },
        },
      ],
    })
    class RouteTestModule {}

    app = await NestFactory.create(RouteTestModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers recruiting and group patch/delete routes', () => {
    const adapter = app.getHttpAdapter().getInstance() as {
      router?: { stack?: any[] };
      _router?: { stack?: any[] };
    };
    const routes = collectRoutes(adapter.router?.stack ?? adapter._router?.stack);

    expect(routes).toEqual(
      expect.arrayContaining([
        'PATCH /recruiting-posts/:postId',
        'DELETE /recruiting-posts/:postId',
        'PATCH /groups/:groupId',
        'DELETE /groups/:groupId',
        'GET /groups/:groupId/member-candidates',
        'PATCH /me/profile-image',
        'DELETE /me/profile-image',
        'DELETE /me',
        'POST /reports',
        'GET /me/reports',
        'POST /blocks/:targetUserId',
        'DELETE /blocks/:targetUserId',
        'GET /me/blocks',
        'GET /app-config/public',
        'GET /users/search',
        'GET /users',
      ]),
    );
  });
});
