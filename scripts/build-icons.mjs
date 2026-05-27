import fs from 'node:fs/promises'
import path from 'node:path'

import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const buildDir = path.resolve(import.meta.dirname, '..', 'build')
const sourceIconPath = path.resolve(import.meta.dirname, '..', 'public', 'favicon.svg')
const outputPngPath = path.join(buildDir, 'icon.png')
const outputIconPath = path.join(buildDir, 'icon.ico')
const tempDir = path.join(buildDir, '.icon-build')
const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

await fs.mkdir(buildDir, { recursive: true })
await fs.mkdir(tempDir, { recursive: true })

try {
  const basePngBuffer = await sharp(sourceIconPath, { density: 512 })
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  await fs.writeFile(outputPngPath, basePngBuffer)

  const pngBuffers = await Promise.all(
    sizes.map(async (size) => {
      const buffer = await sharp(basePngBuffer)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer()

      const tempPath = path.join(tempDir, `icon-${size}.png`)
      await fs.writeFile(tempPath, buffer)
      return buffer
    }),
  )

  const icoBuffer = await pngToIco(pngBuffers)
  await fs.writeFile(outputIconPath, icoBuffer)
} finally {
  await fs.rm(tempDir, { recursive: true, force: true })
}