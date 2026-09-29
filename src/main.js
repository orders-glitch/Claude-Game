import { Game } from './game.js';

const canvas = document.getElementById('game');

function fail(err) {
  console.error(err);
  const t = document.getElementById('load-text');
  if (t) {
    t.innerHTML = 'The powder is damp — this browser could not start the game.<br><small>' +
      String(err && err.message ? err.message : err) + '</small><br><small>A browser with WebGL 2 (recent Chrome, Edge, Firefox or Safari) is required.</small>';
  }
}

try {
  const test = document.createElement('canvas').getContext('webgl2');
  if (!test) throw new Error('WebGL 2 is not available.');
  const game = new Game(canvas);
  window.__game = game;
  game.init().catch(fail);
} catch (e) {
  fail(e);
}
