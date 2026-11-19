import { crc32, deflateRawSync } from "node:zlib";

// A .zip writer (PKWARE APPNOTE: local headers, central directory, end record), deflate per file.
// ponytail: no zip64, so the whole archive must stay under 4 GB; a month of books is a few hundred KB.

const DOS_1980_01_01 = 0x0021; // a fixed date: the same books give the same bytes

export function zip(files: { name: string; data: string | Uint8Array }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === "string" ? Buffer.from(f.data, "utf8") : Buffer.from(f.data);
    const packed = deflateRawSync(raw);
    const name = Buffer.from(f.name, "utf8");
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
    const local = Buffer.concat([u32(0x04034b50), common, name, packed]);
    const central = Buffer.concat([u32(0x02014b50), u16(20), common, Buffer.alloc(10), u32(offset), name]); // no comment, disk 0, no attributes
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
