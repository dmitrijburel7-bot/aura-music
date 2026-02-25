// ui/toast.js — AURA Music | Toast Notification Engine
// Subscribes to store.toast selector. Manages its own timer and animations.

import { select, dispatch, selectors } from '../store.js';
import { toastEnter, toastExit } from '../animations.js';
import { qs } from '../utils.js';
import { ACTION, ANIM } from '../constants.js';

let _el = null;
let _timer = null;

export function initToast() {
  _el = qs('#toast');
  if (!_el) return;

  select(selectors.toast, (toast) => {
    if (toast) _show(toast);
  });
}

export function showToast(message, type = 'info') {
  dispatch({ type: ACTION.SHOW_TOAST, payload: { message, type } });
}

function _show({ message, type }) {
  if (!_el) return;

  clearTimeout(_timer);

  _el.className = `toast toast--${type}`;
  _el.textContent = message;
  _el.style.display = 'block';
  _el.style.transform = 'translateY(80px) translateX(-50%)';
  _el.style.opacity = '0';

  requestAnimationFrame(() => {
    toastEnter(_el);
    _timer = setTimeout(async () => {
      await toastExit(_el);
      _el.style.display = 'none';
      dispatch({ type: ACTION.HIDE_TOAST });
    }, ANIM.TOAST_DURATION);
  });
}
