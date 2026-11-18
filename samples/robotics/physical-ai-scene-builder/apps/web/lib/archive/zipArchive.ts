// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Streams a directory tree (plus extra on-disk files and in-memory text files) into a ZIP64 archive
 * on disk with constant memory, so archives of any size can be built and later served with a known
 * Content-Length. Headers are written by hand because fflate's Zip does not support ZIP64.
 */
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, readdir, realpath, rename, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

import { Deflate } from 'fflate';

/** Text files keyed by archive path, written after the source tree at the archive root. */
export type ArchiveRootFiles = Readonly<Record<string, string>>;

export interface ArchiveSourceFile {
  absolutePath: string;
  archivePath: string;
  size: number;
  modifiedAt: Date;
  /** Listed from `sourceDirectory` (so it goes under `sourcePrefix`), not an additional file. */
  fromSourceDirectory: boolean;
}

export interface ArchiveSourceInspection {
  files: ArchiveSourceFile[];
  totalBytes: number;
}

export interface ZipArchiveResult {
  archivePath: string;
  size: number;
  sourceBytes: number;
  fileCount: number;
}

export interface ZipArchiveProgress {
  processedBytes: number;
  totalBytes: number;
}

/**
 * An on-disk file placed at `archivePath` verbatim, even when it lives inside the source directory
 * (for example episodes excluded from the listing and re-added under new names).
 */
export interface ZipArchiveAdditionalFile {
  absolutePath: string;
  archivePath: string;
}

export class ZipArchiveError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ZipArchiveError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------------------------
// Compression method and checksum
// ---------------------------------------------------------------------------------------------

const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
type ZipMethod = typeof ZIP_METHOD_STORE | typeof ZIP_METHOD_DEFLATE;

// Recorded datasets are dominated by payloads that are already compressed (np.savez_compressed
// frames, JPEG sidecars, videos). Re-deflating them in JS runs at ~40 MB/s and gains nothing, which
// made 100+ GB archives take hours, so they are stored as-is with only a native CRC-32 pass.
const PRECOMPRESSED_EXTENSIONS = new Set([
  '.7z',
  '.avi',
  '.bz2',
  '.gz',
  '.jpeg',
  '.jpg',
  '.mkv',
  '.mov',
  '.mp4',
  '.npz',
  '.parquet',
  '.png',
  '.tgz',
  '.webm',
  '.webp',
  '.xz',
  '.zip',
  '.zst',
]);

function zipMethodFor(archivePath: string): ZipMethod {
  return PRECOMPRESSED_EXTENSIONS.has(path.posix.extname(archivePath).toLowerCase())
    ? ZIP_METHOD_STORE
    : ZIP_METHOD_DEFLATE;
}

let crcTable: Uint32Array | null = null;

