// Wire format for /api/landing/points:
//   [u32 LE header byte length][header JSON utf-8][zero pad to 4][u32 ts × n][u16 artist × n]
// Typed arrays use platform byte order; every browser and server we target is little-endian.
export type LandingHeader = { user: string; n: number; tz: string; artists: string[]; firstTs: number; lastTs: number };
export type LandingPayload = { header: LandingHeader; ts: Uint32Array; artist: Uint16Array };

/** Artist rank for everyone outside the top MAX_NAMED_ARTISTS. */
export const OTHER_ARTIST = 65535;
export const MAX_NAMED_ARTISTS = 1000;

export function encodePayload(p: LandingPayload): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(p.header));
  const n = p.header.n;
  const tsOff = Math.ceil((4 + head.length) / 4) * 4;
  const out = new Uint8Array(tsOff + n * 4 + n * 2);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  new Uint32Array(out.buffer, tsOff, n).set(p.ts.subarray(0, n));
  new Uint16Array(out.buffer, tsOff + n * 4, n).set(p.artist.subarray(0, n));
  return out;
}

export function decodePayload(buf: ArrayBuffer): LandingPayload {
  const bad = () => new Error("bad landing payload");
  if (buf.byteLength < 4) throw bad();
  const headLen = new DataView(buf).getUint32(0, true);
  if (4 + headLen > buf.byteLength) throw bad();
  let header: LandingHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headLen)));
  } catch {
    throw bad();
  }
  const n = header.n;
  const tsOff = Math.ceil((4 + headLen) / 4) * 4;
  if (!Number.isInteger(n) || n < 0 || tsOff + n * 6 !== buf.byteLength) throw bad();
  return {
    header,
    ts: new Uint32Array(buf.slice(tsOff, tsOff + n * 4)),
    artist: new Uint16Array(buf.slice(tsOff + n * 4, tsOff + n * 6)),
  };
}
