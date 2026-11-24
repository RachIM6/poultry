import { crc32, inflateRawSync } from "node:zlib";

/** Tests only: the files of a .zip, read from its central directory, each checked against its CRC. */
export function unzip(zip: Buffer): Map<string, string> {
  return new Map([...unzipBytes(zip)].map(([name, data]) => [name, data.toString("utf8")]));
}

/** The same, as bytes (stored files). */
export function unzipBytes(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const [crc, packed, size, nameLength, local] = [zip.readUInt32LE(p + 16), zip.readUInt32LE(p + 20), zip.readUInt32LE(p + 24), zip.readUInt16LE(p + 28), zip.readUInt32LE(p + 42)];
    const name = zip.subarray(p + 46, p + 46 + nameLength).toString("utf8");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = inflateRawSync(zip.subarray(start, start + packed));
    if (crc32(data) !== crc || data.length !== size) throw new Error(`${name}: bad CRC or size`);
    files.set(name, data);
    p += 46 + nameLength + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return files;
}
