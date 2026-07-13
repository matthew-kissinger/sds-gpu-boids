import './styles.css';
import { Game } from './game/Game';

function showStartupError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const overlay = document.querySelector<HTMLElement>('#game-overlay');
  const kicker = document.querySelector<HTMLElement>('#overlay-kicker');
  const title = document.querySelector<HTMLElement>('#overlay-title');
  const body = document.querySelector<HTMLElement>('#overlay-body');
  const retry = document.querySelector<HTMLButtonElement>('#overlay-primary');
  const secondary = document.querySelector<HTMLButtonElement>('#overlay-secondary');
  if (overlay && kicker && title && body && retry && secondary) {
    overlay.dataset.state = 'error';
    overlay.hidden = false;
    kicker.textContent = 'WEBGPU REQUIRED';
    title.textContent = 'GPU flock could not start';
    body.textContent = `${message} Use a current browser with hardware WebGPU enabled.`;
    retry.textContent = 'Retry';
    retry.hidden = false;
    retry.addEventListener('click', () => window.location.reload(), { once: true });
    secondary.hidden = true;
    retry.focus({ preventScroll: true });
  }
  window.__THREE_GAME_DIAGNOSTICS__ = {
    status: 'error',
    unsupported: true,
    error: message,
  };
}

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
  if (!canvas) throw new Error('Missing #game-canvas element.');

  const game = await Game.create(canvas);
  game.start();

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      game.dispose();
    });
  }
}

bootstrap().catch((error) => {
  console.warn(error);
  showStartupError(error);
});
