const path = require('path');
const sharp = require('sharp');

const sourcePath = path.resolve(__dirname, '..', 'media', 'store_icon.png');
const outputPath = path.resolve(__dirname, '..', 'media', 'store_icon_128.png');

async function main() {
  await sharp(sourcePath)
    .resize(128, 128, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false,
    })
    .png()
    .toFile(outputPath);

  console.log(`Generated ${path.relative(process.cwd(), outputPath)} from ${path.relative(process.cwd(), sourcePath)}`);
}

main().catch((error) => {
  console.error('Failed to generate Marketplace icon.');
  console.error(error);
  process.exit(1);
});