function softwareCrc32(data: Uint8Array, value = 0): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let crc = index;
      for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      crcTable[index] = crc >>> 0;
    }
  }
  let crc = ~value >>> 0;
  for (let index = 0; index < data.byteLength; index += 1) {
    crc = crcTable[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return ~crc >>> 0;
}

// zlib.crc32 is native (multi-GB/s) but only exists on Node >= 20.15 / 22.2.
const crc32: (data: Uint8Array, value?: number) => number =
  typeof zlib.crc32 === 'function' ? (data, value) => zlib.crc32(data, value) : softwareCrc32;

// ---------------------------------------------------------------------------------------------
// ZIP64 records
// ---------------------------------------------------------------------------------------------

interface Zip64Entry {
  filename: Uint8Array;
  method: ZipMethod;
  crc: number;
  compressedSize: bigint;
  size: bigint;
  offset: bigint;
  modifiedAt: Date;
}

function dosDateTime(value: Date): { time: number; date: number } {
  const year = Math.min(Math.max(value.getFullYear(), 1980), 2107);
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | (value.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
  };
}

function zip64Extra(values: readonly bigint[]): Buffer {
  const extra = Buffer.alloc(4 + values.length * 8);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(values.length * 8, 2);
  values.forEach((value, index) => extra.writeBigUInt64LE(value, 4 + index * 8));
  return extra;
}

function localZip64Header(entry: Zip64Entry): Buffer {
  const extra = zip64Extra([BigInt(0), BigInt(0)]);
  const header = Buffer.alloc(30 + entry.filename.byteLength + extra.byteLength);
  const { time, date } = dosDateTime(entry.modifiedAt);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE(0x0808, 6);
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(0xffffffff, 18);
  header.writeUInt32LE(0xffffffff, 22);
  header.writeUInt16LE(entry.filename.byteLength, 26);
  header.writeUInt16LE(extra.byteLength, 28);
  header.set(entry.filename, 30);
  extra.copy(header, 30 + entry.filename.byteLength);
  return header;
}

function dataDescriptor(entry: Zip64Entry): Buffer {
  const descriptor = Buffer.alloc(24);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(entry.crc >>> 0, 4);
  descriptor.writeBigUInt64LE(entry.compressedSize, 8);
  descriptor.writeBigUInt64LE(entry.size, 16);
  return descriptor;
}

function centralZip64Header(entry: Zip64Entry): Buffer {
  const extra = zip64Extra([entry.size, entry.compressedSize, entry.offset]);
  const header = Buffer.alloc(46 + entry.filename.byteLength + extra.byteLength);
  const { time, date } = dosDateTime(entry.modifiedAt);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE(45, 6);
  header.writeUInt16LE(0x0808, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(entry.crc >>> 0, 16);
  header.writeUInt32LE(0xffffffff, 20);
  header.writeUInt32LE(0xffffffff, 24);
  header.writeUInt16LE(entry.filename.byteLength, 28);
  header.writeUInt16LE(extra.byteLength, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(0xffffffff, 42);
  header.set(entry.filename, 46);
  extra.copy(header, 46 + entry.filename.byteLength);
  return header;
}

function zip64End(entryCount: number, centralOffset: bigint, centralSize: bigint): Buffer {
  const end = Buffer.alloc(56 + 20 + 22);
  end.writeUInt32LE(0x06064b50, 0);
  end.writeBigUInt64LE(BigInt(44), 4);
  end.writeUInt16LE(45, 12);
  end.writeUInt16LE(45, 14);
  end.writeUInt32LE(0, 16);
  end.writeUInt32LE(0, 20);
  end.writeBigUInt64LE(BigInt(entryCount), 24);
  end.writeBigUInt64LE(BigInt(entryCount), 32);
  end.writeBigUInt64LE(centralSize, 40);
  end.writeBigUInt64LE(centralOffset, 48);
  const locatorOffset = 56;
  end.writeUInt32LE(0x07064b50, locatorOffset);
  end.writeUInt32LE(0, locatorOffset + 4);
  end.writeBigUInt64LE(centralOffset + centralSize, locatorOffset + 8);
  end.writeUInt32LE(1, locatorOffset + 16);
  const endOffset = 76;
  end.writeUInt32LE(0x06054b50, endOffset);
  end.writeUInt16LE(0xffff, endOffset + 8);
  end.writeUInt16LE(0xffff, endOffset + 10);
  end.writeUInt16LE(0xffff, endOffset + 12);
  end.writeUInt16LE(0xffff, endOffset + 14);
  end.writeUInt32LE(0xffffffff, endOffset + 16);
  end.writeUInt16LE(0, endOffset + 20);
  return end;
}

// ---------------------------------------------------------------------------------------------
// Source inspection
// ---------------------------------------------------------------------------------------------

function pathIsInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function formatBytes(value: bigint): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Number(value);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ZipArchiveError('Archive creation was cancelled.', 499);
  }
}

function safeArchivePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (
    !normalized ||
    normalized.split('/').some((part) => part === '..' || part === '.') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new ZipArchiveError(`Archive path '${value}' is invalid.`, 409);
  }
  return normalized;
}

