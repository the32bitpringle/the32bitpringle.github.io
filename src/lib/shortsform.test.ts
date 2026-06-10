import { describe, expect, it } from 'vitest'
import {
  alignTtsTimings,
  getActiveTtsTimingIndex,
  getShortsformAudioPlaybackRate,
  getTtsTimingIndex,
} from './shortsform'

describe('Shortsform narration timing', () => {
  it('makes WPM and narration rate independently affect playback speed', () => {
    expect(getShortsformAudioPlaybackRate(4000, 4000, 1)).toBe(1)
    expect(getShortsformAudioPlaybackRate(4000, 2000, 1)).toBe(2)
    expect(getShortsformAudioPlaybackRate(4000, 4000, 1.5)).toBe(1.5)
  })

  it('keeps browser playback within supported practical limits', () => {
    expect(getShortsformAudioPlaybackRate(10_000, 100, 2)).toBe(4)
    expect(getShortsformAudioPlaybackRate(100, 10_000, 0.7)).toBe(0.5)
  })

  it('selects the active word from irregular TTS boundaries', () => {
    const timings = [
      { durationMs: 180, offsetMs: 100, text: 'One' },
      { durationMs: 420, offsetMs: 360, text: 'variable' },
      { durationMs: 160, offsetMs: 1100, text: 'pace' },
    ]
    expect(getTtsTimingIndex(timings, 99)).toBe(-1)
    expect(getTtsTimingIndex(timings, 800)).toBe(1)
    expect(getTtsTimingIndex(timings, 1200)).toBe(2)
    expect(getActiveTtsTimingIndex(timings, 99)).toBe(-1)
    expect(getActiveTtsTimingIndex(timings, 200)).toBe(0)
    expect(getActiveTtsTimingIndex(timings, 800)).toBe(-1)
    expect(getActiveTtsTimingIndex(timings, 1200)).toBe(2)
  })

  it('aligns spoken boundaries with punctuation-bearing caption tokens', () => {
    const timings = alignTtsTimings([
      { durationMs: 100, offsetMs: 0, text: 'Hello' },
      { durationMs: 100, offsetMs: 250, text: 'world' },
    ], ['Hello,', 'world.'])
    expect(timings.map((timing) => timing.tokenOffset)).toEqual([0, 1])
  })
})
