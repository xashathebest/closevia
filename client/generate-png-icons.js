const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const baseDir = path.join(__dirname, 'public')
const iconsDir = path.join(baseDir, 'icons')
const sourceLogoPath = path.join(iconsDir, 'CloviaLogo.svg')

async function generateIcons() {
  try {
    if (!fs.existsSync(sourceLogoPath)) {
      throw new Error(`CloviaLogo.svg not found at ${sourceLogoPath}`)
    }

    await sharp(sourceLogoPath)
      .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toFile(path.join(iconsDir, 'icon-192.png'))
    console.log('Created icons/icon-192.png')

    await sharp(sourceLogoPath)
      .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toFile(path.join(iconsDir, 'icon-512.png'))
    console.log('Created icons/icon-512.png')
  } catch (error) {
    console.error('Error generating icons:', error.message)
    process.exit(1)
  }
}

generateIcons()
