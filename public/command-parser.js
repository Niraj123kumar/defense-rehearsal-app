/**
 * command-parser.js — Natural Language intent mapper
 * Maps typed phrases → actions/routes. No external APIs.
 * Pure regex + keyword matching, runs entirely client-side.
 */

const ROUTES = {
  home:         { label: 'Go to Home',            href: 'index.html',         keywords: ['home', 'start', 'landing', 'main'] },
  onboarding:   { label: 'Go to Onboarding',       href: 'onboarding.html',    keywords: ['onboard', 'register', 'student', 'new student', 'add student'] },
  questions:    { label: 'Go to AI Questions',    href: 'questions.html',     keywords: ['question', 'ai question', 'generate', 'interrogate'] },
  defense:      { label: 'Go to Defense Session', href: 'defense.html',       keywords: ['defense', 'session', 'score', 'evaluate', 'viva'] },
  dashboard:    { label: 'Go to Dashboard',        href: 'dashboard.html',     keywords: ['dashboard', 'overview', 'scores', 'students', 'analytics'] },
  coaching:     { label: 'Go to Coaching',         href: 'coaching.html',      keywords: ['coach', 'practice', 'improve', 'weakness', 'targeted'] },
  profile:      { label: 'Go to My Progress',      href: 'profile.html',       keywords: ['profile', 'progress', 'my scores', 'trajectory', 'history'] },
  analytics:    { label: 'Go to Faculty Analytics',href: 'analytics.html',    keywords: ['faculty', 'cohort', 'analytics', 'faculty view', 'at-risk', 'top performer'] },
  sessionCreate:{ label: 'Go to Live Session',      href: 'session-create.html',keywords: ['live', 'session', 'panel', 'create session', 'new session', 'room'] },
  teacher:      { label: 'Go to Teacher Panel',     href: 'teacher.html',      keywords: ['teacher', 'panel', 'interrupt', 'faculty'] },
};

const ACTIONS = {
  toggleTheme:     { label: 'Toggle Dark/Light Mode',   keywords: ['dark mode', 'light mode', 'toggle theme', 'theme'] },
  toggleFocusMode: { label: 'Toggle Focus Mode',          keywords: ['focus mode', 'focus', 'distraction free', 'distraction-free'] },
  toggleDyslexia:  { label: 'Toggle Dyslexia-Friendly',    keywords: ['dyslexia', 'dyslexic', 'reading mode', 'opendyslexic'] },
  toggleLowStim:   { label: 'Toggle Low Stimulation',     keywords: ['low stim', 'low stimulation', 'grayscale', 'calm'] },
  exportCsv:       { label: 'Export Dashboard CSV',        keywords: ['export', 'csv', 'download', 'data'] },
  copyRoomCode:    { label: 'Copy Current Room Code',      keywords: ['copy code', 'room code', 'share code'] },
};

/**
 * Fuzzy match: returns score 0-1 for how well `query` matches `keywords[]`
 * Uses substring + word-boundary bonuses. No external lib needed.
 */
function fuzzyScore(query, keywords) {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  let best = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (k === q) return 1.0;
    if (k.includes(q) || q.includes(k)) return 0.8;
    // Word-boundary match: check if all query words appear in keyword
    const qWords = q.split(/\s+/);
    const allMatch = qWords.every(w => k.includes(w));
    if (allMatch) best = Math.max(best, 0.6);
    // Partial character match (simple overlap)
    let overlap = 0;
    for (const ch of q) if (k.includes(ch)) overlap++;
    const ratio = overlap / q.length;
    if (ratio > 0.5) best = Math.max(best, ratio * 0.4);
  }
  return best;
}

/**
 * Parse a query string → list of matched commands
 * Returns sorted array of { type, id, label, href, score }
 */
function parseCommands(query) {
  const q = (query || '').trim();
  const results = [];

  if (!q) {
    // Show all commands with a score of 0.5 (visible but not highlighted)
    for (const [id, route] of Object.entries(ROUTES)) {
      results.push({ type: 'route', id, label: route.label, href: route.href, score: 0.3 });
    }
    for (const [id, action] of Object.entries(ACTIONS)) {
      results.push({ type: 'action', id, label: action.label, score: 0.3 });
    }
    return results.sort((a, b) => b.score - a.score);
  }

  // Score every route
  for (const [id, route] of Object.entries(ROUTES)) {
    const score = fuzzyScore(q, route.keywords);
    if (score > 0.1) {
      results.push({ type: 'route', id, label: route.label, href: route.href, score });
    }
  }

  // Score every action
  for (const [id, action] of Object.entries(ACTIONS)) {
    const score = fuzzyScore(q, action.keywords);
    if (score > 0.1) {
      results.push({ type: 'action', id, label: action.label, score });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}

/**
 * Execute a matched result
 */
function executeResult(result) {
  if (!result) return;

  if (result.type === 'route') {
    window.location.href = result.href;
    return;
  }

  if (result.type === 'action') {
    switch (result.id) {
      case 'toggleTheme':
        document.body.classList.toggle('light-mode');
        break;
      case 'toggleFocusMode':
        document.body.classList.toggle('focus-mode');
        break;
      case 'toggleDyslexia':
        document.body.classList.toggle('dyslexia-mode');
        break;
      case 'toggleLowStim':
        document.body.classList.toggle('low-stim-mode');
        break;
      case 'exportCsv': {
        const btn = document.getElementById('export-btn') || document.getElementById('export-csv-btn');
        if (btn) btn.click();
        break;
      }
      case 'copyRoomCode': {
        const codeEl = document.getElementById('room-code-display') || document.getElementById('room-code-big');
        if (codeEl) {
          navigator.clipboard.writeText(codeEl.textContent || codeEl.innerText).catch(() => {});
        }
        break;
      }
      default:
        break;
    }
  }
}
