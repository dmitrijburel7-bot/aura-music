// components/modal.js — AURA Music | Modal System + Pro Upgrade Flow
// Renders modals, manages open/close lifecycle, communicates with store only via callbacks.

import { openModal, closeModal } from '../animations.js';
import { createElement, haptic, isTelegram } from '../utils.js';
import { PRO, HAPTIC, ACTION } from '../constants.js';
import { dispatch, getState } from '../store.js';

// ─── Modal Manager ────────────────────────────────────────────────────────────

class ModalManager {
  #currentModal = null;
  #backdrop = null;
  #isClosing = false;

  constructor() {
    this.#backdrop = createElement('div', { className: 'modal-backdrop' });
    document.body.appendChild(this.#backdrop);

    // Close on backdrop click
    this.#backdrop.addEventListener('click', (e) => {
      if (e.target === this.#backdrop) this.close();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.#currentModal) this.close();
    });
  }

  /**
   * Open a modal with given content element.
   * @param {HTMLElement} contentEl
   * @param {object} options
   */
  async open(contentEl, options = {}) {
    if (this.#currentModal) await this.close();

    this.#currentModal = contentEl;
    this.#backdrop.appendChild(contentEl);
    this.#backdrop.style.display = 'flex';

    requestAnimationFrame(() => {
      this.#backdrop.style.pointerEvents = 'auto';
      openModal(contentEl, this.#backdrop);
    });

    haptic(HAPTIC.LIGHT);

    if (options.onOpen) options.onOpen();
  }

  /**
   * Close the currently open modal.
   */
  async close() {
    if (!this.#currentModal || this.#isClosing) return;
    this.#isClosing = true;
    haptic(HAPTIC.LIGHT);

    await closeModal(this.#currentModal, this.#backdrop);

    this.#backdrop.style.display = 'none';
    this.#backdrop.style.pointerEvents = 'none';

    if (this.#currentModal.parentNode === this.#backdrop) {
      this.#backdrop.removeChild(this.#currentModal);
    }

    this.#currentModal = null;
    this.#isClosing = false;
  }

  isOpen() {
    return !!this.#currentModal;
  }
}

export const modalManager = new ModalManager();

// ─── Generic Modal Builder ────────────────────────────────────────────────────

/**
 * Create and open a generic modal.
 * @param {object} options
 * @param {string} options.title
 * @param {HTMLElement|string} options.content
 * @param {Array<{label, onClick, variant}>} options.actions
 * @param {string} options.className
 */
export function createModal({ title, content, actions = [], className = '' }) {
  const modal = createElement('div', { className: `modal ${className}` });

  // Header
  const header = createElement('div', { className: 'modal__header' });
  const titleEl = createElement('h3', { className: 'modal__title' }, title);
  const closeBtn = createElement('button', {
    className: 'modal__close',
    'aria-label': 'Close',
    type: 'button',
  });
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>`;
  closeBtn.addEventListener('click', () => modalManager.close());

  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  // Content
  const body = createElement('div', { className: 'modal__body' });
  if (typeof content === 'string') {
    body.innerHTML = content;
  } else if (content instanceof HTMLElement) {
    body.appendChild(content);
  }

  // Actions
  const footer = createElement('div', { className: 'modal__footer' });
  actions.forEach(({ label, onClick, variant = 'secondary' }) => {
    const btn = createElement('button', {
      className: `modal__action modal__action--${variant}`,
      type: 'button',
    }, label);
    btn.addEventListener('click', () => {
      haptic(HAPTIC.MEDIUM);
      onClick();
    });
    footer.appendChild(btn);
  });

  modal.appendChild(header);
  modal.appendChild(body);
  if (actions.length > 0) modal.appendChild(footer);

  return modal;
}

// ─── Track Options Modal (Context Menu) ──────────────────────────────────────

/**
 * Show track context menu (More options).
 * @param {Track} track
 * @param {object} callbacks
 */
export function showTrackOptionsModal(track, callbacks = {}) {
  const content = createElement('div', { className: 'track-options' });

  // Track preview header
  const preview = createElement('div', { className: 'track-options__preview' });
  const img = createElement('img', {
    className: 'track-options__cover',
    src: track.image,
    alt: track.name,
    width: '56',
    height: '56',
  });
  const previewInfo = createElement('div', { className: 'track-options__preview-info' });
  const previewName = createElement('p', { className: 'track-options__name' }, track.name);
  const previewArtist = createElement('p', { className: 'track-options__artist' }, track.artist_name);
  previewInfo.appendChild(previewName);
  previewInfo.appendChild(previewArtist);
  preview.appendChild(img);
  preview.appendChild(previewInfo);
  content.appendChild(preview);

  // Divider
  content.appendChild(createElement('hr', { className: 'track-options__divider' }));

  // Options list
  const options = [
    {
      icon: queueIcon(),
      label: 'Add to queue',
      onClick: () => { callbacks.onAddToQueue?.(track); modalManager.close(); },
    },
    {
      icon: libraryIcon(),
      label: 'Add to library',
      onClick: () => { callbacks.onAddToLibrary?.(track); modalManager.close(); },
    },
    {
      icon: shareIcon(),
      label: 'Share track',
      onClick: () => { handleShareTrack(track); modalManager.close(); },
    },
    {
      icon: artistIcon(),
      label: `View artist: ${track.artist_name}`,
      onClick: () => { callbacks.onViewArtist?.(track); modalManager.close(); },
    },
    {
      icon: jamendoIcon(),
      label: 'Open on Jamendo',
      onClick: () => { window.open(track.shareurl || `https://www.jamendo.com/track/${track.id}`, '_blank'); modalManager.close(); },
    },
  ];

  options.forEach(({ icon, label, onClick }) => {
    const btn = createElement('button', { className: 'track-options__btn', type: 'button' });
    const iconEl = createElement('span', { className: 'track-options__icon' });
    iconEl.innerHTML = icon;
    const labelEl = createElement('span', { className: 'track-options__label' }, label);
    btn.appendChild(iconEl);
    btn.appendChild(labelEl);
    btn.addEventListener('click', () => {
      haptic(HAPTIC.LIGHT);
      onClick();
    });
    content.appendChild(btn);
  });

  const modal = createElement('div', { className: 'modal modal--sheet' });
  // Sheet handle
  const handle = createElement('div', { className: 'modal__handle' });
  modal.appendChild(handle);
  modal.appendChild(content);

  modalManager.open(modal);
}

// ─── Pro Upgrade Modal ────────────────────────────────────────────────────────

/**
 * Show the AURA Pro upgrade modal with Telegram payment integration.
 * @param {object} options
 * @param {Function} options.onPurchaseComplete
 */
export function showProModal({ onPurchaseComplete = () => {} } = {}) {
  const modal = createElement('div', { className: 'modal modal--pro' });

  // Gradient header
  const header = createElement('div', { className: 'pro-modal__header' });
  header.innerHTML = `
    <div class="pro-modal__crown">
      <svg viewBox="0 0 24 24" fill="currentColor" width="40" height="40">
        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm0 3h14v1.5a.5.5 0 01-.5.5H5.5a.5.5 0 01-.5-.5V19z"/>
      </svg>
    </div>
    <h2 class="pro-modal__title">AURA Pro</h2>
    <p class="pro-modal__subtitle">Unlock the full experience</p>
  `;

  // Features list
  const features = createElement('ul', { className: 'pro-modal__features' });
  PRO.FEATURES.forEach(feature => {
    const li = createElement('li', { className: 'pro-modal__feature' });
    li.innerHTML = `
      <span class="pro-modal__check">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </span>
      <span>${feature}</span>
    `;
    features.appendChild(li);
  });

  // Price section
  const pricing = createElement('div', { className: 'pro-modal__pricing' });
  pricing.innerHTML = `
    <div class="pro-modal__price-main">
      <span class="pro-modal__price-amount">$${PRO.PRICE_USD}</span>
      <span class="pro-modal__price-period">/ month</span>
    </div>
    <div class="pro-modal__price-alt">
      or ${PRO.PRICE_STARS} ⭐ Telegram Stars · ${PRO.PRICE_TON} TON
    </div>
  `;

  // CTA Buttons
  const actions = createElement('div', { className: 'pro-modal__actions' });

  // Primary: Telegram Stars payment
  const starsBtn = createElement('button', {
    className: 'pro-modal__btn pro-modal__btn--stars',
    type: 'button',
  });
  starsBtn.innerHTML = `<span>⭐</span> Pay with Telegram Stars`;
  starsBtn.addEventListener('click', () => {
    haptic(HAPTIC.MEDIUM);
    handleStarsPayment(onPurchaseComplete);
  });

  // Secondary: TON via CryptoBot
  const tonBtn = createElement('button', {
    className: 'pro-modal__btn pro-modal__btn--ton',
    type: 'button',
  });
  tonBtn.innerHTML = `<span>💎</span> Pay with TON`;
  tonBtn.addEventListener('click', () => {
    haptic(HAPTIC.MEDIUM);
    handleTonPayment(onPurchaseComplete);
  });

  // Close
  const closeBtn = createElement('button', {
    className: 'pro-modal__btn pro-modal__btn--close',
    type: 'button',
  }, 'Maybe later');
  closeBtn.addEventListener('click', () => {
    haptic(HAPTIC.LIGHT);
    modalManager.close();
  });

  actions.appendChild(starsBtn);
  actions.appendChild(tonBtn);
  actions.appendChild(closeBtn);

  // Terms
  const terms = createElement('p', { className: 'pro-modal__terms' });
  terms.innerHTML = `Music licensed under <a href="https://creativecommons.org" target="_blank">Creative Commons</a> via Jamendo.`;

  modal.appendChild(header);
  modal.appendChild(features);
  modal.appendChild(pricing);
  modal.appendChild(actions);
  modal.appendChild(terms);

  modalManager.open(modal);
  haptic(HAPTIC.LIGHT);
}

// ─── Payment Handlers ─────────────────────────────────────────────────────────

function handleStarsPayment(onComplete) {
  const tg = window.Telegram?.WebApp;

  if (!tg) {
    // Dev fallback: simulate purchase
    console.warn('[AURA] Not in Telegram context — simulating purchase');
    simulatePurchase(onComplete);
    return;
  }

  // Use Telegram's native MainButton for payment
  tg.MainButton.setText(`Pay ${PRO.PRICE_STARS} ⭐`);
  tg.MainButton.color = '#f5a623';
  tg.MainButton.show();

  const handlePayment = () => {
    tg.MainButton.hide();
    tg.MainButton.offClick(handlePayment);

    // In production, invoke your bot payment endpoint here
    // For now we activate Pro immediately (replace with real webhook verification)
    dispatch({ type: ACTION.SET_PRO_STATUS, payload: true });
    dispatch({
      type: ACTION.SHOW_TOAST,
      payload: { message: '🎉 Welcome to AURA Pro!', type: 'success' }
    });

    onComplete();
    modalManager.close();
    haptic(HAPTIC.SUCCESS);
  };

  tg.MainButton.onClick(handlePayment);
  modalManager.close();
}

function handleTonPayment(onComplete) {
  // Open CryptoBot invoice
  const invoiceUrl = `${PRO.CRYPTOBOT_URL}?start=aura_pro_ton`;

  if (isTelegram()) {
    window.Telegram.WebApp.openLink(invoiceUrl);
  } else {
    window.open(invoiceUrl, '_blank');
  }

  // In production: listen for payment confirmation via Telegram bot webhook
  // For demo: activate after user returns (replace with real verification)
  dispatch({
    type: ACTION.SHOW_TOAST,
    payload: { message: 'Complete payment in CryptoBot, then restart the app.', type: 'info' }
  });

  modalManager.close();
}

function simulatePurchase(onComplete) {
  dispatch({ type: ACTION.SET_PRO_STATUS, payload: true });
  dispatch({
    type: ACTION.SHOW_TOAST,
    payload: { message: '🎉 AURA Pro activated (demo)!', type: 'success' }
  });
  onComplete();
  modalManager.close();
  haptic(HAPTIC.SUCCESS);
}

// ─── Share Handler ────────────────────────────────────────────────────────────

function handleShareTrack(track) {
  const shareUrl = track.shareurl || `https://www.jamendo.com/track/${track.id}`;
  const shareText = `🎵 ${track.name} by ${track.artist_name} — listened via AURA Music`;

  if (navigator.share) {
    navigator.share({ title: track.name, text: shareText, url: shareUrl }).catch(() => {});
  } else if (isTelegram()) {
    window.Telegram.WebApp.openTelegramLink(
      `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`
    );
  } else {
    navigator.clipboard?.writeText(shareUrl).then(() => {
      dispatch({ type: ACTION.SHOW_TOAST, payload: { message: 'Link copied!', type: 'success' } });
    });
  }
}

// ─── SVG Icons (self-contained) ───────────────────────────────────────────────

const queueIcon = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/></svg>`;

const libraryIcon = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;

const shareIcon = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;

const artistIcon = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

const jamendoIcon = () => `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><polygon points="10,8 16,12 10,16"/></svg>`;
