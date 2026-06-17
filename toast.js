// Dr. NIRA Toast System
function showToast(message, type = 'success', duration = 3000) {
  const existing = document.getElementById('nira-toast-container');
  if (!existing) {
    const container = document.createElement('div');
    container.id = 'nira-toast-container';
    container.style.cssText = `
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      z-index: 9999; display: flex; flex-direction: column; align-items: center; gap: 8px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }

  const colors = {
    success: { bg: '#16a34a', icon: '✓' },
    error:   { bg: '#dc2626', icon: '✕' },
    info:    { bg: '#2563EB', icon: 'ℹ' },
    warning: { bg: '#d97706', icon: '⚠' }
  };

  const { bg, icon } = colors[type] || colors.success;

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: ${bg}; color: #fff;
    padding: 10px 18px; border-radius: 30px;
    font-size: 13px; font-weight: 500; font-family: 'Inter', sans-serif;
    display: flex; align-items: center; gap: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    pointer-events: none; white-space: nowrap;
    animation: toastIn 0.25s ease;
    opacity: 1; transition: opacity 0.3s ease;
  `;
  toast.innerHTML = `<span style="font-size:14px">${icon}</span>${message}`;

  const style = document.getElementById('nira-toast-style');
  if (!style) {
    const s = document.createElement('style');
    s.id = 'nira-toast-style';
    s.textContent = `
      @keyframes toastIn {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(s);
  }

  document.getElementById('nira-toast-container').appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
