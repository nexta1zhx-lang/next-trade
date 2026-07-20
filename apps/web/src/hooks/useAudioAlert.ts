'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import type {AlertType} from '@nexttrade/shared'

/**
 * Web Audio API 无文件音效引擎
 * 实时合成: 看涨突破音 + 支撑回踩音
 */
class AudioAlertEngine {
  private ctx: AudioContext | null = null
  private unlocked = false

  /**
   * 解锁 AudioContext（需要用户交互触发）
   */
  unlock(): void {
    if (this.unlocked) return
    try {
      this.ctx = new AudioContext()
      this.unlocked = true
    } catch {
      console.warn('[audio] Web Audio API not available')
    }
  }

  get isReady(): boolean {
    return this.unlocked && this.ctx !== null
  }

  /**
   * 播放看涨突破音: 880Hz → 1760Hz 快速双升调
   */
  playBreakout(): void {
    if (!this.ctx) return
    if (this.ctx.state === 'suspended') this.ctx.resume()

    const now = this.ctx.currentTime

    // 第一声: 880Hz, 0.15s
    this.playTone(this.ctx, 880, now, 0.15, 0.3)
    // 第二声: 1760Hz, 0.2s (延迟 0.12s)
    this.playTone(this.ctx, 1760, now + 0.12, 0.2, 0.25)
  }

  /**
   * 播放支撑回踩音: 523Hz 软和双响
   */
  playSupport(): void {
    if (!this.ctx) return
    if (this.ctx.state === 'suspended') this.ctx.resume()

    const now = this.ctx.currentTime

    // 第一声: 523Hz, 0.12s
    this.playTone(this.ctx, 523, now, 0.12, 0.2, 'sine')
    // 第二声: 523Hz, 0.12s (延迟 0.2s)
    this.playTone(this.ctx, 523, now + 0.2, 0.12, 0.2, 'sine')
  }

  /**
   * 播放挤压释放音: 低频警报
   */
  playSqueezeRelease(): void {
    if (!this.ctx) return
    if (this.ctx.state === 'suspended') this.ctx.resume()

    const now = this.ctx.currentTime
    // 低沉警报 220Hz → 440Hz 滑音
    this.playSweep(this.ctx, 220, 440, now, 0.4, 0.4)
  }

  private playTone(
    ctx: AudioContext,
    freq: number,
    startTime: number,
    duration: number,
    volume: number,
    type: OscillatorType = 'triangle'
  ): void {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = type
    osc.frequency.setValueAtTime(freq, startTime)

    gain.gain.setValueAtTime(0, startTime)
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.01)
    gain.gain.linearRampToValueAtTime(0, startTime + duration)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(startTime)
    osc.stop(startTime + duration + 0.05)
  }

  private playSweep(
    ctx: AudioContext,
    startFreq: number,
    endFreq: number,
    startTime: number,
    duration: number,
    volume: number
  ): void {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(startFreq, startTime)
    osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + duration)

    gain.gain.setValueAtTime(0, startTime)
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.02)
    gain.gain.linearRampToValueAtTime(0, startTime + duration)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(startTime)
    osc.stop(startTime + duration + 0.05)
  }
}

const engine = new AudioAlertEngine()

/**
 * 音效告警 Hook
 * 监听告警事件并播放对应音效
 */
export function useAudioAlert(
  lastAlert: {type: AlertType; timestamp: number} | null
): {
  isMuted: boolean
  toggleMute: () => void
  playTest: () => void
  unlock: () => void
} {
  const [isMuted, setIsMuted] = useState(true) // 默认静音
  const lastPlayedRef = useRef(0)

  const playForType = useCallback(
    (type: AlertType) => {
      if (isMuted || !engine.isReady) return
      // 防重复: 同一类型 2 秒内不重复播
      const now = Date.now()
      if (now - lastPlayedRef.current < 2000) return
      lastPlayedRef.current = now

      switch (type) {
        case 'breakout':
          engine.playBreakout()
          break
        case 'support':
          engine.playSupport()
          break
        case 'squeeze_release':
          engine.playSqueezeRelease()
          break
      }
    },
    [isMuted]
  )

  // 监听最新告警
  useEffect(() => {
    if (lastAlert) playForType(lastAlert.type)
  }, [lastAlert, playForType])

  const toggleMute = useCallback(() => setIsMuted(m => !m), [])
  const playTest = useCallback(() => {
    if (!engine.isReady) engine.unlock()
    engine.playBreakout()
    setTimeout(() => engine.playSupport(), 600)
  }, [])
  const unlock = useCallback(() => engine.unlock(), [])

  return {isMuted, toggleMute, playTest, unlock}
}
