import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const branding = path.join(root, 'apps/desktop/branding/chituo');
const publicDir = path.join(root, 'public');
const logo = path.join(branding, 'logo.png');
// Keep the supplied artwork and aspect ratio; only derive required icon sizes.
for (const size of [192, 512]) {
  for (const maskable of [false, true]) {
    const inner = maskable ? Math.floor(size * 0.7) : size;
    const padding = Math.floor((size - inner) / 2);
    await sharp(logo)
      .resize(inner, inner, { fit: 'contain', background: '#ffffff00' })
      .extend({
        top: padding,
        left: padding,
        bottom: size - inner - padding,
        right: size - inner - padding,
        background: '#ffffff00',
      })
      .png()
      .toFile(path.join(publicDir, `icons/icon-${size}x${size}${maskable ? '.maskable' : ''}.png`));
  }
}
await sharp(logo)
  .resize(180, 180, { fit: 'contain' })
  .png()
  .toFile(path.join(publicDir, 'apple-touch-icon.png'));
await fs.copyFile(logo, path.join(publicDir, 'avatars/lobe-ai.png'));
for (const file of await fs.readdir(publicDir)) {
  if (/^favicon(?:-[a-z0-9-]+)?\.ico$/.test(file)) {
    await fs.copyFile(path.join(branding, 'icon.ico'), path.join(publicDir, file));
  }
}
