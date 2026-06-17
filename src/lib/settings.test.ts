import { describe, expect, it } from 'vitest'
import { defaultSettings, mergeSettings, modePresets, sensoryPresets } from './settings'

describe('reader settings', () => {
  it('keeps every documented control in its supported range', () => {
    expect(defaultSettings.wpm).toBeGreaterThanOrEqual(50)
    expect(defaultSettings.wpm).toBeLessThanOrEqual(1000)
    expect(defaultSettings.chunkSize).toBeGreaterThanOrEqual(1)
    expect(defaultSettings.chunkSize).toBeLessThanOrEqual(5)
    expect(defaultSettings.fontSize).toBeGreaterThanOrEqual(24)
    expect(defaultSettings.fontSize).toBeLessThanOrEqual(120)
    expect(defaultSettings.fontWeight).toBeGreaterThanOrEqual(400)
    expect(defaultSettings.fontWeight).toBeLessThanOrEqual(700)
    expect(defaultSettings.wordFocusTextScale).toBeGreaterThanOrEqual(32)
    expect(defaultSettings.wordFocusTextScale).toBeLessThanOrEqual(72)
    expect(defaultSettings.wordFocusLineSpacing).toBeGreaterThanOrEqual(120)
    expect(defaultSettings.wordFocusLineSpacing).toBeLessThanOrEqual(190)
    expect(defaultSettings.pauseCommaMs).toBeGreaterThanOrEqual(0)
    expect(defaultSettings.pausePeriodMs).toBeGreaterThan(defaultSettings.pauseCommaMs)
    expect(defaultSettings.pauseLongWordMs).toBeGreaterThanOrEqual(0)
    expect(defaultSettings.microBreakDuration).toBeGreaterThanOrEqual(5)
    expect(defaultSettings.microBreakDuration).toBeLessThanOrEqual(20)
    expect(defaultSettings.eyeAnchor).toBe(false)
    expect(defaultSettings.eyeAnchorStyle).toBe('line')
    expect(defaultSettings.hotkeys.focusMode).toBe('F')
  })

  it('applies all purpose-driven mode presets', () => {
    expect(modePresets.skim.wpm).toBeGreaterThan(modePresets['deep-focus'].wpm!)
    expect(modePresets.study.wpm).toBeLessThan(modePresets['deep-focus'].wpm!)
    expect(modePresets.study.chunkSize).toBe(1)
  })

  it('lets neutral sensory mode undo carryover from stronger presets', () => {
    expect(sensoryPresets.neutral).toMatchObject({
      theme: 'paper',
      contrast: 'balanced',
      focusWindow: false,
      motionSmoothing: false,
      audioMode: 'off',
    })
    expect(sensoryPresets.calm).toMatchObject({
      theme: 'calm',
      focusWindow: true,
      motionSmoothing: true,
    })
    expect(sensoryPresets['low-stim']).toMatchObject({
      theme: 'eink',
      focusWindow: true,
      toneIndicators: false,
      audioMode: 'off',
    })
  })

  it('migrates old settings without losing user choices', () => {
    const migrated = mergeSettings({
      version: 1,
      wpm: 430,
      theme: 'dark',
    } as unknown as Parameters<typeof mergeSettings>[0])
    expect(migrated.version).toBe(2)
    expect(migrated.wpm).toBe(430)
    expect(migrated.theme).toBe('dark')
    expect(migrated.autoHideFocusUi).toBe(false)
    expect(migrated.backgroundLoop).toBe(true)
    expect(migrated.eyeAnchor).toBe(false)
    expect(migrated.eyeAnchorStyle).toBe('line')
    expect(migrated.hotkeys.narration).toBe('H')
  })
})
