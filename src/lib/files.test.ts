import { describe, expect, it } from 'vitest'
import { extensionForType, formatBytes, isSupportedImage } from './files'

describe('file helpers', () => {
  it('formats file sizes for the metadata UI', () => {
    expect(formatBytes(4.82 * 1024 * 1024)).toBe('4.82 MB')
    expect(formatBytes(640)).toBe('640 B')
  })

  it('maps browser MIME types to export labels', () => {
    expect(extensionForType('image/jpeg')).toBe('JPG')
    expect(extensionForType('image/avif')).toBe('AVIF')
  })

  it('handles empty sizes and rejects unsupported file types', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(isSupportedImage(new File(['data'], 'notes.txt', { type: 'text/plain' }))).toBe(false)
    expect(isSupportedImage(new File(['data'], 'photo.webp', { type: 'image/webp' }))).toBe(true)
  })
})
