/**
 * ambient-bg.js — Cursor-reactive ambient background
 * GPU-accelerated via CSS custom properties + transform.
 * No Canvas, no WebGPU — pure CSS + lightweight JS.
 *
 * How it works:
 * 1. A full-viewport pseudo-element (::before) on <body> holds the gradient.
 * 2. On mousemove, we update CSS vars --mouse-x and --mouse-y (0-100% of viewport).
 * 3. The gradient position is driven by these vars via calc() — zero JS layout thrashing.
 * 4. Uses will-change: transform to promote to its own compositing layer.
 * 5. Throttled via requestAnimationFrame to cap at 60fps.
 */

(function () {
  let rafId = null;
  let targetX = 50, targetY = 50;
  let currentX = 50, currentY = 50;

  // ─── Inject styles ──────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('ambient-bg-styles')) return;
    const style = document.createElement('style');
    style.id = 'ambient-bg-styles';
    style.textContent = `
      /* Ambient glow layer — full-viewport ::before on body */
      body::before {
        content: '';
        position: fixed;
        inset: -20%; /* slightly larger to avoid edge clipping during movement */
        z-index: 0;
        pointer-events: none;
        will-change: transform;
        opacity: 0.35;
        /* The gradient center follows --mouse-x / --mouse-y, offset by viewport size */
        background: radial-gradient(
          ellipse 55% 45% at var(--mouse-x, 50%) var(--mouse-y, 50%),
          rgba(99, 102, 241, 0.22) 0%,
          rgba(139, 92, 246, 0.08) 35%,
          transparent 65%
        );
        transform: translate3d(0, 0, 0); /* promote to compositor layer */
        transition: opacity 800ms ease; /* slow fade on init/exit */
      }

      /* When any a11y mode is active, dim the ambient effect */
      body.focus-mode::before,
      body.low-stim-mode::before {
        opacity: 0.05;
      }

      /* Ensure all page content sits above the ambient layer */
      body > * {
        position: relative;
        z-index: 1;
      }

      /* Navbar sits above ambient */
      .navbar, nav {
        z-index: 100;
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Smooth lerp (linear interpolation) ────────────────────────────────────

  /**
   * Lerp between current and target at speed factor.
   * speed < 1 → slower follow (dreamy, trailing)
   * speed > 1 → snappier follow
   */
  function lerp(current, target, speed) {
    return current + (target - current) * speed;
  }

  // ─── Animation loop ─────────────────────────────────────────────────────────

  function tick() {
    // Smooth follow: creates a trailing/breathing feel
    currentX = lerp(currentX, targetX, 0.04); // ~4% per frame = ~60fps trailing
    currentY = lerp(currentY, targetY, 0.04);

    // Only update CSS var if values changed meaningfully (reduces style recalc)
    if (Math.abs(currentX - targetX) > 0.01 || Math.abs(currentY - targetY) > 0.01) {
      document.body.style.setProperty('--mouse-x', currentX + '%');
      document.body.style.setProperty('--mouse-y', currentY + '%');
    }

    rafId = requestAnimationFrame(tick);
  }

  // ─── Mouse/touch handler ───────────────────────────────────────────────────

  function onMove(e) {
    // Support both mouse and touch
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    targetX = (clientX / window.innerWidth) * 100;
    targetY = (clientY / window.innerHeight) * 100;
  }

  // Throttle via rAF already — mousemove fires at native rate but we only
  // update CSS vars in the animation loop, so there's zero thrashing.

  // ─── Visibility API — pause when tab is hidden ─────────────────────────────

  function onVisibility() {
    if (document.hidden) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    } else {
      if (!rafId) rafId = requestAnimationFrame(tick);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  function enable() {
    injectStyles();
    // Initialize at center
    document.body.style.setProperty('--mouse-x', '50%');
    document.body.style.setProperty('--mouse-y', '50%');

    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchstart', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);

    rafId = requestAnimationFrame(tick);
  }

  function disable() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchstart', onMove);
    document.removeEventListener('visibilitychange', onVisibility);
    document.body.style.removeProperty('--mouse-x');
    document.body.style.removeProperty('--mouse-y');
  }

  // ─── Auto-init ─────────────────────────────────────────────────────────────

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReduced) {
    enable();
  }

  window.AmbientBackground = { enable, disable };

})();
