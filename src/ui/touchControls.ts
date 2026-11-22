/**
 * Touch driving controls.
 *
 * The race session reads KeyboardEvents from `window`, so the on-screen pads
 * synthesise the same events rather than duplicating the input path. Pointer
 * capture keeps a button held while a thumb slides, and every exit path
 * releases the key so a dropped touch cannot leave the throttle stuck open.
 *
 * The same mechanism covers the camera, car-data and recover buttons, which
 * are otherwise keyboard-only and unreachable on a phone.
 */
const KEY_NAMES: Record<string, string> = { KeyA: 'a', KeyD: 'd', KeyS: 's', KeyW: 'w' };

export function bindTouchControls(): void {
  const buttons = [
    ...document.querySelectorAll<HTMLButtonElement>('#touch-controls [data-touch-key]'),
    ...document.querySelectorAll<HTMLButtonElement>('#touch-tools [data-touch-key]'),
  ];
  if (!buttons.length) return;

  const held = new Map<number, HTMLButtonElement>();

  const emit = (type: 'keydown' | 'keyup', code: string): void => {
    window.dispatchEvent(
      new KeyboardEvent(type, {
        code,
        key: KEY_NAMES[code] ?? code.replace(/^Key/, '').toLowerCase(),
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  const press = (button: HTMLButtonElement, pointerId: number): void => {
    const code = button.dataset.touchKey;
    if (!code || held.has(pointerId)) return;
    held.set(pointerId, button);
    button.classList.add('active');
    emit('keydown', code);
  };

  const release = (pointerId: number): void => {
    const button = held.get(pointerId);
    if (!button) return;
    held.delete(pointerId);
    button.classList.remove('active');
    const code = button.dataset.touchKey;
    if (code) emit('keyup', code);
  };

  const releaseAll = (): void => {
    for (const id of [...held.keys()]) release(id);
  };

  for (const button of buttons) {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // The pointer can already be gone; the pad still works without capture.
      }
      press(button, event.pointerId);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      button.addEventListener(type, (event) => release(event.pointerId));
    }
  }

  // A backgrounded tab or a system gesture must not leave a pedal held down.
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') releaseAll();
  });
}
