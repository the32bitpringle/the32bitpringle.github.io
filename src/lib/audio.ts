import type { AudioMode } from '../types'

export class AmbientAudio {
  private context: AudioContext | null = null
  private stopCurrent: (() => void) | null = null
  private wordPulseGain: GainNode | null = null

  async start(mode: AudioMode, volume: number, pace: number) {
    this.stop()
    if (mode === 'off') return
    this.context ??= new AudioContext({ latencyHint: 'playback' })
    await this.context.resume()
    const gain = this.context.createGain()
    gain.gain.value = Math.max(0, Math.min(volume / 100, 1)) * 0.16
    gain.connect(this.context.destination)

    if (mode === 'soft-drums') {
      this.wordPulseGain = gain
      this.stopCurrent = () => {
        this.wordPulseGain = null
        gain.disconnect()
      }
      return
    }

    if (mode === 'brown-noise') {
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate)
      const data = buffer.getChannelData(0)
      let last = 0
      for (let i = 0; i < data.length; i += 1) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
        data[i] = last * 3.2
      }
      const source = this.context.createBufferSource()
      const filter = this.context.createBiquadFilter()
      source.buffer = buffer
      source.loop = true
      filter.type = 'lowpass'
      filter.frequency.value = 420
      source.connect(filter).connect(gain)
      source.start()
      this.stopCurrent = () => { source.stop(); source.disconnect(); filter.disconnect(); gain.disconnect() }
      return
    }

    if (mode === 'binaural-beats') {
      const merger = this.context.createChannelMerger(2)
      const left = this.context.createOscillator()
      const right = this.context.createOscillator()
      left.frequency.value = 160
      right.frequency.value = 168
      left.connect(merger, 0, 0)
      right.connect(merger, 0, 1)
      merger.connect(gain)
      left.start()
      right.start()
      this.stopCurrent = () => { left.stop(); right.stop(); left.disconnect(); right.disconnect(); merger.disconnect(); gain.disconnect() }
      return
    }

    let active = true
    let timer: number | null = null
    const tick = () => {
      if (!active || !this.context) return
      const oscillator = this.context.createOscillator()
      const pulse = this.context.createGain()
      oscillator.frequency.value = 620
      pulse.gain.setValueAtTime(0.001, this.context.currentTime)
      pulse.gain.exponentialRampToValueAtTime(0.12, this.context.currentTime + 0.01)
      pulse.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + 0.08)
      oscillator.connect(pulse).connect(gain)
      oscillator.start()
      oscillator.stop(this.context.currentTime + 0.09)
      timer = window.setTimeout(tick, Math.max(220, 60_000 / Math.max(pace, 50)))
    }
    tick()
    this.stopCurrent = () => { active = false; if (timer) clearTimeout(timer); gain.disconnect() }
  }

  async pulseWord(volume: number) {
    this.context ??= new AudioContext({ latencyHint: 'interactive' })
    await this.context.resume()
    if (!this.wordPulseGain) {
      this.wordPulseGain = this.context.createGain()
      this.wordPulseGain.gain.value = Math.max(0, Math.min(volume / 100, 1)) * 0.18
      this.wordPulseGain.connect(this.context.destination)
    }

    const now = this.context.currentTime
    const oscillator = this.context.createOscillator()
    const envelope = this.context.createGain()
    const filter = this.context.createBiquadFilter()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(105, now)
    oscillator.frequency.exponentialRampToValueAtTime(48, now + 0.11)
    filter.type = 'lowpass'
    filter.frequency.value = 190
    envelope.gain.setValueAtTime(0.0001, now)
    envelope.gain.exponentialRampToValueAtTime(0.7, now + 0.008)
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.14)
    oscillator.connect(filter).connect(envelope).connect(this.wordPulseGain)
    oscillator.start(now)
    oscillator.stop(now + 0.15)
    oscillator.onended = () => {
      oscillator.disconnect()
      filter.disconnect()
      envelope.disconnect()
    }
  }

  stop() {
    this.stopCurrent?.()
    this.stopCurrent = null
    this.wordPulseGain = null
  }
}
