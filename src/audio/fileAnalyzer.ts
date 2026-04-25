import { YIN } from 'pitchfinder';
import { PitchDetector } from 'pitchy';
import { getAudioContext } from './audioContext';

const FRAME_SIZE = 2048;
const SPECTRAL_FRAME_SIZE = 2048;
const HOP_SIZE = 512;
const SPECTRAL_HOP_SIZE = 2048;
const CLARITY_THRESHOLD = 0.72;
const MELODY_MIN_HZ = 130;
const MELODY_MAX_HZ = 1100;
const DETECTOR_DISAGREEMENT_CENTS = 350;
const SEGMENT_CONTINUITY_CENTS = 120;
const MIN_SEGMENT_FRAMES = 2;
const MIN_RANGE_SEC = 0.05;
const SOURCE_NAMES = ['mid', 'left', 'right', 'side', 'spectral'] as const;

type PitchSourceName = typeof SOURCE_NAMES[number];

interface RawPitchFrame {
  offset: number;
  timeSec: number;
  hz: number;
  midi: number;
  noteBin: number;
  rms: number;
  clarity: number;
  centerScore: number;
  agreementScore: number;
  preliminaryScore: number;
  source: PitchSourceName;
}

interface PitchFrame extends RawPitchFrame {
  energyScore: number;
  weight: number;
}

interface PitchSegment {
  startSec: number;
  endSec: number;
  durationSec: number;
  frameCount: number;
  hz: number;
  score: number;
  meanClarity: number;
  meanCenter: number;
  meanEnergy: number;
  densityScore: number;
  stabilityScore: number;
  pitchSpreadCents: number;
  dominantSource: PitchSourceName;
}

export interface PitchCandidateSegment extends PitchSegment {
  rank: number;
  selected: boolean;
}

export interface PitchAnalysisResult {
  hz: number | null;
  frameCount: number;
  segments: PitchCandidateSegment[];
}

export async function decodeAudio(file: File): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const arrayBuf = await file.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuf);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function centsDistance(aHz: number, bHz: number): number {
  return Math.abs(1200 * Math.log2(aHz / bHz));
}

function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

function percentile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) return 0;
  const index = clamp(ratio, 0, 1) * (sortedValues.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sortedValues[lo];
  const t = index - lo;
  return sortedValues[lo] * (1 - t) + sortedValues[hi] * t;
}

function extractMidSide(
  buffer: AudioBuffer,
  start: number,
  end: number,
): { mid: Float32Array; left: Float32Array; right: Float32Array | null; side: Float32Array | null } {
  const length = end - start;
  const mid = new Float32Array(length);
  const leftOut = new Float32Array(length);

  if (buffer.numberOfChannels === 1) {
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const value = ch[start + i];
      mid[i] = value;
      leftOut[i] = value;
    }
    return { mid, left: leftOut, right: null, side: null };
  }

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const rightOut = new Float32Array(length);
  const side = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const leftValue = left[start + i];
    const rightValue = right[start + i];
    leftOut[i] = leftValue;
    rightOut[i] = rightValue;
    mid[i] = (leftValue + rightValue) * 0.5;
    side[i] = (leftValue - rightValue) * 0.5;
  }

  return { mid, left: leftOut, right: rightOut, side };
}

