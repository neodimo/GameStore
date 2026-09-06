/**
 * Steam's binary VDF, which is how `shortcuts.vdf` stores non-Steam games.
 *
 * The format is a tag-prefixed tree: 0x00 opens a nested map, 0x01 is a
 * NUL-terminated string, 0x02 is a little-endian int32, and 0x08 closes the
 * current map. A `shortcuts.vdf` file is one map named `shortcuts` whose keys
 * are the stringified entry indices, followed by a second 0x08 closing the
 * implicit document root.
 *
 * This is written as a general encoder/decoder rather than a shortcuts-shaped
 * one on purpose: the file we are handed belongs to the user and may contain
 * keys this app has never heard of. Round-tripping the whole tree means adding
 * one GameStore entry cannot silently drop somebody else's shortcut fields.
 */

export type VdfValue = string | number | VdfMap;
export type VdfMap = { [key: string]: VdfValue };

const MAP = 0x00;
const STRING = 0x01;
const INT32 = 0x02;
const END = 0x08;

const readCString = (buffer: Buffer, offset: number): [string, number] => {
  const end = buffer.indexOf(0, offset);
  if (end < 0) throw new Error("Malformed shortcuts.vdf: unterminated string.");
  return [buffer.toString("utf8", offset, end), end + 1];
};

const readMap = (buffer: Buffer, start: number): [VdfMap, number] => {
  const map: VdfMap = {};
  let offset = start;
  for (;;) {
    if (offset >= buffer.length) throw new Error("Malformed shortcuts.vdf: map is not closed.");
    const tag = buffer[offset];
    offset += 1;
    if (tag === END) return [map, offset];
    const [key, afterKey] = readCString(buffer, offset);
    offset = afterKey;
    if (tag === MAP) {
      const [child, afterChild] = readMap(buffer, offset);
      map[key] = child;
      offset = afterChild;
    } else if (tag === STRING) {
      const [value, afterValue] = readCString(buffer, offset);
      map[key] = value;
      offset = afterValue;
    } else if (tag === INT32) {
      map[key] = buffer.readInt32LE(offset);
      offset += 4;
    } else {
      throw new Error(`Malformed shortcuts.vdf: unknown value tag 0x${tag.toString(16)}.`);
    }
  }
};

/** Decodes a whole binary VDF document into its single named root map. */
export const decodeBinaryVdf = (buffer: Buffer): { name: string; value: VdfMap } => {
  if (buffer.length === 0) throw new Error("Malformed shortcuts.vdf: file is empty.");
  if (buffer[0] !== MAP) throw new Error("Malformed shortcuts.vdf: file does not start with a map.");
  const [name, afterName] = readCString(buffer, 1);
  const [value] = readMap(buffer, afterName);
  return { name, value };
};

const cString = (value: string) => Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);

const encodeMapBody = (map: VdfMap): Buffer => {
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined) continue;
    if (typeof value === "string") parts.push(Buffer.from([STRING]), cString(key), cString(value));
    else if (typeof value === "number") {
      const int = Buffer.alloc(4);
      // Steam stores appids as unsigned but the field is a signed int32 slot,
      // so anything with the non-Steam high bit set has to be written by its
      // signed reinterpretation rather than rejected as out of range.
      int.writeInt32LE(value > 0x7fffffff ? value - 0x100000000 : value);
      parts.push(Buffer.from([INT32]), cString(key), int);
    // `encodeMapBody` emits its own closing byte, so a nested map needs no
    // second one here.
    } else parts.push(Buffer.from([MAP]), cString(key), encodeMapBody(value));
  }
  parts.push(Buffer.from([END]));
  return Buffer.concat(parts);
};

/** Encodes a named root map, including the document-terminating end byte. */
export const encodeBinaryVdf = (name: string, value: VdfMap): Buffer =>
  Buffer.concat([Buffer.from([MAP]), cString(name), encodeMapBody(value), Buffer.from([END])]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value;
  }
  return table;
})();

/** Standard CRC-32, the hash Steam derives non-Steam shortcut app IDs from. */
export const crc32 = (input: string): number => {
  const bytes = Buffer.from(input, "utf8");
  let crc = -1;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
};

/**
 * The app ID Steam assigns a non-Steam shortcut: `crc32(Exe + AppName)` with
 * the high bit set, where `Exe` is the *quoted* string exactly as it is stored
 * in the file. Getting the quoting wrong produces a valid-looking but different
 * number, which is the difference between artwork appearing and Steam showing a
 * blank tile, so the quoted form is the input this function takes.
 */
export const shortcutAppId = (quotedExe: string, appName: string): number =>
  (crc32(`${quotedExe}${appName}`) | 0x80000000) >>> 0;

/** The 64-bit id `steam://rungameid/` needs for the same shortcut. */
export const shortcutRunGameId = (appId: number): string =>
  ((BigInt(appId) << 32n) | 0x02000000n).toString();

/** Reads a signed int32 appid slot back as the unsigned id artwork is keyed by. */
export const unsignedAppId = (stored: number): number => stored >>> 0;
