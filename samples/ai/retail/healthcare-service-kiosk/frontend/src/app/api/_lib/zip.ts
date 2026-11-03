// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { crc32 } from "zlib";

export type ZipEntry = { name: string; bytes: Uint8Array };

/** A stored (uncompressed) zip archive; what goes in here is already compressed. */
export function zip(entries: ZipEntry[], at = new Date()): Buffer {
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1);
  const date = ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  const files: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const { name, bytes } of entries) {
    const fileName = Buffer.from(name, "utf8");
    const crc = crc32(bytes);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    files.push(local, fileName, Buffer.from(bytes));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, fileName);

    offset += local.length + fileName.length + bytes.length;
  }

  const listing = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(listing.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, listing, end]);
}
