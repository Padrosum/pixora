export type OutputFormat = 'original' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif'
export type Rotation = 0 | 90 | 180 | 270
export type CropRect = { x: number; y: number; width: number; height: number }
export type Adjustments = {
  brightness: number
  contrast: number
  saturation: number
  exposure: number
  blur: number
  sharpen: number
}
export type BackgroundRemoval = { enabled: boolean; mode: 'local' | 'ml'; threshold: number; softness: number }

export type ImageSettings = {
  width: number
  height: number
  maintainAspectRatio: boolean
  quality: number
  outputFormat: OutputFormat
  crop: CropRect
  rotation: Rotation
  flipX: boolean
  flipY: boolean
  adjustments: Adjustments
  backgroundRemoval: BackgroundRemoval
}

const QUALITY_FORMATS = new Set<Exclude<OutputFormat, 'original' | 'image/png'>>([
  'image/jpeg',
  'image/webp',
  'image/avif',
])

export function getOutputMimeType(outputFormat: OutputFormat, sourceType: string): string {
  return outputFormat === 'original' ? sourceType : outputFormat
}

export function supportsQuality(outputFormat: OutputFormat): boolean {
  return QUALITY_FORMATS.has(outputFormat as Exclude<OutputFormat, 'original' | 'image/png'>)
}

export function getSavingsPercent(originalSize: number, outputSize: number): number {
  if (originalSize <= 0) return 0
  return Math.max(0, Math.round((1 - outputSize / originalSize) * 1000) / 10)
}

export function getOutputDimensions(settings: Pick<ImageSettings, 'width' | 'height' | 'rotation'>): { width: number; height: number } {
  return settings.rotation === 90 || settings.rotation === 270
    ? { width: settings.height, height: settings.width }
    : { width: settings.width, height: settings.height }
}

function loadSource(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The image could not be decoded for processing.'))
    image.src = url
  })
}

export async function renderImage(sourceUrl: string, sourceType: string, settings: ImageSettings): Promise<Blob> {
  const image = await loadSource(sourceUrl)
  const dimensions = getOutputDimensions(settings)
  const canvas = document.createElement('canvas')
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvas.getContext('2d')

  if (!context) throw new Error('This browser cannot create a canvas for image processing.')

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  const { brightness, contrast, saturation, exposure, blur } = settings.adjustments
  context.filter = `brightness(${Math.max(0, 1 + brightness / 100) * Math.pow(2, exposure / 100)}) contrast(${Math.max(0, 1 + contrast / 100)}) saturate(${Math.max(0, 1 + saturation / 100)}) blur(${blur}px)`
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(settings.rotation * Math.PI / 180)
  context.scale(settings.flipX ? -1 : 1, settings.flipY ? -1 : 1)
  context.drawImage(image, settings.crop.x, settings.crop.y, settings.crop.width, settings.crop.height, -settings.width / 2, -settings.height / 2, settings.width, settings.height)
  context.filter = 'none'
  if (settings.backgroundRemoval.enabled && settings.backgroundRemoval.mode === 'local') applyBackgroundRemoval(context, canvas.width, canvas.height, settings.backgroundRemoval.threshold, settings.backgroundRemoval.softness)
  if (settings.adjustments.sharpen > 0) applySharpen(context, canvas.width, canvas.height, settings.adjustments.sharpen)

  const mimeType = getOutputMimeType(settings.outputFormat, sourceType)
  const quality = supportsQuality(settings.outputFormat) ? settings.quality / 100 : undefined
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality))

  if (!blob) {
    throw new Error(`This browser cannot export ${mimeType.replace('image/', '').toUpperCase()} images.`)
  }
  return blob
}

export function applyBackgroundRemoval(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number, threshold: number, softness: number) {
  const imageData = context.getImageData(0, 0, width, height)
  const pixels = imageData.data
  const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 80))
  let red = 0
  let green = 0
  let blue = 0
  let samples = 0
  const sample = (x: number, y: number) => {
    const index = (y * width + x) * 4
    red += pixels[index]
    green += pixels[index + 1]
    blue += pixels[index + 2]
    samples += 1
  }
  for (let x = 0; x < width; x += sampleStep) { sample(x, 0); sample(x, height - 1) }
  for (let y = sampleStep; y < height - 1; y += sampleStep) { sample(0, y); sample(width - 1, y) }

  const background = { red: red / samples, green: green / samples, blue: blue / samples }
  const cutoff = 18 + threshold * 2.2
  const feather = Math.max(1, softness * 1.5)
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let queueStart = 0
  let queueEnd = 0
  const distanceAt = (pixelIndex: number) => {
    const redDelta = pixels[pixelIndex] - background.red
    const greenDelta = pixels[pixelIndex + 1] - background.green
    const blueDelta = pixels[pixelIndex + 2] - background.blue
    return Math.sqrt(redDelta ** 2 + greenDelta ** 2 + blueDelta ** 2)
  }
  const enqueue = (x: number, y: number) => {
    const position = y * width + x
    if (visited[position]) return
    visited[position] = 1
    const pixelIndex = position * 4
    if (distanceAt(pixelIndex) <= cutoff + feather) queue[queueEnd++] = position
  }
  for (let x = 0; x < width; x += 1) { enqueue(x, 0); enqueue(x, height - 1) }
  for (let y = 1; y < height - 1; y += 1) { enqueue(0, y); enqueue(width - 1, y) }

  while (queueStart < queueEnd) {
    const position = queue[queueStart++]
    const x = position % width
    const y = Math.floor(position / width)
    const pixelIndex = position * 4
    const distance = distanceAt(pixelIndex)
    pixels[pixelIndex + 3] = distance <= cutoff ? 0 : Math.min(pixels[pixelIndex + 3], Math.round((distance - cutoff) / feather * 255))
    if (x > 0) enqueue(x - 1, y)
    if (x < width - 1) enqueue(x + 1, y)
    if (y > 0) enqueue(x, y - 1)
    if (y < height - 1) enqueue(x, y + 1)
  }
  context.putImageData(imageData, 0, 0)
}

function applySharpen(context: CanvasRenderingContext2D, width: number, height: number, amount: number) {
  const imageData = context.getImageData(0, 0, width, height)
  const source = new Uint8ClampedArray(imageData.data)
  const strength = amount / 100
  const indexAt = (x: number, y: number, channel: number) => (y * width + x) * 4 + channel

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const center = source[indexAt(x, y, channel)]
        const neighbours = source[indexAt(x - 1, y, channel)] + source[indexAt(x + 1, y, channel)] + source[indexAt(x, y - 1, channel)] + source[indexAt(x, y + 1, channel)]
        imageData.data[indexAt(x, y, channel)] = Math.max(0, Math.min(255, center * (1 + 4 * strength) - neighbours * strength))
      }
    }
  }
  context.putImageData(imageData, 0, 0)
}