async function inspectAdditionalFiles(
  files: readonly ZipArchiveAdditionalFile[],
  storageRealPath: string,
  archivePaths: ReadonlySet<string>,
): Promise<ArchiveSourceFile[]> {
  const inspected: ArchiveSourceFile[] = [];
  const seen = new Set(archivePaths);
  for (const file of files) {
    const archivePath = safeArchivePath(file.archivePath);
    if (seen.has(archivePath)) {
      throw new ZipArchiveError(`Archive contains duplicate path '${archivePath}'.`, 409);
    }
    seen.add(archivePath);
    const absolutePath = path.resolve(file.absolutePath);
    const fileInfo = await lstat(absolutePath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      throw new ZipArchiveError(`Archive source '${file.archivePath}' is not a safe file.`, 409);
    }
    const [fileRealPath, regularFile] = await Promise.all([
      realpath(absolutePath),
      stat(absolutePath),
    ]);
    if (!pathIsInside(storageRealPath, fileRealPath)) {
      throw new ZipArchiveError(
        `Archive source '${file.archivePath}' is outside its storage root.`,
        409,
      );
    }
    if (!regularFile.isFile() || !Number.isSafeInteger(regularFile.size) || regularFile.size < 0) {
      throw new ZipArchiveError(
        `Archive source '${file.archivePath}' has an unsupported size.`,
        413,
      );
    }
    inspected.push({
      absolutePath,
      archivePath,
      size: regularFile.size,
      modifiedAt: regularFile.mtime,
      fromSourceDirectory: false,
    });
  }
  return inspected;
}

/**
 * Lists every regular file under `sourceDirectory` (plus `additionalFiles`) by metadata only.
 * Rejects symbolic links and anything that resolves outside `storageRoot`.
 */
export async function inspectArchiveSource(
  sourceDirectory: string,
  storageRoot: string,
  excludedPaths: ReadonlySet<string> = new Set(),
  additionalFiles: readonly ZipArchiveAdditionalFile[] = [],
): Promise<ArchiveSourceInspection> {
  const source = path.resolve(sourceDirectory);
  const root = path.resolve(storageRoot);
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw new ZipArchiveError('Archive source is not a safe directory.', 409);
  }
  const [sourceRealPath, storageRealPath] = await Promise.all([realpath(source), realpath(root)]);
  if (!pathIsInside(storageRealPath, sourceRealPath)) {
    throw new ZipArchiveError('Archive source is outside the local storage root.', 409);
  }

  const files: ArchiveSourceFile[] = [];
  let totalBytes = 0;
  const pending = [{ absolutePath: source, relativePath: '' }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    const entries = await readdir(current.absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = current.relativePath
        ? path.join(current.relativePath, entry.name)
        : entry.name;
      const archivePath = relativePath.split(path.sep).join('/');
      if (excludedPaths.has(archivePath)) continue;
      const absolutePath = path.resolve(current.absolutePath, entry.name);
      if (!pathIsInside(source, absolutePath)) {
        throw new ZipArchiveError('Archive source contains a path outside its root.', 409);
      }
      if (entry.isSymbolicLink()) {
        throw new ZipArchiveError(
          `Archive source contains an unsafe symbolic link '${relativePath}'.`,
          409,
        );
      }
      if (entry.isDirectory()) {
        pending.push({ absolutePath, relativePath });
        continue;
      }
      if (!entry.isFile()) continue;

      const [fileRealPath, fileInfo] = await Promise.all([
        realpath(absolutePath),
        stat(absolutePath),
      ]);
      if (!pathIsInside(sourceRealPath, fileRealPath)) {
        throw new ZipArchiveError(
          `Archive source file '${relativePath}' is outside its root.`,
          409,
        );
      }
      if (!Number.isSafeInteger(fileInfo.size) || fileInfo.size < 0) {
        throw new ZipArchiveError(
          `Archive source file '${relativePath}' has an unsupported size.`,
          413,
        );
      }
      totalBytes += fileInfo.size;
      if (!Number.isSafeInteger(totalBytes)) {
        throw new ZipArchiveError('Archive source is too large to archive safely.', 413);
      }
      files.push({
        absolutePath,
        archivePath,
        size: fileInfo.size,
        modifiedAt: fileInfo.mtime,
        fromSourceDirectory: true,
      });
    }
  }
  const additional = await inspectAdditionalFiles(
    additionalFiles,
    storageRealPath,
    new Set([...files.map((file) => file.archivePath), ...excludedPaths]),
  );
  files.push(...additional);
  totalBytes += additional.reduce((total, file) => total + file.size, 0);
  if (!Number.isSafeInteger(totalBytes)) {
    throw new ZipArchiveError('Archive source is too large to archive safely.', 413);
  }
  files.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
  return { files, totalBytes };
}

