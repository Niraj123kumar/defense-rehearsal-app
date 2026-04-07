// Shared navigation component — role-aware
// Usage: <script src="nav.js" data-page="home"></script>
(function () {
  const page = document.currentScript.getAttribute('data-page') || 'home';

  // ─── Role Management ────────────────────────────────────────────────────────
  const FACULTY_TOKEN_KEY = 'pdrs_faculty_token';
  const ROLE_KEY = 'pdrs_role';

  function getRole() {
    return localStorage.getItem(ROLE_KEY) || null;
  }

  function isFaculty() {
    return getRole() === 'faculty' && !!localStorage.getItem(FACULTY_TOKEN_KEY);
  }

  function isStudent() {
    return getRole() === 'student';
  }

  // Pages only faculty can access
  const FACULTY_ONLY_PAGES = ['analytics', 'session-host', 'session-create'];

  // Pages only students should access (faculty get redirected to their dashboard)
  const STUDENT_ONLY_PAGES = ['onboarding', 'questions', 'defense', 'profile', 'coaching'];

  // ─── Access Guards ──────────────────────────────────────────────────────────
  // Don't guard: home, teacher (has its own room-code auth), dashboard (shared)
  if (FACULTY_ONLY_PAGES.includes(page)) {
    if (!isFaculty()) {
      window.location.href = 'index.html?access=faculty-required';
      return;
    }
  }

  if (STUDENT_ONLY_PAGES.includes(page)) {
    if (isFaculty()) {
      window.location.href = 'analytics.html';
      return;
    }
    if (!isStudent() && !localStorage.getItem('pdrs_student_id')) {
      // Not blocking — students may not have set role yet, just redirect to home
      // only if they have NO student ID either (fresh visit)
      if (page === 'defense' || page === 'coaching' || page === 'profile' || page === 'questions') {
        // Allow — they'll be prompted by the page itself
      }
    }
  }

  // ─── Nav Links per Role ─────────────────────────────────────────────────────
  const studentLinks = [
    { href: 'index.html',       label: 'Home',         key: 'home' },
    { href: 'onboarding.html',  label: 'Onboarding',   key: 'onboarding' },
    { href: 'questions.html',   label: 'AI Questions', key: 'questions' },
    { href: 'defense.html',     label: 'Defense',      key: 'defense' },
    { href: 'profile.html',     label: 'My Progress',  key: 'profile' },
    { href: 'coaching.html',    label: 'Coaching',     key: 'coaching' },
  ];

  const facultyLinks = [
    { href: 'index.html',           label: 'Home',          key: 'home' },
    { href: 'dashboard.html',       label: 'Dashboard',     key: 'dashboard' },
    { href: 'analytics.html',       label: 'Cohort View',   key: 'analytics' },
    { href: 'session-create.html',  label: 'Live Session',  key: 'session-create' },
    { href: 'session-host.html',    label: 'Host Panel',    key: 'session-host' },
  ];

  const guestLinks = [
    { href: 'index.html', label: 'Home', key: 'home' },
  ];

  function getLinks() {
    if (isFaculty()) return facultyLinks;
    if (isStudent()) return studentLinks;
    return guestLinks;
  }

  // ─── Role Badge HTML ────────────────────────────────────────────────────────
  function roleBadgeHTML() {
    if (isFaculty()) {
      return `
        <div class="navbar-role">
          <span class="role-badge role-badge--faculty">Faculty</span>
          <button class="role-switch-btn" onclick="window.__pdrsLogout()">Switch role</button>
        </div>`;
    }
    if (isStudent()) {
      return `
        <div class="navbar-role">
          <span class="role-badge role-badge--student">Student</span>
          <button class="role-switch-btn" onclick="window.__pdrsLogout()">Switch role</button>
        </div>`;
    }
    return `
      <div class="navbar-role">
        <a href="index.html" class="btn-choose-role">Choose role →</a>
      </div>`;
  }

  // ─── Build Nav ──────────────────────────────────────────────────────────────
  const links = getLinks();
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
      ${roleBadgeHTML()}
    </div>
  `;
  document.body.insertBefore(nav, document.body.firstChild);

  // ─── Logout / Role Switch ───────────────────────────────────────────────────
  window.__pdrsLogout = function () {
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(FACULTY_TOKEN_KEY);
    window.location.href = 'index.html';
  };

  // ─── Faculty Login Modal ────────────────────────────────────────────────────
  // Called from index.html when user clicks "Faculty →"
  window.__pdrsFacultyLogin = function () {
    const existing = document.getElementById('pdrs-faculty-modal');
    if (existing) { existing.style.display = 'flex'; return; }

    const modal = document.createElement('div');
    modal.id = 'pdrs-faculty-modal';
    modal.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:9999;
      display:flex; align-items:center; justify-content:center;
    `;
    modal.innerHTML = `
      <div style="
        background:var(--bg-card, #1a1a2e);
        border:1px solid var(--border, rgba(255,255,255,0.1));
        border-radius:16px; padding:32px; width:340px; max-width:90vw;
      ">
        <h3 style="margin:0 0 8px; font-size:1.1rem;">Faculty Login</h3>
        <p style="margin:0 0 20px; font-size:0.85rem; color:var(--text-muted);">Enter your faculty password to continue.</p>
        <input
          id="pdrs-faculty-pwd"
          type="password"
          placeholder="Faculty password"
          style="
            width:100%; padding:10px 14px; border-radius:8px; margin-bottom:12px;
            background:var(--bg-input, rgba(255,255,255,0.06));
            border:1px solid var(--border, rgba(255,255,255,0.12));
            color:var(--text-primary, #fff); font-size:0.95rem; box-sizing:border-box;
          "
          onkeydown="if(event.key==='Enter') window.__pdrsSubmitFacultyLogin()"
        />
        <div id="pdrs-faculty-error" style="color:#f87171; font-size:0.8rem; margin-bottom:10px; display:none;"></div>
        <div style="display:flex; gap:8px;">
          <button
            onclick="window.__pdrsSubmitFacultyLogin()"
            style="
              flex:1; padding:10px; border-radius:8px; border:none; cursor:pointer;
              background:var(--accent-indigo, #6366f1); color:#fff; font-size:0.9rem; font-weight:500;
            ">
            Enter Faculty Portal →
          </button>
          <button
            onclick="document.getElementById('pdrs-faculty-modal').style.display='none'"
            style="
              padding:10px 14px; border-radius:8px; cursor:pointer;
              background:transparent; border:1px solid var(--border, rgba(255,255,255,0.15));
              color:var(--text-muted, #aaa); font-size:0.9rem;
            ">
            Cancel
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', function(e) {
      if (e.target === modal) modal.style.display = 'none';
    });
    setTimeout(() => document.getElementById('pdrs-faculty-pwd')?.focus(), 50);
  };

  window.__pdrsSubmitFacultyLogin = async function () {
    const pwd = document.getElementById('pdrs-faculty-pwd')?.value || '';
    const errEl = document.getElementById('pdrs-faculty-error');
    if (!pwd) { errEl.style.display = 'block'; errEl.textContent = 'Password required.'; return; }
    errEl.style.display = 'none';

    // Use a dummy room code just to validate the password against the server
    // The server's teacher-auth endpoint validates TEACHER_PASSWORD
    try {
      const res = await fetch('/api/faculty-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem(ROLE_KEY, 'faculty');
        localStorage.setItem(FACULTY_TOKEN_KEY, data.token);
        window.location.href = 'faculty-dashboard.html';
      } else {
        errEl.style.display = 'block';
        errEl.textContent = 'Incorrect password. Try again.';
        document.getElementById('pdrs-faculty-pwd').value = '';
        document.getElementById('pdrs-faculty-pwd').focus();
      }
    } catch (e) {
      errEl.style.display = 'block';
      errEl.textContent = 'Server error. Please try again.';
    }
  };

  // ─── Bootstrap: inject shared CSS ──────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('shared-a11y-css')) return;
    const link = document.createElement('link');
    link.id = 'shared-a11y-css';
    link.rel = 'stylesheet';
    link.href = 'accessibility-modes.css';
    document.head.appendChild(link);
  }

  function loadScripts() {
    if (document.getElementById('cmd-parser')) return;
    const parser = document.createElement('script');
    parser.id = 'cmd-parser';
    parser.src = 'command-parser.js';
    parser.onload = () => {
      const palette = document.createElement('script');
      palette.src = 'command-palette.js';
      palette.onload = () => {
        const ambient = document.createElement('script');
        ambient.src = 'ambient-bg.js';
        document.head.appendChild(ambient);
      };
      document.head.appendChild(palette);
    };
    document.head.appendChild(parser);
    const a11y = document.createElement('script');
    a11y.src = 'accessibility-switcher.js';
    document.head.appendChild(a11y);
  }

  injectStyles();
  loadScripts();
})();
