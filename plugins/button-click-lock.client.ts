const CLICK_LOCK_MS = 2500;
const CLICK_LOCK_CLASS = 'btn-click-locked';

const getLockTarget = (eventTarget: EventTarget | null) => {
  const el = eventTarget as HTMLElement | null;
  if (!el) return null;
  const nativeButton = el.closest('button');
  if (nativeButton) return nativeButton as HTMLElement;
  return el.closest('.v-btn, [role="button"]') as HTMLElement | null;
};

const shouldSkipLock = (target: HTMLElement) => {
  if (target.dataset.noClickLock === 'true') return true;
  if (target.classList.contains('v-btn--disabled')) return true;
  if (target.getAttribute('aria-disabled') === 'true') return true;
  return false;
};

const lockTarget = (target: HTMLElement) => {
  const lockUntil = Date.now() + CLICK_LOCK_MS;
  target.dataset.clickLockUntil = String(lockUntil);
  target.classList.add(CLICK_LOCK_CLASS);

  window.setTimeout(() => {
    const currentLockUntil = Number(target.dataset.clickLockUntil || '0');
    if (currentLockUntil <= Date.now()) {
      delete target.dataset.clickLockUntil;
      target.classList.remove(CLICK_LOCK_CLASS);
    }
  }, CLICK_LOCK_MS + 50);
};

const isLocked = (target: HTMLElement) => {
  const lockUntil = Number(target.dataset.clickLockUntil || '0');
  return lockUntil > Date.now();
};

export default defineNuxtPlugin(() => {
  if (!process.client) return;

  const clickHandler = (event: Event) => {
    const target = getLockTarget(event.target);
    if (!target || shouldSkipLock(target)) return;

    if (isLocked(target)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    lockTarget(target);
  };

  document.addEventListener('click', clickHandler, true);
});
