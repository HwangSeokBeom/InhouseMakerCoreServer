export const SUPPORTED_NODE_ENVS = ['development', 'test', 'production'] as const;

export type SupportedNodeEnv = (typeof SUPPORTED_NODE_ENVS)[number];

export function resolveNodeEnv(nodeEnv: string | undefined = process.env.NODE_ENV): SupportedNodeEnv {
  const normalized = nodeEnv?.trim().toLowerCase();

  if (!normalized) {
    return 'development';
  }

  if (SUPPORTED_NODE_ENVS.includes(normalized as SupportedNodeEnv)) {
    return normalized as SupportedNodeEnv;
  }

  throw new Error(
    `Unsupported NODE_ENV "${nodeEnv}". Use development, test, or production.`,
  );
}

export function resolveEnvFilePath(nodeEnv?: string): string {
  return `.env.${resolveNodeEnv(nodeEnv)}`;
}

export function isDebugRuntime(nodeEnv?: string, appEnv?: string): boolean {
  const resolvedNodeEnv = resolveNodeEnv(nodeEnv);
  const normalizedAppEnv = appEnv?.trim().toLowerCase();

  return (
    resolvedNodeEnv === 'development' ||
    resolvedNodeEnv === 'test' ||
    normalizedAppEnv === 'development' ||
    normalizedAppEnv === 'test'
  );
}
