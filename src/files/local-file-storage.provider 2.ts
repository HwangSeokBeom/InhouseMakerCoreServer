import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { FileStorageProvider, StoreFileInput, StoredFile } from './file-storage.provider';

const DEFAULT_UPLOAD_DIR = 'uploads';
const DEFAULT_PUBLIC_PATH_PREFIX = '/uploads';
const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

@Injectable()
export class LocalFileStorageProvider implements FileStorageProvider {
  constructor(private readonly configService: ConfigService) {}

  async store(input: StoreFileInput): Promise<StoredFile> {
    const extension = MIME_EXTENSION_MAP[input.mimeType] ?? path.extname(input.originalName);
    const safeDirectory = this.normalizeRelativePath(input.directory);
    const key = `${safeDirectory}/${randomUUID()}${extension}`;
    const absolutePath = this.resolveStoragePath(key);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.buffer);

    return {
      key,
      url: this.buildPublicUrl(key),
      path: absolutePath,
      mimeType: input.mimeType,
      originalName: input.originalName,
      size: input.buffer.length,
    };
  }

  async deleteByUrl(url: string | null | undefined): Promise<void> {
    if (!url) {
      return;
    }

    const key = this.extractStorageKey(url);
    if (!key) {
      return;
    }

    try {
      await unlink(this.resolveStoragePath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private buildPublicUrl(key: string): string {
    const publicPath = `${DEFAULT_PUBLIC_PATH_PREFIX}/${key}`;
    const baseUrl = this.configService.get<string>('UPLOAD_BASE_URL')?.replace(/\/$/, '');

    return baseUrl ? `${baseUrl}${publicPath}` : publicPath;
  }

  private extractStorageKey(rawUrl: string): string | null {
    const pathname = this.extractPathname(rawUrl);
    if (!pathname.startsWith(`${DEFAULT_PUBLIC_PATH_PREFIX}/`)) {
      return null;
    }

    return this.normalizeRelativePath(
      pathname.slice(DEFAULT_PUBLIC_PATH_PREFIX.length + 1),
    );
  }

  private extractPathname(rawUrl: string): string {
    try {
      return new URL(rawUrl).pathname;
    } catch {
      return rawUrl.split('?')[0] ?? rawUrl;
    }
  }

  private resolveStoragePath(key: string): string {
    const uploadDir =
      this.configService.get<string>('UPLOAD_DIR') ?? DEFAULT_UPLOAD_DIR;
    const root = path.isAbsolute(uploadDir)
      ? uploadDir
      : path.resolve(process.cwd(), uploadDir);
    const absolutePath = path.resolve(root, key);
    const normalizedRoot = path.resolve(root);

    if (
      absolutePath !== normalizedRoot &&
      !absolutePath.startsWith(`${normalizedRoot}${path.sep}`)
    ) {
      throw new Error('Resolved upload path escapes upload root.');
    }

    return absolutePath;
  }

  private normalizeRelativePath(value: string): string {
    const normalized = path.posix.normalize(value.replace(/\\/g, '/'));

    if (
      normalized === '.' ||
      normalized.startsWith('../') ||
      normalized === '..' ||
      normalized.startsWith('/')
    ) {
      throw new Error('Invalid storage key.');
    }

    return normalized;
  }
}
