import { getAudioContext } from './audioContext';

export interface PlayRangeOptions {
  startSec: number;
  endSec: number;
  onEnded?: () => void; // 自然終了・手動停止いずれでも1回だけ発火
}

export class AudioPlayer {
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;

  private ensureGain(): GainNode {
    if (!this.gain) {
      const ctx = getAudioContext();
      this.gain = ctx.createGain();
      this.gain.gain.value = 1.0;
      this.gain.connect(ctx.destination);
    }
    return this.gain;
  }

  start(buffer: AudioBuffer, opts: PlayRangeOptions): void {
    this.stop(); // 多重再生防止
    const ctx = getAudioContext();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ensureGain());

    let ended = false;
    const fireEnded = (): void => {
      if (ended) return;
      ended = true;
      try { src.disconnect(); } catch { /* noop */ }
      if (this.source === src) this.source = null;
      opts.onEnded?.();
    };
    src.onended = fireEnded;
    this.source = src;

    const offset = Math.max(0, opts.startSec);
    const duration = Math.max(0, opts.endSec - opts.startSec);
    src.start(0, offset, duration); // 終端で onended 自動発火
  }

  stop(): void {
    if (!this.source) return;
    const s = this.source;
    this.source = null;
    try { s.stop(); } catch { /* already stopped */ }
    try { s.disconnect(); } catch { /* noop */ }
  }

  get isPlaying(): boolean { return this.source !== null; }
}