function sourcePrefix(value: string | undefined): string {
  if (!value) return '';
  const normalized = value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '.')) {
    throw new ZipArchiveError('Archive source prefix is invalid.', 409);
  }
  return normalized;
}

// ---------------------------------------------------------------------------------------------
// Archive writer
// ---------------------------------------------------------------------------------------------

/**
 * Writes `sourceDirectory` (under `sourcePrefix`), then `additionalFiles`, then `rootFiles` into a
 * ZIP64 archive at `archivePath`. The archive is staged in a temporary file and renamed into place
 * only once complete; cancellation or any error removes the temporary file.
 */
export async function createZipArchive({
  sourceDirectory,
  archivePath,
  storageRoot,
  rootFiles,
  sourcePrefix: requestedSourcePrefix,
  excludePaths,
  additionalFiles,
  onProgress,
  signal,
}: {
  sourceDirectory: string;
  archivePath: string;
  storageRoot: string;
  rootFiles: ArchiveRootFiles;
  /** Archive directory for files from `sourceDirectory`; additional and root files are unaffected. */
  sourcePrefix?: string;
  /** Paths relative to `sourceDirectory` to leave out. */
  excludePaths?: readonly string[];
  additionalFiles?: readonly ZipArchiveAdditionalFile[];
  onProgress?: (progress: ZipArchiveProgress) => void;
  signal?: AbortSignal;
}): Promise<ZipArchiveResult> {
  throwIfAborted(signal);
  const destination = path.resolve(archivePath);
  const root = path.resolve(storageRoot);
  if (!pathIsInside(root, destination)) {
    throw new ZipArchiveError('Archive path is outside its storage root.', 409);
  }

  const source = path.resolve(sourceDirectory);
  const inspection = await inspectArchiveSource(
    source,
    storageRoot,
    new Set(excludePaths),
    additionalFiles,
  );
  const prefix = sourcePrefix(requestedSourcePrefix);
  const rootFileEntries = Object.entries(rootFiles).map(
    ([name, content]) => [safeArchivePath(name), Buffer.from(content, 'utf8')] as const,
  );
  const rootFileBytes = rootFileEntries.reduce((total, [, bytes]) => total + bytes.byteLength, 0);
  const entryCount = inspection.files.length + rootFileEntries.length;

  const filesystem = await statfs(path.dirname(destination), { bigint: true });
  const availableBytes = filesystem.bavail * filesystem.bsize;
  const conservativeArchiveBytes =
    BigInt(inspection.totalBytes) + BigInt(rootFileBytes) + BigInt(entryCount * 512 + 1024 ** 2);
  if (availableBytes < conservativeArchiveBytes) {
    throw new ZipArchiveError(
      `Not enough free disk space to create the archive: it needs about ${formatBytes(conservativeArchiveBytes)} but only ${formatBytes(availableBytes)} is available.`,
      507,
    );
  }

  const totalBytes = inspection.totalBytes + rootFileBytes;
  let processedBytes = 0;
  onProgress?.({ processedBytes, totalBytes });

  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  const output = createWriteStream(temporaryPath, { flags: 'wx' });
  const finished = once(output, 'finish');
  // Only awaited on success; a stream error on the failure path must not become unhandled.
  finished.catch(() => undefined);
  let archiveOffset = BigInt(0);
  let writeError: unknown = null;
  let drainPromise: Promise<void> | null = null;
  const entries: Zip64Entry[] = [];
  output.once('error', (error) => {
    if (writeError === null) writeError = error;
  });

  const waitForDrain = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        output.off('drain', onDrain);
        output.off('error', onError);
        output.off('close', onClose);
        signal?.removeEventListener('abort', onAbort);
        callback();
      };
      const onDrain = (): void => settle(resolve);
      const onError = (error: Error): void => settle(() => reject(error));
      const onClose = (): void =>
        settle(() => reject(new Error('Archive output closed before draining.')));
      const onAbort = (): void =>
        settle(() => reject(new ZipArchiveError('Archive creation was cancelled.', 499)));
      output.once('drain', onDrain);
      output.once('error', onError);
      output.once('close', onClose);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });

  const write = (chunk: Uint8Array): void => {
    if (chunk.byteLength === 0 || writeError) return;
    try {
      const canContinue = output.write(chunk);
      archiveOffset += BigInt(chunk.byteLength);
      if (!canContinue && !drainPromise) {
        drainPromise = waitForDrain().finally(() => {
          drainPromise = null;
        });
      }
    } catch (error) {
      writeError = error;
    }
  };

  // Applies backpressure and surfaces asynchronous write failures.
  const flush = async (): Promise<void> => {
    if (drainPromise) await drainPromise;
    if (writeError) throw writeError;
  };

  const writeEntry = async (
    name: string,
    modifiedAt: Date,
    chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): Promise<void> => {
    const entry: Zip64Entry = {
      filename: Buffer.from(name, 'utf8'),
      method: zipMethodFor(name),
      crc: 0,
      compressedSize: BigInt(0),
      size: BigInt(0),
      offset: archiveOffset,
      modifiedAt,
    };
    const emit = (data: Uint8Array): void => {
      entry.compressedSize += BigInt(data.byteLength);
      write(data);
    };
    const deflater =
      entry.method === ZIP_METHOD_DEFLATE ? new Deflate({ level: 1 }, (data) => emit(data)) : null;
    write(localZip64Header(entry));
    for await (const chunk of chunks) {
      throwIfAborted(signal);
      entry.crc = crc32(chunk, entry.crc);
      entry.size += BigInt(chunk.byteLength);
      if (deflater) deflater.push(chunk, false);
      else emit(chunk);
      processedBytes += chunk.byteLength;
      onProgress?.({ processedBytes, totalBytes });
      await flush();
    }
    deflater?.push(new Uint8Array(0), true);
    write(dataDescriptor(entry));
    await flush();
    entries.push(entry);
  };

  try {
    for (const file of inspection.files) {
      throwIfAborted(signal);
      // Decided by how the file was listed, not where it lives: additional files inside the
      // source directory (renumbered episodes) already carry their full archive path.
      const name =
        prefix && file.fromSourceDirectory ? `${prefix}/${file.archivePath}` : file.archivePath;
      const highWaterMark = zipMethodFor(name) === ZIP_METHOD_STORE ? 1024 * 1024 : 64 * 1024;
      await writeEntry(
        name,
        file.modifiedAt,
        createReadStream(file.absolutePath, { highWaterMark }) as AsyncIterable<Buffer>,
      );
    }
    const now = new Date();
    for (const [name, bytes] of rootFileEntries) {
      throwIfAborted(signal);
      await writeEntry(name, now, [bytes]);
    }

    const centralOffset = archiveOffset;
    for (const entry of entries) write(centralZip64Header(entry));
    write(zip64End(entries.length, centralOffset, archiveOffset - centralOffset));
    await flush();
    output.end();
    await finished;
    throwIfAborted(signal);
    await rename(temporaryPath, destination);
    const archiveInfo = await stat(destination);
    return {
      archivePath: destination,
      size: archiveInfo.size,
      sourceBytes: inspection.totalBytes,
      fileCount: entryCount,
    };
  } catch (error) {
    output.destroy();
    await rm(temporaryPath, { force: true });
    if (error instanceof ZipArchiveError) throw error;
    throw new ZipArchiveError(
      `Archive could not be created: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
