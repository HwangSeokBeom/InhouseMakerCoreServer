export const FILE_STORAGE_PROVIDER = Symbol('FILE_STORAGE_PROVIDER');

export interface StoreFileInput {
  buffer: Buffer;
  directory: string;
  mimeType: string;
  originalName: string;
}

export interface StoredFile {
  key: string;
  url: string;
  path: string;
  mimeType: string;
  originalName: string;
  size: number;
}

export interface FileStorageProvider {
  store(input: StoreFileInput): Promise<StoredFile>;
  deleteByUrl(url: string | null | undefined): Promise<void>;
}
