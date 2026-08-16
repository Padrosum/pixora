import { describe, expect, it } from 'vitest'
import { ML_MODEL_SIZE_LABEL } from './ml-background-removal'

describe('ML background removal metadata', () => {
  it('communicates the first-run model download size', () => {
    expect(ML_MODEL_SIZE_LABEL).toContain('40 MB')
  })
})
