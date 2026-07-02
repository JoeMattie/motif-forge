import { describe, expect, test } from 'vitest'
import { audioBufferToWavBlob } from '../src/core/wav'

/** wav.ts only touches getChannelData(0) and sampleRate. */
function fakeAudioBuffer(samples: number[], sampleRate = 44100): AudioBuffer {
  const data = new Float32Array(samples)
  return { getChannelData: () => data, sampleRate } as unknown as AudioBuffer
}

async function decode(samples: number[], sampleRate = 44100) {
  const blob = audioBufferToWavBlob(fakeAudioBuffer(samples, sampleRate))
  const view = new DataView(await blob.arrayBuffer())
  const str = (o: number, n: number) =>
    String.fromCharCode(...new Uint8Array(view.buffer, o, n))
  return { blob, view, str }
}

describe('audioBufferToWavBlob', () => {
  test('writes a valid RIFF/WAVE header for mono 16-bit PCM', async () => {
    const { blob, view, str } = await decode([0, 0.5, -0.5], 48000)
    expect(blob.type).toBe('audio/wav')
    expect(str(0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + 6) // 3 samples × 2 bytes
    expect(str(8, 4)).toBe('WAVE')
    expect(str(12, 4)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16) // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint32(28, true)).toBe(96000) // byte rate
    expect(view.getUint16(32, true)).toBe(2) // block align
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(str(36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(6)
    expect(blob.size).toBe(44 + 6)
  })

  test('scales samples to signed 16-bit little-endian', async () => {
    const { view } = await decode([0, 1, -1, 0.5])
    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(0x7fff)
    expect(view.getInt16(48, true)).toBe(-0x7fff)
    expect(view.getInt16(50, true)).toBe(Math.trunc(0.5 * 0x7fff))
  })

  test('clips samples outside [-1, 1] instead of wrapping', async () => {
    const { view } = await decode([2.5, -3])
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x7fff)
  })

  test('handles an empty buffer', async () => {
    const { blob, view } = await decode([])
    expect(blob.size).toBe(44)
    expect(view.getUint32(40, true)).toBe(0)
  })
})
