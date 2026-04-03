/**
 * command-palette.js — Global ⌘K Command Palette
 * Drop-in vanilla JS module. Import once in nav.js or index.html.
 * Listens for Cmd+K / Ctrl+K globally, shows modal with fuzzy NL search.
 */

(function () {
  let isOpen = false;
  let selectedIndex = 0;
  let currentResults = [];
  let inputEl = null;
  let listEl = null;
  let overlayEl = null;

  // ─── Build DOM ──────────────────────────────────────────────────────────────

  function buildPalette() {
    overlayEl = document.createElement('div');
    overlayEl.id = 'cmd-overlay';
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-label', 'Command Palette');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: 15vh;
      opacity: 0; pointer-events: none;
      transition: opacity 150ms ease;
    `;

    overlayEl.innerHTML = `
      <div id="cmd-modal" style="
        width: 90vw; max-width: 600px;
        background: #13131F;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 16px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.2);
        overflow: hidden;
        transform: translateY(-8px) scale(0.97);
        transition: transform 150ms ease;
      ">
        <!-- Search input -->
        <div style="display:flex; align-items:center; padding: 16px 20px; gap:12px; border-bottom: 1px solid rgba(255,255,255,0.06);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            id="cmd-input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="cmd-list"
            placeholder="Type a command or search… (e.g. 'show dashboard', 'dark mode')"
            style="
              flex: 1; background: none; border: none; outline: none;
              font-family: 'Space Grotesk', sans-serif; font-size: 1rem;
              color: #F1F5F9; caret-color: #6366F1;
            "
          >
          <kbd style="
            background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
            border-radius: 6px; padding: 2px 8px; font-size: 0.7rem;
            color: #64748B; font-family: 'JetBrains Mono', monospace;
          ">ESC</kbd>
        </div>

        <!-- Results list -->
        <div id="cmd-list" role="listbox" aria-label="Commands" style="max-height: 360px; overflow-y: auto; padding: 8px;">
          <div id="cmd-empty" style="text-align:center; padding: 32px 16px; color: #475569; font-size: 0.875rem;">
            Type to search commands…
          </div>
          <div id="cmd-results"></div>
        </div>

        <!-- Footer -->
        <div style="
          display:flex; gap:16px; padding: 10px 20px;
          border-top: 1px solid rgba(255,255,255,0.06);
          font-size: 0.7rem; color: #475569;
        ">
          <span><kbd style="background:rgba(255,255,255,0.06); border-radius:4px; padding:1px 5px; font-family:monospace;">↑↓</kbd> navigate</span>
          <span><kbd style="background:rgba(255,255,255,0.06); border-radius:4px; padding:1px 5px; font-family:monospace;">↵</kbd> select</span>
          <span><kbd style="background:rgba(255,255,255,0.06); border-radius:4px; padding:1px 5px; font-family:monospace;">ESC</kbd> close</span>
          <span style="margin-left:auto; opacity:0.6;">Type natural language — try "dark mode" or "show dashboard"</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlayEl);
    inputEl = document.getElementById('cmd-input');
    listEl = document.getElementById('cmd-results');

    // ─── Event listeners ───────────────────────────────────────────────────

    // Click overlay to close
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) close();
    });

    // Input handler
    inputEl.addEventListener('input', () => {
      renderResults(inputEl.value);
    });

    // Keyboard navigation
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected(Math.min(selectedIndex + 1, currentResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected(Math.max(selectedIndex - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (currentResults[selectedIndex]) {
          executeResult(currentResults[selectedIndex]);
          close();
        }
      } else if (e.key === 'Escape') {
        close();
      }
    });

    // Accessibility: focus trap
    overlayEl.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        inputEl.focus();
      }
    });
  }

  // ─── Render results ─────────────────────────────────────────────────────────

  function renderResults(query) {
    currentResults = parseCommands(query);
    selectedIndex = 0;

    if (currentResults.length === 0) {
      listEl.innerHTML = `<div style="text-align:center; padding:24px; color:#475569; font-size:0.875rem;">No commands found for "${query}"</div>`;
      return;
    }

    const typeIcons = {
      route:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`,
      action: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>`,
    };

    listEl.innerHTML = currentResults.map((result, i) => `
      <div
        class="cmd-item${i === 0 ? ' cmd-selected' : ''}"
        data-idx="${i}"
        role="option"
        aria-selected="${i === 0}"
        style="
          display: flex; align-items: center; gap: 12px;
          padding: 10px 14px; border-radius: 8px; cursor: pointer;
          transition: background 100ms ease;
          ${i === 0 ? 'background: rgba(99,102,241,0.12);' : ''}
        "
      >
        ${typeIcons[result.type] || ''}
        <span style="flex:1; font-size: 0.9rem; color: #E2E8F0;">${result.label}</span>
        <span style="
          font-size: 0.65rem; padding: 2px 8px; border-radius: 9999px;
          background: ${result.type === 'route' ? 'rgba(99,102,241,0.15)' : 'rgba(16,185,129,0.15)'};
          color: ${result.type === 'route' ? '#818cf8' : '#34d399'};
          font-family: 'JetBrains Mono', monospace;
        ">${result.type}</span>
      </div>
    `).join('');

    // Click handlers
    listEl.querySelectorAll('.cmd-item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        const idx = parseInt(item.dataset.idx);
        setSelected(idx);
      });
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.idx);
        executeResult(currentResults[idx]);
        close();
      });
    });
  }

  function setSelected(idx) {
    const items = listEl.querySelectorAll('.cmd-item');
    items.forEach((el, i) => {
      const selected = i === idx;
      el.style.background = selected ? 'rgba(99,102,241,0.12)' : 'transparent';
      el.setAttribute('aria-selected', selected);
    });
    selectedIndex = idx;
    // Scroll into view
    items[idx]?.scrollIntoView({ block: 'nearest' });
  }

  // ─── Open / Close ───────────────────────────────────────────────────────────

  function open() {
    if (isOpen) return;
    isOpen = true;
    overlayEl.style.opacity = '1';
    overlayEl.style.pointerEvents = 'all';
    const modal = document.getElementById('cmd-modal');
    if (modal) {
      modal.style.transform = 'translateY(0) scale(1)';
    }
    renderResults('');
    // Small delay so transition plays, then focus
    setTimeout(() => inputEl?.focus(), 50);
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    overlayEl.style.opacity = '0';
    overlayEl.style.pointerEvents = 'none';
    const modal = document.getElementById('cmd-modal');
    if (modal) modal.style.transform = 'translateY(-8px) scale(0.97)';
    document.body.style.overflow = '';
    if (inputEl) inputEl.value = '';
  }

  // ─── Global keyboard listener ──────────────────────────────────────────────

  function handleKeydown(e) {
    // ⌘K (Mac) or Ctrl+K (Windows/Linux)
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      isOpen ? close() : open();
    }
    // Cmd+P for quick nav (alternative)
    if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
      e.preventDefault();
      isOpen ? close() : open();
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  window.CmdPalette = { open, close };

  // ─── Init ───────────────────────────────────────────────────────────────────

  function init() {
    if (overlayEl) return; // already built
    buildPalette();
    document.addEventListener('keydown', handleKeydown);

    // Add ⌘K hint to nav if exists
    const nav = document.querySelector('.navbar, nav');
    if (nav) {
      const hint = document.createElement('kbd');
      hint.setAttribute('aria-label', 'Press Command K to open command palette');
      hint.style.cssText = `
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px; padding: 2px 8px; font-size: 0.65rem;
        color: #64748B; font-family: 'JetBrains Mono', monospace;
        cursor: pointer; margin-left: auto;
      `;
      hint.textContent = '⌘K';
      hint.addEventListener('click', open);
      nav.querySelector('.navbar-inner')?.appendChild(hint);
    }
  }

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
