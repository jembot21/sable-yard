// input.js — keyboard and mouse for the player: pointer-lock mouse look,
// WASD movement, and one-shot action flags the simulation consumes (fire is
// level-triggered, jump/reload/throw are edge-triggered). Nothing here knows
// the rules; player.js reads this state each fixed step.

export const input = {
  keys: new Set(),
  yaw: 0, pitch: 0,
  firing: false,
  aiming: false,       // right mouse held (scope / tight aim)
  locked: false,
  jumpPressed: false,
  reloadPressed: false,
  interactPressed: false,
  throwPressed: false,
  slotPressed: 0,      // 1 primary, 2 sidearm, 3 grenade cycle — 0 = none
  buyPressed: false,
  scorePressed: false,
};

const SENS = 0.0021;

export function bindInput(canvas, onFirstGesture) {
  canvas.addEventListener('click', () => {
    if (!input.locked) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (input.locked && onFirstGesture) onFirstGesture();
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.yaw -= e.movementX * SENS;
    input.pitch -= e.movementY * SENS;
    const lim = 1.45;
    input.pitch = Math.max(-lim, Math.min(lim, input.pitch));
  });
  document.addEventListener('mousedown', (e) => {
    if (!input.locked) return;
    if (e.button === 0) input.firing = true;
    if (e.button === 2) input.aiming = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    if (e.code === 'Space') { input.jumpPressed = true; e.preventDefault(); }
    if (e.code === 'KeyR') input.reloadPressed = true;
    if (e.code === 'KeyE') input.interactPressed = true;
    if (e.code === 'KeyG') input.throwPressed = true;
    if (e.code === 'KeyB') input.buyPressed = true;
    if (e.code === 'Tab') { input.scorePressed = true; e.preventDefault(); }
    if (e.code === 'Digit1') input.slotPressed = 1;
    if (e.code === 'Digit2') input.slotPressed = 2;
    if (e.code === 'Digit3') input.slotPressed = 3;
  });
  window.addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
    if (e.code === 'Tab') input.scorePressed = false;
  });
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.firing = false;
    input.aiming = false;
  });
}

// Consume the edge-triggered flags once the simulation has read them.
export function endStepInput() {
  input.jumpPressed = false;
  input.reloadPressed = false;
  input.interactPressed = false;
  input.throwPressed = false;
  input.slotPressed = 0;
  input.buyPressed = false;
}

export function moveAxes() {
  const f = (input.keys.has('KeyW') ? 1 : 0) - (input.keys.has('KeyS') ? 1 : 0);
  const r = (input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('KeyA') ? 1 : 0);
  return { f, r };
}

export function wantsCrouch() {
  return input.keys.has('ControlLeft') || input.keys.has('KeyC');
}

export function wantsSprint() {
  return input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
}
