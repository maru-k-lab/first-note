import './style.css';
import { analyzePitchInRange, decodeAudio } from './audio/fileAnalyzer';
import type { PitchAnalysisResult } from './audio/fileAnalyzer';
import { AudioPlayer } from './audio/audioPlayer';
import { ReferenceOscillator } from './audio/oscillator';
import { MicrophoneAnalyzer } from './audio/microphone';
import { resumeAudioContext } from './audio/audioContext';
import { frequencyToNote } from './utils/pitchToNote';
import { centsBetween } from './utils/centCalculation';
import { setupFileInput } from './ui/fileInput';
import { setupReferenceDisplay } from './ui/referenceDisplay';
import { setupMicDisplay } from './ui/micDisplay';
import { setupTunerMeter } from './ui/tunerMeter';
import { setupWaveform } from './ui/waveform';
import { setupRangeSelector } from './ui/rangeSelector';

// --- App state ---
const oscillator = new ReferenceOscillator();
const mic = new MicrophoneAnalyzer();
const player = new AudioPlayer();
let currentBuffer: AudioBuffer | null = null;
let referenceHz: number | null = null;
let currentFileName = '';
let isRangeLooping = false;
let rangeRestartRaf: number | null = null;

const fileStatus = document.getElementById('file-status')!;
const sectionWaveform = document.getElementById('section-waveform')!;
const sectionAnalysis = document.getElementById('section-analysis')!;
const analysisSummary = document.getElementById('analysis-summary')!;
const candidateList = document.getElementById('candidate-list')!;

function setFileStatus(text: string, color: 'gray' | 'yellow' | 'red'): void {
  fileStatus.textContent = text;
  const colorClass = { gray: 'text-gray-500', yellow: 'text-yellow-400', red: 'text-red-400' }[color];
  fileStatus.className = `text-sm text-center mt-2 h-5 ${colorClass}`;
}

function stopRangePlayback(): void {
  isRangeLooping = false;
  if (rangeRestartRaf !== null) {
    cancelAnimationFrame(rangeRestartRaf);
    rangeRestartRaf = null;
  }
  player.stop();
}

function stopReferenceTone(): void {
  oscillator.stop();
  mic.stop();
  refDisplay.setPlayState(false);
  micDisplay.hide();
  tunerMeter.hide();
}

function playCurrentRangeLoop(): void {
  if (!currentBuffer) return;
  const range = rangeSelector.getRange();
  if (range.endSec - range.startSec < 0.01) return;

  player.start(currentBuffer, {
    ...range,
    loop: true,
  });
}

function scheduleRangeLoopRestart(): void {
  if (!isRangeLooping) return;
  if (rangeRestartRaf !== null) cancelAnimationFrame(rangeRestartRaf);
  rangeRestartRaf = requestAnimationFrame(() => {
    rangeRestartRaf = null;
    playCurrentRangeLoop();
  });
}

async function startAutoRangeLoop(): Promise<void> {
  if (!currentBuffer) return;
  try {
    stopReferenceTone();
    if (isRangeLooping) return;
    await resumeAudioContext();
    isRangeLooping = true;
    playCurrentRangeLoop();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setFileStatus(`エラー: ${msg}`, 'red');
  }
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatSeconds(value: number): string {
  return `${value.toFixed(2)}s`;
}

function hideAnalysis(): void {
  sectionAnalysis.classList.add('hidden');
  analysisSummary.textContent = '';
  candidateList.replaceChildren();
}

function getMicrophoneErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'マイクを起動できませんでした';

  if (err.message === 'MIC_REQUIRES_SECURE_CONTEXT') {
    return 'マイクは http://localhost または HTTPS で開いてください。IPアドレスのHTTPでは使えません';
  }

  if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
    return 'マイクの許可が必要です';
  }

  if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
    return 'マイクが見つかりません';
  }

  if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
    return 'マイクが他のアプリで使用中です';
  }

  return `マイクを起動できませんでした: ${err.name || err.message}`;
}

