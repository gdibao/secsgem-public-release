import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { inspectModuleAppZipEntries, ModuleAppZipMetadataError } from './zipMetadata';

const CENTRAL_SIGNATURE = 0x02014B50;
const EOCD_SIGNATURE = 0x06054B50;

const findSignature = (bytes: Uint8Array, signature: number) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }

  throw new Error('signature_not_found');
};

const makeZip = () => zipSync({ 'manifest.json': strToU8('{"manifestVersion":1}') });

describe('inspectModuleAppZipEntries', () => {
  it('reads bounded central-directory metadata from a normal ZIP', () => {
    expect(inspectModuleAppZipEntries(makeZip())).toEqual([
      expect.objectContaining({ isSymbolicLink: false, name: 'manifest.json' }),
    ]);
  });

  it('detects Unix symbolic-link entries from external attributes', () => {
    const bytes = makeZip().slice();
    const offset = findSignature(bytes, CENTRAL_SIGNATURE);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(offset + 4, 0x0314, true);
    view.setUint32(offset + 38, 0xA1FF0000, true);

    expect(inspectModuleAppZipEntries(bytes)[0]).toMatchObject({
      isSymbolicLink: true,
      name: 'manifest.json',
      unixMode: 0xA1FF,
    });
  });

  it('rejects malformed and ZIP64 central-directory metadata', () => {
    expect(() => inspectModuleAppZipEntries(new Uint8Array([1, 2, 3]))).toThrowError(
      ModuleAppZipMetadataError,
    );

    const bytes = makeZip().slice();
    const offset = findSignature(bytes, EOCD_SIGNATURE);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(offset + 10, 0xFFFF, true);

    try {
      inspectModuleAppZipEntries(bytes);
      throw new Error('expected_zip64_rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'module_app_package_archive_metadata_invalid' });
    }
  });
});
