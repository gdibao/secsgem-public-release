#!/usr/bin/env node
/**
 * Generate the macOS tray template icon set (black + alpha).
 *
 * Template images must contain only black pixels and an alpha channel;
 * macOS then recolors them automatically based on the menu bar theme.
 *
 * Renders two files in apps/desktop/resources:
 *   - trayTemplate.png       (@1x, 18x18)
 *   - trayTemplate@2x.png    (@2x, 36x36)
 *
 * Run: bun run apps/desktop/scripts/generate-tray-template.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'resources');
const sourceIcon = path.resolve(__dirname, '..', 'branding', 'chituo', 'logo.png');

async function render(size, outFile) {
  const { data, info } = await sharp(sourceIcon)
    .resize(size, size, { fit: 'contain' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(info.width * info.height * 4);
  for (let index = 0; index < info.width * info.height; index++) {
    const value = Math.max(data[index * 3], data[index * 3 + 1], data[index * 3 + 2]);
    const alpha = Math.max(0, Math.min(255, Math.round((value - 48) * 2.2)));
    output[index * 4] = 0;
    output[index * 4 + 1] = 0;
    output[index * 4 + 2] = 0;
    output[index * 4 + 3] = alpha;
  }
  await sharp(output, { raw: { channels: 4, height: info.height, width: info.width } })
    .png()
    .toFile(outFile);
  console.log(`wrote ${path.relative(process.cwd(), outFile)} (${size}x${size})`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await render(18, path.join(outDir, 'trayTemplate.png'));
  await render(36, path.join(outDir, 'trayTemplate@2x.png'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
