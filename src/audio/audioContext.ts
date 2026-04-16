let ctx: AudioContext | null = null;

/**
 * Get (or lazy-create) the shared AudioContext.
 * Safe to call at module level; actual audio only flows after resumeAudioContext().
 * The context starts in 'suspended' state until a user gesture triggers resume.
 */
export function getAudioContext(): AudioContext {
  if (!ctx) {
    // webkitAudioContext fallback for older iOS Safari
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AC = (window.AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext;
    ctx = new AC();
  }
  return ctx;
}

/**
 * Resume the AudioContext. Must be called from inside a user gesture on iOS Safari.
 * await this before starting oscillators or mic input.
 */
export async function resumeAudioContext(): Promise<void> {
  const c = getAudioContext();
  if (c.state === 'suspended') {
    await c.resume();
  }
}
