import { describe, expect, it } from 'vitest'
import { getModelPublicPath, ML_MODEL_SIZE_LABEL } from './ml-background-removal'

describe('ML background removal metadata', () => {
  it('communicates the first-run model download size', () => {
    expect(ML_MODEL_SIZE_LABEL).toContain('75 MB')
  })

  it('resolves model assets against the deployed application path', () => {
    expect(getModelPublicPath('./', 'https://padrosum.uk/pixora/')).toBe('https://padrosum.uk/pixora/models/background-removal/')
  })
})
