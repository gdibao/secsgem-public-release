import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  completeDesktopBuildAsset,
  createDesktopBuildAssetUpload,
  inspectDesktopBuildAsset,
  readTrustedDesktopBuildAsset,
  validateDesktopBuildAssetManifest,
} from './assets';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const HEADER_ID = '33333333-3333-4333-8333-333333333333';
const SIDEBAR_ID = '44444444-4444-4444-8444-444444444444';

const writeUint16Le = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
};

const writeUint32Be = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = (value >>> 24) & 255;
  bytes[offset + 1] = (value >>> 16) & 255;
  bytes[offset + 2] = (value >>> 8) & 255;
  bytes[offset + 3] = value & 255;
};

const writeUint32Le = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
  bytes[offset + 2] = (value >>> 16) & 255;
  bytes[offset + 3] = (value >>> 24) & 255;
};

const concatBytes = (...parts: Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
};

const crc32 = (bytes: Uint8Array) => {
  let crc = 4_294_967_295;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (3_988_292_384 & -(crc & 1));
    }
  }
  return (crc ^ 4_294_967_295) >>> 0;
};

const pngChunk = (type: string, data: Uint8Array) => {
  const typeBytes = Uint8Array.from([...type].map((character) => character.charCodeAt(0)));
  const bytes = new Uint8Array(12 + data.byteLength);
  writeUint32Be(bytes, 0, data.byteLength);
  bytes.set(typeBytes, 4);
  bytes.set(data, 8);
  writeUint32Be(bytes, 8 + data.byteLength, crc32(bytes.slice(4, 8 + data.byteLength)));
  return bytes;
};

type PngOptions = {
  afterIdatChunks?: Uint8Array[];
  bitDepth?: number;
  beforeIdatChunks?: Uint8Array[];
  colorType?: number;
  compressionMethod?: number;
  filterMethod?: number;
  idat?: Uint8Array;
  includeIdat?: boolean;
  interlaceMethod?: number;
};

const pngIdatCache = new Map<string, Uint8Array>();

const pngChannels = (colorType: number) => ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType]!;

const createValidPngIdat = (width: number, height: number, bitsPerPixel: number) => {
  const key = `${width}x${height}:${bitsPerPixel}`;
  const cached = pngIdatCache.get(key);
  if (cached) return cached;

  const idat = new Uint8Array(
    deflateSync(Buffer.alloc(height * (1 + Math.ceil((width * bitsPerPixel) / 8)))),
  );
  pngIdatCache.set(key, idat);
  return idat;
};

const createDifferentValidPngIdat = (width: number, height: number) => {
  const bytes = Buffer.alloc(height * (1 + width * 4));
  bytes[1] = 1;
  return new Uint8Array(deflateSync(bytes));
};

const png = (width: number, height: number, options: PngOptions = {}) => {
  const ihdr = new Uint8Array(13);
  writeUint32Be(ihdr, 0, width);
  writeUint32Be(ihdr, 4, height);
  ihdr[8] = options.bitDepth ?? 8;
  ihdr[9] = options.colorType ?? 6;
  ihdr[10] = options.compressionMethod ?? 0;
  ihdr[11] = options.filterMethod ?? 0;
  ihdr[12] = options.interlaceMethod ?? 0;

  const bitDepth = options.bitDepth ?? 8;
  const colorType = options.colorType ?? 6;
  const idat = options.idat ?? createValidPngIdat(width, height, bitDepth * pngChannels(colorType));
  return concatBytes(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    ...(options.beforeIdatChunks ?? []),
    ...(options.includeIdat === false ? [] : [pngChunk('IDAT', idat)]),
    ...(options.afterIdatChunks ?? []),
    pngChunk('IEND', new Uint8Array()),
  );
};

