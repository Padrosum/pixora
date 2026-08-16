import { describe, expect, it } from 'vitest'
import { getOutputDimensions, getOutputMimeType, getSavingsPercent, supportsQuality } from './image-processing'

describe('image processing helpers', () => {
  it('keeps the input type when original output is selected', () => {
    expect(getOutputMimeType('original', 'image/png')).toBe('image/png')
    expect(getOutputMimeType('image/webp', 'image/png')).toBe('image/webp')
  })

  it('only exposes quality for lossy formats', () => {
    expect(supportsQuality('image/png')).toBe(false)
    expect(supportsQuality('image/jpeg')).toBe(true)
    expect(supportsQuality('image/avif')).toBe(true)
  })

  it('calculates savings with one decimal precision', () => {
    expect(getSavingsPercent(4_820_000, 1_210_000)).toBe(74.9)
    expect(getSavingsPercent(0, 10)).toBe(0)
  })

  it('swaps output dimensions for quarter turns', () => {
    expect(getOutputDimensions({ width: 1200, height: 800, rotation: 90 })).toEqual({ width: 800, height: 1200 })
    expect(getOutputDimensions({ width: 1200, height: 800, rotation: 180 })).toEqual({ width: 1200, height: 800 })
  })
})
