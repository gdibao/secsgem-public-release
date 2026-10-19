import fs from 'node:fs/promises';
import path from 'node:path';

const roots = process.argv.slice(2);
if (roots.length === 0) throw new Error('PACKAGED_IDENTITY_ROOT_REQUIRED');

const asarFiles = [];

const collectAsarFiles = async (entry) => {
  const stat = await fs.stat(entry);
  if (stat.isFile()) {
    if (path.basename(entry).toLowerCase() === 'app.asar') asarFiles.push(entry);
    return;
  }

  for (const child of await fs.readdir(entry, { withFileTypes: true })) {
    await collectAsarFiles(path.join(entry, child.name));
  }
};

for (const root of roots) await collectAsarFiles(path.resolve(root));
if (asarFiles.length === 0) throw new Error('PACKAGED_APP_ASAR_NOT_FOUND');

const required = [
  'https://fab.secsgem.com.cn',
  'com.gdibao.chituoai',
  '驰拓 AI 助手',
  'chituoai',
  'lobehub-desktop',
];
const forbidden = [
  'https://chat.qingyouai.com',
  '<title>LobeHub</title>',
  '© 2026 LobeHub. All rights reserved.',
  'LobeHub can now send you notifications.',
];

for (const asarFile of asarFiles) {
  const content = await fs.readFile(asarFile);
  for (const marker of required) {
    if (!content.includes(Buffer.from(marker))) {
      throw new Error(`PACKAGED_IDENTITY_REQUIRED_MARKER_MISSING:${marker}:${asarFile}`);
    }
  }
  for (const marker of forbidden) {
    if (content.includes(Buffer.from(marker))) {
      throw new Error(`PACKAGED_IDENTITY_FORBIDDEN_MARKER_FOUND:${marker}:${asarFile}`);
    }
  }
  console.info(`Packaged identity verified: ${asarFile}`);
}
