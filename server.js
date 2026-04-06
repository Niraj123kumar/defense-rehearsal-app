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
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.json());
app.use(express.static('public'));

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'llama3.2:latest';
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'faculty2024';

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

async function callOllama(prompt) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
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
    console.error("Ollama failed:", e.message);
    return "";
  }
}

function randRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── Existing REST Routes ─────────────────────────────────────────────────────

// GET /api/students
app.get('/api/students', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const enriched = await Promise.all(students.map(async (s) => {
      const scores = await readJson(`scores_${s.id}.json`);
      const questions = await readJson(`questions_${s.id}.json`);
      let baseline = null, final = null;
      if (scores && scores.length > 0) {
        const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
        const avg = sc => dims.reduce((a, d) => a + (sc[d] || 0), 0) / 4;
        baseline = avg(scores[0]);
        final = avg(scores[scores.length - 1]);
      }
      return { ...s, questionsGenerated: !!questions, baseline, final };
    }));
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/students
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

// GET /api/students/:id
app.get('/api/students/:id', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const student = students.find(s => s.id === req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(student);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/generate-questions/:id
app.post('/api/generate-questions/:id', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const student = students.find(s => s.id === req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

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
3. [question]`;

    const raw = await callOllama(prompt);
    const questions = { tier1: [], tier2: [], tier3: [] };
    const tierMap = { 'tier 1': 'tier1', 'tier 2': 'tier2', 'tier 3': 'tier3' };
    let currentTier = null;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      const m = trimmed.match(/^tier\s*[123]/i);
      if (m) { currentTier = tierMap[m[0].replace(/\s+/g, ' ').toLowerCase()]; continue; }
      const qm = trimmed.match(/^\d+[\.\)]\s*(.+)/);
      if (qm && currentTier) questions[currentTier].push(qm[1]);
    }
    if (!questions.tier1.length && !questions.tier2.length && !questions.tier3.length) {
      questions.tier1 = ['What does your system do?', 'What are the main components?'];
      questions.tier2 = ['Why did you choose this approach?', 'What alternatives did you consider?', 'What are the tradeoffs?', 'How does it compare to alternatives?', 'What would you do differently?'];
      questions.tier3 = ['What breaks under load?', 'What are the failure points?', 'How do you handle errors?'];
    }
    await writeJson(`questions_${student.id}.json`, { studentId: student.id, generatedAt: new Date().toISOString(), questions });
    res.json({ success: true, questions, raw });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/scores
app.post('/api/scores', async (req, res) => {
  try {
    const { studentId, responses } = req.body;
    if (!studentId || !responses) return res.status(400).json({ error: 'studentId and responses required' });
    const filename = `scores_${studentId}.json`;
    const existing = (await readJson(filename)) || [];
    const entry = { session: existing.length + 1, timestamp: new Date().toISOString(), responses };
    existing.push(entry);
    await writeJson(filename, existing);
    res.json({ success: true, session: entry.session });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/scores/:id
app.get('/api/scores/:id', async (req, res) => {
  try { res.json((await readJson(`scores_${req.params.id}.json`)) || []); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/questions/:id
app.get('/api/questions/:id', async (req, res) => {
  try {
    const q = await readJson(`questions_${req.params.id}.json`);
    if (!q) return res.status(404).json({ error: 'Questions not found' });
    res.json(q);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/coaching/:id
app.post('/api/coaching/:id', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const student = students.find(s => s.id === req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const scores = await readJson(`scores_${student.id}.json`);
    if (!scores || !scores.length) return res.status(400).json({ error: 'No baseline scores found.' });
    const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
    const first = scores[0].responses;
    const weakDims = dims.slice().sort((a, b) => (first[a] || 3) - (first[b] || 3)).slice(0, 2);
    const dimDescriptions = { clarity: 'Ability to explain concepts clearly without jargon', reasoning: 'Logical thinking and structured argumentation', depth: 'Technical depth and understanding of internals', confidence: 'Delivery, composure, and self-assurance' };
    const prompt = `You are a technical coach. A student scored low on: ${weakDims.join(' and ')}.

Student Context:
- Name: ${student.name}
- Project: ${student.title}
- Description: ${student.description || 'Not provided'}
- Architecture Decisions:
${(student.architecture || []).map((a, i) => `${i+1}. ${a.decision}\n   Alternatives: ${a.alternatives}\n   Reason: ${a.reason}`).join('\n')}

Generate exactly 8 practice questions — 4 for each weak dimension — formatted as:

DIMENSION: ${weakDims[0].toUpperCase()} — ${dimDescriptions[weakDims[0]]}
1. [question]
2. [question]
3. [question]
4. [question]

DIMENSION: ${weakDims[1].toUpperCase()} — ${dimDescriptions[weakDims[1]]}
1. [question]
2. [question]
3. [question]
4. [question]`;

    const raw = await callOllama(prompt);
    const coaching = { weakDimensions: weakDims, questions: { [weakDims[0]]: [], [weakDims[1]]: [] } };
    let currentDim = null;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('DIMENSION:')) {
        const dim = trimmed.split(':')[1].trim().split('—')[0].trim().toLowerCase();
        if (coaching.questions[dim] !== undefined) currentDim = dim;
        continue;
      }
      const qm = trimmed.match(/^\d+[\.\)]\s*(.+)/);
      if (qm && currentDim) coaching.questions[currentDim].push(qm[1]);
    }
    if (!coaching.questions[weakDims[0]].length) coaching.questions[weakDims[0]] = [`Explain ${student.title} to a non-technical person in 2 minutes.`, 'What is the core insight behind your approach?', 'If someone asks "why not just X?", how do you respond?', 'Describe the data flow in your system end-to-end.'];
    if (!coaching.questions[weakDims[1]].length) coaching.questions[weakDims[1]] = ['What happens to your system if the database goes down?', 'Walk me through your scaling plan from 100 to 100k users.', 'What are the 3 most likely bugs in your system?', 'If your API latency spikes 10x, how do you diagnose it?'];
    res.json({ success: true, coaching });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/profile/:studentId
app.get('/api/profile/:studentId', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const student = students.find(s => s.id === req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const scores = await readJson(`scores_${req.params.studentId}.json`);
    if (!scores || !scores.length) return res.status(404).json({ error: 'No sessions found' });
    const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
    const dimNames = { clarity: 'Clarity', reasoning: 'Logical Reasoning', depth: 'Technical Depth', confidence: 'Confidence' };
    const dimTotals = { clarity: 0, reasoning: 0, depth: 0, confidence: 0 };
    let totalResponses = 0;
    scores.forEach(s => { s.responses.forEach(r => { dims.forEach(d => { dimTotals[d] += r.scores[d] || 0; }); totalResponses++; }); });
    const dimensionAverages = {}; dims.forEach(d => { dimensionAverages[dimNames[d]] = totalResponses > 0 ? parseFloat((dimTotals[d] / totalResponses).toFixed(2)) : 0; });
    const trajectory = scores.map(s => {
      const avg = s.responses.length ? s.responses.reduce((sum, r) => sum + dims.reduce((s, d) => s + (r.scores[d] || 0), 0) / 4, 0) / s.responses.length : 0;
      return { session: s.session, avg: parseFloat(avg.toFixed(2)) };
    });
    const firstDimAvg = {}; const lastDimAvg = {};
    dims.forEach(d => { firstDimAvg[d] = scores[0].responses.reduce((sum, r) => sum + (r.scores[d] || 0), 0) / scores[0].responses.length; lastDimAvg[d] = scores[scores.length - 1].responses.reduce((sum, r) => sum + (r.scores[d] || 0), 0) / scores[scores.length - 1].responses.length; });
    const improvements = {}; dims.forEach(d => { improvements[d] = lastDimAvg[d] - firstDimAvg[d]; });
    const sortedImp = dims.slice().sort((a, b) => improvements[b] - improvements[a]);
    const sortedAvg = dims.slice().sort((a, b) => dimensionAverages[dimNames[a]] - dimensionAverages[dimNames[b]]);
    res.json({ studentId: student.id, studentName: student.name, projectTitle: student.title, totalSessions: scores.length, dimensionAverages, mostImproved: dimNames[sortedImp[0]], weakest: dimNames[sortedAvg[0]], trajectory, dimDescriptions: dimNames, dimImprovements: Object.fromEntries(dims.map(d => [dimNames[d], parseFloat(improvements[d].toFixed(2))])) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/analytics/cohort
app.get('/api/analytics/cohort', async (req, res) => {
  try {
    const students = (await readJson('students.json')) || [];
    const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
    const dimNames = { clarity: 'Clarity', reasoning: 'Logical Reasoning', depth: 'Technical Depth', confidence: 'Confidence' };
    let totalDimSum = { clarity: 0, reasoning: 0, depth: 0, confidence: 0 }; let totalResponses = 0;
    let studentsWithMultipleSessions = 0; let allDeltas = []; let atRisk = []; let allSummaries = [];
    for (const student of students) {
      const scores = await readJson(`scores_${student.id}.json`);
      if (!scores || !scores.length) continue;
      let sTotal = 0, sCount = 0; const sDimTotals = { clarity: 0, reasoning: 0, depth: 0, confidence: 0 };
      scores.forEach(sess => { sess.responses.forEach(r => { dims.forEach(d => sDimTotals[d] += r.scores[d] || 0); sTotal += dims.reduce((sum, d) => sum + (r.scores[d] || 0), 0) / 4; sCount++; }); });
      const avg = sCount > 0 ? sTotal / sCount : 0;
      const finalAvg = scores.length > 1 ? scores[scores.length - 1].responses.reduce((sum, r) => sum + dims.reduce((s, d) => s + (r.scores[d] || 0), 0) / 4, 0) / scores[scores.length - 1].responses.length : avg;
      const baselineAvg = scores[0].responses.reduce((sum, r) => sum + dims.reduce((s, d) => s + (r.scores[d] || 0), 0) / 4, 0) / scores[0].responses.length;
      const delta = finalAvg - baselineAvg;
      if (scores.length >= 2) studentsWithMultipleSessions++;
      if (scores.length >= 2 && finalAvg < 3.0) atRisk.push({ id: student.id, name: student.name, title: student.title, sessions: scores.length, finalAvg: parseFloat(finalAvg.toFixed(2)), delta: parseFloat(delta.toFixed(2)) });
      if (avg > 0) allSummaries.push({ id: student.id, name: student.name, title: student.title, avg: parseFloat(avg.toFixed(2)), finalAvg: parseFloat(finalAvg.toFixed(2)) });
      if (sCount > 0) { dims.forEach(d => { totalDimSum[d] += sDimTotals[d]; }); totalResponses += sCount; }
      if (delta) allDeltas.push(delta);
    }
    const dimensionAverages = {}; dims.forEach(d => { dimensionAverages[dimNames[d]] = totalResponses > 0 ? parseFloat((totalDimSum[d] / totalResponses).toFixed(2)) : 0; });
    const sortedDims = dims.slice().sort((a, b) => dimensionAverages[dimNames[a]] - dimensionAverages[dimNames[b]]);
    const topPerformers = allSummaries.sort((a, b) => (b.finalAvg || 0) - (a.finalAvg || 0)).slice(0, 3);
    const avgImprovement = allDeltas.length > 0 ? parseFloat((allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length).toFixed(2)) : null;
    res.json({ totalStudents: students.length, studentsWithMultipleSessions, averageImprovement: avgImprovement, dimensionWeaknesses: sortedDims.map(d => ({ dimension: dimNames[d], average: dimensionAverages[dimNames[d]] })), topPerformers, atRisk });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PANEL SESSION ROUTES ─────────────────────────────────────────────────────

// POST /api/sessions/create
app.post('/api/sessions/create', async (req, res) => {
  try {
    const { studentId, teacherEmails } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId required' });
    const students = (await readJson('students.json')) || [];
    const student = students.find(s => s.id === studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const sessions = (await readJson('sessions.json')) || [];
    const roomCode = randRoomCode();
    const sessionId = uuidv4();
    const teacherInviteUrl = `http://localhost:3000/teacher.html?room=${roomCode}`;

    const session = {
      id: sessionId,
      studentId,
      studentName: student.name,
      projectTitle: student.title,
      roomCode,
      teacherInviteUrl,
      teacherEmails: teacherEmails || [],
      phase: 'waiting',
      teachers: [],
      questions: (await readJson(`questions_${studentId}.json`)) || null,
      aiScores: {},
      teacherScores: {},
      panelQuestions: [],
      interruptions: [],
      disagreements: [],
      createdAt: Date.now()
    };

    sessions.push(session);
    await writeJson('sessions.json', sessions);
    io.emit('session-created', { sessionId, roomCode, studentName: student.name });

    res.json({ sessionId, roomCode, teacherInviteUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/sessions/:roomCode
app.get('/api/sessions/:roomCode', async (req, res) => {
  try {
    const sessions = (await readJson('sessions.json')) || [];
    const session = sessions.find(s => s.roomCode === req.params.roomCode.toUpperCase());
    if (!session) return res.status(404).json({ error: 'Session not found' });
    // Don't expose internal fields
    const { teacherScores, disagreements, ...pub } = session;
    res.json({ ...pub, teacherScores: teacherScores || {}, disagreements: disagreements || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/sessions/:roomCode/teacher-auth
app.post('/api/sessions/:roomCode/teacher-auth', async (req, res) => {
  try {
    const { password, teacherName } = req.body;
    if (!password || !teacherName) return res.status(400).json({ error: 'password and teacherName required' });
    const valid = await bcrypt.compare(password, await bcrypt.hash(TEACHER_PASSWORD, 10));
    // For simplicity, just check plain text (already hashed above won't match)
    // Use plain comparison instead:
    if (password !== TEACHER_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
    const teacherId = uuidv4();
    const token = `${req.params.roomCode}-${teacherId}`;
    res.json({ token, teacherId, teacherName });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/evaluate-response (AI scoring for live panel sessions)
app.post('/api/evaluate-response', async (req, res) => {
  try {
    const { sessionId, questionIndex, transcript, questionText } = req.body;
    if (!transcript) return res.status(400).json({ error: 'transcript required' });

    const sessions = (await readJson('sessions.json')) || [];
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
    const dimDescriptions = { clarity: 'Explains concepts clearly and jargon-free', reasoning: 'Logical structure and clear argumentation', depth: 'Knows internals, not just surface facts', confidence: 'Composed delivery with self-assurance' };

    const prompt = `You are evaluating a student's verbal defense response.

Student Project: ${session.projectTitle}
Question: ${questionText || 'General defense question'}
Student Response: "${transcript}"

Rate the student 1-5 on each dimension:
- Clarity: ${dimDescriptions.clarity}
- Reasoning: ${dimDescriptions.reasoning}
- Technical Depth: ${dimDescriptions.depth}
- Confidence: ${dimDescriptions.confidence}

Respond ONLY with valid JSON in this exact format, no explanation:
{"clarity": N, "reasoning": N, "depth": N, "confidence": N}`;

    const raw = await callOllama(prompt);
    let scores = { clarity: 3, reasoning: 3, depth: 3, confidence: 3 };
    try {
      const match = raw.match(/\{[\s\S]*?\}/);
      if (match) scores = { ...scores, ...JSON.parse(match[0]) };
    } catch {}

    // Save AI score
    if (session.aiScores) {
      session.aiScores[questionIndex] = { ...scores, transcript, scoredAt: Date.now() };
    }

    // Update session in sessions.json
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx !== -1) sessions[idx] = session;
    await writeJson('sessions.json', sessions);

    io.to(session.roomCode).emit('ai-score', { questionIndex, scores, transcript });
    res.json({ success: true, scores });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Socket.io Logic ──────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log('[socket] connected:', socket.id);

  socket.on('join-session', ({ roomCode, role, teacherId, teacherName }) => {
    if (!roomCode) return;
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.role = role;
    socket.data.teacherId = teacherId;
    socket.data.teacherName = teacherName;

    if (role === 'teacher') {
      // Add teacher to session
      (async () => {
        try {
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
          }
          const count = sessions.find(s => s.roomCode === roomCode)?.teachers?.length || 1;
          io.to(roomCode).emit('teacher-joined', { teacherId, teacherName, count });
          // If student already there, notify teachers
          socket.emit('teachers-list', { teachers: sessions.find(s => s.roomCode === roomCode)?.teachers || [] });
        } catch (e) { console.error('[join-session teacher] error:', e); }
      })();
    }

    if (role === 'student') {
      io.to(roomCode).emit('student-ready', { studentName: socket.data.studentName });
    }
  });

  // WebRTC signaling
  socket.on('webrtc-offer', ({ roomCode, offer, teacherId }) => {
    console.log('[socket] webrtc-offer to room', roomCode, 'for teacher', teacherId);
    socket.to(roomCode).emit('webrtc-offer', { offer, forTeacherId: teacherId });
  });

  socket.on('webrtc-answer', ({ roomCode, answer, toTeacherId }) => {
    console.log('[socket] webrtc-answer to room', roomCode);
    socket.to(roomCode).emit('webrtc-answer', { answer, toTeacherId });
  });

  socket.on('webrtc-ice', ({ roomCode, candidate, toTeacherId }) => {
    socket.to(roomCode).emit('webrtc-ice', { candidate, toTeacherId });
  });

  // Transcript streaming for live view
  socket.on('transcript-chunk', ({ roomCode, text, isFinal }) => {
    socket.to(roomCode).emit('transcript-chunk', { text, isFinal });
  });

  // Phase management
  socket.on('phase-change', async ({ roomCode, phase, questionIndex }) => {
    try {
      const sessions = (await readJson('sessions.json')) || [];
      const idx = sessions.findIndex(s => s.roomCode === roomCode);
      if (idx !== -1) {
        sessions[idx].phase = phase;
        sessions[idx].currentQuestionIndex = questionIndex;
        await writeJson('sessions.json', sessions);
      }
      io.to(roomCode).emit('phase-changed', { phase, questionIndex });
    } catch (e) { console.error('[phase-change] error:', e); }
  });

  // Teacher interrupt
  socket.on('teacher-interrupt', async ({ roomCode, teacherId, teacherName, question }) => {
    try {
      const sessions = (await readJson('sessions.json')) || [];
      const idx = sessions.findIndex(s => s.roomCode === roomCode);
      if (idx !== -1) {
        const session = sessions[idx];
        if (!session.panelQuestions) session.panelQuestions = [];
        session.panelQuestions.push({ teacherId, teacherName, question, timestamp: Date.now(), answered: false });
        if (!session.interruptions) session.interruptions = [];
        session.interruptions.push({ teacherId, teacherName, question, timestamp: Date.now() });
        sessions[idx] = session;
        await writeJson('sessions.json', sessions);
      }
      io.to(roomCode).emit('interrupt-fired', { teacherId, teacherName, question });
    } catch (e) { console.error('[teacher-interrupt] error:', e); }
  });

  // Teacher score submission
  socket.on('teacher-score', async ({ roomCode, teacherId, questionIndex, scores, feedback }) => {
    try {
      const sessions = (await readJson('sessions.json')) || [];
      const idx = sessions.findIndex(s => s.roomCode === roomCode);
      if (idx === -1) return;
      const session = sessions[idx];
      if (!session.teacherScores) session.teacherScores = {};
      if (!session.teacherScores[teacherId]) session.teacherScores[teacherId] = {};
      session.teacherScores[teacherId][questionIndex] = { scores, feedback, scoredAt: Date.now() };

      // Compute disagreement across teachers for this question
      const dims = ['clarity', 'reasoning', 'depth', 'ownership'];
      const teacherIds = Object.keys(session.teacherScores);
      const grid = {};
      const flagged = [];
      dims.forEach(dim => {
        const vals = teacherIds.map(tid => session.teacherScores[tid][questionIndex]?.scores?.[dim]).filter(v => v != null);
        grid[dim] = {};
        teacherIds.forEach(tid => { grid[dim][tid] = session.teacherScores[tid][questionIndex]?.scores?.[dim] || null; });
        if (vals.length >= 2) {
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
          const stddev = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
          if (stddev > 1.0) flagged.push(dim);
        }
      });

      // Check resolved disagreements
      if (!session.disagreements) session.disagreements = [];
      const canClose = flagged.length === 0 || flagged.every(f => session.disagreements.find(d => d.questionIndex === questionIndex && d.dimension === f && d.resolved));

      sessions[idx] = session;
      await writeJson('sessions.json', sessions);

      io.to(roomCode).emit('score-update', {
        questionIndex,
        grid,
        flagged,
        canClose,
        teachers: session.teachers
      });
    } catch (e) { console.error('[teacher-score] error:', e); }
  });

  // Resolve disagreement
  socket.on('resolve-disagreement', async ({ roomCode, questionIndex, dimension, finalScore, resolvingTeacherId, dissentReason }) => {
    try {
      const sessions = (await readJson('sessions.json')) || [];
      const idx = sessions.findIndex(s => s.roomCode === roomCode);
      if (idx === -1) return;
      const session = sessions[idx];
      if (!session.disagreements) session.disagreements = [];
      const existing = session.disagreements.findIndex(d => d.questionIndex === questionIndex && d.dimension === dimension);
      const entry = { questionIndex, dimension, finalScore, resolvingTeacherId, dissentReason, resolvedAt: Date.now() };
      if (existing !== -1) session.disagreements[existing] = entry;
      else session.disagreements.push(entry);
      sessions[idx] = session;
      await writeJson('sessions.json', sessions);
      io.to(roomCode).emit('disagreement-resolved', { questionIndex, dimension, finalScore });
    } catch (e) { console.error('[resolve-disagreement] error:', e); }
  });

  // Add panel round question
  socket.on('add-panel-question', async ({ roomCode, teacherId, teacherName, question }) => {
    try {
      const sessions = (await readJson('sessions.json')) || [];
      const idx = sessions.findIndex(s => s.roomCode === roomCode);
      if (idx !== -1) {
        const session = sessions[idx];
        if (!session.panelQuestions) session.panelQuestions = [];
        session.panelQuestions.push({ teacherId, teacherName, question, timestamp: Date.now(), answered: false });
        sessions[idx] = session;
        await writeJson('sessions.json', sessions);
        io.to(roomCode).emit('panel-question-added', { teacherId, teacherName, question });
      }
    } catch (e) { console.error('[add-panel-question] error:', e); }
  });

  // Mark panel question answered
  socket.on('mark-panel-answered', async ({ roomCode, questionIndex }) => {
    try {
      const sessions = (await readJson('sessions.json')) || [];
      const idx = sessions.findIndex(s => s.roomCode === roomCode);
      if (idx !== -1 && sessions[idx].panelQuestions) {
        sessions[idx].panelQuestions[questionIndex].answered = true;
        await writeJson('sessions.json', sessions);
        io.to(roomCode).emit('panel-question-answered', { questionIndex });
      }
    } catch (e) { console.error('[mark-panel-answered] error:', e); }
  });

  // Session close
  socket.on('session-close', async ({ roomCode }) => {
    try {
      const sessions = (await readJson('sessions.json')) || [];
      const idx = sessions.findIndex(s => s.roomCode === roomCode);
      if (idx === -1) return;
      const session = sessions[idx];

      const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
      const allResponses = [];

      // AI round scores (questions 0-9)
      if (session.aiScores) {
        Object.entries(session.aiScores).forEach(([qIdx, scoreData]) => {
          allResponses.push({ source: 'ai', questionIndex: parseInt(qIdx), scores: scoreData });
        });
      }

      // Panel questions (teacher scores, resolve disagreements)
      if (session.panelQuestions && session.teacherScores) {
        session.panelQuestions.forEach((pq, qIdx) => {
          const teacherIds = Object.keys(session.teacherScores);
          const resolvedScores = {};
          dims.forEach(dim => {
            const entry = session.disagreements?.find(d => d.questionIndex === qIdx && d.dimension === dim);
            if (entry) {
              resolvedScores[dim] = entry.finalScore;
            } else {
              const vals = teacherIds.map(tid => session.teacherScores[tid]?.[qIdx]?.scores?.[dim]).filter(v => v != null);
              resolvedScores[dim] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 3;
            }
          });
          allResponses.push({ source: 'panel', questionIndex: qIdx, scores: resolvedScores, teacherId: pq.teacherId, teacherName: pq.teacherName });
        });
      }

      // Compute final score
      const aiResponses = allResponses.filter(r => r.source === 'ai');
      const panelResponses = allResponses.filter(r => r.source === 'panel');
      const avgDim = (responses) => {
        const totals = { clarity: 0, reasoning: 0, depth: 0, confidence: 0 };
        responses.forEach(r => dims.forEach(d => { totals[d] += r.scores[d] || 0; }));
        const count = responses.length * 4;
        return count > 0 ? Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, parseFloat((v / responses.length).toFixed(2))])) : null;
      };

      const aiAvg = avgDim(aiResponses);
      const panelAvg = avgDim(panelResponses);

      let finalScores = null;
      if (aiAvg && panelAvg) {
        dims.forEach(d => {
          finalScores[d] = parseFloat(((aiAvg[d] * 0.4) + (panelAvg[d] * 0.6)).toFixed(2));
        });
      } else if (aiAvg) {
        finalScores = aiAvg;
      } else if (panelAvg) {
        finalScores = panelAvg;
      }

      const panelDisagreements = session.disagreements || [];

      // Save to scores file
      const scoreFileEntry = {
        sessionId: session.id,
        roomCode: session.roomCode,
        timestamp: new Date().toISOString(),
        sources: { ai: aiResponses.length, panel: panelResponses.length },
        finalScores,
        aiAvg,
        panelAvg,
        panelDisagreements,
        teacherScores: session.teacherScores,
        panelQuestions: session.panelQuestions
      };
      await writeJson(`scores_${session.studentId}_${session.id}.json`, scoreFileEntry);

      // Update session phase
      sessions[idx].phase = 'closed';
      sessions[idx].finalScores = finalScores;
      await writeJson('sessions.json', sessions);

      io.to(roomCode).emit('session-closed', { finalScores, coachingFlags: panelDisagreements.map(d => d.dimension) });
    } catch (e) { console.error('[session-close] error:', e); }
  });

  socket.on('disconnect', () => {
    console.log('[socket] disconnected:', socket.id);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Defense Rehearsal App running at http://localhost:${PORT}`);
});
