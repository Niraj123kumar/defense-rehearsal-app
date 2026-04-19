/**
 * Global Helpers & Advanced Animations for PDRS
 */

function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast glass ${type}`;
  toast.innerHTML = `
    <div class="toast-content">${message}</div>
    <div class="toast-progress" style="animation-duration: ${duration}ms"></div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOutLeft 0.3s forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toast-container';
  document.body.appendChild(container);
  return container;
}

function animateCounter(el, start, end, duration = 1200, decimals = 0) {
  if (prefersReducedMotion()) {
    el.textContent = end.toFixed(decimals);
    return;
  }
  let startTime = null;
  const step = (timestamp) => {
    if (!startTime) startTime = timestamp;
    const progress = Math.min((timestamp - startTime) / duration, 1);
    const easeProgress = 1 - Math.pow(1 - progress, 3); // Cubic ease out
    const value = easeProgress * (end - start) + start;
    el.textContent = value.toFixed(decimals);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function triggerConfetti(x = 0.5, y = 0.5, count = 80) {
  if (prefersReducedMotion()) return;
  const colors = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#FFFFFF'];
  for (let i = 0; i < count; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    confetti.style.cssText = `
      position: fixed;
      left: ${x * 100}vw;
      top: ${y * 100}vh;
      width: ${Math.random() * 12 + 6}px;
      height: ${Math.random() * 12 + 6}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      z-index: 3000;
      pointer-events: none;
      animation: confettiFall ${Math.random() * 3 + 2}s var(--ease-quick) forwards;
      transform: rotate(${Math.random() * 360}deg);
    `;
    document.body.appendChild(confetti);
    setTimeout(() => confetti.remove(), 5000);
  }
}

function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        
        // Handle counters
        const counters = entry.target.querySelectorAll('.counter');
        counters.forEach(c => {
          const target = parseFloat(c.dataset.target);
          animateCounter(c, 0, target, 1500, c.dataset.decimals || 0);
        });

        // Handle dim bars
        const bars = entry.target.querySelectorAll('.dim-bar-fill');
        bars.forEach(bar => {
          const width = bar.dataset.width || bar.style.getPropertyValue('--target-width');
          bar.style.width = width;
        });

        // Handle staggered children
        const staggered = entry.target.classList.contains('stagger-children') ? [entry.target] : entry.target.querySelectorAll('.stagger-children');
        staggered.forEach(parent => {
          Array.from(parent.children).forEach((child, index) => {
            setTimeout(() => child.classList.add('visible'), index * 100);
          });
        });
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.animate-on-scroll, .stagger-children').forEach(el => observer.observe(el));
}

function initParticles(count = 15) {
  if (prefersReducedMotion()) return;
  const container = document.body;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 100 + 50;
    const colors = ['var(--accent-indigo)', 'var(--accent-emerald)', 'var(--accent-amber)'];
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.left = `${Math.random() * 100}vw`;
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDuration = `${Math.random() * 10 + 10}s`;
    p.style.animationDelay = `${Math.random() * 5}s`;
    container.appendChild(p);
  }
}

function init3DTilt() {
  if (prefersReducedMotion() || window.innerWidth < 768) return;
  document.querySelectorAll('.card-3d').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = (y - centerY) / 10;
      const rotateY = (centerX - x) / 10;
      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0)';
    });
  });
}

function initRipple() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
}

function initPageTransition() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link || !link.href || link.target === '_blank' || link.href.includes('#') || link.href.startsWith('mailto:') || link.href.startsWith('tel:')) return;
    if (link.origin !== window.location.origin) return;
    
    e.preventDefault();
    document.body.style.animation = 'fadeOutUp 0.4s var(--ease-quick) forwards';
    setTimeout(() => {
      window.location.href = link.href;
    }, 400);
  });
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function renderNav() {
  const studentId = localStorage.getItem('studentId');
  const facultyRole = localStorage.getItem('facultyRole');
  const nav = document.getElementById('main-nav');
  if (!nav) return;

  let links = `
    <a href="index.html" class="nav-link ${window.location.pathname.endsWith('index.html') ? 'active' : ''}">Home</a>
  `;

  if (studentId) {
    links += `
      <a href="dashboard.html" class="nav-link ${window.location.pathname.endsWith('dashboard.html') ? 'active' : ''}">Dashboard</a>
      <a href="profile.html" class="nav-link ${window.location.pathname.endsWith('profile.html') ? 'active' : ''}">My Profile</a>
    `;
  } else {
    links += `<a href="onboarding.html" class="nav-link">Get Started</a>`;
  }

  if (facultyRole === 'faculty') {
    links += `
      <a href="faculty-dashboard.html" class="nav-link ${window.location.pathname.endsWith('faculty-dashboard.html') ? 'active' : ''}">Faculty</a>
    `;
  } else {
    links += `<a href="faculty-login.html" class="nav-link">Faculty Portal</a>`;
  }

  nav.innerHTML = `
    <a href="index.html" class="nav-logo gradient-text">PDRS</a>
    <div class="nav-links">${links}</div>
    <div class="nav-mobile-btn" style="display:none">☰</div>
  `;
}

// Typewriter Effect
class Typewriter {
  constructor(el, phrases, period = 2000) {
    this.el = el;
    this.phrases = phrases;
    this.period = period;
    this.txt = '';
    this.loopNum = 0;
    this.isDeleting = false;
    this.tick();
  }
  tick() {
    const i = this.loopNum % this.phrases.length;
    const fullTxt = this.phrases[i];
    if (this.isDeleting) this.txt = fullTxt.substring(0, this.txt.length - 1);
    else this.txt = fullTxt.substring(0, this.txt.length + 1);
    this.el.innerHTML = `<span class="wrap">${this.txt}</span>`;
    let delta = 200 - Math.random() * 100;
    if (this.isDeleting) delta /= 2;
    if (!this.isDeleting && this.txt === fullTxt) {
      delta = this.period;
      this.isDeleting = true;
    } else if (this.isDeleting && this.txt === '') {
      this.isDeleting = false;
      this.loopNum++;
      delta = 500;
    }
    setTimeout(() => this.tick(), delta);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderNav();
  initParticles();
  initScrollAnimations();
  init3DTilt();
  initRipple();
  initPageTransition();
  createToastContainer();
  
  // Initialize typewriters if present
  document.querySelectorAll('.typewriter-data').forEach(el => {
    const phrases = JSON.parse(el.dataset.phrases);
    new Typewriter(el, phrases, el.dataset.period);
  });
});

// Skeleton helpers
function showSkeleton() {
  document.querySelectorAll('.content-area').forEach(el => el.classList.add('skeleton-loading'));
}
function hideSkeleton() {
  document.querySelectorAll('.content-area').forEach(el => el.classList.remove('skeleton-loading'));
}
