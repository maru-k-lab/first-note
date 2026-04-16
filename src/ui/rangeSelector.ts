export interface Range {
  startSec: number;
  endSec: number;
}

export interface RangeSelectorOptions {
  rootId: string;
  onChange: (range: Range) => void;
  onChangeEnd?: (range: Range) => void;
}

export interface RangeSelector {
  reset(duration: number, initial?: Range): void;
  getRange(): Range;
  disable(disabled: boolean): void;
}

const MIN_RANGE_SEC = 0.05; // YIN 最低要件: 50ms
const STEP_SEC = 0.01;      // 矢印キー: 10ms
const STEP_LARGE_SEC = 0.1; // Shift+矢印: 100ms

export function setupRangeSelector(opts: RangeSelectorOptions): RangeSelector {
  const root = document.getElementById(opts.rootId)!;
  const handleStart = root.querySelector<HTMLElement>('[data-handle-start]')!;
  const handleEnd = root.querySelector<HTMLElement>('[data-handle-end]')!;
  const rangeText = document.getElementById('range-text')!;

  let duration = 1;
  let startSec = 0;
  let endSec = Math.min(0.75, duration);
  let dragging: 'start' | 'end' | null = null;
  let disabled = false;

  function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
  }

  function secToLeft(sec: number): string {
    const rect = root.getBoundingClientRect();
    return `${(sec / duration) * rect.width}px`;
  }

  function updatePositions(): void {
    handleStart.style.left = secToLeft(startSec);
    handleEnd.style.left = secToLeft(endSec);

    // ARIA
    handleStart.setAttribute('aria-valuenow', startSec.toFixed(2));
    handleStart.setAttribute('aria-valuemin', '0');
    handleStart.setAttribute('aria-valuemax', duration.toFixed(2));
    handleEnd.setAttribute('aria-valuenow', endSec.toFixed(2));
    handleEnd.setAttribute('aria-valuemin', '0');
    handleEnd.setAttribute('aria-valuemax', duration.toFixed(2));

    // テキスト表示
    const len = endSec - startSec;
    rangeText.textContent = `${startSec.toFixed(2)}s – ${endSec.toFixed(2)}s (${len.toFixed(2)}s)`;
  }

  function notify(): void {
    opts.onChange({ startSec, endSec });
    updatePositions();
  }

  // PointerEvent ハンドラ
  function onPointerDown(e: PointerEvent, handle: 'start' | 'end'): void {
    if (disabled) return;
    e.preventDefault();
    dragging = handle;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || disabled) return;
    const rect = root.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const sec = (x / rect.width) * duration;

    if (dragging === 'start') {
      startSec = clamp(sec, 0, endSec - MIN_RANGE_SEC);
    } else {
      endSec = clamp(sec, startSec + MIN_RANGE_SEC, duration);
    }
    notify();
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    dragging = null;
    opts.onChangeEnd?.({ startSec, endSec });
  }

  // ハンドルにイベント登録
  handleStart.addEventListener('pointerdown', (e) => onPointerDown(e, 'start'));
  handleEnd.addEventListener('pointerdown', (e) => onPointerDown(e, 'end'));
  handleStart.addEventListener('pointermove', onPointerMove);
  handleEnd.addEventListener('pointermove', onPointerMove);
  handleStart.addEventListener('pointerup', onPointerUp);
  handleEnd.addEventListener('pointerup', onPointerUp);
  handleStart.addEventListener('pointercancel', onPointerUp);
  handleEnd.addEventListener('pointercancel', onPointerUp);

  // キーボード操作
  function onKeyDown(e: KeyboardEvent, handle: 'start' | 'end'): void {
    if (disabled) return;
    const step = e.shiftKey ? STEP_LARGE_SEC : STEP_SEC;
    let changed = false;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      if (handle === 'start') {
        startSec = clamp(startSec - step, 0, endSec - MIN_RANGE_SEC);
      } else {
        endSec = clamp(endSec - step, startSec + MIN_RANGE_SEC, duration);
      }
      changed = true;
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      if (handle === 'start') {
        startSec = clamp(startSec + step, 0, endSec - MIN_RANGE_SEC);
      } else {
        endSec = clamp(endSec + step, startSec + MIN_RANGE_SEC, duration);
      }
      changed = true;
    }

    if (changed) {
      e.preventDefault();
      notify();
      opts.onChangeEnd?.({ startSec, endSec });
    }
  }

  handleStart.addEventListener('keydown', (e) => onKeyDown(e, 'start'));
  handleEnd.addEventListener('keydown', (e) => onKeyDown(e, 'end'));

  // ResizeObserver でリサイズ時に位置再計算
  const ro = new ResizeObserver(() => {
    updatePositions();
  });
  ro.observe(root);

  return {
    reset(dur: number, initial?: Range): void {
      duration = dur;
      startSec = initial?.startSec ?? 0;
      endSec = initial?.endSec ?? Math.min(0.75, dur);
      updatePositions();
      notify();
    },

    getRange(): Range {
      return { startSec, endSec };
    },

    disable(d: boolean): void {
      disabled = d;
      handleStart.style.pointerEvents = d ? 'none' : 'auto';
      handleEnd.style.pointerEvents = d ? 'none' : 'auto';
    },
  };
}
