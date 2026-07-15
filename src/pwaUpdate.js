let updateServiceWorker = null;
let needRefresh = false;

const listeners = new Set();

function emit() {
  const state = {
    needRefresh,
    version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0",
  };
  listeners.forEach((listener) => listener(state));
}

export function configurePwaUpdate(updateFn) {
  updateServiceWorker = updateFn;
}

export function markPwaRefreshNeeded() {
  needRefresh = true;
  emit();
}

export function subscribePwaUpdate(listener) {
  listeners.add(listener);
  listener({
    needRefresh,
    version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0",
  });
  return () => listeners.delete(listener);
}

export async function checkForPwaUpdate() {
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registrations || []).map((registration) => registration.update()));
    return true;
  } catch (error) {
    console.error("PWA update check failed", error);
    return false;
  }
}

export async function applyPwaUpdate() {
  if (updateServiceWorker) {
    await updateServiceWorker(true);
    return;
  }
  window.location.reload();
}

export async function clearPwaCacheAndReload() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registrations || []).map((registration) => registration.update()));
  } catch (error) {
    console.error("PWA cache clear failed", error);
  } finally {
    window.location.reload();
  }
}