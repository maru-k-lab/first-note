import { YIN } from 'pitchfinder';
import { getAudioContext } from './audioContext';

const BUFFER_SIZE = 2048;
const FRAME_INTERVAL_MS = 1000 / 30; // ~30 fps
const SILENCE_RMS = 0.005;

/**
 * Captures mic input and emits real-time pitch detections via a callback.
 *
 * iOS Safari notes:
 *   - getUserMedia() must be called inside a user gesture handler.
 *   - AudioContext must already be resumed before calling start().
 *   - The rAF loop runs on the main thread; pitchfinder is pure JS (no AudioWorklet needed).
 */
export class MicrophoneAnalyzer {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer = new Float32Array(BUFFER_SIZE);
  private detect: ((b: Float32Array) => number | null) | null = null;
  private rafId: number | null = null;
  private lastTick = 0;

  async start(onPitch: (hz: number | null) => void): Promise<void> {
    const ctx = getAudioContext();

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('MIC_REQUIRES_SECURE_CONTEXT');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    this.source = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = BUFFER_SIZE;
    this.source.connect(this.analyser);

    this.detect = YIN({
      sampleRate: ctx.sampleRate,
      threshold: 0.1,
      probabilityThreshold: 0.1,
    });

    const loop = (now: number): void => {
      this.rafId = requestAnimationFrame(loop);
      if (!this.analyser || !this.detect) return;
      if (now - this.lastTick < FRAME_INTERVAL_MS) return;
      this.lastTick = now;

      this.analyser.getFloatTimeDomainData(this.buffer);

      // Silence gate: skip detection when signal is too quiet
      let sumSq = 0;
      for (let i = 0; i < this.buffer.length; i++) {
        sumSq += this.buffer[i] * this.buffer[i];
      }
      const rms = Math.sqrt(sumSq / this.buffer.length);
      if (rms < SILENCE_RMS) {
        onPitch(null);
        return;
      }

      onPitch(this.detect(this.buffer) ?? null);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.source?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.source = null;
    this.analyser = null;
    this.stream = null;
    this.detect = null;
  }
}