async function bandpassOffline(mono: Float32Array, sampleRate: number): Promise<Float32Array> {
  const offlineCtx = new OfflineAudioContext(1, mono.length, sampleRate);
  const inputBuffer = offlineCtx.createBuffer(1, mono.length, sampleRate);
  inputBuffer.getChannelData(0).set(mono);

  const source = offlineCtx.createBufferSource();
  source.buffer = inputBuffer;

  const highpass = offlineCtx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = MELODY_MIN_HZ;
  highpass.Q.value = 0.7;

  const lowpass = offlineCtx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = MELODY_MAX_HZ;
  lowpass.Q.value = 0.7;

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

function frameRms(data: Float32Array, offset: number): number {
  let sum = 0;
  const end = offset + FRAME_SIZE;
  for (let i = offset; i < end; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / FRAME_SIZE);
}

function lowFrequencyPenalty(hz: number): number {
  if (hz < 100) return 0.45;
  if (hz < 130) return 0.65;
  if (hz < 160) return 0.82;
  return 1;
}

function centerScoreForFrame(
  left: Float32Array,
  right: Float32Array | null,
  offset: number,
  source: PitchSourceName,
): number {
  if (!right) return 0.75;

  const leftRms = frameRms(left, offset);
  const rightRms = frameRms(right, offset);
  const sum = leftRms + rightRms;
  const balance = sum > 1e-6 ? 1 - Math.abs(leftRms - rightRms) / sum : 0;
  const balancedScore = clamp(0.45 + 0.55 * balance, 0.45, 1);

  if (source === 'mid') return clamp(balancedScore + 0.08, 0, 1);
  if (source === 'side') return clamp(balancedScore * 0.72, 0.25, 0.78);
  return balancedScore;
}

function collectPitchFramesForSource(
  filtered: Float32Array,
  filteredLeft: Float32Array,
  filteredRight: Float32Array | null,
  sampleRate: number,
  source: PitchSourceName,
): RawPitchFrame[] {
  const yin = YIN({ sampleRate, threshold: 0.1, probabilityThreshold: 0.1 });
  const pitchyDetector = PitchDetector.forFloat32Array(FRAME_SIZE);
  const frames: RawPitchFrame[] = [];

  for (let offset = 0; offset + FRAME_SIZE <= filtered.length; offset += HOP_SIZE) {
    const rms = frameRms(filtered, offset);
    if (rms < 1e-4) continue;

    const frame = filtered.subarray(offset, offset + FRAME_SIZE);
    const yinHz = yin(frame);
    if (yinHz === null || yinHz < MELODY_MIN_HZ || yinHz > MELODY_MAX_HZ) continue;

    const [pitchyHz, clarity] = pitchyDetector.findPitch(frame, sampleRate);
    if (pitchyHz === 0 || clarity < CLARITY_THRESHOLD) continue;
    if (pitchyHz < MELODY_MIN_HZ || pitchyHz > MELODY_MAX_HZ) continue;

    const disagreement = centsDistance(yinHz, pitchyHz);
    if (disagreement > DETECTOR_DISAGREEMENT_CENTS) continue;

    const centerScore = centerScoreForFrame(filteredLeft, filteredRight, offset, source);
    const agreementScore = clamp(1 - disagreement / DETECTOR_DISAGREEMENT_CENTS, 0, 1);
    const hz = Math.sqrt(yinHz * pitchyHz);
    const midi = hzToMidi(hz);
    const preliminaryScore =
      Math.sqrt(rms) *
      (0.3 + 0.7 * clarity) *
      (0.45 + 0.55 * centerScore) *
      (0.5 + 0.5 * agreementScore) *
      lowFrequencyPenalty(hz);

    frames.push({
      offset,
      timeSec: offset / sampleRate,
      hz,
      midi,
      noteBin: Math.round(midi),
      rms,
      clarity,
      centerScore,
      agreementScore,
      preliminaryScore,
      source,
    });
  }

  return frames;
}

function selectBestFramePerOffset(frames: RawPitchFrame[]): RawPitchFrame[] {
  const bestByOffset = new Map<number, RawPitchFrame>();

  for (const frame of frames) {
    const current = bestByOffset.get(frame.offset);
    if (!current || frame.preliminaryScore > current.preliminaryScore) {
      bestByOffset.set(frame.offset, frame);
    }
  }

  return [...bestByOffset.values()].sort((a, b) => a.offset - b.offset);
}

function scorePitchFrames(frames: RawPitchFrame[]): PitchFrame[] {
  if (frames.length === 0) return [];

  const rmsValues = frames.map((frame) => frame.rms).sort((a, b) => a - b);
  const rmsFloor = percentile(rmsValues, 0.35);
  const rmsCeil = percentile(rmsValues, 0.9);
  const dynamicRange = Math.max(rmsCeil - rmsFloor, 1e-6);

  return frames.map((frame) => {
    const energyScore = clamp((frame.rms - rmsFloor) / dynamicRange, 0, 1);
    const weight =
      (0.3 + 0.7 * frame.clarity) *
      (0.35 + 0.65 * energyScore) *
      (0.45 + 0.55 * frame.centerScore) *
      (0.5 + 0.5 * frame.agreementScore) *
      lowFrequencyPenalty(frame.hz);

    return { ...frame, energyScore, weight };
  });
}

function framesBelongToSameSegment(previous: PitchFrame, current: PitchFrame, hopSec: number): boolean {
  const gapSec = current.timeSec - previous.timeSec;
  if (gapSec > hopSec * 3) return false;

  const pitchDelta = centsDistance(previous.hz, current.hz);
  if (pitchDelta <= SEGMENT_CONTINUITY_CENTS) return true;

  return previous.noteBin === current.noteBin && pitchDelta <= DETECTOR_DISAGREEMENT_CENTS;
}

function scoreSegment(
  frames: PitchFrame[],
  rangeDurationSec: number,
  hopSec: number,
  frameDurationSec: number,
): PitchSegment {
  const totalWeight = frames.reduce((sum, frame) => sum + frame.weight, 0);
  const weightedLogHz =
    frames.reduce((sum, frame) => sum + Math.log(frame.hz) * frame.weight, 0) /
    Math.max(totalWeight, 1e-6);
  const hz = Math.exp(weightedLogHz);

  const meanClarity = frames.reduce((sum, frame) => sum + frame.clarity, 0) / frames.length;
  const meanCenter = frames.reduce((sum, frame) => sum + frame.centerScore, 0) / frames.length;
  const meanEnergy = frames.reduce((sum, frame) => sum + frame.energyScore, 0) / frames.length;
  const sourceCounts = new Map<PitchSourceName, number>();
  for (const frame of frames) {
    sourceCounts.set(frame.source, (sourceCounts.get(frame.source) ?? 0) + 1);
  }
  const dominantSource = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'mid';
  const pitchSpread =
    Math.sqrt(
      frames.reduce((sum, frame) => {
        const delta = centsDistance(frame.hz, hz);
        return sum + delta * delta * frame.weight;
      }, 0) / Math.max(totalWeight, 1e-6),
    );
  const stabilityScore = clamp(1 - pitchSpread / 100, 0, 1);

  const startSec = frames[0].timeSec;
  const endSec = frames[frames.length - 1].timeSec + frameDurationSec;
  const durationSec = endSec - startSec;
  const expectedFrames = Math.max(1, durationSec / hopSec);
  const densityScore = clamp(frames.length / expectedFrames, 0, 1);
  const earlyBoost = clamp(1.15 - 0.25 * (startSec / Math.max(rangeDurationSec, 1e-6)), 0.9, 1.15);
  const durationBoost = clamp(0.8 + durationSec / 0.25, 0.8, 1.4);

  const score =
    totalWeight *
    (0.55 + 0.45 * meanClarity) *
    (0.6 + 0.4 * densityScore) *
    (0.6 + 0.4 * stabilityScore) *
    (0.7 + 0.3 * meanCenter) *
    earlyBoost *
    durationBoost;

  return {
    startSec,
    endSec,
    durationSec,
    frameCount: frames.length,
    hz,
    score,
    meanClarity,
    meanCenter,
    meanEnergy,
    densityScore,
    stabilityScore,
    pitchSpreadCents: pitchSpread,
    dominantSource,
  };
}

function buildSegments(
  frames: PitchFrame[],
  rangeDurationSec: number,
  hopSec: number,
  frameDurationSec: number,
): PitchSegment[] {
  if (frames.length === 0) return [];

  const segments: PitchSegment[] = [];
  let currentSegment: PitchFrame[] = [frames[0]];

  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i];
    const prev = currentSegment[currentSegment.length - 1];

    if (framesBelongToSameSegment(prev, frame, hopSec)) {
      currentSegment.push(frame);
      continue;
    }

    segments.push(scoreSegment(currentSegment, rangeDurationSec, hopSec, frameDurationSec));
    currentSegment = [frame];
  }

  segments.push(scoreSegment(currentSegment, rangeDurationSec, hopSec, frameDurationSec));

  return segments.filter((segment) => segment.frameCount >= MIN_SEGMENT_FRAMES);
}

