import { describe, expect, it } from 'vitest'
import { getSmartOptimizeSettings } from './smart-optimize'
import type { ImageSettings } from './image-processing'

const settings: ImageSettings = {
  width: 4000,
  height: 3000,
  maintainAspectRatio: false,
  quality: 100,
  outputFormat: 'image/png',
  crop: { x: 0, y: 0, width: 4000, height: 3000 },
  rotation: 0,
  flipX: false,
  flipY: false,
  adjustments: { brightness: 0, contrast: 0, saturation: 0, exposure: 0, blur: 0, sharpen: 0 },
  backgroundRemoval: { enabled: false, mode: 'local', threshold: 34, softness: 8 },
}

describe('smart optimize', () => {
  it('caps large images and selects a balanced web output', () => {
    const result = getSmartOptimizeSettings(settings)
    expect(result.width).toBe(1920)
    expect(result.height).toBe(1440)
    expect(result.quality).toBe(82)
    expect(result.outputFormat).toBe('image/webp')
  })
})
