// onboarding.js — first-run overlay logic (shared)
// Usage: initOnboarding({ steps: [...], storageKey: 'builder', helpBtn: el })

const LS_PREFIX = 'discuss_seen_';

export function initOnboarding({ steps, storageKey, helpBtn }) {
  const key = LS_PREFIX + storageKey;

  if (!localStorage.getItem(key)) {
    showOverlay(steps, key);
  }

  helpBtn?.addEventListener('click', () => showOverlay(steps, key));
}

function showOverlay(steps, key) {
  // Remove any existing overlay
  document.querySelector('.onboarding')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'onboarding';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  let current = 0;

  const card = document.createElement('div');
  card.className = 'onboarding-card';
  overlay.appendChild(card);

  function render() {
    card.innerHTML = `
      <p class="onboarding-indicator">${current + 1} / ${steps.length}</p>
      <p class="onboarding-text">${steps[current]}</p>
      <div class="onboarding-actions">
        <button class="btn-ghost js-prev" ${current === 0 ? 'style="visibility:hidden"' : ''}>← Back</button>
        ${current < steps.length - 1
          ? '<button class="btn-primary js-next">Next →</button>'
          : '<button class="btn-primary js-done">Got it</button>'
        }
      </div>
    `;
    card.querySelector('.js-prev')?.addEventListener('click', () => { current--; render(); });
    card.querySelector('.js-next')?.addEventListener('click', () => { current++; render(); });
    card.querySelector('.js-done')?.addEventListener('click', () => {
      localStorage.setItem(key, '1');
      overlay.remove();
    });
  }

  render();
  document.body.appendChild(overlay);

  // Trap focus inside overlay
  overlay.querySelector('.js-next, .js-done')?.focus();
}