function renderAnalysis(result: PitchAnalysisResult, startSec: number, endSec: number): void {
  candidateList.replaceChildren();
  sectionAnalysis.classList.remove('hidden');

  if (result.hz === null) {
    analysisSummary.textContent =
      `${formatSeconds(startSec)}-${formatSeconds(endSec)} / 有効フレーム ${result.frameCount} / 採用なし`;
    return;
  }

  const { label } = frequencyToNote(result.hz);
  analysisSummary.textContent =
    `${formatSeconds(startSec)}-${formatSeconds(endSec)} / 採用 ${label} ${result.hz.toFixed(1)}Hz / 有効フレーム ${result.frameCount}`;

  for (const segment of result.segments) {
    const note = frequencyToNote(segment.hz).label;
    const row = document.createElement('div');
    row.className = [
      'rounded-lg border p-3 text-xs tabular-nums',
      segment.selected ? 'border-indigo-400 bg-indigo-500/10' : 'border-gray-800 bg-gray-950/60',
    ].join(' ');

    const title = document.createElement('div');
    title.className = 'flex items-center justify-between gap-3 text-sm';

    const name = document.createElement('span');
    name.className = 'font-medium text-gray-100';
    name.textContent = `${segment.rank}. ${note} ${segment.hz.toFixed(1)}Hz`;

    const score = document.createElement('span');
    score.className = segment.selected ? 'text-indigo-200' : 'text-gray-400';
    score.textContent = `score ${segment.score.toFixed(2)}`;

    title.append(name, score);

    const detail = document.createElement('div');
    detail.className = 'mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-gray-400';
    const details = [
      `${formatSeconds(startSec + segment.startSec)}-${formatSeconds(startSec + segment.endSec)}`,
      `${segment.frameCount} frames`,
      `energy ${formatPercent(segment.meanEnergy)}`,
      `center ${formatPercent(segment.meanCenter)}`,
      `clarity ${formatPercent(segment.meanClarity)}`,
      `stable ${formatPercent(segment.stabilityScore)}`,
      `density ${formatPercent(segment.densityScore)}`,
      `spread ${Math.round(segment.pitchSpreadCents)}c`,
      `source ${segment.dominantSource}`,
    ];

    for (const text of details) {
      const item = document.createElement('span');
      item.textContent = text;
      detail.append(item);
    }

    row.append(title, detail);
    candidateList.append(row);
  }
}

// Initialize mic/tuner displays first so the onPlay closure can safely reference them
const micDisplay = setupMicDisplay();
const tunerMeter = setupTunerMeter();

const waveform = setupWaveform('waveform-root');
const rangeSelector = setupRangeSelector({
  rootId: 'waveform-root',
  onChange({ startSec, endSec }) {
    waveform.setSelection(startSec, endSec);
    scheduleRangeLoopRestart();
  },
  onUserChange() {
    void startAutoRangeLoop();
  },
});

const refDisplay = setupReferenceDisplay({
  async onPlay() {
    if (!referenceHz) return;
    try {
      // iOS Safari requires AudioContext.resume() inside a user gesture handler
      // 区間再生を止めてから基準音を再生する
      stopRangePlayback();
      await resumeAudioContext();
      oscillator.start(referenceHz);
      await mic.start((hz) => {
        micDisplay.update(hz);
        tunerMeter.setCents(hz !== null ? centsBetween(hz, referenceHz!) : null);
      });
      refDisplay.setPlayState(true);
      micDisplay.show();
      tunerMeter.show();
    } catch (err) {
      // マイク起動失敗時は oscillator も止めてクリーンな状態に戻す
      oscillator.stop();
      setFileStatus(getMicrophoneErrorMessage(err), 'red');
    }
  },
  onStop() {
    oscillator.stop();
    mic.stop();
    refDisplay.setPlayState(false);
    micDisplay.hide();
    tunerMeter.hide();
  },
  onVolumeChange(value) {
    oscillator.setVolume(value);
  },
});

// 解析実行
document.getElementById('btn-analyze')!.addEventListener('click', async () => {
  if (!currentBuffer) return;
  // 基準音・区間再生いずれも止めてクリーンな状態で解析する
  stopReferenceTone();
  stopRangePlayback();
  setFileStatus('解析中...', 'gray');
  const { startSec, endSec } = rangeSelector.getRange();
  const analysis = await analyzePitchInRange(currentBuffer, startSec, endSec);
  renderAnalysis(analysis, startSec, endSec);
  const hz = analysis.hz;

  if (hz === null || hz < 20 || hz > 20000) {
    setFileStatus('この区間ではピッチを検出できませんでした', 'yellow');
    return;
  }

  referenceHz = hz;
  const { label } = frequencyToNote(hz);
  refDisplay.showNote(label, hz);
  setFileStatus(currentFileName, 'gray');
});

setupFileInput({
  async onFile(file) {
    setFileStatus('読み込み中...', 'gray');
    currentFileName = file.name;

    // 全停止
    oscillator.stop();
    mic.stop();
    stopRangePlayback();
    refDisplay.setPlayState(false);
    micDisplay.hide();
    tunerMeter.hide();
    refDisplay.hide();
    hideAnalysis();

    try {
      currentBuffer = await decodeAudio(file);
    } catch {
      setFileStatus('対応していないファイル形式です', 'red');
      currentBuffer = null;
      sectionWaveform.classList.add('hidden');
      hideAnalysis();
      return;
    }

    waveform.render(currentBuffer);
    rangeSelector.reset(currentBuffer.duration);
    sectionWaveform.classList.remove('hidden');
    referenceHz = null;
    setFileStatus(file.name, 'gray');
  },
});
