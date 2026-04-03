/**
 * accessibility-switcher.js — Mode toggle UI + localStorage persistence
 * Drop-in: include this once. It creates a floating toggle button and handles persistence.
 * Reads/writes localStorage keys: pdrs_a11y_mode
 * Valid modes: 'focus', 'dyslexia', 'lowstim', '' (none)
 */

(function () {
  const STORAGE_KEY = 'pdrs_a11y_mode';

  // Current active mode
  let activeMode = localStorage.getItem(STORAGE_KEY) || '';

  // ─── Apply mode to body ───────────────────────────────────────────────────

  function applyMode(mode) {
    // Remove all mode classes
    document.body.classList.remove('focus-mode', 'dyslexia-mode', 'low-stim-mode');
    activeMode = mode;
    if (mode) {
      document.body.classList.add(mode + '-mode');
    }
    localStorage.setItem(STORAGE_KEY, mode);
    updateIndicator();
  }

  // Restore on page load
  if (activeMode) {
    document.body.classList.add(activeMode + '-mode');
  }

  // ─── Floating indicator / toggle button ──────────────────────────────────

  function buildUI() {
    // Indicator badge (bottom-right)
    const badge = document.createElement('div');
    badge.id = 'a11y-mode-indicator';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    if (activeMode) badge.classList.add('visible');

    const dot = document.createElement('span');
    dot.className = 'mode-dot';

    const label = document.createElement('span');
    label.id = 'a11y-mode-label';
    label.textContent = modeLabel(activeMode);

    badge.appendChild(dot);
    badge.appendChild(label);
    document.body.appendChild(badge);

    // Toggle popup on click
    badge.addEventListener('click', togglePopup);
  }

  function modeLabel(mode) {
    return { focus: 'Focus Mode', dyslexia: 'Dyslexia', lowstim: 'Low Stim', '': '' }[mode] || '';
  }

  function togglePopup() {
    const existing = document.getElementById('a11y-popup');
    if (existing) { existing.remove(); return; }
    showPopup();
  }

  function showPopup() {
    const popup = document.createElement('div');
    popup.id = 'a11y-popup';
    popup.style.cssText = `
      position: fixed; bottom: 64px; right: 20px; z-index: 9999;
      background: #13131F; border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px; padding: 16px; min-width: 220px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.5);
      animation: fadeIn 150ms ease;
    `;

    popup.innerHTML = `
      <div style="font-size:0.75rem; font-family:var(--font-mono); color:#6366F1; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:12px;">Accessibility Modes</div>

      <button class="a11y-opt" data-mode="" style="
        display:flex; align-items:center; gap:10px; width:100%; padding:10px 12px;
        background:${!activeMode ? 'rgba(99,102,241,0.15)' : 'transparent'};
        border:1px solid ${!activeMode ? 'rgba(99,102,241,0.3)' : 'transparent'};
        border-radius:10px; cursor:pointer; color:#E2E8F0; font-size:0.875rem;
        margin-bottom:6px; transition:all 150ms ease;
      ">
        <span style="width:20px; text-align:center;">🌙</span>
        <span style="flex:1; text-align:left;">Default</span>
        ${!activeMode ? '<span style="width:8px;height:8px;border-radius:50%;background:#6366F1;"></span>' : ''}
      </button>

      <button class="a11y-opt" data-mode="focus" style="
        display:flex; align-items:center; gap:10px; width:100%; padding:10px 12px;
        background:${activeMode === 'focus' ? 'rgba(245,158,11,0.15)' : 'transparent'};
        border:1px solid ${activeMode === 'focus' ? 'rgba(245,158,11,0.3)' : 'transparent'};
        border-radius:10px; cursor:pointer; color:#E2E8F0; font-size:0.875rem;
        margin-bottom:6px; transition:all 150ms ease;
      ">
        <span style="width:20px; text-align:center;">🎯</span>
        <span style="flex:1; text-align:left;">Focus Mode</span>
        ${activeMode === 'focus' ? '<span style="width:8px;height:8px;border-radius:50%;background:#F59E0B;"></span>' : ''}
      </button>

      <button class="a11y-opt" data-mode="dyslexia" style="
        display:flex; align-items:center; gap:10px; width:100%; padding:10px 12px;
        background:${activeMode === 'dyslexia' ? 'rgba(16,185,129,0.15)' : 'transparent'};
        border:1px solid ${activeMode === 'dyslexia' ? 'rgba(16,185,129,0.3)' : 'transparent'};
        border-radius:10px; cursor:pointer; color:#E2E8F0; font-size:0.875rem;
        margin-bottom:6px; transition:all 150ms ease;
      ">
        <span style="width:20px; text-align:center;">🔤</span>
        <span style="flex:1; text-align:left;">Dyslexia-Friendly</span>
        ${activeMode === 'dyslexia' ? '<span style="width:8px;height:8px;border-radius:50%;background:#10B981;"></span>' : ''}
      </button>

      <button class="a11y-opt" data-mode="lowstim" style="
        display:flex; align-items:center; gap:10px; width:100%; padding:10px 12px;
        background:${activeMode === 'lowstim' ? 'rgba(100,116,139,0.15)' : 'transparent'};
        border:1px solid ${activeMode === 'lowstim' ? 'rgba(100,116,139,0.3)' : 'transparent'};
        border-radius:10px; cursor:pointer; color:#E2E8F0; font-size:0.875rem;
        transition:all 150ms ease;
      ">
        <span style="width:20px; text-align:center;">🧘</span>
        <span style="flex:1; text-align:left;">Low Stimulation</span>
        ${activeMode === 'lowstim' ? '<span style="width:8px;height:8px;border-radius:50%;background:#64748B;"></span>' : ''}
      </button>

      <div style="margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.06); font-size:0.7rem; color:#475569; text-align:center;">
        Press <kbd style="background:rgba(255,255,255,0.06);border-radius:4px;padding:1px 5px;font-family:monospace;">⌘K</kbd> to open command palette
      </div>
    `;

    // Attach click handlers
    popup.querySelectorAll('.a11y-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        applyMode(btn.dataset.mode);
        popup.remove();
      });
    });

    // Close on outside click
    const closeHandler = (e) => {
      if (!popup.contains(e.target) && e.target.id !== 'a11y-mode-indicator') {
        popup.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 50);

    document.body.appendChild(popup);
  }

  function updateIndicator() {
    const badge = document.getElementById('a11y-mode-indicator');
    const label = document.getElementById('a11y-mode-label');
    if (!badge) return;
    if (activeMode) {
      badge.classList.add('visible');
      label.textContent = modeLabel(activeMode);
    } else {
      badge.classList.remove('visible');
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    buildUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