const bmp = (width: number, height: number) => {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowBytes * height;
  const bytes = new Uint8Array(54 + pixelBytes);
  bytes.set([66, 77]);
  writeUint32Le(bytes, 2, bytes.byteLength);
  writeUint32Le(bytes, 10, 54);
  writeUint32Le(bytes, 14, 40);
  writeUint32Le(bytes, 18, width);
  writeUint32Le(bytes, 22, height);
  writeUint16Le(bytes, 26, 1);
  writeUint16Le(bytes, 28, 24);
  writeUint32Le(bytes, 34, pixelBytes);
  return bytes;
};

const icoDib = (width: number, height: number) => {
  const xorRowBytes = Math.ceil((width * 32) / 32) * 4;
  const andRowBytes = Math.ceil(width / 32) * 4;
  const xorBytes = xorRowBytes * height;
  const andBytes = andRowBytes * height;
  const bytes = new Uint8Array(40 + xorBytes + andBytes);

  writeUint32Le(bytes, 0, 40);
  writeUint32Le(bytes, 4, width);
  writeUint32Le(bytes, 8, height * 2);
  writeUint16Le(bytes, 12, 1);
  writeUint16Le(bytes, 14, 32);
  writeUint32Le(bytes, 16, 0);
  writeUint32Le(bytes, 20, xorBytes);
  return bytes;
};

type IcoEntry = { height?: number; payload: Uint8Array; width: number };

const ico = (
  entries: IcoEntry[] = [
    { payload: icoDib(16, 16), width: 16 },
    { payload: png(32, 32), width: 32 },
    { payload: png(48, 48), width: 48 },
    { payload: png(256, 256), width: 256 },
  ],
) => {
  const directoryEnd = 6 + entries.length * 16;
  const bytes = new Uint8Array(
    directoryEnd + entries.reduce((total, entry) => total + entry.payload.byteLength, 0),
  );
  writeUint16Le(bytes, 0, 0);
  writeUint16Le(bytes, 2, 1);
  writeUint16Le(bytes, 4, entries.length);

  let dataOffset = directoryEnd;
  entries.forEach((entry, index) => {
    const directoryEntryOffset = 6 + index * 16;
    const height = entry.height ?? entry.width;
    bytes[directoryEntryOffset] = entry.width === 256 ? 0 : entry.width;
    bytes[directoryEntryOffset + 1] = height === 256 ? 0 : height;
    writeUint16Le(bytes, directoryEntryOffset + 4, 1);
    writeUint16Le(bytes, directoryEntryOffset + 6, 32);
    writeUint32Le(bytes, directoryEntryOffset + 8, entry.payload.byteLength);
    writeUint32Le(bytes, directoryEntryOffset + 12, dataOffset);
    bytes.set(entry.payload, dataOffset);
    dataOffset += entry.payload.byteLength;
  });

  return bytes;
};

const manifest = () => ({
  appPreview: {
    contentType: 'text/plain',
    height: 1,
    key: `desktop-build-assets/${PROFILE_ID}/${ASSET_ID}.png`,
    kind: 'appPreview' as const,
    sha256: 'untrusted',
    size: 1,
    width: 1,
  },
  nsisHeader: {
    contentType: 'text/plain',
    height: 1,
    key: `desktop-build-assets/${PROFILE_ID}/${HEADER_ID}.bmp`,
    kind: 'nsisHeader' as const,
    sha256: 'untrusted',
    size: 1,
    width: 1,
  },
  nsisSidebar: {
    contentType: 'text/plain',
    height: 1,
    key: `desktop-build-assets/${PROFILE_ID}/${SIDEBAR_ID}.bmp`,
    kind: 'nsisSidebar' as const,
    sha256: 'untrusted',
    size: 1,
    width: 1,
  },
  windowsIcon: {
    contentType: 'text/plain',
    key: `desktop-build-assets/${PROFILE_ID}/${ASSET_ID}.ico`,
    kind: 'windowsIcon' as const,
    sha256: 'untrusted',
    size: 1,
  },
});

const assetExtensions = {
  appPreview: 'png',
  nsisHeader: 'bmp',
  nsisSidebar: 'bmp',
  windowsIcon: 'ico',
} as const;

