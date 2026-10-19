import { createHash, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';

import type {
  DesktopBuildAsset,
  DesktopBuildAssetKind,
  DesktopBuildAssetManifest,
} from '@lobechat/types';

import type { FileS3 } from '@/server/modules/S3';

export const DESKTOP_BUILD_ASSET_PREFIX = 'desktop-build-assets';

const ASSET_SPECS: Record<
  DesktopBuildAssetKind,
  { contentType: string; extension: 'bmp' | 'ico' | 'png' }
> = {
  appPreview: { contentType: 'image/png', extension: 'png' },
  nsisHeader: { contentType: 'image/bmp', extension: 'bmp' },
  nsisSidebar: { contentType: 'image/bmp', extension: 'bmp' },
  windowsIcon: { contentType: 'image/x-icon', extension: 'ico' },
};

const MAX_ASSET_BYTES: Record<DesktopBuildAssetKind, number> = {
  appPreview: 4 * 1024 * 1024,
  nsisHeader: 1 * 1024 * 1024,
  nsisSidebar: 1 * 1024 * 1024,
  windowsIcon: 2 * 1024 * 1024,
};

const assetError = () => new Error('Invalid desktop build asset');

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const PNG_BIT_DEPTHS: Record<number, ReadonlySet<number>> = {
  0: new Set([1, 2, 4, 8, 16]),
  2: new Set([8, 16]),
  3: new Set([1, 2, 4, 8]),
  4: new Set([8, 16]),
  6: new Set([8, 16]),
};

const PNG_COLOR_TYPE_CHANNELS: Record<number, number> = {
  0: 1,
  2: 3,
  3: 1,
  4: 2,
  6: 4,
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const PNG_ADAM7_PASSES = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

const PNG_CRC_INITIAL = 4_294_967_295;
const PNG_CRC_POLYNOMIAL = 3_988_292_384;

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ (PNG_CRC_POLYNOMIAL & -(value & 1));
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const normalizedContentType = (value: string | undefined) =>
  value?.split(';')[0]?.trim().toLowerCase();

const isUuid = (value: string) => new RegExp(`^${UUID_PATTERN}$`, 'i').test(value);

const isUuidVersion = (value: string, version: 4 | 5) =>
  new RegExp(
    `^[0-9a-f]{8}-[0-9a-f]{4}-${version}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
    'i',
  ).test(value);

const readUint16Le = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! | (bytes[offset + 1]! << 8);

const readUint32Be = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset]! << 24) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!) >>>
  0;

const readUint32Le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)) >>>
  0;

const readInt32Le = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! |
  (bytes[offset + 1]! << 8) |
  (bytes[offset + 2]! << 16) |
  (bytes[offset + 3]! << 24);

const readPngCrc32 = (bytes: Uint8Array, start: number, end: number) => {
  let crc = PNG_CRC_INITIAL;
  for (let index = start; index < end; index++) {
    crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ bytes[index]!) & 255]!;
  }
  return (crc ^ PNG_CRC_INITIAL) >>> 0;
};

const assertExpectedDimensions = (
  kind: 'appPreview' | 'nsisHeader' | 'nsisSidebar',
  width: number,
  height: number,
) => {
  const expected =
    kind === 'appPreview' ? [1024, 1024] : kind === 'nsisHeader' ? [150, 57] : [164, 314];
  if (width !== expected[0] || height !== expected[1]) throw assetError();
};

type PngHeader = {
  bitDepth: number;
  colorType: number;
  height: number;
  interlaceMethod: number;
  width: number;
};

const getPngScanlineLengths = (header: PngHeader) => {
  const bitsPerPixel = PNG_COLOR_TYPE_CHANNELS[header.colorType]! * header.bitDepth;
  const rowLength = (width: number) => 1 + Math.ceil((width * bitsPerPixel) / 8);

  if (header.interlaceMethod === 0) {
    return Array.from({ length: header.height }, () => rowLength(header.width));
  }

  return PNG_ADAM7_PASSES.flatMap(([startX, startY, stepX, stepY]) => {
    const width = header.width <= startX ? 0 : Math.ceil((header.width - startX) / stepX);
    const height = header.height <= startY ? 0 : Math.ceil((header.height - startY) / stepY);
    return Array.from({ length: height }, () => rowLength(width));
  });
};

const validatePngImageData = (header: PngHeader, chunks: Uint8Array[]) => {
  const scanlineLengths = getPngScanlineLengths(header);
  const expectedLength = scanlineLengths.reduce((total, length) => total + length, 0);
  let imageData: Uint8Array;

  try {
    imageData = inflateSync(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), {
      maxOutputLength: expectedLength,
    });
  } catch {
    throw assetError();
  }

  if (imageData.byteLength !== expectedLength) throw assetError();

  let offset = 0;
  for (const length of scanlineLengths) {
    if (imageData[offset]! > 4) throw assetError();
    offset += length;
  }
};

const hasPngSignature = (bytes: Uint8Array) =>
  bytes.byteLength >= PNG_SIGNATURE.length &&
  PNG_SIGNATURE.every((value, index) => bytes[index] === value);

const inspectPng = (bytes: Uint8Array, expectedDimensions?: { height: number; width: number }) => {
  if (!hasPngSignature(bytes)) {
    throw assetError();
  }

  let offset = PNG_SIGNATURE.length;
  let header: PngHeader | undefined;
  let dimensions: { height: number; width: number } | undefined;
  let foundIdat = false;
  let foundPlte = false;
  let foundTrns = false;
  let idatEnded = false;
  let paletteEntries = 0;
  const idatChunks: Uint8Array[] = [];
  let seenIdat = false;

  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw assetError();
    const length = readUint32Be(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    const nextOffset = dataEnd + 4;
    if (nextOffset > bytes.byteLength) throw assetError();
    if (readPngCrc32(bytes, offset + 4, dataEnd) !== readUint32Be(bytes, dataEnd)) {
      throw assetError();
    }

    if (!dimensions) {
      if (type !== 'IHDR' || length !== 13) throw assetError();
      const width = readUint32Be(bytes, dataOffset);
      const height = readUint32Be(bytes, dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8]!;
      const colorType = bytes[dataOffset + 9]!;
      const compressionMethod = bytes[dataOffset + 10]!;
      const filterMethod = bytes[dataOffset + 11]!;
      const interlaceMethod = bytes[dataOffset + 12]!;
      if (
        width === 0 ||
        height === 0 ||
        !PNG_BIT_DEPTHS[colorType]?.has(bitDepth) ||
        compressionMethod !== 0 ||
        filterMethod !== 0 ||
        (interlaceMethod !== 0 && interlaceMethod !== 1)
      ) {
        throw assetError();
      }
      if (
        expectedDimensions &&
        (width !== expectedDimensions.width || height !== expectedDimensions.height)
      ) {
        throw assetError();
      }
      header = { bitDepth, colorType, height, interlaceMethod, width };
      dimensions = { height, width };
    } else if (type === 'IHDR') {
      throw assetError();
    } else if (type === 'IDAT') {
      if (idatEnded) throw assetError();
      seenIdat = true;
      foundIdat ||= length > 0;
      idatChunks.push(bytes.subarray(dataOffset, dataEnd));
    } else {
      if (seenIdat) idatEnded = true;

      if (type === 'PLTE') {
        if (
          foundPlte ||
          seenIdat ||
          header!.colorType === 0 ||
          header!.colorType === 4 ||
          length === 0 ||
          length % 3 !== 0 ||
          length > 768 ||
          (header!.colorType === 3 && length / 3 > 2 ** header!.bitDepth)
        ) {
          throw assetError();
        }
        foundPlte = true;
        paletteEntries = length / 3;
      } else if (type === 'tRNS') {
        if (foundTrns || seenIdat || header!.colorType === 4 || header!.colorType === 6) {
          throw assetError();
        }

        if (
          (header!.colorType === 0 && length !== 2) ||
          (header!.colorType === 2 && length !== 6) ||
          (header!.colorType === 3 && (!foundPlte || length > paletteEntries))
        ) {
          throw assetError();
        }

        foundTrns = true;
      } else if (type === 'IEND') {
        if (
          length !== 0 ||
          !foundIdat ||
          (header!.colorType === 3 && !foundPlte) ||
          nextOffset !== bytes.byteLength
        ) {
          throw assetError();
        }
        validatePngImageData(header!, idatChunks);
        return { contentType: 'image/png', ...dimensions };
      } else if ((bytes[offset + 4]! & 32) === 0) {
        // PNG decoders must reject unknown critical chunks.
        throw assetError();
      }
    }

    offset = nextOffset;
  }

  throw assetError();
};

const inspectIcoDib = (bytes: Uint8Array) => {
  const dibHeaderSize = 40;
  if (bytes.byteLength < dibHeaderSize || readUint32Le(bytes, 0) !== dibHeaderSize) {
    throw assetError();
  }

  const width = readInt32Le(bytes, 4);
  const storedHeight = readInt32Le(bytes, 8);
  const planes = readUint16Le(bytes, 12);
  const bitsPerPixel = readUint16Le(bytes, 14);
  const compression = readUint32Le(bytes, 16);
  const imageSize = readUint32Le(bytes, 20);
  const colorsUsed = readUint32Le(bytes, 32);
  if (
    width <= 0 ||
    storedHeight <= 0 ||
    storedHeight % 2 !== 0 ||
    planes !== 1 ||
    compression !== 0 ||
    ![1, 4, 8, 24, 32].includes(bitsPerPixel)
  ) {
    throw assetError();
  }

  const height = storedHeight / 2;
  const maxPaletteEntries = bitsPerPixel <= 8 ? 2 ** bitsPerPixel : 0;
  if ((bitsPerPixel <= 8 && colorsUsed > maxPaletteEntries) || (bitsPerPixel > 8 && colorsUsed)) {
    throw assetError();
  }
  const paletteEntries = bitsPerPixel <= 8 ? colorsUsed || maxPaletteEntries : 0;
  const paletteEnd = dibHeaderSize + paletteEntries * 4;
  const xorRowBytes = Math.ceil((width * bitsPerPixel) / 32) * 4;
  const xorBytes = xorRowBytes * height;
  const andRowBytes = Math.ceil(width / 32) * 4;
  const andBytes = andRowBytes * height;
  const pixelEnd = paletteEnd + xorBytes + andBytes;
  if (
    !Number.isSafeInteger(pixelEnd) ||
    paletteEnd > bytes.byteLength ||
    xorBytes === 0 ||
    andBytes === 0 ||
    (imageSize !== 0 && imageSize !== xorBytes) ||
    pixelEnd !== bytes.byteLength
  ) {
    throw assetError();
  }

  return { height, width };
};

const inspectIco = (bytes: Uint8Array) => {
  if (bytes.byteLength < 6 || readUint16Le(bytes, 0) !== 0 || readUint16Le(bytes, 2) !== 1) {
    throw assetError();
  }

  const count = readUint16Le(bytes, 4);
  const directoryEnd = 6 + count * 16;
  if (count === 0 || directoryEnd > bytes.byteLength) throw assetError();

  const entries: Array<{ dataEnd: number; dataOffset: number; height: number; width: number }> = [];
  for (let index = 0; index < count; index++) {
    const offset = 6 + index * 16;
    if (bytes[offset + 3] !== 0) throw assetError();
    const width = bytes[offset] === 0 ? 256 : bytes[offset]!;
    const height = bytes[offset + 1] === 0 ? 256 : bytes[offset + 1]!;
    const dataLength = readUint32Le(bytes, offset + 8);
    const dataOffset = readUint32Le(bytes, offset + 12);
    const dataEnd = dataOffset + dataLength;
    if (dataLength === 0 || dataOffset < directoryEnd || dataEnd > bytes.byteLength) {
      throw assetError();
    }
    entries.push({ dataEnd, dataOffset, height, width });
  }

  entries.sort((left, right) => left.dataOffset - right.dataOffset);
  for (let index = 1; index < entries.length; index++) {
    if (entries[index - 1]!.dataEnd > entries[index]!.dataOffset) throw assetError();
  }

  const sizes = new Set<number>();
  for (const entry of entries) {
    const payload = bytes.subarray(entry.dataOffset, entry.dataEnd);
    const decoded = hasPngSignature(payload)
      ? inspectPng(payload, { height: entry.height, width: entry.width })
      : inspectIcoDib(payload);
    if (decoded.width !== entry.width || decoded.height !== entry.height) throw assetError();
    if (decoded.width === decoded.height) sizes.add(decoded.width);
  }

  if (![16, 32, 48, 256].every((size) => sizes.has(size))) throw assetError();
  return { contentType: 'image/x-icon' };
};

const inspectBmp = (kind: 'nsisHeader' | 'nsisSidebar', bytes: Uint8Array) => {
  if (bytes.byteLength < 54 || bytes[0] !== 66 || bytes[1] !== 77) throw assetError();

  const fileSize = readUint32Le(bytes, 2);
  const pixelOffset = readUint32Le(bytes, 10);
  const dibSize = readUint32Le(bytes, 14);
  if (fileSize !== bytes.byteLength || dibSize < 40 || 14 + dibSize > bytes.byteLength) {
    throw assetError();
  }

  const width = readInt32Le(bytes, 18);
  const height = readInt32Le(bytes, 22);
  const planes = readUint16Le(bytes, 26);
  const bitsPerPixel = readUint16Le(bytes, 28);
  const compression = readUint32Le(bytes, 30);
  const absoluteHeight = Math.abs(height);
  if (
    width <= 0 ||
    absoluteHeight === 0 ||
    planes !== 1 ||
    bitsPerPixel === 0 ||
    compression !== 0 ||
    pixelOffset < 14 + dibSize
  )
    throw assetError();

  const requiredPixels = Math.ceil((width * bitsPerPixel) / 32) * 4 * absoluteHeight;
  if (requiredPixels === 0 || pixelOffset + requiredPixels > bytes.byteLength) throw assetError();

  assertExpectedDimensions(kind, width, absoluteHeight);
  return { contentType: 'image/bmp', height: absoluteHeight, width };
};

export type DesktopBuildAssetInspection = Omit<DesktopBuildAsset, 'key'>;

export type DesktopBuildAssetStorage = {
  createPrivatePreSignedUpload: FileS3['createPrivatePreSignedUpload'];
  deleteFile: (key: string) => Promise<unknown>;
  getFileByteArray: FileS3['getFileByteArray'];
  getFileMetadata: FileS3['getFileMetadata'];
  uploadPrivateBufferIfAbsent: (
    key: string,
    buffer: Buffer,
    contentType: string,
  ) => Promise<unknown>;
};

export const getDesktopBuildAssetKey = (
  profileId: string,
  kind: DesktopBuildAssetKind,
  assetId: string,
) => `${DESKTOP_BUILD_ASSET_PREFIX}/${profileId}/${assetId}.${ASSET_SPECS[kind].extension}`;

export const isValidDesktopBuildAssetKey = (
  profileId: string,
  kind: DesktopBuildAssetKind,
  key: string,
) => {
  if (!isUuid(profileId)) return false;

  const prefix = `${DESKTOP_BUILD_ASSET_PREFIX}/${profileId}/`;
  const extension = `.${ASSET_SPECS[kind].extension}`;
  if (!key.startsWith(prefix) || !key.endsWith(extension)) return false;

  return isUuid(key.slice(prefix.length, -extension.length));
};

const isDesktopBuildAssetKeyVersion = (
  profileId: string,
  kind: DesktopBuildAssetKind,
  key: string,
  version: 4 | 5,
) => {
  if (!isValidDesktopBuildAssetKey(profileId, kind, key)) return false;

  const prefix = `${DESKTOP_BUILD_ASSET_PREFIX}/${profileId}/`;
  const extension = `.${ASSET_SPECS[kind].extension}`;
  return isUuidVersion(key.slice(prefix.length, -extension.length), version);
};

const getFinalDesktopBuildAssetKey = (
  profileId: string,
  kind: DesktopBuildAssetKind,
  sha256: string,
) => {
  const assetIdBytes = Buffer.from(sha256.slice(0, 32), 'hex');
  assetIdBytes[6] = (assetIdBytes[6]! & 15) | 80;
  assetIdBytes[8] = (assetIdBytes[8]! & 63) | 128;
  const assetId = assetIdBytes.toString('hex');
  const formattedAssetId = `${assetId.slice(0, 8)}-${assetId.slice(8, 12)}-${assetId.slice(12, 16)}-${assetId.slice(16, 20)}-${assetId.slice(20)}`;

  return getDesktopBuildAssetKey(profileId, kind, formattedAssetId);
};

export const inspectDesktopBuildAsset = (
  kind: DesktopBuildAssetKind,
  bytes: Uint8Array,
): DesktopBuildAssetInspection => {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES[kind]) throw assetError();

  const inspection =
    kind === 'appPreview'
      ? inspectPng(bytes, { height: 1024, width: 1024 })
      : kind === 'windowsIcon'
        ? inspectIco(bytes)
        : inspectBmp(kind, bytes);

  return {
    ...inspection,
    kind,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
  };
};

export const createDesktopBuildAssetUpload = async ({
  input,
  randomId = randomUUID,
  storage,
}: {
  input: { kind: DesktopBuildAssetKind; profileId?: string };
  randomId?: () => string;
  storage: Pick<DesktopBuildAssetStorage, 'createPrivatePreSignedUpload'>;
}) => {
  const profileId = input.profileId ?? randomId();
  const assetId = randomId();
  if (!isUuid(profileId) || !isUuidVersion(assetId, 4)) throw assetError();

  const key = getDesktopBuildAssetKey(profileId, input.kind, assetId);
  const upload = await storage.createPrivatePreSignedUpload(key);

  return {
    headers: { ...upload.headers, 'Content-Type': ASSET_SPECS[input.kind].contentType },
    key,
    kind: input.kind,
    profileId,
    uploadUrl: upload.url,
  };
};

const readDesktopBuildAsset = async ({
  expectedKeyVersion,
  key,
  kind,
  profileId,
  storage,
}: {
  expectedKeyVersion: 4 | 5;
  key: string;
  kind: DesktopBuildAssetKind;
  profileId: string;
  storage: Pick<DesktopBuildAssetStorage, 'getFileByteArray' | 'getFileMetadata'>;
}): Promise<{ asset: DesktopBuildAsset; bytes: Uint8Array }> => {
  if (!isDesktopBuildAssetKeyVersion(profileId, kind, key, expectedKeyVersion)) throw assetError();

  const metadata = await storage.getFileMetadata(key);
  const spec = ASSET_SPECS[kind];
  if (
    metadata.contentLength <= 0 ||
    metadata.contentLength > MAX_ASSET_BYTES[kind] ||
    normalizedContentType(metadata.contentType) !== spec.contentType
  ) {
    throw assetError();
  }

  const bytes = await storage.getFileByteArray(key);
  if (bytes.byteLength !== metadata.contentLength) throw assetError();

  const inspection = inspectDesktopBuildAsset(kind, bytes);
  if (inspection.contentType !== spec.contentType) throw assetError();
  if (
    expectedKeyVersion === 5 &&
    key !== getFinalDesktopBuildAssetKey(profileId, kind, inspection.sha256)
  ) {
    throw assetError();
  }

  return { asset: { ...inspection, key }, bytes };
};

export const readTrustedDesktopBuildAsset = async ({
  key,
  kind,
  profileId,
  storage,
}: {
  key: string;
  kind: DesktopBuildAssetKind;
  profileId: string;
  storage: Pick<DesktopBuildAssetStorage, 'getFileByteArray' | 'getFileMetadata'>;
}): Promise<DesktopBuildAsset> => {
  const { asset } = await readDesktopBuildAsset({
    expectedKeyVersion: 5,
    key,
    kind,
    profileId,
    storage,
  });
  return asset;
};

const isPreconditionFailed = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return false;

  const s3Error = error as {
    $metadata?: { httpStatusCode?: number };
    code?: string;
    name?: string;
  };
  return (
    s3Error.name === 'PreconditionFailed' ||
    s3Error.code === 'PreconditionFailed' ||
    s3Error.$metadata?.httpStatusCode === 412
  );
};

export const completeDesktopBuildAsset = async ({
  key,
  kind,
  profileId,
  storage,
}: {
  key: string;
  kind: DesktopBuildAssetKind;
  profileId: string;
  storage: Pick<
    DesktopBuildAssetStorage,
    'deleteFile' | 'getFileByteArray' | 'getFileMetadata' | 'uploadPrivateBufferIfAbsent'
  >;
}): Promise<DesktopBuildAsset> => {
  const staging = await readDesktopBuildAsset({
    expectedKeyVersion: 4,
    key,
    kind,
    profileId,
    storage,
  });
  const finalKey = getFinalDesktopBuildAssetKey(profileId, kind, staging.asset.sha256);

  try {
    await storage.uploadPrivateBufferIfAbsent(
      finalKey,
      Buffer.from(staging.bytes),
      staging.asset.contentType,
    );
  } catch (error) {
    if (!isPreconditionFailed(error)) throw error;
  }
  const finalAsset = await readTrustedDesktopBuildAsset({
    key: finalKey,
    kind,
    profileId,
    storage,
  });

  try {
    await storage.deleteFile(key);
  } catch {
    // Staging objects are untrusted and can be safely reclaimed later.
  }

  return finalAsset;
};

export const validateDesktopBuildAssetManifest = async ({
  manifest,
  profileId,
  storage,
}: {
  manifest: DesktopBuildAssetManifest;
  profileId: string;
  storage: Pick<DesktopBuildAssetStorage, 'getFileByteArray' | 'getFileMetadata'>;
}): Promise<DesktopBuildAssetManifest> => {
  const kinds: DesktopBuildAssetKind[] = ['appPreview', 'windowsIcon', 'nsisHeader', 'nsisSidebar'];
  const assets = await Promise.all(
    kinds.map(async (kind) => {
      const asset = manifest[kind];
      if (!asset || asset.kind !== kind) throw assetError();
      return [
        kind,
        await readTrustedDesktopBuildAsset({ key: asset.key, kind, profileId, storage }),
      ] as const;
    }),
  );

  return Object.fromEntries(assets) as DesktopBuildAssetManifest;
};
