import { randomUUID } from 'node:crypto';

import { HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';

import { AuthenticatedUser } from './interfaces/authenticated-request.interface';

export interface RequestDebugRequest extends Request {
  debugRequestId?: string;
  user?: Partial<AuthenticatedUser>;
}

export interface ExceptionDebugInfo {
  statusCode: number;
  code?: string;
  message: string;
  reason?: unknown;
}

export type HomeRequestProbableCause =
  | 'stale_client_reference'
  | 'not_member';

export type HomeRequestFixtureHint = 'removed_fixture';

const FIXTURE_LIKE_RESOURCE_ID_PATTERNS = [
  /(^|[-_])ui[-_]?test($|[-_])/i,
  /(^|[-_])(mock|fake|fixture|demo|seed)($|[-_])/i,
  /^dev[-_]/i,
] as const;

export function ensureRequestId(request: RequestDebugRequest): string {
  if (request.debugRequestId) {
    return request.debugRequestId;
  }

  const headers = request.headers ?? {};

  request.debugRequestId =
    readFirstHeader(headers['x-request-id']) ??
    readFirstHeader(headers['x-correlation-id']) ??
    randomUUID();

  return request.debugRequestId;
}

export function getRequesterUserId(request: RequestDebugRequest): string | null {
  return typeof request.user?.userId === 'string' ? request.user.userId : null;
}

export function getRequestPath(request: RequestDebugRequest): string {
  return request.originalUrl ?? request.url ?? 'unknown';
}

export function getRequestRoute(request: RequestDebugRequest): string {
  const routePath = normalizeRoutePath(request.route?.path);

  if (routePath) {
    return `${request.baseUrl ?? ''}${routePath}`;
  }

  return stripQueryString(getRequestPath(request));
}

export function getExceptionDebugInfo(exception: unknown): ExceptionDebugInfo {
  const isHttpException = exception instanceof HttpException;
  const statusCode = isHttpException
    ? exception.getStatus()
    : HttpStatus.INTERNAL_SERVER_ERROR;
  const responseBody = getExceptionResponseBody(exception);
  const rawMessage =
    responseBody.message ??
    (exception instanceof Error ? exception.message : 'Internal server error');
  const details =
    responseBody.details && typeof responseBody.details === 'object'
      ? (responseBody.details as Record<string, unknown>)
      : {};

  return {
    statusCode,
    code:
      typeof responseBody.code === 'string'
        ? responseBody.code
        : typeof responseBody.errorCode === 'string'
          ? responseBody.errorCode
          : undefined,
    message: Array.isArray(rawMessage) ? rawMessage.join(', ') : String(rawMessage),
    reason: details.reason,
  };
}

export function serializeLogPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

export function serializeUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function buildMissingResourceDebugDetails(
  resourceIdKey: 'groupId' | 'matchId',
  resourceId: string | null | undefined,
  reason?: string,
): Record<string, unknown> {
  const details: Record<string, unknown> = {
    probableCause: 'stale_client_reference',
  };

  if (reason) {
    details.reason = reason;
  }

  if (resourceId) {
    details[resourceIdKey] = resourceId;
  }

  if (resourceId && isFixtureLikeResourceId(resourceId)) {
    details.fixtureHint = 'removed_fixture';
  }

  return details;
}

export function buildAccessDeniedDebugDetails(
  resourceIdKey: 'groupId' | 'matchId',
  resourceId: string | null | undefined,
  reason: string,
): Record<string, unknown> {
  const details: Record<string, unknown> = {
    reason,
  };

  if (resourceId) {
    details[resourceIdKey] = resourceId;
  }

  if (reason === 'NOT_GROUP_MEMBER') {
    details.probableCause = 'not_member';
  }

  return details;
}

export function isFixtureLikeResourceId(resourceId: string): boolean {
  return FIXTURE_LIKE_RESOURCE_ID_PATTERNS.some((pattern) => pattern.test(resourceId));
}

export function shouldLogHomeRequestDebug(
  path: string,
  route?: string | null,
): boolean {
  const normalizedPath = stripQueryString(path);

  return (
    route === '/groups/:groupId' ||
    route === '/matches/:matchId' ||
    /^\/groups\/[^/]+$/.test(normalizedPath) ||
    /^\/matches\/[^/]+$/.test(normalizedPath)
  );
}

export function formatHomeRequestDebugMessage(input: {
  requesterUserId: string | null;
  path: string;
  outcome: 'forbidden' | 'not_found';
  probableCause: HomeRequestProbableCause;
  reason?: string | null;
  fixtureHint?: HomeRequestFixtureHint | null;
}): string {
  const tokens = [
    '[HomeRequestDebug]',
    `requesterUserId=${input.requesterUserId ?? 'anonymous'}`,
    `path=${stripQueryString(input.path)}`,
    `outcome=${input.outcome}`,
    `probableCause=${input.probableCause}`,
  ];

  if (input.fixtureHint) {
    tokens.push(`fixtureHint=${input.fixtureHint}`);
  }

  if (input.reason) {
    tokens.push(`reason=${input.reason}`);
  }

  return tokens.join(' ');
}

function getExceptionResponseBody(exception: unknown): Record<string, unknown> {
  if (!(exception instanceof HttpException)) {
    return {};
  }

  const response = exception.getResponse();

  return typeof response === 'string'
    ? { message: response }
    : (response as Record<string, unknown> | null) ?? {};
}

function readFirstHeader(value: string | string[] | undefined): string | undefined {
  const headerValue = Array.isArray(value) ? value[0] : value;
  const trimmed = headerValue?.trim();

  return trimmed ? trimmed : undefined;
}

function normalizeRoutePath(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  return undefined;
}

function stripQueryString(value: string): string {
  return value.split('?')[0] ?? value;
}
