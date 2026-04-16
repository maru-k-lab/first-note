import { YIN } from 'pitchfinder';
import { getAudioContext } from './audioContext';

/** File を AudioBuffer にデコードする。decodeAudioData は suspended 状態でも動作する。 */
export async function decodeAudio(file: File): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const arrayBuf = await file.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuf);
}

/**
 * 指定区間 [startSec, endSec) のピッチを YIN で検出する。
 * 区間が短すぎる（50ms 未満）場合や検出失敗時は null を返す。
 *
 * Note on sample rates: decodeAudioData resamples audio to ctx.sampleRate,
 * so audioBuf.sampleRate === ctx.sampleRate.
 */
export function detectPitchInRange(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
): number | null {
  const sr = buffer.sampleRate;
  const start = Math.max(0, Math.floor(startSec * sr));
  const end = Math.min(buffer.length, Math.floor(endSec * sr));
  if (end - start < Math.floor(sr * 0.05)) return null; // YIN 最低 50ms
  const slice = buffer.getChannelData(0).slice(start, end);
  const detect = YIN({ sampleRate: sr, threshold: 0.1, probabilityThreshold: 0.1 });
  return detect(slice) ?? null;
}
