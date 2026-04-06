const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.json());
app.use(express.static('public'));

// ─── Config ───────────────────────────────────────────────────────────────────
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'faculty2024';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const USE_CLAUDE = !!ANTHROPIC_API_KEY;

// Ensure data directory exists
(async () => {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch (e) {}
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function readJson(filename) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, filename), 'utf8'));
  } catch { return null; }
}

async function writeJson(filename, data) {
  await fs.writeFile(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

// ─── AI Provider (Claude API or Ollama fallback) ──────────────────────────────
async function callAI(prompt) {
  if (USE_CLAUDE) {
    return await callClaude(prompt);
  } else {
    return await callOllama(prompt);
  }
}

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }
  const json = await res.json();
  return json.content?.[0]?.text || '';
}

async function callOllama(prompt) {
  const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:latest';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const json = await res.json();
    return json.response || '';
  } catch (e) {
    throw new Error(`AI call failed: ${e.message}`);
  }
}

function randRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, aiProvider: USE_CLAUDE ? 'claude' : 'ollama', timestamp: new Date().toISOString() });
});

// ─── DEMO MODE ────────────────────────────────────────────────────────────────
app.get('/api/demo/student', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    let demo = students.find(s => s.id === 'demo_student');
    if (!demo) {
      demo = {
        id: 'demo_student',
        name: 'Demo Student',
        year: '3rd Year',
        branch: 'Computer Science',
        title: 'Real-Time Collaborative Code Editor',
        description: 'A web-based IDE that allows multiple users to collaboratively edit code in real-time using operational transforms and WebSocket connections.',
        architecture: [
          { decision: 'Operational Transforms for conflict resolution', alternatives: 'CRDTs, last-write-wins', reason: 'OT gives predictable merge behavior for code edits' },
          { decision: 'WebSocket over HTTP polling', alternatives: 'HTTP long-polling, SSE', reason: 'Lower latency and bidirectional communication needed' },
          { decision: 'Monaco Editor (VS Code core)', alternatives: 'CodeMirror, Ace', reason: 'Better language support and VS Code familiarity for users' }
        ],
        limitations: 'No offline mode; OT algorithm complexity increases with concurrent users beyond 10; no git integration yet.',
        isDemo: true,
        createdAt: new Date().toISOString()
      };
      students.push(demo);
      await writeJson('students.json', students);
    }

    // Create demo questions if none
    const existingQ = await readJson('questions_demo_student.json');
    if (!existingQ) {
      await writeJson('questions_demo_student.json', {
        studentId: 'demo_student',
        generatedAt: new Date().toISOString(),
        questions: {
          tier1: [
            'Explain in simple terms what your system does and who uses it.',
            'Walk me through the main components of your architecture.'
          ],
          tier2: [
            'Why did you choose Operational Transforms over CRDTs for conflict resolution?',
            'How does your system handle network partitions or dropped WebSocket connections?',
            'What happens when two users simultaneously edit the same line of code?',
            'How does Monaco Editor integrate with your real-time sync layer?',
            'What are the scalability limits of your current WebSocket architecture?'
          ],
          tier3: [
            'If your OT server crashes mid-session, what data is lost and how do you recover?',
            'How would you handle a malicious user injecting code through your editor?',
            'What breaks first when you go from 10 to 1000 concurrent users?'
          ]
        }
      });
    }

    res.json({ studentId: 'demo_student', message: 'Demo mode active' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── STUDENTS ─────────────────────────────────────────────────────────────────
app.get('/api/students', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const enriched = await Promise.all(students.map(async (s) => {
      const scores = await readJson(`scores_${s.id}.json`);
      const questions = await readJson(`questions_${s.id}.json`);
      let baseline = null, final = null;
      if (scores && scores.length > 0) {
        const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
        const avg = sc => {
          const responses = sc.responses || [];
          if (!responses.length) return 0;
          return responses.reduce((a, r) => a + dims.reduce((s, d) => s + (r.scores?.[d] || r[d] || 0), 0) / 4, 0) / responses.length;
        };
        baseline = parseFloat(avg(scores[0]).toFixed(2));
        final = parseFloat(avg(scores[scores.length - 1]).toFixed(2));
      }
      return { ...s, questionsGenerated: !!questions, sessionCount: scores?.length || 0, baseline, final };
    }));
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/students', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const { name, year, branch, title, description, architecture, limitations } = req.body;
    if (!name || !title) return res.status(400).json({ error: 'name and title required' });
    const id = name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
    const student = { id, name, year, branch, title, description, architecture, limitations, createdAt: new Date().toISOString() };
    students.push(student);
    await writeJson('students.json', students);
    res.json(student);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/students/:id', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const student = students.find(s => s.id === req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(student);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE student
app.delete('/api/students/:id', async (req, res) => {
  try {
    let students = (await readJson('students.json')) || [];
    students = students.filter(s => s.id !== req.params.id);
    await writeJson('students.json', students);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── QUESTION GENERATION ──────────────────────────────────────────────────────
app.post('/api/generate-questions/:id', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const student = students.find(s => s.id === req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const { count = 10, focusTier } = req.body;

    const prompt = `You are generating interview questions for a student defense rehearsal.

Student Project:
- Name: ${student.name}
- Title: ${student.title}
- Description: ${student.description || 'Not provided'}
- Architecture Decisions:
${(student.architecture || []).map((a, i) => `${i+1}. ${a.decision}\n   Alternatives: ${a.alternatives}\n   Reason: ${a.reason}`).join('\n')}
- Limitations: ${student.limitations || 'Not provided'}

Generate exactly 10 questions split into 3 tiers. Format EXACTLY as:

TIER 1 — Surface Clarity (2 questions):
1. [question]
2. [question]

TIER 2 — Design Tradeoffs (5 questions):
1. [question]
2. [question]
3. [question]
4. [question]
5. [question]

TIER 3 — Failure Modes (3 questions):
1. [question]
2. [question]
3. [question]

Make questions specific to this project, not generic. Probe the actual decisions and tradeoffs mentioned.`;

    const raw = await callAI(prompt);
    const questions = { tier1: [], tier2: [], tier3: [] };
    let currentTier = null;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (/tier\s*1/i.test(trimmed)) { currentTier = 'tier1'; continue; }
      if (/tier\s*2/i.test(trimmed)) { currentTier = 'tier2'; continue; }
      if (/tier\s*3/i.test(trimmed)) { currentTier = 'tier3'; continue; }
      const qm = trimmed.match(/^\d+[\.\)]\s*(.+)/);
      if (qm && currentTier) questions[currentTier].push(qm[1]);
    }
    // Fallbacks
    if (!questions.tier1.length) questions.tier1 = ['What does your system do and who uses it?', 'Walk me through the main components of your architecture.'];
    if (!questions.tier2.length) questions.tier2 = ['Why did you choose this approach over alternatives?', 'What tradeoffs did you accept with this design?', 'How does your system handle concurrent users?', 'What was the hardest technical decision you made?', 'How would you redesign this if you started over?'];
    if (!questions.tier3.length) questions.tier3 = ['What breaks first under heavy load?', 'What are the 3 most likely failure points?', 'How do you handle data loss scenarios?'];

    const qData = { studentId: student.id, generatedAt: new Date().toISOString(), questions, raw };
    await writeJson(`questions_${student.id}.json`, qData);
    res.json({ success: true, questions, raw, aiProvider: USE_CLAUDE ? 'claude' : 'ollama' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SCORES ───────────────────────────────────────────────────────────────────
app.post('/api/scores', async (req, res) => {
  try {
    const { studentId, responses, sessionType } = req.body;
    if (!studentId || !responses) return res.status(400).json({ error: 'studentId and responses required' });
    const filename = `scores_${studentId}.json`;
    const existing = (await readJson(filename)) || [];
    const entry = {
      session: existing.length + 1,
      timestamp: new Date().toISOString(),
      sessionType: sessionType || 'solo',
      responses
    };
    existing.push(entry);
    await writeJson(filename, existing);
    res.json({ success: true, session: entry.session });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/scores/:id', async (req, res) => {
  try { res.json((await readJson(`scores_${req.params.id}.json`)) || []); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── QUESTIONS ────────────────────────────────────────────────────────────────
app.get('/api/questions/:id', async (req, res) => {
  try {
    const q = await readJson(`questions_${req.params.id}.json`);
    if (!q) return res.status(404).json({ error: 'Questions not found. Please generate questions first.' });
    res.json(q);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── AI ANSWER EVALUATION ─────────────────────────────────────────────────────
app.post('/api/evaluate-answer', async (req, res) => {
  try {
    const { studentId, questionText, answer, tier } = req.body;
    if (!answer || !questionText) return res.status(400).json({ error: 'answer and questionText required' });

    const student = studentId ? (await readJson('students.json') || []).find(s => s.id === studentId) : null;

    const prompt = `You are evaluating a student's written answer during a project defense rehearsal.

Project: ${student?.title || 'Engineering Project'}
Question (${tier || 'general'}): "${questionText}"
Student Answer: "${answer}"

Score 1-5 on each dimension:
- clarity: Explains clearly without unnecessary jargon (1=incomprehensible, 5=crystal clear)
- reasoning: Logical structure and sound argumentation (1=illogical, 5=well-reasoned)  
- depth: Technical understanding beyond surface facts (1=superficial, 5=expert depth)
- confidence: Decisive, owns the answer (1=evasive, 5=commanding)

Also provide:
- feedback: 2-3 sentence specific feedback on what was good and what to improve
- suggestion: One specific thing they should add or change in their answer

Respond ONLY with valid JSON, no markdown, no explanation:
{"clarity":N,"reasoning":N,"depth":N,"confidence":N,"feedback":"...","suggestion":"..."}`;

    const raw = await callAI(prompt);
    let result = { clarity: 3, reasoning: 3, depth: 3, confidence: 3, feedback: 'Keep working on clarity and depth.', suggestion: 'Try to be more specific about technical details.' };
    try {
      const match = raw.match(/\{[\s\S]*?\}/);
      if (match) result = { ...result, ...JSON.parse(match[0]) };
    } catch {}

    res.json({ success: true, scores: result, aiProvider: USE_CLAUDE ? 'claude' : 'ollama' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── COACHING ─────────────────────────────────────────────────────────────────
app.post('/api/coaching/:id', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const student = students.find(s => s.id === req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const scores = await readJson(`scores_${student.id}.json`);
    if (!scores || !scores.length) return res.status(400).json({ error: 'No baseline scores found. Complete at least one defense session first.' });

    const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
    const dimDescriptions = {
      clarity: 'Ability to explain concepts clearly without jargon',
      reasoning: 'Logical thinking and structured argumentation',
      depth: 'Technical depth and understanding of internals',
      confidence: 'Delivery, composure, and self-assurance'
    };

    // Average each dim across all sessions
    const dimTotals = { clarity: 0, reasoning: 0, depth: 0, confidence: 0 };
    let count = 0;
    scores.forEach(s => {
      (s.responses || []).forEach(r => {
        dims.forEach(d => { dimTotals[d] += r.scores?.[d] || r[d] || 0; });
        count++;
      });
    });
    const dimAvgs = {};
    dims.forEach(d => { dimAvgs[d] = count > 0 ? dimTotals[d] / count : 3; });
    const weakDims = dims.slice().sort((a, b) => dimAvgs[a] - dimAvgs[b]).slice(0, 2);

    const prompt = `You are a technical coach for engineering students. A student scored low on: ${weakDims.map(d => d + ' (' + dimDescriptions[d] + ')').join(' and ')}.

Student Context:
- Name: ${student.name}
- Project: ${student.title}
- Description: ${student.description || 'Not provided'}
- Architecture Decisions:
${(student.architecture || []).map((a, i) => `${i+1}. ${a.decision}`).join('\n')}

Generate exactly 8 targeted practice questions — 4 for each weak dimension:

DIMENSION: ${weakDims[0].toUpperCase()} — ${dimDescriptions[weakDims[0]]}
1. [question specific to their project]
2. [question specific to their project]
3. [question specific to their project]
4. [question specific to their project]

DIMENSION: ${weakDims[1].toUpperCase()} — ${dimDescriptions[weakDims[1]]}
1. [question specific to their project]
2. [question specific to their project]
3. [question specific to their project]
4. [question specific to their project]

Also include one tip for each dimension on how to improve, formatted as:
TIP_${weakDims[0].toUpperCase()}: [specific improvement tip]
TIP_${weakDims[1].toUpperCase()}: [specific improvement tip]`;

    const raw = await callAI(prompt);
    const coaching = {
      weakDimensions: weakDims,
      dimAverages: dimAvgs,
      questions: { [weakDims[0]]: [], [weakDims[1]]: [] },
      tips: { [weakDims[0]]: '', [weakDims[1]]: '' }
    };

    let currentDim = null;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('DIMENSION:')) {
        const dim = trimmed.replace('DIMENSION:', '').trim().split('—')[0].trim().toLowerCase();
        if (coaching.questions[dim] !== undefined) currentDim = dim;
        continue;
      }
      for (const wd of weakDims) {
        if (trimmed.startsWith(`TIP_${wd.toUpperCase()}:`)) {
          coaching.tips[wd] = trimmed.replace(`TIP_${wd.toUpperCase()}:`, '').trim();
        }
      }
      const qm = trimmed.match(/^\d+[\.\)]\s*(.+)/);
      if (qm && currentDim) coaching.questions[currentDim].push(qm[1]);
    }

    // Fallbacks
    if (!coaching.questions[weakDims[0]].length) coaching.questions[weakDims[0]] = [
      `Explain ${student.title} to a non-technical person in 2 minutes.`,
      'What is the core insight behind your approach?',
      'If someone asks "why not just use an existing tool?", how do you respond?',
      'Describe the data flow in your system end-to-end.'
    ];
    if (!coaching.questions[weakDims[1]].length) coaching.questions[weakDims[1]] = [
      'What happens to your system if the primary service goes down?',
      'Walk me through your plan to scale from 100 to 100k users.',
      'What are the 3 most likely bugs in your current implementation?',
      'If latency spikes 10x, how do you diagnose and fix it?'
    ];

    res.json({ success: true, coaching, aiProvider: USE_CLAUDE ? 'claude' : 'ollama' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PROFILE ──────────────────────────────────────────────────────────────────
app.get('/api/profile/:studentId', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const student = students.find(s => s.id === req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const scores = await readJson(`scores_${req.params.studentId}.json`);
    if (!scores || !scores.length) return res.status(404).json({ error: 'No sessions found. Complete a defense session first.' });

    const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
    const dimNames = { clarity: 'Clarity', reasoning: 'Logical Reasoning', depth: 'Technical Depth', confidence: 'Confidence' };
    const dimTotals = { clarity: 0, reasoning: 0, depth: 0, confidence: 0 };
    let totalResponses = 0;

    scores.forEach(s => {
      (s.responses || []).forEach(r => {
        dims.forEach(d => { dimTotals[d] += r.scores?.[d] || r[d] || 0; });
        totalResponses++;
      });
    });

    const dimensionAverages = {};
    dims.forEach(d => { dimensionAverages[dimNames[d]] = totalResponses > 0 ? parseFloat((dimTotals[d] / totalResponses).toFixed(2)) : 0; });

    const trajectory = scores.map(s => {
      const resps = s.responses || [];
      const avg = resps.length ? resps.reduce((sum, r) => sum + dims.reduce((ss, d) => ss + (r.scores?.[d] || r[d] || 0), 0) / 4, 0) / resps.length : 0;
      return { session: s.session, avg: parseFloat(avg.toFixed(2)), timestamp: s.timestamp };
    });

    const getSessionAvg = (sess) => {
      const resps = sess.responses || [];
      const result = {};
      dims.forEach(d => { result[d] = resps.length ? resps.reduce((s, r) => s + (r.scores?.[d] || r[d] || 0), 0) / resps.length : 0; });
      return result;
    };

    const firstAvg = getSessionAvg(scores[0]);
    const lastAvg = getSessionAvg(scores[scores.length - 1]);
    const improvements = {};
    dims.forEach(d => { improvements[d] = lastAvg[d] - firstAvg[d]; });

    const sortedImp = dims.slice().sort((a, b) => improvements[b] - improvements[a]);
    const sortedAvg = dims.slice().sort((a, b) => dimensionAverages[dimNames[a]] - dimensionAverages[dimNames[b]]);

    res.json({
      studentId: student.id, studentName: student.name, projectTitle: student.title,
      year: student.year, branch: student.branch,
      totalSessions: scores.length, dimensionAverages,
      mostImproved: dimNames[sortedImp[0]], weakest: dimNames[sortedAvg[0]],
      trajectory, dimDescriptions: dimNames,
      dimImprovements: Object.fromEntries(dims.map(d => [dimNames[d], parseFloat(improvements[d].toFixed(2))]))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
app.get('/api/analytics/cohort', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
    const dimNames = { clarity: 'Clarity', reasoning: 'Logical Reasoning', depth: 'Technical Depth', confidence: 'Confidence' };
    let totalDimSum = { clarity: 0, reasoning: 0, depth: 0, confidence: 0 };
    let totalResponses = 0;
    let studentsWithMultipleSessions = 0;
    let allDeltas = [], atRisk = [], allSummaries = [];

    for (const student of students) {
      const scores = await readJson(`scores_${student.id}.json`);
      if (!scores || !scores.length) continue;
      let sTotal = 0, sCount = 0;
      const sDimTotals = { clarity: 0, reasoning: 0, depth: 0, confidence: 0 };
      scores.forEach(sess => {
        (sess.responses || []).forEach(r => {
          dims.forEach(d => sDimTotals[d] += r.scores?.[d] || r[d] || 0);
          sTotal += dims.reduce((sum, d) => sum + (r.scores?.[d] || r[d] || 0), 0) / 4;
          sCount++;
        });
      });
      const avg = sCount > 0 ? sTotal / sCount : 0;
      const getAvg = (sess) => {
        const resps = sess.responses || [];
        return resps.length ? resps.reduce((s, r) => s + dims.reduce((ss, d) => ss + (r.scores?.[d] || r[d] || 0), 0) / 4, 0) / resps.length : 0;
      };
      const finalAvg = getAvg(scores[scores.length - 1]);
      const baselineAvg = getAvg(scores[0]);
      const delta = finalAvg - baselineAvg;
      if (scores.length >= 2) studentsWithMultipleSessions++;
      if (scores.length >= 2 && finalAvg < 3.0) atRisk.push({ id: student.id, name: student.name, title: student.title, sessions: scores.length, finalAvg: parseFloat(finalAvg.toFixed(2)), delta: parseFloat(delta.toFixed(2)) });
      if (avg > 0) allSummaries.push({ id: student.id, name: student.name, title: student.title, avg: parseFloat(avg.toFixed(2)), finalAvg: parseFloat(finalAvg.toFixed(2)) });
      if (sCount > 0) { dims.forEach(d => { totalDimSum[d] += sDimTotals[d]; }); totalResponses += sCount; }
      if (delta) allDeltas.push(delta);
    }

    const dimensionAverages = {};
    dims.forEach(d => { dimensionAverages[dimNames[d]] = totalResponses > 0 ? parseFloat((totalDimSum[d] / totalResponses).toFixed(2)) : 0; });
    const sortedDims = dims.slice().sort((a, b) => dimensionAverages[dimNames[a]] - dimensionAverages[dimNames[b]]);
    const topPerformers = allSummaries.sort((a, b) => (b.finalAvg || 0) - (a.finalAvg || 0)).slice(0, 3);
    const avgImprovement = allDeltas.length > 0 ? parseFloat((allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length).toFixed(2)) : null;

    res.json({ totalStudents: students.length, studentsWithMultipleSessions, averageImprovement: avgImprovement, dimensionWeaknesses: sortedDims.map(d => ({ dimension: dimNames[d], average: dimensionAverages[dimNames[d]] })), topPerformers, atRisk, allSummaries });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── EXPORT (PDF-ready JSON) ───────────────────────────────────────────────────
app.get('/api/export/:studentId', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const student = students.find(s => s.id === req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const scores = await readJson(`scores_${student.id}.json`) || [];
    const questions = await readJson(`questions_${student.id}.json`);
    res.json({ student, scores, questions, exportedAt: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// ─── FACULTY PORTAL AUTH ──────────────────────────────────────────────────────
app.post('/api/faculty-auth', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password required' });
  if (password !== TEACHER_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
  const token = `faculty-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  res.json({ token, role: 'faculty' });
});
// ─── PANEL SESSIONS ───────────────────────────────────────────────────────────
app.post('/api/sessions/create', async (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId required' });
    const students = (await readJson('students.json')) || [];
    const student = students.find(s => s.id === studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const sessions = (await readJson('sessions.json')) || [];
    const roomCode = randRoomCode();
    const sessionId = uuidv4();
    const session = {
      id: sessionId, studentId, studentName: student.name, projectTitle: student.title,
      roomCode, phase: 'waiting', teachers: [],
      questions: (await readJson(`questions_${studentId}.json`)) || null,
      aiScores: {}, teacherScores: {}, panelQuestions: [], interruptions: [], disagreements: [],
      createdAt: Date.now()
    };
    sessions.push(session);
    await writeJson('sessions.json', sessions);
    io.emit('session-created', { sessionId, roomCode, studentName: student.name });
    res.json({ sessionId, roomCode, teacherInviteUrl: `/teacher.html?room=${roomCode}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sessions/:roomCode', async (req, res) => {
  try {
    const sessions = (await readJson('sessions.json')) || [];
    const session = sessions.find(s => s.roomCode === req.params.roomCode.toUpperCase());
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const { teacherScores, disagreements, ...pub } = session;
    res.json({ ...pub, teacherScores: teacherScores || {}, disagreements: disagreements || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sessions/:roomCode/teacher-auth', async (req, res) => {
  try {
    const { password, teacherName } = req.body;
    if (!password || !teacherName) return res.status(400).json({ error: 'password and teacherName required' });
    if (password !== TEACHER_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
    const teacherId = uuidv4();
    res.json({ token: `${req.params.roomCode}-${teacherId}`, teacherId, teacherName });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/evaluate-response', async (req, res) => {
  try {
    const { sessionId, questionIndex, transcript, questionText } = req.body;
    if (!transcript) return res.status(400).json({ error: 'transcript required' });
    const sessions = (await readJson('sessions.json')) || [];
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const prompt = `Evaluate this student's verbal defense response.
Project: ${session.projectTitle}
Question: ${questionText || 'General defense question'}
Student Response: "${transcript}"
Rate 1-5: clarity, reasoning, depth, confidence.
Respond ONLY with JSON: {"clarity":N,"reasoning":N,"depth":N,"confidence":N}`;

    const raw = await callAI(prompt);
    let scores = { clarity: 3, reasoning: 3, depth: 3, confidence: 3 };
    try { const m = raw.match(/\{[\s\S]*?\}/); if (m) scores = { ...scores, ...JSON.parse(m[0]) }; } catch {}

    if (session.aiScores) session.aiScores[questionIndex] = { ...scores, transcript, scoredAt: Date.now() };
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx !== -1) sessions[idx] = session;
    await writeJson('sessions.json', sessions);
    io.to(session.roomCode).emit('ai-score', { questionIndex, scores, transcript });
    res.json({ success: true, scores });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join-session', ({ roomCode, role, teacherId, teacherName }) => {
    if (!roomCode) return;
    socket.join(roomCode);
    socket.data = { roomCode, role, teacherId, teacherName };
    if (role === 'teacher') {
      (async () => {
        const sessions = (await readJson('sessions.json')) || [];
        const idx = sessions.findIndex(s => s.roomCode === roomCode);
        if (idx !== -1) {
          const session = sessions[idx];
          if (!session.teachers) session.teachers = [];
          if (!session.teachers.find(t => t.teacherId === teacherId)) {
            session.teachers.push({ teacherId, teacherName, joinedAt: Date.now() });
          }
          sessions[idx] = session;
          await writeJson('sessions.json', sessions);
          const count = session.teachers.length;
          io.to(roomCode).emit('teacher-joined', { teacherId, teacherName, count });
          socket.emit('teachers-list', { teachers: session.teachers });
        }
      })();
    }
    if (role === 'student') io.to(roomCode).emit('student-ready', { studentName: socket.data.studentName });
  });

  socket.on('webrtc-offer', ({ roomCode, offer, teacherId }) => socket.to(roomCode).emit('webrtc-offer', { offer, forTeacherId: teacherId }));
  socket.on('webrtc-answer', ({ roomCode, answer }) => socket.to(roomCode).emit('webrtc-answer', { answer }));
  socket.on('webrtc-ice', ({ roomCode, candidate, toTeacherId }) => socket.to(roomCode).emit('webrtc-ice', { candidate, toTeacherId }));
  socket.on('transcript-chunk', ({ roomCode, text, isFinal }) => socket.to(roomCode).emit('transcript-chunk', { text, isFinal }));

  socket.on('phase-change', async ({ roomCode, phase, questionIndex }) => {
    const sessions = (await readJson('sessions.json')) || [];
    const idx = sessions.findIndex(s => s.roomCode === roomCode);
    if (idx !== -1) { sessions[idx].phase = phase; sessions[idx].currentQuestionIndex = questionIndex; await writeJson('sessions.json', sessions); }
    io.to(roomCode).emit('phase-changed', { phase, questionIndex });
  });

  socket.on('teacher-interrupt', async ({ roomCode, teacherId, teacherName, question }) => {
    const sessions = (await readJson('sessions.json')) || [];
    const idx = sessions.findIndex(s => s.roomCode === roomCode);
    if (idx !== -1) {
      if (!sessions[idx].panelQuestions) sessions[idx].panelQuestions = [];
      sessions[idx].panelQuestions.push({ teacherId, teacherName, question, timestamp: Date.now(), answered: false });
      await writeJson('sessions.json', sessions);
    }
    io.to(roomCode).emit('interrupt-fired', { teacherId, teacherName, question });
  });

  socket.on('teacher-score', async ({ roomCode, teacherId, questionIndex, scores, feedback }) => {
    const sessions = (await readJson('sessions.json')) || [];
    const idx = sessions.findIndex(s => s.roomCode === roomCode);
    if (idx === -1) return;
    const session = sessions[idx];
    if (!session.teacherScores) session.teacherScores = {};
    if (!session.teacherScores[teacherId]) session.teacherScores[teacherId] = {};
    session.teacherScores[teacherId][questionIndex] = { scores, feedback, scoredAt: Date.now() };
    const dims = ['clarity', 'reasoning', 'depth', 'ownership'];
    const teacherIds = Object.keys(session.teacherScores);
    const grid = {};
    const flagged = [];
    dims.forEach(dim => {
      grid[dim] = {};
      const vals = teacherIds.map(tid => session.teacherScores[tid][questionIndex]?.scores?.[dim]).filter(v => v != null);
      teacherIds.forEach(tid => { grid[dim][tid] = session.teacherScores[tid][questionIndex]?.scores?.[dim] || null; });
      if (vals.length >= 2) { const mean = vals.reduce((a, b) => a + b, 0) / vals.length; const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length); if (std > 1.0) flagged.push(dim); }
    });
    sessions[idx] = session;
    await writeJson('sessions.json', sessions);
    io.to(roomCode).emit('score-update', { questionIndex, grid, flagged, canClose: flagged.length === 0, teachers: session.teachers });
  });

  socket.on('resolve-disagreement', async ({ roomCode, questionIndex, dimension, finalScore, resolvingTeacherId, dissentReason }) => {
    const sessions = (await readJson('sessions.json')) || [];
    const idx = sessions.findIndex(s => s.roomCode === roomCode);
    if (idx === -1) return;
    if (!sessions[idx].disagreements) sessions[idx].disagreements = [];
    const entry = { questionIndex, dimension, finalScore, resolvingTeacherId, dissentReason, resolvedAt: Date.now() };
    const ei = sessions[idx].disagreements.findIndex(d => d.questionIndex === questionIndex && d.dimension === dimension);
    if (ei !== -1) sessions[idx].disagreements[ei] = entry; else sessions[idx].disagreements.push(entry);
    await writeJson('sessions.json', sessions);
    io.to(roomCode).emit('disagreement-resolved', { questionIndex, dimension, finalScore });
  });

  socket.on('add-panel-question', async ({ roomCode, teacherId, teacherName, question }) => {
    const sessions = (await readJson('sessions.json')) || [];
    const idx = sessions.findIndex(s => s.roomCode === roomCode);
    if (idx !== -1) {
      if (!sessions[idx].panelQuestions) sessions[idx].panelQuestions = [];
      sessions[idx].panelQuestions.push({ teacherId, teacherName, question, timestamp: Date.now(), answered: false });
      await writeJson('sessions.json', sessions);
      io.to(roomCode).emit('panel-question-added', { teacherId, teacherName, question });
    }
  });

  socket.on('mark-panel-answered', async ({ roomCode, questionIndex }) => {
    const sessions = (await readJson('sessions.json')) || [];
    const idx = sessions.findIndex(s => s.roomCode === roomCode);
    if (idx !== -1 && sessions[idx].panelQuestions?.[questionIndex]) {
      sessions[idx].panelQuestions[questionIndex].answered = true;
      await writeJson('sessions.json', sessions);
      io.to(roomCode).emit('panel-question-answered', { questionIndex });
    }
  });

  socket.on('student-answered', (data) => socket.to(data.roomCode).emit('student-answered', data));

  socket.on('session-close', async ({ roomCode }) => {
    const sessions = (await readJson('sessions.json')) || [];
    const idx = sessions.findIndex(s => s.roomCode === roomCode);
    if (idx === -1) return;
    const session = sessions[idx];
    sessions[idx].phase = 'closed';
    await writeJson('sessions.json', sessions);
    io.to(roomCode).emit('session-closed', { finalScores: session.aiScores });
  });

  socket.on('disconnect', () => {});
});

httpServer.listen(PORT, () => {
  console.log(`PDRS running at http://localhost:${PORT}`);
  console.log(`AI Provider: ${USE_CLAUDE ? 'Claude API ✓' : 'Ollama (set ANTHROPIC_API_KEY to use Claude)'}`);
});
