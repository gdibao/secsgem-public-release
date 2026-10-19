const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const MAX_ZIP_COMMENT_BYTES = 65_535;
const ZIP64_UINT16_SENTINEL = 0xffff;
const ZIP64_UINT32_SENTINEL = 0xffffffff;
const UNIX_CREATOR_PLATFORM = 3;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_DIRECTORY = 0x4000;
const UNIX_REGULAR_FILE = 0x8000;
const UNIX_SYMBOLIC_LINK = 0xa000;
const DOS_DIRECTORY_ATTRIBUTE = 0x10;

export type ModuleAppZipEntryType = 'directory' | 'other' | 'regular' | 'symlink';

export type ModuleAppZipEntry = {
  isEncrypted: boolean;
  isSymbolicLink: boolean;
  name: string;
  type: ModuleAppZipEntryType;
  unixMode?: number;
};

export class ModuleAppZipMetadataError extends Error {
  readonly code = 'module_app_package_archive_metadata_invalid';

  constructor(message: string) {
    super(message);
    this.name = 'ModuleAppZipMetadataError';
  }
}

const fail = (message: string): never => {
  throw new ModuleAppZipMetadataError(message);
};

const findEocdOffset = (view: DataView) => {
  const minimum = Math.max(0, view.byteLength - EOCD_MIN_SIZE - MAX_ZIP_COMMENT_BYTES);

  for (let offset = view.byteLength - EOCD_MIN_SIZE; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }

  return fail('ZIP end-of-central-directory record is missing.');
};

const classifyEntry = (input: {
  externalAttributes: number;
  name: string;
  unixMode?: number;
}): ModuleAppZipEntryType => {
  const directoryAttribute =
    input.name.endsWith('/') || (input.externalAttributes & DOS_DIRECTORY_ATTRIBUTE) !== 0;

  if (input.unixMode === undefined) return directoryAttribute ? 'directory' : 'regular';

  const fileType = input.unixMode & UNIX_FILE_TYPE_MASK;
  if (fileType === UNIX_SYMBOLIC_LINK) return 'symlink';
  if (fileType === UNIX_DIRECTORY) return 'directory';
  if (fileType === UNIX_REGULAR_FILE) return 'regular';
  if (fileType !== 0) return 'other';

  return directoryAttribute ? 'directory' : 'regular';
};

export const inspectModuleAppZipEntries = (bytes: Uint8Array): ModuleAppZipEntry[] => {
  if (bytes.byteLength < EOCD_MIN_SIZE) return fail('ZIP archive is too small.');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocdOffset(view);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const commentLength = view.getUint16(eocdOffset + 20, true);

  if (eocdOffset + EOCD_MIN_SIZE + commentLength !== bytes.byteLength) {
    return fail('ZIP comment length does not match the archive size.');
  }
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
    return fail('Multi-disk ZIP archives are not supported.');
  }
  if (
    totalEntries === ZIP64_UINT16_SENTINEL ||
    centralDirectorySize === ZIP64_UINT32_SENTINEL ||
    centralDirectoryOffset === ZIP64_UINT32_SENTINEL
  ) {
    return fail('ZIP64 archives are not supported.');
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (centralDirectoryEnd !== eocdOffset || centralDirectoryEnd > bytes.byteLength) {
    return fail('ZIP central-directory bounds are invalid.');
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: ModuleAppZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > centralDirectoryEnd) return fail('ZIP central entry is truncated.');
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      return fail('ZIP central entry signature is invalid.');
    }

    const versionMadeBy = view.getUint16(offset + 4, true);
    const creatorPlatform = versionMadeBy >>> 8;
    const generalPurposeFlags = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const originalSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentBytes = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const entryEnd = offset + 46 + fileNameLength + extraLength + commentBytes;

    if (
      compressedSize === ZIP64_UINT32_SENTINEL ||
      originalSize === ZIP64_UINT32_SENTINEL ||
      localHeaderOffset === ZIP64_UINT32_SENTINEL ||
      diskStart === ZIP64_UINT16_SENTINEL
    ) {
      return fail('ZIP64 entry metadata is not supported.');
    }
    if (diskStart !== 0 || fileNameLength === 0 || entryEnd > centralDirectoryEnd) {
      return fail('ZIP central entry bounds are invalid.');
    }

    let name: string;
    try {
      name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + fileNameLength));
    } catch {
      return fail('ZIP entry names must be valid UTF-8.');
    }

    const unixMode =
      creatorPlatform === UNIX_CREATOR_PLATFORM ? externalAttributes >>> 16 : undefined;
    const type = classifyEntry({ externalAttributes, name, unixMode });
    entries.push({
      isEncrypted: (generalPurposeFlags & 1) === 1,
      isSymbolicLink: type === 'symlink',
      name,
      type,
      unixMode,
    });
    offset = entryEnd;
  }

  if (offset !== centralDirectoryEnd) return fail('ZIP central-directory size is inconsistent.');

  return entries;
};
