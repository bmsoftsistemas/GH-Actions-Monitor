/**
 * Toca bipes curtos sintetizados via Web Audio (sem depender de nenhum
 * arquivo de som) — janela oculta, dedicada só a isso, pra funcionar mesmo
 * com a janela de configurações fechada.
 */

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function tone(freq, duration, startDelay, type, gain) {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);

  const startTime = ctx.currentTime + startDelay;
  const stopTime = startTime + duration;
  gainNode.gain.setValueAtTime(gain, startTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, stopTime);
  osc.start(startTime);
  osc.stop(stopTime + 0.05);
}

function playSuccess() {
  // dois tons curtos e suaves, subindo — discreto
  tone(880, 0.12, 0, "sine", 0.12);
  tone(1174.66, 0.16, 0.09, "sine", 0.12);
}

function playFailure() {
  // dois tons graves em "quadrada", mais chamativo
  tone(220, 0.18, 0, "square", 0.18);
  tone(174.61, 0.24, 0.18, "square", 0.18);
}

window.audioAPI.onPlay((kind) => {
  if (kind === "success") playSuccess();
  else if (kind === "failure") playFailure();
});
