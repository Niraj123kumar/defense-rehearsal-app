// Shared navigation component
// Usage: <script src="nav.js" data-page="home"></script>

(function () {
  const page = document.currentScript.getAttribute('data-page') || 'home';

  // ─── Bootstrap: inject shared CSS ─────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('shared-a11y-css')) return;
    const link = document.createElement('link');
    link.id = 'shared-a11y-css';
    link.rel = 'stylesheet';
    link.href = 'accessibility-modes.css';
    document.head.appendChild(link);
  }

  function loadScripts() {
    if (document.getElementById('cmd-parser')) return; // already loaded
    // Load command parser first (no deps)
    const parser = document.createElement('script');
    parser.id = 'cmd-parser';
    parser.src = 'command-parser.js';
    parser.onload = () => {
      // Then command palette (depends on parser)
      const palette = document.createElement('script');
      palette.src = 'command-palette.js';
      palette.onload = () => {
        // Ambient bg (standalone)
        const ambient = document.createElement('script');
        ambient.src = 'ambient-bg.js';
        document.head.appendChild(ambient);
      };
      document.head.appendChild(palette);
    };
    document.head.appendChild(parser);

    // Accessibility switcher (standalone)
    const a11y = document.createElement('script');
    a11y.src = 'accessibility-switcher.js';
    document.head.appendChild(a11y);
  }

  const links = [
    { href: 'index.html',          label: 'Home',            key: 'home' },
    { href: 'onboarding.html',    label: 'Onboarding',      key: 'onboarding' },
    { href: 'questions.html',      label: 'AI Questions',    key: 'questions' },
    { href: 'defense.html',       label: 'Defense',          key: 'defense' },
    { href: 'dashboard.html',     label: 'Dashboard',       key: 'dashboard' },
    { href: 'profile.html',       label: 'My Progress',     key: 'profile' },
    { href: 'coaching.html',      label: 'Coaching',        key: 'coaching' },
    { href: 'analytics.html',     label: 'Faculty View',    key: 'analytics' },
    { href: 'session-create.html',label: '🎙 Live Session', key: 'session-create' },
    { href: 'teacher.html',       label: 'Teacher Panel',   key: 'teacher' },
  ];

  const nav = document.createElement('nav');
  nav.className = 'navbar';
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', 'Main navigation');

  nav.innerHTML = `
    <div class="navbar-inner">
      <a href="index.html" class="navbar-logo">PDRS<span>.dev</span></a>
      <ul class="navbar-links" role="list">
        ${links.map(l => `
          <li>
            <a href="${l.href}"
               ${l.key === page ? 'class="active"' : ''}
               ${l.key === page ? 'aria-current="page"' : ''}>
              ${l.label}
            </a>
          </li>
        `).join('')}
      </ul>
    </div>
  `;

  document.body.insertBefore(nav, document.body.firstChild);

  // Boot — runs after body has content
  injectStyles();
  loadScripts();
})();
