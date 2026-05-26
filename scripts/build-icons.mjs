import fs from 'node:fs/promises'
import path from 'node:path'

import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const buildDir = path.resolve(import.meta.dirname, '..', 'build')
const sourceIconPath = path.join(buildDir, 'icon.png')
const outputIconPath = path.join(buildDir, 'icon.ico')
const tempDir = path.join(buildDir, '.icon-build')
const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

await fs.mkdir(tempDir, { recursive: true })

try {
  const pngBuffers = await Promise.all(
    sizes.map(async (size) => {
      const buffer = await sharp(sourceIconPath)
        .resize(size, size, { fit: 'contain' })
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