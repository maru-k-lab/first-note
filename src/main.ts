import './style.css';
import { decodeAudio, detectPitchInRange } from './audio/fileAnalyzer';
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

const fileStatus = document.getElementById('file-status')!;
const sectionWaveform = document.getElementById('section-waveform')!;

function setFileStatus(text: string, color: 'gray' | 'yellow' | 'red'): void {
  fileStatus.textContent = text;
  const colorClass = { gray: 'text-gray-500', yellow: 'text-yellow-400', red: 'text-red-400' }[color];
  fileStatus.className = `text-sm text-center mt-2 h-5 ${colorClass}`;
}

function setPlayRangeState(playing: boolean): void {
  document.getElementById('btn-play-range')!.classList.toggle('hidden', playing);
  document.getElementById('btn-stop-range')!.classList.toggle('hidden', !playing);
}

// Initialize mic/tuner displays first so the onPlay closure can safely reference them
const micDisplay = setupMicDisplay();
const tunerMeter = setupTunerMeter();

const waveform = setupWaveform('waveform-root');
const rangeSelector = setupRangeSelector({
  rootId: 'waveform-root',
  onChange({ startSec, endSec }) {
    waveform.setSelection(startSec, endSec);
    // ドラッグ中に区間再生中なら止める
    if (player.isPlaying) {
      player.stop();
      setPlayRangeState(false);
    }
  },
});

const refDisplay = setupReferenceDisplay({
  async onPlay() {
    if (!referenceHz) return;
    try {
      // iOS Safari requires AudioContext.resume() inside a user gesture handler
      // 区間再生を止めてから基準音を再生する
      player.stop();
      setPlayRangeState(false);
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
      const msg = err instanceof Error ? err.message : String(err);
      const isDenied = msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('notallowed');
      setFileStatus(isDenied ? 'マイクの許可が必要です' : 'マイクを起動できませんでした', 'red');
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

// 区間再生
document.getElementById('btn-play-range')!.addEventListener('click', async () => {
  if (!currentBuffer) return;
  const range = rangeSelector.getRange();
  if (range.endSec - range.startSec < 0.01) return;
  try {
    // 基準音・マイク再生中なら止める
    oscillator.stop();
    mic.stop();
    refDisplay.setPlayState(false);
    micDisplay.hide();
    tunerMeter.hide();
    await resumeAudioContext();
    player.start(currentBuffer, {
      ...range,
      onEnded: () => setPlayRangeState(false),
    });
    setPlayRangeState(true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setFileStatus(`エラー: ${msg}`, 'red');
  }
});

document.getElementById('btn-stop-range')!.addEventListener('click', () => {
  player.stop();
  // onEnded 経由で setPlayRangeState(false) が呼ばれる
});

// 解析実行
document.getElementById('btn-analyze')!.addEventListener('click', () => {
  if (!currentBuffer) return;
  player.stop();
  setPlayRangeState(false);
  setFileStatus('', 'gray');
  const { startSec, endSec } = rangeSelector.getRange();
  const hz = detectPitchInRange(currentBuffer, startSec, endSec);

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
    player.stop();
    refDisplay.setPlayState(false);
    micDisplay.hide();
    tunerMeter.hide();
    setPlayRangeState(false);
    refDisplay.hide();

    try {
      currentBuffer = await decodeAudio(file);
    } catch {
      setFileStatus('対応していないファイル形式です', 'red');
      currentBuffer = null;
      sectionWaveform.classList.add('hidden');
      return;
    }

    waveform.render(currentBuffer);
    rangeSelector.reset(currentBuffer.duration);
    sectionWaveform.classList.remove('hidden');
    referenceHz = null;
    setFileStatus(file.name, 'gray');
  },
});
