// app.js — AURA Music | Main Entry Point & Orchestrator
// This is the ONLY file imported by index.html (as type="module").
// It initialises everything in the right order and connects modules.

// ─── ИСПРАВЛЕНИЕ #1 ───────────────────────────────────────────────────────────
// STORAGE_KEY живёт в constants.js, а НЕ в utils.js.
// Старый импорт вызывал SyntaxError при парсинге модуля — до выполнения
// любого кода — поэтому boot() никогда не вызывался и сплеш висел вечно.
// ─────────────────────────────────────────────────────────────────────────────

import { initUI } from './ui.js';
import { dispatch, getState, select, selectors } from './store.js';
import audioPlayer from './player.js';
import {
  ACTION,
  SCREEN,
  HAPTIC,
  ERROR_MSG,
  STORAGE_KEY,          // ← теперь правильно: из constants.js
} from './constants.js';
import {
  isTelegram,
  getTelegramUser,
  getTelegramTheme,
  haptic,
  storageGet,
  // STORAGE_KEY здесь больше нет — он не экспортируется из utils.js
} from './utils.js';

// ─── Boot Sequence ────────────────────────────────────────────────────────────

async function boot() {
  try {
    // 1. Telegram WebApp integration
    initTelegramWebApp();

    // 2. Restore persistent UI state
    restorePersistedState();

    // 3. Initialise DOM / UI bindings
    initUI();

    // 4. Bind global error handler
    bindGlobalErrorHandlers();

    // 5. Bind app-level keyboard shortcuts
    bindKeyboardShortcuts();

    // 6. Mark app as ready
    document.body.classList.add('app--ready');
    document.querySelector('#splash')?.classList.add('splash--hidden');

    // 7. Set initial screen
    dispatch({ type: ACTION.SET_SCREEN, payload: SCREEN.HOME });

    console.info('[AURA] 🎵 App booted successfully');
  } catch (err) {
    console.error('[AURA] Boot failed:', err);
    showFatalError(err);
  }
}

// ─── Telegram WebApp Init ─────────────────────────────────────────────────────

function initTelegramWebApp() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    console.info('[AURA] Running outside Telegram — haptics and MainButton unavailable.');
    return;
  }

  // Tell Telegram the app is ready
  tg.ready();
  tg.expand();

  // Apply Telegram theme colors to CSS variables
  const theme = getTelegramTheme();
  if (theme.colorScheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }

  // Handle back button (Telegram in-app back)
  tg.BackButton.onClick(() => {
    const { playerSize, screen } = getState();
    if (playerSize === 'full') {
      import('./ui.js').then(({ collapsePlayer }) => collapsePlayer());
    } else if (screen !== SCREEN.HOME) {
      dispatch({ type: ACTION.SET_SCREEN, payload: SCREEN.HOME });
    } else {
      tg.close();
    }
  });

  // Show back button when not on home
  select(selectors.screen, (screen) => {
    if (isTelegram()) {
      if (screen !== SCREEN.HOME) {
        tg.BackButton.show();
      } else {
        tg.BackButton.hide();
      }
    }
  });

  // Log user info (for analytics / Pro verification)
  const user = getTelegramUser();
  if (user) {
    console.info(`[AURA] User: ${user.first_name} (@${user.username || 'N/A'})`);
  }

  // Set viewport safe areas from Telegram
  if (tg.viewportStableHeight) {
    document.documentElement.style.setProperty(
      '--tg-viewport-height',
      `${tg.viewportStableHeight}px`
    );
  }

  tg.onEvent('viewportChanged', ({ isStateStable }) => {
    if (isStateStable) {
      document.documentElement.style.setProperty(
        '--tg-viewport-height',
        `${tg.viewportStableHeight}px`
      );
    }
  });
}

// ─── Restore Persisted State ──────────────────────────────────────────────────

function restorePersistedState() {
  // Volume is restored in store initialState from storageGet.
  // Repeat / shuffle are already restored in store.
  // Pro status is restored in store.
  // Nothing else to restore at boot — store handles it.
}

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ignore if focused in an input
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        audioPlayer.toggle();
        haptic(HAPTIC.MEDIUM);
        break;

      case 'ArrowRight':
      case 'l':
        e.preventDefault();
        audioPlayer.seekRelative(10);
        break;

      case 'ArrowLeft':
      case 'j':
        e.preventDefault();
        audioPlayer.seekRelative(-10);
        break;

      case 'ArrowUp':
        e.preventDefault();
        audioPlayer.setVolume(getState().volume + 0.05);
        break;

      case 'ArrowDown':
        e.preventDefault();
        audioPlayer.setVolume(getState().volume - 0.05);
        break;

      case 'n':
        audioPlayer.next();
        break;

      case 'p':
        audioPlayer.prev();
        break;

      case 'm':
        audioPlayer.setVolume(getState().volume > 0 ? 0 : 0.85);
        break;
    }
  });
}

// ─── Global Error Handling ────────────────────────────────────────────────────

function bindGlobalErrorHandlers() {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[AURA] Unhandled promise rejection:', event.reason);
    // Only show toast for known app errors, not third-party noise
    if (event.reason?.message?.includes('audio') || event.reason?.message?.includes('API')) {
      dispatch({
        type: ACTION.SHOW_TOAST,
        payload: { message: event.reason.message || ERROR_MSG.GENERIC, type: 'error' }
      });
    }
  });

  window.addEventListener('error', (event) => {
    console.error('[AURA] Uncaught error:', event.error);
  });

  // Handle offline/online
  window.addEventListener('offline', () => {
    dispatch({
      type: ACTION.SHOW_TOAST,
      payload: { message: '📡 You\'re offline', type: 'warning' }
    });
  });

  window.addEventListener('online', () => {
    dispatch({
      type: ACTION.SHOW_TOAST,
      payload: { message: '✅ Back online', type: 'success' }
    });
  });
}

// ─── Fatal Error Screen ───────────────────────────────────────────────────────

function showFatalError(err) {
  // Этот экран рендерится только если boot() бросил исключение.
  // После исправления импортов это не должно происходить в штатном режиме.
  const stackLine = err?.stack?.split('\n')[1]?.trim() || '';
  document.body.innerHTML = `
    <div style="
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:100vh;background:#0a0a0a;color:#fff;font-family:sans-serif;
      padding:24px;text-align:center;
    ">
      <span style="font-size:48px;margin-bottom:16px;">🎵</span>
      <h1 style="font-size:20px;margin-bottom:8px;">AURA couldn't start</h1>
      <p style="color:#888;font-size:14px;margin-bottom:4px;">${err?.message || 'Unknown error'}</p>
      <p style="color:#555;font-size:11px;font-family:monospace;margin-bottom:24px;">${stackLine}</p>
      <button
        onclick="location.reload()"
        style="background:#e94560;color:#fff;border:none;padding:12px 28px;
          border-radius:999px;font-size:16px;cursor:pointer;"
      >Retry</button>
    </div>
  `;
}

// ─── Go ───────────────────────────────────────────────────────────────────────

// DOMContentLoaded is already fired when ES modules execute,
// but we guard just in case.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
