/**
 * How high the ground is, from the IGN's MDT05: the national 5 m terrain model, from the
 * PNOA LiDAR, served as INSPIRE WCS coverages. Five times finer than the global Terrarium
 * tiles this first read. Coverages come back as uncompressed 16-bit single-sample TIFF,
 * the simplest shape a TIFF has, so it is decoded here in seventy lines rather than by a
 * raster stack pulled in to read a few tiles at build time.
 */

/** The IGN's 5 m model, in ETRS89 geographic coordinates. */
export const COVERAGE = 'Elevacion4258_5';
const WCS = 'https://servicios.idee.es/wcs-inspire/mdt';

/** One request: 0,01° is about 1,1 x 0,8 km here, 222x222 pixels and 99 KB. Small enough that a cell nobody walks in is never fetched. */
export const CELL = 0.01;

export const cellKey = (lat: number, lng: number) => `${Math.floor(lat / CELL)}_${Math.floor(lng / CELL)}`;

export function cellUrl(key: string): string {
  const [latIndex, lngIndex] = key.split('_').map(Number);
  const south = latIndex * CELL;
  const west = lngIndex * CELL;
  return (
    `${WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${COVERAGE}` +
    `&subset=lat(${south.toFixed(4)},${(south + CELL).toFixed(4)})` +
    `&subset=long(${west.toFixed(4)},${(west + CELL).toFixed(4)})` +
    `&format=image/tiff`
  );
}

export interface Raster {
  width: number;
  height: number;
  /** Metres above sea level, row-major, north to south. */
  values: Int32Array;
  /** Geographic bounds, from the file's own tags rather than from what we asked for. */
  west: number;
  north: number;
  pixelLng: number;
  pixelLat: number;
}

/**
 * An uncompressed single-sample TIFF, with its GeoTIFF placement tags.
 *
 * Anything else throws rather than returning quiet nonsense: a height map that decoded
 * wrong would put hills in the wrong places and nothing downstream would notice.
 */
export function decodeTiff(buffer: Buffer): Raster {
  const little = buffer.toString('ascii', 0, 2) === 'II';
  if (!little && buffer.toString('ascii', 0, 2) !== 'MM') throw new Error('not a TIFF');
  const u16 = (o: number) => (little ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o));
  const u32 = (o: number) => (little ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o));
  const f64 = (o: number) => (little ? buffer.readDoubleLE(o) : buffer.readDoubleBE(o));
  if (u16(2) !== 42) throw new Error('not a classic TIFF');

  const tags = new Map<number, { type: number; count: number; offset: number }>();
  const ifd = u32(4);
  const entries = u16(ifd);
  for (let i = 0; i < entries; i++) {
    const at = ifd + 2 + i * 12;
    const tag = u16(at);
    const type = u16(at + 2);
    const count = u32(at + 4);
    // A value of four bytes or fewer sits in the entry itself; anything longer is a
    // pointer. Sizes are the TIFF types we can meet here.
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 8: 2, 9: 4, 11: 4, 12: 8 }[type] ?? 1;
    tags.set(tag, { type, count, offset: size * count <= 4 ? at + 8 : u32(at + 8) });
  }

  const scalar = (tag: number): number | undefined => {
    const entry = tags.get(tag);
    if (!entry) return undefined;
    return entry.type === 3 ? u16(entry.offset) : u32(entry.offset);
  };

  const width = scalar(256)!;
  const height = scalar(257)!;
  const bits = scalar(258) ?? 8;
  const compression = scalar(259) ?? 1;
  const samples = scalar(277) ?? 1;
  const format = scalar(339) ?? 1; // 1 unsigned, 2 signed, 3 float

  if (compression !== 1) throw new Error(`TIFF compression ${compression}, expected none`);
  if (samples !== 1) throw new Error(`${samples} samples per pixel, expected 1`);
  if (bits !== 16 && bits !== 32) throw new Error(`${bits} bits per sample`);

  // Strips, in order. A single-strip file is the common case here but not guaranteed.
  const stripsTag = tags.get(273)!;
  const stripOffsets: number[] = [];
  for (let i = 0; i < stripsTag.count; i++) {
    stripOffsets.push(stripsTag.type === 3 ? u16(stripsTag.offset + i * 2) : u32(stripsTag.offset + i * 4));
  }
  const rowsPerStrip = scalar(278) ?? height;

  const values = new Int32Array(width * height);
  let written = 0;
  for (let s = 0; s < stripOffsets.length; s++) {
    const rows = Math.min(rowsPerStrip, height - s * rowsPerStrip);
    for (let i = 0; i < rows * width; i++) {
      const at = stripOffsets[s] + i * (bits / 8);
      let value: number;
      if (bits === 32) value = format === 3 ? (little ? buffer.readFloatLE(at) : buffer.readFloatBE(at)) : u32(at);
      else value = format === 2 ? (little ? buffer.readInt16LE(at) : buffer.readInt16BE(at)) : u16(at);
      values[written++] = Math.round(value);
    }
  }

  // Where on the earth it sits. ModelPixelScale is (x, y, z); ModelTiepoint maps a raster
  // point to a model point, and for a north-up image the first tie point is the top-left.
  const scale = tags.get(33550);
  const tie = tags.get(33922);
  if (!scale || !tie) throw new Error('no GeoTIFF placement tags');

  return {
    width,
    height,
    values,
    west: f64(tie.offset + 3 * 8),
    north: f64(tie.offset + 4 * 8),
    pixelLng: f64(scale.offset),
    pixelLat: f64(scale.offset + 8),
  };
}

export interface Terrain {
  /** Metres above sea level, or null where no coverage holds the point. */
  at(lat: number, lng: number): number | null;
}

/** Reads heights out of a set of decoded coverages, keyed by cell. */
export function terrainFrom(cells: Map<string, Raster>): Terrain {
  return {
    at(lat: number, lng: number): number | null {
      const raster = cells.get(cellKey(lat, lng));
      if (!raster) return null;
      const px = Math.floor((lng - raster.west) / raster.pixelLng);
      const py = Math.floor((raster.north - lat) / raster.pixelLat);
      if (px < 0 || py < 0 || px >= raster.width || py >= raster.height) return null;
      const metres = raster.values[py * raster.width + px];
      // The model marks sea and gaps with a large negative; Lugo is 400 m up and nothing
      // real here is below 300.
      return metres < -1000 ? null : metres;
    },
  };
}

export { WCS };
