import { crc32, deflateRawSync } from "node:zlib";

// A .zip writer (PKWARE APPNOTE: local headers, central directory, end record), deflate per file.
// ponytail: no zip64, so the whole archive must stay under 4 GB; a month of books is a few hundred KB.

const DOS_1980_01_01 = 0x0021; // a fixed date: the same books give the same bytes

export function zip(files: { name: string; data: string | Uint8Array }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const { local, central } = zipEntry(f.name, f.data, offset);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  return Buffer.concat([...locals, ...zipEnd(centrals, offset)]);
}

/**
 * One file of an archive written piece by piece (scripts/export-organization.ts streams it to disk): its local part,
 * written at `offset`, and its central-directory record, kept for zipEnd.
 */
export function zipEntry(fileName: string, data: string | Uint8Array, offset: number): { local: Buffer; central: Buffer } {
  const raw = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  const packed = deflateRawSync(raw);
  const name = Buffer.from(fileName, "utf8");
  const common = Buffer.alloc(26);
  common.writeUInt16LE(20, 0); // version needed: 2.0 (deflate)
  common.writeUInt16LE(0x0800, 2); // UTF-8 names
  common.writeUInt16LE(8, 4); // deflate
  common.writeUInt16LE(0, 6); // time
  common.writeUInt16LE(DOS_1980_01_01, 8);
  common.writeUInt32LE(crc32(raw), 10);
  common.writeUInt32LE(packed.length, 14);
  common.writeUInt32LE(raw.length, 18);
  common.writeUInt16LE(name.length, 22);
  common.writeUInt16LE(0, 24); // no extra field
  return {
    local: Buffer.concat([u32(0x04034b50), common, name, packed]),
    central: Buffer.concat([u32(0x02014b50), u16(20), common, Buffer.alloc(10), u32(offset), name]), // no comment, disk 0, no attributes
  };
}

/** The central directory and end record, after every local part (`offset`: where the directory starts). */
export function zipEnd(centrals: Buffer[], offset: number): Buffer[] {
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return [directory, end];
}

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
