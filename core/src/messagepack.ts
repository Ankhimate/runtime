export class MessagePackError extends Error {
  constructor(message: string) { super(message); this.name = "MessagePackError"; }
}

export function decodeMessagePack(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  const need = (count: number): void => {
    if (offset + count > bytes.length) throw new MessagePackError("truncated MessagePack payload");
  };
  const byte = (): number => { need(1); return bytes[offset++]!; };
  const uint = (count: 1 | 2 | 4): number => {
    need(count);
    const value = count === 1 ? view.getUint8(offset)
      : count === 2 ? view.getUint16(offset, false) : view.getUint32(offset, false);
    offset += count;
    return value;
  };
  const string = (length: number): string => {
    need(length);
    let value: string;
    try { value = text.decode(bytes.subarray(offset, offset + length)); }
    catch { throw new MessagePackError("invalid UTF-8 string"); }
    offset += length;
    return value;
  };
  const array = (length: number): unknown[] => Array.from({ length }, read);
  const map = (length: number): Record<string, unknown> => {
    const value: Record<string, unknown> = {};
    for (let index = 0; index < length; index++) {
      const key = read();
      if (typeof key !== "string") throw new MessagePackError("map key is not a string");
      if (Object.hasOwn(value, key)) throw new MessagePackError(`duplicate map key ${JSON.stringify(key)}`);
      value[key] = read();
    }
    return value;
  };
  function read(): unknown {
    const tag = byte();
    if (tag <= 0x7f) return tag;
    if (tag >= 0xe0) return tag - 0x100;
    if ((tag & 0xe0) === 0xa0) return string(tag & 0x1f);
    if ((tag & 0xf0) === 0x90) return array(tag & 0x0f);
    if ((tag & 0xf0) === 0x80) return map(tag & 0x0f);
    switch (tag) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xca: need(4); { const value = view.getFloat32(offset, false); offset += 4; return value; }
      case 0xcb: need(8); { const value = view.getFloat64(offset, false); offset += 8; return value; }
      case 0xcc: return uint(1);
      case 0xcd: return uint(2);
      case 0xce: return uint(4);
      case 0xd0: { const value = uint(1); return value >= 0x80 ? value - 0x100 : value; }
      case 0xd1: need(2); { const value = view.getInt16(offset, false); offset += 2; return value; }
      case 0xd2: need(4); { const value = view.getInt32(offset, false); offset += 4; return value; }
      case 0xd9: return string(uint(1));
      case 0xda: return string(uint(2));
      case 0xdb: return string(uint(4));
      case 0xdc: return array(uint(2));
      case 0xdd: return array(uint(4));
      case 0xde: return map(uint(2));
      case 0xdf: return map(uint(4));
      default: throw new MessagePackError(`unsupported MessagePack tag 0x${tag.toString(16)}`);
    }
  }
  const result = read();
  if (offset !== bytes.length) throw new MessagePackError("trailing MessagePack bytes");
  return result;
}