function analyzeFrames(frames: PitchFrame[], rangeDurationSec: number, sampleRate: number): PitchAnalysisResult {
  if (frames.length === 0) return { hz: null, frameCount: 0, segments: [] };

  const hopSec = HOP_SIZE / sampleRate;
  const frameDurationSec = FRAME_SIZE / sampleRate;
  const segments = buildSegments(frames, rangeDurationSec, hopSec, frameDurationSec).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.startSec - b.startSec;
  });

  const selectedHz = segments[0]?.hz ?? null;

  return {
    hz: selectedHz,
    frameCount: frames.length,
    segments: segments.slice(0, 5).map((segment, index) => ({
      ...segment,
      rank: index + 1,
      selected: index === 0,
    })),
  };
}

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function goertzelPower(data: Float32Array, offset: number, length: number, sampleRate: number, hz: number): number {
  const omega = 2 * Math.PI * hz / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let prev = 0;
  let prev2 = 0;

  for (let i = 0; i < length; i++) {
    const phase = i / Math.max(length - 1, 1);
    const windowed = data[offset + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase));
    const current = windowed + coeff * prev - prev2;
    prev2 = prev;
    prev = current;
  }

  return Math.max(prev2 * prev2 + prev * prev - coeff * prev * prev2, 0) / length;
}

