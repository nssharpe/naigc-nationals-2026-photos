import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const SOURCE_DIR = process.argv[2] ||
  'C:/Users/nssha/Steinsharpe Dropbox/Nate Sharpe/Documents/Misc/Gymnastics/NAIGC/Nationals 2026/Photographer/Additional Options';

const PHOTOS_DIR = path.join(repoRoot, 'docs', 'photos');
const THUMBS_DIR = path.join(repoRoot, 'docs', 'thumbs');
const MANIFEST_PATH = path.join(repoRoot, 'docs', 'manifest.json');

const THUMB_WIDTH = 400;
const THUMB_QUALITY = 78;

fs.mkdirSync(PHOTOS_DIR, { recursive: true });
fs.mkdirSync(THUMBS_DIR, { recursive: true });

const sourceFiles = fs.readdirSync(SOURCE_DIR)
  .filter(f => /\.jpe?g$/i.test(f))
  .sort();

console.log(`Found ${sourceFiles.length} source images.`);

const ids = [];

for (const filename of sourceFiles) {
  // extract 4-digit suffix: "2026_04_09_NAIGC Nationals_0002.jpg" → "0002"
  const match = filename.match(/_(\d{4})\.jpe?g$/i);
  if (!match) {
    console.warn(`  Skipping unrecognized filename: ${filename}`);
    continue;
  }
  const id = match[1];
  ids.push(id);

  const srcPath = path.join(SOURCE_DIR, filename);
  const destPhoto = path.join(PHOTOS_DIR, `${id}.jpg`);
  const destThumb = path.join(THUMBS_DIR, `${id}.jpg`);

  if (!fs.existsSync(destPhoto)) {
    fs.copyFileSync(srcPath, destPhoto);
    process.stdout.write(`  [photo] ${id}\n`);
  }

  if (!fs.existsSync(destThumb)) {
    await sharp(srcPath)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
      .toFile(destThumb);
    process.stdout.write(`  [thumb] ${id}\n`);
  }
}

ids.sort();
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(ids, null, 2));
console.log(`\nDone. ${ids.length} photos written to manifest.json.`);
