import { describe, expect, it } from 'vitest'
import { featureRegistry } from './features'

describe('feature registry', () => {
  it('documents shipped behavior without exposing excluded features', () => {
    expect(featureRegistry.every((feature) => feature.disable.length > 0)).toBe(true)
    expect(featureRegistry.length).toBeGreaterThan(35)
    expect(new Set(featureRegistry.map((feature) => feature.id)).size).toBe(featureRegistry.length)
    expect(featureRegistry.every((feature) => feature.privacy && feature.processedData && feature.defaultState)).toBe(true)
    expect(featureRegistry.every((feature) => feature.status === 'implemented')).toBe(true)
  })
})