function estimateSpectralCandidate(
  sources: Array<{ source: PitchSourceName; filtered: Float32Array }>,
  rangeDurationSec: number,
  sampleRate: number,
): PitchSegment | null {
  const sourceWeights: Record<PitchSourceName, number> = {
    mid: 1.08,
    left: 0.96,
    right: 0.96,
    side: 0.72,
    spectral: 1,
  };
  const minMidi = Math.ceil(hzToMidi(MELODY_MIN_HZ));
  const maxMidi = Math.floor(hzToMidi(MELODY_MAX_HZ));
  const scores = new Map<number, number>();
  let windowCount = 0;

  for (const { source, filtered } of sources) {
    if (filtered.length < SPECTRAL_FRAME_SIZE) continue;
    for (let offset = 0; offset + SPECTRAL_FRAME_SIZE <= filtered.length; offset += SPECTRAL_HOP_SIZE) {
      windowCount++;
      for (let midi = minMidi; midi <= maxMidi; midi++) {
        const hz = midiToHz(midi);
        let harmonicSum = 0;
        let harmonicWeight = 0;

        for (let harmonic = 1; harmonic <= 3; harmonic++) {
          const harmonicHz = hz * harmonic;
          if (harmonicHz > MELODY_MAX_HZ) break;
          const weight = 1 / harmonic;
          harmonicSum += goertzelPower(filtered, offset, SPECTRAL_FRAME_SIZE, sampleRate, harmonicHz) * weight;
          harmonicWeight += weight;
        }

        const score = harmonicWeight > 0 ? (harmonicSum / harmonicWeight) * sourceWeights[source] : 0;
        scores.set(midi, (scores.get(midi) ?? 0) + score);
      }
    }
  }

  if (scores.size === 0 || windowCount === 0) return null;

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [bestMidi, bestScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;
  const confidence = bestScore / Math.max(secondScore, bestScore * 0.2, 1e-12);
  if (bestScore <= 1e-10) return null;

  const hz = midiToHz(bestMidi);
  const confidenceScore = clamp((confidence - 1) / 0.35, 0, 1);

  return {
    startSec: 0,
    endSec: rangeDurationSec,
    durationSec: rangeDurationSec,
    frameCount: windowCount,
    hz,
    score: Math.log10(bestScore + 1e-12) + 12,
    meanClarity: confidenceScore,
    meanCenter: 0.5,
    meanEnergy: 1,
    densityScore: 1,
    stabilityScore: confidenceScore,
    pitchSpreadCents: 0,
    dominantSource: 'spectral',
  };
}

/**
 * Detects the main melody pitch in [startSec, endSec).
 * Center placement is treated as a soft signal rather than a hard filter so
 * off-center melodies can still win when they form the strongest stable run.
 */
export async function analyzePitchInRange(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
): Promise<PitchAnalysisResult> {
  const sampleRate = buffer.sampleRate;
  const start = Math.max(0, Math.floor(startSec * sampleRate));
  const end = Math.min(buffer.length, Math.floor(endSec * sampleRate));
  const rangeDurationSec = (end - start) / sampleRate;

  if (rangeDurationSec < MIN_RANGE_SEC) return { hz: null, frameCount: 0, segments: [] };

  const { mid, left, right, side } = extractMidSide(buffer, start, end);
  const [filteredMid, filteredLeft, filteredRight, filteredSide] = await Promise.all([
    bandpassOffline(mid, sampleRate),
    bandpassOffline(left, sampleRate),
    right ? bandpassOffline(right, sampleRate) : Promise.resolve(null),
    side ? bandpassOffline(side, sampleRate) : Promise.resolve(null),
  ]);
  const sources: Array<{ source: PitchSourceName; filtered: Float32Array }> = [
    { source: 'mid', filtered: filteredMid },
    { source: 'left', filtered: filteredLeft },
  ];
  if (filteredRight) sources.push({ source: 'right', filtered: filteredRight });
  if (filteredSide) sources.push({ source: 'side', filtered: filteredSide });

  const rawFrames = sources.flatMap(({ source, filtered }) =>
    collectPitchFramesForSource(filtered, filteredLeft, filteredRight, sampleRate, source),
  );
  const frames = scorePitchFrames(selectBestFramePerOffset(rawFrames));
  const timeDomainResult = analyzeFrames(frames, rangeDurationSec, sampleRate);
  if (timeDomainResult.hz !== null) return timeDomainResult;

  const spectralSources = sources.filter(({ source }) => source === 'mid');
  const spectralSegment = estimateSpectralCandidate(spectralSources, rangeDurationSec, sampleRate);
  if (!spectralSegment) return timeDomainResult;

  return {
    hz: spectralSegment.hz,
    frameCount: Math.max(frames.length, spectralSegment.frameCount),
    segments: [{
      ...spectralSegment,
      rank: 1,
      selected: true,
    }],
  };
}

export async function detectPitchInRange(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
): Promise<number | null> {
  return (await analyzePitchInRange(buffer, startSec, endSec)).hz;
}
