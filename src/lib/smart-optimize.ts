import type { ImageSettings } from './image-processing'

export const SMART_MAX_DIMENSION = 1920

export function getSmartOptimizeSettings(settings: ImageSettings): ImageSettings {
  const scale = Math.min(1, SMART_MAX_DIMENSION / settings.width, SMART_MAX_DIMENSION / settings.height)
  return {
    ...settings,
    width: Math.max(1, Math.round(settings.width * scale)),
    height: Math.max(1, Math.round(settings.height * scale)),
    quality: 82,
    outputFormat: 'image/webp',
    maintainAspectRatio: true,
  }
}
