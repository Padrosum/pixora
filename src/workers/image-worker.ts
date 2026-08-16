import { applyBackgroundRemoval, type ImageSettings } from '../lib/image-processing'

type WorkerRequest = { file: Blob; sourceType: string; settings: ImageSettings }
type WorkerResponse = { type: 'success'; blob: Blob } | { type: 'error'; message: string }

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerResponse) => void
}

workerScope.onmessage = async ({ data }) => {
  try {
    const bitmap = await createImageBitmap(data.file)
    const dimensions = data.settings.rotation === 90 || data.settings.rotation === 270
      ? { width: data.settings.height, height: data.settings.width }
      : { width: data.settings.width, height: data.settings.height }
    const canvas = new OffscreenCanvas(dimensions.width, dimensions.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot create a canvas in a worker.')

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    const { brightness, contrast, saturation, exposure, blur } = data.settings.adjustments
    context.filter = `brightness(${Math.max(0, 1 + brightness / 100) * Math.pow(2, exposure / 100)}) contrast(${Math.max(0, 1 + contrast / 100)}) saturate(${Math.max(0, 1 + saturation / 100)}) blur(${blur}px)`
    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate(data.settings.rotation * Math.PI / 180)
    context.scale(data.settings.flipX ? -1 : 1, data.settings.flipY ? -1 : 1)
    context.drawImage(bitmap, data.settings.crop.x, data.settings.crop.y, data.settings.crop.width, data.settings.crop.height, -data.settings.width / 2, -data.settings.height / 2, data.settings.width, data.settings.height)
    bitmap.close()
    context.filter = 'none'
    if (data.settings.backgroundRemoval.enabled && data.settings.backgroundRemoval.mode === 'local') applyBackgroundRemoval(context, canvas.width, canvas.height, data.settings.backgroundRemoval.threshold, data.settings.backgroundRemoval.softness)
    if (data.settings.adjustments.sharpen > 0) applySharpen(context, canvas.width, canvas.height, data.settings.adjustments.sharpen)

    const mimeType = data.settings.outputFormat === 'original' ? data.sourceType : data.settings.outputFormat
    const qualityFormats = ['image/jpeg', 'image/webp', 'image/avif']
    const blob = await canvas.convertToBlob({ type: mimeType, quality: qualityFormats.includes(data.settings.outputFormat) ? data.settings.quality / 100 : undefined })
    workerScope.postMessage({ type: 'success', blob })
  } catch (reason: unknown) {
    workerScope.postMessage({ type: 'error', message: reason instanceof Error ? reason.message : 'This image could not be processed in a worker.' })
  }
}

function applySharpen(context: OffscreenCanvasRenderingContext2D, width: number, height: number, amount: number) {
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
