/**
 * Local Lingua — Transient Toast Notifications
 * Shared user-facing error/warning/success messages.
 */

export function showToast(message, type = 'error') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const bg = type === 'error' ? '#ff4444'
    : type === 'warn' ? '#ff8c00'
    : type === 'info' ? '#0288d1'
    : '#06d6a0';
  toast.style.cssText = `padding:10px 16px;border-radius:8px;background:${bg};color:#fff;font-size:13px;max-width:320px;box-shadow:0 4px 12px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.3s;`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
