import { YIN } from 'pitchfinder';
import { PitchDetector } from 'pitchy';
import { getAudioContext } from './audioContext';

const BUFFER_SIZE = 2048;
const FRAME_INTERVAL_MS = 1000 / 30; // ~30 fps
const SILENCE_RMS = 0.0003;
const MIC_MIN_HZ = 60;
const MIC_MAX_HZ = 1400;
const PITCHY_CLARITY_THRESHOLD = 0.62;

export type MicSignalState = 'silent' | 'unpitched' | 'pitched';

export interface MicPitchUpdate {
  hz: number | null;
  signal: MicSignalState;
  level: number;
}

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
  private pitchy: PitchDetector<Float32Array> | null = null;
  private rafId: number | null = null;
  private lastTick = 0;

  async start(onPitch: (update: MicPitchUpdate) => void): Promise<void> {
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
      threshold: 0.15,
      probabilityThreshold: 0.05,
    });
    this.pitchy = PitchDetector.forFloat32Array(BUFFER_SIZE);
    this.pitchy.clarityThreshold = PITCHY_CLARITY_THRESHOLD;
    this.pitchy.minVolumeAbsolute = SILENCE_RMS;

    const loop = (now: number): void => {
      this.rafId = requestAnimationFrame(loop);
      if (!this.analyser || !this.detect) return;
      if (now - this.lastTick < FRAME_INTERVAL_MS) return;
      this.lastTick = now;

      this.analyser.getFloatTimeDomainData(this.buffer);
      const pitchy = this.pitchy;
      if (!pitchy) return;

      // Silence gate: skip detection when signal is too quiet
      let sumSq = 0;
      for (let i = 0; i < this.buffer.length; i++) {
        sumSq += this.buffer[i] * this.buffer[i];
      }
      const rms = Math.sqrt(sumSq / this.buffer.length);
      const level = Math.min(1, rms / 0.02);
      if (rms < SILENCE_RMS) {
        onPitch({ hz: null, signal: 'silent', level });
        return;
      }

      const yinHz = this.detect(this.buffer);
      if (isUsableMicPitch(yinHz)) {
        onPitch({ hz: yinHz, signal: 'pitched', level });
        return;
      }

      const [pitchyHz, clarity] = pitchy.findPitch(this.buffer, ctx.sampleRate);
      if (clarity >= PITCHY_CLARITY_THRESHOLD && isUsableMicPitch(pitchyHz)) {
        onPitch({ hz: pitchyHz, signal: 'pitched', level });
        return;
      }

      onPitch({ hz: null, signal: 'unpitched', level });
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
    this.pitchy = null;
  }
}

function isUsableMicPitch(hz: number | null): hz is number {
  return hz !== null && Number.isFinite(hz) && hz >= MIC_MIN_HZ && hz <= MIC_MAX_HZ;
}
