import { getAudioContext } from './audioContext';

/**
 * Plays a sustained sine wave at a given frequency.
 * GainNode is lazy-initialized so that the AudioContext is not created
 * until the user first interacts (iOS Safari autoplay policy).
 * OscillatorNode is single-use; a new one is created on each start().
 */
export class ReferenceOscillator {
  private oscillatorNode: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;

  private ensureGain(): GainNode {
    if (!this.gainNode) {
      const ctx = getAudioContext();
      this.gainNode = ctx.createGain();
      this.gainNode.gain.value = 0.7;
      this.gainNode.connect(ctx.destination);
    }
    return this.gainNode;
  }

  start(hz: number): void {
    this.stop(); // clean up any running node first
    const ctx = getAudioContext();
    this.oscillatorNode = ctx.createOscillator();
    this.oscillatorNode.type = 'sine';
    this.oscillatorNode.frequency.value = hz;
    this.oscillatorNode.connect(this.ensureGain());
    this.oscillatorNode.start();
  }

  stop(): void {
    if (this.oscillatorNode) {
      this.oscillatorNode.stop();
      this.oscillatorNode.disconnect();
      this.oscillatorNode = null;
    }
  }

  /** value: 0.0 – 1.0 */
  setVolume(value: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = value;
    }
  }

  get isPlaying(): boolean {
    return this.oscillatorNode !== null;
  }
}