const finalAssetKey = (profileId: string, kind: keyof typeof assetExtensions, body: Uint8Array) => {
  const hash = createHash('sha256').update(body).digest('hex');
  const bytes = Buffer.from(hash.slice(0, 32), 'hex');
  bytes[6] = (bytes[6]! & 15) | 80;
  bytes[8] = (bytes[8]! & 63) | 128;
  const value = bytes.toString('hex');
  const assetId = `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  return `desktop-build-assets/${profileId}/${assetId}.${assetExtensions[kind]}`;
};

type StoredAsset = { body: Uint8Array; contentType: string };

const createAssetStorage = (objects: Map<string, StoredAsset>) => {
  const deletedKeys: string[] = [];
  const privateUploads: Array<{ body: Uint8Array; contentType: string; key: string }> = [];
  const privateUploadAttempts: Array<{ body: Uint8Array; contentType: string; key: string }> = [];

  return {
    deletedKeys,
    privateUploads,
    privateUploadAttempts,
    storage: {
      deleteFile: async (key: string) => {
        deletedKeys.push(key);
        objects.delete(key);
      },
      getFileByteArray: async (key: string) => {
        const object = objects.get(key);
        if (!object) throw new Error('OBJECT_NOT_FOUND');
        return object.body;
      },
      getFileMetadata: async (key: string) => {
        const object = objects.get(key);
        if (!object) throw new Error('OBJECT_NOT_FOUND');
        return { contentLength: object.body.byteLength, contentType: object.contentType };
      },
      uploadPrivateBufferIfAbsent: async (key: string, body: Buffer, contentType: string) => {
        const value = new Uint8Array(body);
        privateUploadAttempts.push({ body: value, contentType, key });
        if (objects.has(key)) {
          const error = new Error('Final object already exists');
          error.name = 'PreconditionFailed';
          throw error;
        }
        privateUploads.push({ body: value, contentType, key });
        objects.set(key, { body: value, contentType });
      },
    },
  };
};

describe('inspectDesktopBuildAsset', () => {
  it('accepts an ico containing all required sizes', () => {
    expect(inspectDesktopBuildAsset('windowsIcon', ico())).toMatchObject({
      contentType: 'image/x-icon',
      kind: 'windowsIcon',
    });
  });

  it('rejects an ICO entry with a nonzero reserved byte', () => {
    const body = ico();
    body[6 + 3] = 1;

    expect(() => inspectDesktopBuildAsset('windowsIcon', body)).toThrow(
      'Invalid desktop build asset',
    );
  });

  it('rejects an ICO PNG dimension mismatch before building scanlines or inflating', () => {
    const compressedByte = new Uint8Array(deflateSync(Buffer.alloc(1)));

    expect(() =>
      inspectDesktopBuildAsset(
        'windowsIcon',
        ico([
          { payload: icoDib(16, 16), width: 16 },
          {
            payload: png(2_000_000_000, 2_000_000_000, { idat: compressedByte }),
            width: 32,
          },
          { payload: png(48, 48), width: 48 },
          { payload: png(256, 256), width: 256 },
        ]),
      ),
    ).toThrow('Invalid desktop build asset');
  });

  it.each([
    [
      'a truncated embedded PNG',
      ico([
        { payload: png(16, 16).slice(0, -5), width: 16 },
        { payload: png(32, 32), width: 32 },
        { payload: png(48, 48), width: 48 },
        { payload: png(256, 256), width: 256 },
      ]),
    ],
    [
      'a malformed embedded DIB',
      ico([
        { payload: new Uint8Array([40, 0, 0, 0]), width: 16 },
        { payload: png(32, 32), width: 32 },
        { payload: png(48, 48), width: 48 },
        { payload: png(256, 256), width: 256 },
      ]),
    ],
  ])('rejects an ico containing %s', (_reason, body) => {
    expect(() => inspectDesktopBuildAsset('windowsIcon', body)).toThrow(
      'Invalid desktop build asset',
    );
  });

  it.each([
    [
      'an unsupported DIB header',
      (() => {
        const body = icoDib(16, 16);
        writeUint32Le(body, 0, 124);
        return body;
      })(),
    ],
    [
      'a compressed DIB payload',
      (() => {
        const body = icoDib(16, 16);
        writeUint32Le(body, 16, 3);
        return body;
      })(),
    ],
    [
      'an unsupported DIB bit depth',
      (() => {
        const body = icoDib(16, 16);
        writeUint16Le(body, 14, 16);
        return body;
      })(),
    ],
    [
      'a DIB palette span beyond the payload',
      (() => {
        const body = icoDib(16, 16);
        writeUint16Le(body, 14, 8);
        return body;
      })(),
    ],
    ['a truncated DIB AND mask', icoDib(16, 16).slice(0, -1)],
  ])('rejects an ico containing %s', (_reason, malformedDib) => {
    expect(() =>
      inspectDesktopBuildAsset(
        'windowsIcon',
        ico([
          { payload: malformedDib, width: 16 },
          { payload: png(32, 32), width: 32 },
          { payload: png(48, 48), width: 48 },
          { payload: png(256, 256), width: 256 },
        ]),
      ),
    ).toThrow('Invalid desktop build asset');
  });

  it.each([
    ['PNG', { payload: png(32, 32), width: 16 }],
    ['DIB', { height: 32, payload: icoDib(16, 16), width: 16 }],
  ] satisfies Array<[string, IcoEntry]>)(
    'rejects ICO directory dimensions that disagree with an embedded %s payload',
    (_format, mismatchedEntry) => {
      expect(() =>
        inspectDesktopBuildAsset(
          'windowsIcon',
          ico([
            mismatchedEntry,
            { payload: png(32, 32), width: 32 },
            { payload: png(48, 48), width: 48 },
            { payload: png(256, 256), width: 256 },
          ]),
        ),
      ).toThrow('Invalid desktop build asset');
    },
  );

  it('rejects overlapping ICO entry payloads', () => {
    const body = ico();
    writeUint32Le(body, 6 + 16 + 12, 6 + 4 * 16);

    expect(() => inspectDesktopBuildAsset('windowsIcon', body)).toThrow(
      'Invalid desktop build asset',
    );
  });

  it.each([
    ['appPreview', png(1024, 1024)],
    ['nsisHeader', bmp(150, 57)],
    ['nsisSidebar', bmp(164, 314)],
  ] as const)('validates %s dimensions', (kind, body) => {
    expect(inspectDesktopBuildAsset(kind, body)).toMatchObject({ kind });
  });

  it('rejects a truncated PNG chunk', () => {
    expect(() => inspectDesktopBuildAsset('appPreview', png(1024, 1024).slice(0, 30))).toThrow(
      'Invalid desktop build asset',
    );
  });

  it.each([
    ['without an IDAT chunk', png(1024, 1024, { includeIdat: false })],
    ['with an empty IDAT chunk', png(1024, 1024, { idat: new Uint8Array() })],
    [
      'with an IDAT stream that cannot represent image scanlines',
      png(1024, 1024, { idat: new Uint8Array(deflateSync(new Uint8Array())) }),
    ],
    ['with an invalid bit-depth/color-type combination', png(1024, 1024, { bitDepth: 4 })],
    ['with a non-zero compression method', png(1024, 1024, { compressionMethod: 1 })],
    ['with a non-zero filter method', png(1024, 1024, { filterMethod: 1 })],
    ['with an invalid interlace method', png(1024, 1024, { interlaceMethod: 2 })],
    [
      'with an invalid IEND CRC',
      (() => {
        const body = png(1024, 1024);
        body[body.byteLength - 1] ^= 1;
        return body;
      })(),
    ],
    [
      'with a duplicate IHDR chunk',
      (() => {
        const body = png(1024, 1024);
        return concatBytes(body.slice(0, 8), body.slice(8, 33), body.slice(8));
      })(),
    ],
    [
      'with non-contiguous IDAT chunks',
      (() => {
        const body = png(1024, 1024);
        return concatBytes(
          body.slice(0, 33),
          pngChunk('IDAT', new Uint8Array()),
          pngChunk('tEXt', new Uint8Array([0])),
          body.slice(33),
        );
      })(),
    ],
    ['with trailing data after IEND', concatBytes(png(1024, 1024), new Uint8Array([0]))],
  ])('rejects a PNG %s', (_reason, body) => {
    expect(() => inspectDesktopBuildAsset('appPreview', body)).toThrow(
      'Invalid desktop build asset',
    );
  });

  it.each([
    [
      'an indexed palette larger than its bit depth allows',
      png(1024, 1024, {
        beforeIdatChunks: [pngChunk('PLTE', new Uint8Array(9))],
        bitDepth: 1,
        colorType: 3,
      }),
    ],
    ['a missing indexed palette', png(1024, 1024, { bitDepth: 1, colorType: 3 })],
    [
      'a palette after IDAT',
      png(1024, 1024, { afterIdatChunks: [pngChunk('PLTE', new Uint8Array(3))] }),
    ],
    [
      'indexed transparency before the palette',
      png(1024, 1024, {
        beforeIdatChunks: [
          pngChunk('tRNS', new Uint8Array(1)),
          pngChunk('PLTE', new Uint8Array(3)),
        ],
        bitDepth: 1,
        colorType: 3,
      }),
    ],
    [
      'transparency after IDAT',
      png(1024, 1024, { afterIdatChunks: [pngChunk('tRNS', new Uint8Array(2))], colorType: 0 }),
    ],
    [
      'duplicate transparency chunks',
      png(1024, 1024, {
        beforeIdatChunks: [
          pngChunk('tRNS', new Uint8Array(2)),
          pngChunk('tRNS', new Uint8Array(2)),
        ],
        colorType: 0,
      }),
    ],
    [
      'an invalid grayscale transparency length',
      png(1024, 1024, {
        beforeIdatChunks: [pngChunk('tRNS', new Uint8Array(1))],
        colorType: 0,
      }),
    ],
    [
      'an indexed transparency length larger than its palette',
      png(1024, 1024, {
        beforeIdatChunks: [
          pngChunk('PLTE', new Uint8Array(3)),
          pngChunk('tRNS', new Uint8Array(2)),
        ],
        bitDepth: 1,
        colorType: 3,
      }),
    ],
    [
      'an invalid truecolor transparency length',
      png(1024, 1024, {
        beforeIdatChunks: [pngChunk('tRNS', new Uint8Array(2))],
        colorType: 2,
      }),
    ],
  ])('rejects a PNG with %s', (_reason, body) => {
    expect(() => inspectDesktopBuildAsset('appPreview', body)).toThrow(
      'Invalid desktop build asset',
    );
  });

  it('rejects an invalid desktop-build dimension', () => {
    expect(() => inspectDesktopBuildAsset('nsisHeader', bmp(149, 57))).toThrow(
      'Invalid desktop build asset',
    );
  });

  it('rejects an invalid BMP compression header', () => {
    const invalidCompression = bmp(150, 57);
    writeUint32Le(invalidCompression, 30, 99);

    expect(() => inspectDesktopBuildAsset('nsisHeader', invalidCompression)).toThrow(
      'Invalid desktop build asset',
    );
  });

  it('rejects an ICO missing a required size', () => {
    const missingSize = ico();
    missingSize[6] = 24;

    expect(() => inspectDesktopBuildAsset('windowsIcon', missingSize)).toThrow(
      'Invalid desktop build asset',
    );
  });

  it('issues a private upload target with a server-generated profile and exact asset key', async () => {
    const createPrivatePreSignedUpload = async () => ({
      headers: { 'x-amz-acl': 'private' },
      url: 'https://uploads.example.test/opaque-signature',
    });

    const result = await createDesktopBuildAssetUpload({
      input: { kind: 'appPreview' },
      randomId: (() => {
        const ids = [PROFILE_ID, ASSET_ID];
        return () => ids.shift()!;
      })(),
      storage: { createPrivatePreSignedUpload },
    });

    expect(result).toEqual({
      headers: { 'Content-Type': 'image/png', 'x-amz-acl': 'private' },
      key: `desktop-build-assets/${PROFILE_ID}/${ASSET_ID}.png`,
      kind: 'appPreview',
      profileId: PROFILE_ID,
      uploadUrl: 'https://uploads.example.test/opaque-signature',
    });
    expect(result.key).toMatch(
      new RegExp(
        `^desktop-build-assets/${PROFILE_ID}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.png$`,
      ),
    );
    expect(JSON.stringify(result)).not.toContain('GET');
  });

  it('finalizes a staging upload to the hash-derived private key', async () => {
    const stagingKey = `desktop-build-assets/${PROFILE_ID}/${ASSET_ID}.png`;
    const body = png(1024, 1024);
    const { deletedKeys, privateUploads, storage } = createAssetStorage(
      new Map([[stagingKey, { body, contentType: 'image/png' }]]),
    );

    const asset = await completeDesktopBuildAsset({
      key: stagingKey,
      kind: 'appPreview',
      profileId: PROFILE_ID,
      storage,
    });

    expect(asset).toMatchObject({
      contentType: 'image/png',
      key: finalAssetKey(PROFILE_ID, 'appPreview', body),
      kind: 'appPreview',
      sha256: createHash('sha256').update(body).digest('hex'),
      size: body.byteLength,
    });
    expect(asset.key).toMatch(
      new RegExp(
        `^desktop-build-assets/${PROFILE_ID}/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.png$`,
      ),
    );
    expect(privateUploads).toEqual([
      {
        body,
        contentType: 'image/png',
        key: finalAssetKey(PROFILE_ID, 'appPreview', body),
      },
    ]);
    expect(deletedKeys).toEqual([stagingKey]);
  });

  it('keeps the finalized object stable when a staging key is overwritten later', async () => {
    const stagingKey = `desktop-build-assets/${PROFILE_ID}/${ASSET_ID}.png`;
    const body = png(1024, 1024);
    const changedBody = png(1024, 1024, { idat: createDifferentValidPngIdat(1024, 1024) });
    const objects = new Map([[stagingKey, { body, contentType: 'image/png' }]]);
    const { storage } = createAssetStorage(objects);

    const finalized = await completeDesktopBuildAsset({
      key: stagingKey,
      kind: 'appPreview',
      profileId: PROFILE_ID,
      storage,
    });
    objects.set(stagingKey, { body: changedBody, contentType: 'image/png' });

    await expect(
      readTrustedDesktopBuildAsset({
        key: finalized.key,
        kind: 'appPreview',
        profileId: PROFILE_ID,
        storage,
      }),
    ).resolves.toMatchObject({
      key: finalAssetKey(PROFILE_ID, 'appPreview', body),
      sha256: createHash('sha256').update(body).digest('hex'),
    });
  });

  it('content-addresses repeated completions through the precondition-failure path', async () => {
    const firstStagingKey = `desktop-build-assets/${PROFILE_ID}/${ASSET_ID}.png`;
    const secondStagingKey = `desktop-build-assets/${PROFILE_ID}/${HEADER_ID}.png`;
    const body = png(1024, 1024);
    const objects = new Map([
      [firstStagingKey, { body, contentType: 'image/png' }],
      [secondStagingKey, { body, contentType: 'image/png' }],
    ]);
    const { privateUploadAttempts, privateUploads, storage } = createAssetStorage(objects);

    const first = await completeDesktopBuildAsset({
      key: firstStagingKey,
      kind: 'appPreview',
      profileId: PROFILE_ID,
      storage,
    });
    const second = await completeDesktopBuildAsset({
      key: secondStagingKey,
      kind: 'appPreview',
      profileId: PROFILE_ID,
      storage,
    });

    const finalKey = finalAssetKey(PROFILE_ID, 'appPreview', body);
    expect(first.key).toBe(finalKey);
    expect(second.key).toBe(finalKey);
    expect(privateUploadAttempts.map((upload) => upload.key)).toEqual([finalKey, finalKey]);
    expect(privateUploads.map((upload) => upload.key)).toEqual([finalKey]);
    expect(objects).toEqual(new Map([[finalKey, { body, contentType: 'image/png' }]]));
  });

  it('does not overwrite a conflicting final object after a precondition failure', async () => {
    const stagingKey = `desktop-build-assets/${PROFILE_ID}/${ASSET_ID}.png`;
    const body = png(1024, 1024);
    const conflictingBody = png(1024, 1024, {
      idat: createDifferentValidPngIdat(1024, 1024),
    });
    const finalKey = finalAssetKey(PROFILE_ID, 'appPreview', body);
    const objects = new Map([
      [stagingKey, { body, contentType: 'image/png' }],
      [finalKey, { body: conflictingBody, contentType: 'image/png' }],
    ]);
    const { deletedKeys, privateUploads, storage } = createAssetStorage(objects);

    await expect(
      completeDesktopBuildAsset({
        key: stagingKey,
        kind: 'appPreview',
        profileId: PROFILE_ID,
        storage,
      }),
    ).rejects.toThrow('Invalid desktop build asset');

    expect(privateUploads).toEqual([]);
    expect(objects.get(finalKey)).toEqual({ body: conflictingBody, contentType: 'image/png' });
    expect(deletedKeys).toEqual([]);
  });

  it('propagates non-precondition finalization failures', async () => {
    const stagingKey = `desktop-build-assets/${PROFILE_ID}/${ASSET_ID}.png`;
    const body = png(1024, 1024);
    const { deletedKeys, storage } = createAssetStorage(
      new Map([[stagingKey, { body, contentType: 'image/png' }]]),
    );
    const uploadFailure = new Error('S3 unavailable');

    await expect(
      completeDesktopBuildAsset({
        key: stagingKey,
        kind: 'appPreview',
        profileId: PROFILE_ID,
        storage: {
          ...storage,
          uploadPrivateBufferIfAbsent: async () => {
            throw uploadFailure;
          },
        },
      }),
    ).rejects.toThrow(uploadFailure);

    expect(deletedKeys).toEqual([]);
  });

  it('reads trusted metadata and bytes instead of client-provided values', async () => {
    const body = png(1024, 1024);
    const key = finalAssetKey(PROFILE_ID, 'appPreview', body);
    const storage = {
      getFileByteArray: async () => body,
      getFileMetadata: async () => ({ contentLength: body.byteLength, contentType: 'image/png' }),
    };

    await expect(
      readTrustedDesktopBuildAsset({
        key,
        kind: 'appPreview',
        profileId: PROFILE_ID,
        storage,
      }),
    ).resolves.toMatchObject({
      contentType: 'image/png',
      height: 1024,
      kind: 'appPreview',
      size: body.byteLength,
      width: 1024,
    });
  });

  it.each([
    [
      'metadata MIME mismatch',
      { contentLength: png(1024, 1024).byteLength, contentType: 'image/bmp' },
    ],
    ['metadata/body size mismatch', { contentLength: 1, contentType: 'image/png' }],
  ])('rejects a %s before trusting an uploaded asset', async (_name, metadata) => {
    const body = png(1024, 1024);
    await expect(
      readTrustedDesktopBuildAsset({
        key: finalAssetKey(PROFILE_ID, 'appPreview', body),
        kind: 'appPreview',
        profileId: PROFILE_ID,
        storage: {
          getFileByteArray: async () => body,
          getFileMetadata: async () => metadata,
        },
      }),
    ).rejects.toThrow('Invalid desktop build asset');
  });

  it('rejects a cross-profile or traversal asset key before reading storage', async () => {
    const getFileMetadata = async () => ({ contentLength: 1, contentType: 'image/png' });

    await expect(
      readTrustedDesktopBuildAsset({
        key: `desktop-build-assets/${PROFILE_ID}/../${ASSET_ID}.png`,
        kind: 'appPreview',
        profileId: PROFILE_ID,
        storage: { getFileByteArray: async () => png(1024, 1024), getFileMetadata },
      }),
    ).rejects.toThrow('Invalid desktop build asset');
  });

  it('requires the generated key prefix and extension casing exactly', async () => {
    await expect(
      readTrustedDesktopBuildAsset({
        key: `DESKTOP-BUILD-ASSETS/${PROFILE_ID}/${ASSET_ID}.PNG`,
        kind: 'appPreview',
        profileId: PROFILE_ID,
        storage: {
          getFileByteArray: async () => png(1024, 1024),
          getFileMetadata: async () => ({
            contentLength: png(1024, 1024).byteLength,
            contentType: 'image/png',
          }),
        },
      }),
    ).rejects.toThrow('Invalid desktop build asset');
  });

  it('revalidates every draft-manifest entry and replaces browser metadata', async () => {
    const bodies = {
      appPreview: png(1024, 1024),
      nsisHeader: bmp(150, 57),
      nsisSidebar: bmp(164, 314),
      windowsIcon: ico(),
    };
    const input = {
      appPreview: {
        ...manifest().appPreview,
        key: finalAssetKey(PROFILE_ID, 'appPreview', bodies.appPreview),
      },
      nsisHeader: {
        ...manifest().nsisHeader,
        key: finalAssetKey(PROFILE_ID, 'nsisHeader', bodies.nsisHeader),
      },
      nsisSidebar: {
        ...manifest().nsisSidebar,
        key: finalAssetKey(PROFILE_ID, 'nsisSidebar', bodies.nsisSidebar),
      },
      windowsIcon: {
        ...manifest().windowsIcon,
        key: finalAssetKey(PROFILE_ID, 'windowsIcon', bodies.windowsIcon),
      },
    };
    const { storage } = createAssetStorage(
      new Map([
        [input.appPreview.key, { body: bodies.appPreview, contentType: 'image/png' }],
        [input.nsisHeader.key, { body: bodies.nsisHeader, contentType: 'image/bmp' }],
        [input.nsisSidebar.key, { body: bodies.nsisSidebar, contentType: 'image/bmp' }],
        [input.windowsIcon.key, { body: bodies.windowsIcon, contentType: 'image/x-icon' }],
      ]),
    );
    const trustedManifest = await validateDesktopBuildAssetManifest({
      manifest: input,
      profileId: PROFILE_ID,
      storage,
    });

    expect(trustedManifest).toMatchObject({
      appPreview: { contentType: 'image/png', height: 1024, width: 1024 },
      nsisHeader: { contentType: 'image/bmp', height: 57, width: 150 },
      nsisSidebar: { contentType: 'image/bmp', height: 314, width: 164 },
      windowsIcon: { contentType: 'image/x-icon' },
    });
    expect(trustedManifest.appPreview.sha256).not.toBe('untrusted');
    expect(trustedManifest.appPreview.size).toBe(bodies.appPreview.byteLength);
  });

  it('rejects a staging key in a draft manifest before reading storage', async () => {
    let reads = 0;

    await expect(
      validateDesktopBuildAssetManifest({
        manifest: manifest(),
        profileId: PROFILE_ID,
        storage: {
          getFileByteArray: async () => {
            reads += 1;
            return png(1024, 1024);
          },
          getFileMetadata: async () => {
            reads += 1;
            return { contentLength: 1, contentType: 'image/png' };
          },
        },
      }),
    ).rejects.toThrow('Invalid desktop build asset');
    expect(reads).toBe(0);
  });
});
