const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { Groq } = require('groq-sdk');

if (!process.env.GROQ_API_KEY) { 
  console.error('GROQ_API_KEY is required'); 
  process.exit(1); 
} 

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY }); 

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Storage Helpers
async function readJSON(filename) {
  try {
    const data = await fsPromises.readFile(path.join(DATA_DIR, filename), 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function writeJSON(filename, data) {
  await fsPromises.writeFile(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

// Ensure data directory exists
async function initStorage() {
  try {
    await fsPromises.mkdir(DATA_DIR, { recursive: true });
    const files = ['students.json', 'faculty.json'];
    for (const file of files) {
      const filePath = path.join(DATA_DIR, file);
      try {
        await fsPromises.access(filePath);
      } catch {
        await fsPromises.writeFile(filePath, '[]');
      }
    }

    // --- Add default faculty account if none exists ---
    const faculty = await readJSON('faculty.json');
    if (faculty.length === 0) {
        const defaultHash = await bcrypt.hash('admin123', 10);
        const defaultFaculty = {
            id: uuidv4(),
            name: 'Default Faculty',
            email: 'faculty@example.com',
            password: defaultHash,
            department: 'Engineering',
            employeeId: 'F001',
            createdAt: new Date().toISOString()
        };
        await writeJSON('faculty.json', [defaultFaculty]);
        console.log('✅ Default faculty created: faculty@example.com / admin123');
    }
    // ------------------------------------------------

  } catch (err) {
    console.error('Failed to initialize storage:', err);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// AI Provider Logic using Groq (free tier)
async function callAI(prompt, systemPrompt = "You are a helpful academic assistant.") {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      model: "llama3-70b-8192",  // Free, good quality
      temperature: 0.7,
      max_tokens: 1024,
    });
    const text = chatCompletion.choices[0]?.message?.content || "";
    return text;
  } catch (err) {
    console.error('Groq API error:', err);
    throw err;
  }
}

// API Routes (all unchanged except health endpoint)
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    aiProvider: 'Groq (llama3-70b-8192)',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/demo/student', async (req, res) => {
  try {
    const demoId = 'demo_student';
    const students = await readJSON('students.json') || [];
    let student = students.find(s => s.id === demoId);
    
    if (!student) {
      student = {
        id: demoId,
        name: 'Demo Student',
        year: '2024',
        branch: 'Computer Science',
        title: 'AI-Powered Project Defense Rehearsal System',
        description: 'A web application to help students prepare for their project defense using AI-generated questions and feedback.',
        architecture: [
          { decision: 'Node.js + Express', alternatives: 'Python + FastAPI', reason: 'Familiarity and Socket.io integration' },
          { decision: 'JSON Storage', alternatives: 'MongoDB', reason: 'Simplicity for demo purposes' }
        ],
        limitations: ['Limited concurrent sessions', 'Basic AI scoring logic'],
        createdAt: new Date().toISOString()
      };
      students.push(student);
      await writeJSON('students.json', students);
    }
    res.json({ studentId: demoId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students', async (req, res) => {
  try {
    const students = await readJSON('students.json') || [];
    const enriched = await Promise.all(students.map(async (s) => {
      const questions = await readJSON(`questions_${s.id}.json`);
      const scores = await readJSON(`scores_${s.id}.json`) || [];
      const baseline = scores.length > 0 ? scores[0].average : 0;
      const final = scores.length > 0 ? scores[scores.length - 1].average : 0;
      return {
        ...s,
        questionsGenerated: !!questions,
        sessionCount: scores.length,
        baseline,
        final
      };
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/students', async (req, res) => {
  try {
    const student = { ...req.body, id: uuidv4(), createdAt: new Date().toISOString() };
    const students = await readJSON('students.json') || [];
    students.push(student);
    await writeJSON('students.json', students);
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/:id', async (req, res) => {
  const students = await readJSON('students.json') || [];
  const student = students.find(s => s.id === req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  res.json(student);
});

app.delete('/api/students/:id', async (req, res) => {
  try {
    let students = await readJSON('students.json') || [];
    students = students.filter(s => s.id !== req.params.id);
    await writeJSON('students.json', students);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate-questions/:id', async (req, res) => {
  try {
    const students = await readJSON('students.json') || [];
    const student = students.find(s => s.id === req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const prompt = `Based on the following project details, generate 10 tiered defense questions:
    Title: ${student.title}
    Description: ${student.description}
    Architecture: ${JSON.stringify(student.architecture)}
    Limitations: ${student.limitations.join(', ')}

    Tier 1 (2 surface questions): General understanding and basic concepts.
    Tier 2 (5 tradeoff questions): Why these choices? Alternatives? Scalability?
    Tier 3 (3 failure mode questions): What if X fails? Edge cases? Security?

    Return ONLY a valid JSON object with the following structure:
    {
      "tier1": ["q1", "q2"],
      "tier2": ["q3", "q4", "q5", "q6", "q7"],
      "tier3": ["q8", "q9", "q10"]
    }`;

    const aiResponse = await callAI(prompt, "You are a senior technical examiner. Return JSON only.");
    const questions = JSON.parse(aiResponse.match(/\{[\s\S]*\}/)[0]);
    
    await writeJSON(`questions_${req.params.id}.json`, questions);
    res.json({ success: true, questions, aiProvider: 'Groq' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/questions/:id', async (req, res) => {
  const questions = await readJSON(`questions_${req.params.id}.json`);
  if (!questions) return res.status(404).json({ error: 'Questions not found. Generate questions first.' });
  res.json(questions);
});

app.post('/api/evaluate-answer', async (req, res) => {
  try {
    const { studentId, questionText, answer, tier } = req.body;
    const prompt = `Question: ${questionText}
    Student Answer: ${answer}
    Tier: ${tier}

    Evaluate the answer based on:
    1. Clarity (1-5)
    2. Reasoning (1-5)
    3. Depth (1-5)
    4. Confidence (1-5)

    Provide feedback and a suggestion for improvement.
    Return ONLY a valid JSON object:
    {
      "clarity": number,
      "reasoning": number,
      "depth": number,
      "confidence": number,
      "feedback": "string",
      "suggestion": "string"
    }`;

    const aiResponse = await callAI(prompt, "You are a technical examiner scoring a student.");
    const scores = JSON.parse(aiResponse.match(/\{[\s\S]*\}/)[0]);
    res.json({ success: true, scores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scores', async (req, res) => {
  try {
    const { studentId, responses, sessionType } = req.body;
    const scores = await readJSON(`scores_${studentId}.json`) || [];
    
    const average = responses.reduce((acc, r) => {
      const avg = (r.scores.clarity + r.scores.reasoning + r.scores.depth + r.scores.confidence) / 4;
      return acc + avg;
    }, 0) / responses.length;

    const newSession = {
      id: uuidv4(),
      date: new Date().toISOString(),
      type: sessionType || 'solo',
      average,
      responses
    };
    
    scores.push(newSession);
    await writeJSON(`scores_${studentId}.json`, scores);
    res.json({ success: true, sessionId: newSession.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scores/:id', async (req, res) => {
  const scores = await readJSON(`scores_${req.params.id}.json`) || [];
  res.json(scores);
});

app.post('/api/coaching/:id', async (req, res) => {
  try {
    const scores = await readJSON(`scores_${req.params.id}.json`) || [];
    if (scores.length === 0) return res.status(400).json({ error: 'Complete a solo session first' });

    const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
    const dimAverages = dims.reduce((acc, dim) => {
      const total = scores.reduce((sAcc, session) => {
        const sessionTotal = session.responses.reduce((rAcc, r) => rAcc + r.scores[dim], 0);
        return sAcc + (sessionTotal / session.responses.length);
      }, 0);
      acc[dim] = total / scores.length;
      return acc;
    }, {});

    const weakDimensions = Object.entries(dimAverages)
      .filter(([_, val]) => val < 3.5)
      .map(([dim]) => dim);

    const prompt = `Based on these weak dimensions: ${weakDimensions.join(', ')}, provide 3 targeted questions and tips for improvement.
    Return ONLY a valid JSON object:
    {
      "questions": { "dim1": ["q1"], "dim2": ["q2"] },
      "tips": { "dim1": "tip1", "dim2": "tip2" }
    }`;

    const aiResponse = await callAI(prompt, "You are a technical coach.");
    const coachingData = JSON.parse(aiResponse.match(/\{[\s\S]*\}/)[0]);

    res.json({
      coaching: {
        weakDimensions,
        dimAverages,
        questions: coachingData.questions,
        tips: coachingData.tips
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/profile/:id', async (req, res) => {
  try {
    const students = await readJSON('students.json') || [];
    const student = students.find(s => s.id === req.params.id);
    const scores = await readJSON(`scores_${req.params.id}.json`) || [];
    res.json({ student, sessions: scores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/cohort', async (req, res) => {
  try {
    const students = await readJSON('students.json') || [];
    const stats = await Promise.all(students.map(async (s) => {
      const scores = await readJSON(`scores_${s.id}.json`) || [];
      return { id: s.id, name: s.name, sessionCount: scores.length, latestScore: scores.length > 0 ? scores[scores.length-1].average : 0 };
    }));
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/faculty/register', async (req, res) => {
  try {
    const { name, email, department, employeeId, password } = req.body;
    const faculty = await readJSON('faculty.json') || [];
    
    if (faculty.find(f => f.email === email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newFaculty = {
      id: uuidv4(),
      name,
      email,
      department,
      employeeId,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    faculty.push(newFaculty);
    await writeJSON('faculty.json', faculty);
    res.json({ success: true, facultyId: newFaculty.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/faculty/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const faculty = await readJSON('faculty.json') || [];
    const user = faculty.find(f => f.email === email);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({ 
      token: 'faculty-token-' + Date.now(), 
      role: 'faculty',
      name: user.name
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const sessions = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

app.post('/api/sessions/create', async (req, res) => {
  const { studentId } = req.body;
  const roomCode = generateRoomCode();
  const sessionId = uuidv4();
  const session = {
    id: sessionId,
    roomCode,
    studentId,
    phase: 'waiting',
    teachers: [],
    transcript: [],
    currentQuestion: null,
    scores: {},
    panelQuestions: []
  };
  sessions.set(roomCode, session);
  res.json({ sessionId, roomCode, teacherInviteUrl: `/teacher.html?room=${roomCode}` });
});

app.get('/api/sessions/:roomCode', (req, res) => {
  const session = sessions.get(req.params.roomCode);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

app.post('/api/sessions/:roomCode/teacher-auth', async (req, res) => {
  try {
    const { email, password } = req.body;
    const faculty = await readJSON('faculty.json') || [];
    const user = faculty.find(f => f.email === email);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid faculty credentials' });
    }

    res.json({ 
      token: 'teacher-token-' + uuidv4(), 
      teacherId: user.id, 
      teacherName: user.name 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/evaluate-response', async (req, res) => {
  const { sessionId, roomCode, questionIndex, transcript, questionText } = req.body;
  const session = sessions.get(roomCode);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const prompt = `Question: ${questionText}
    Transcript of student's verbal answer: ${transcript}
    Evaluate the response (1-5 for clarity, reasoning, depth, confidence) and provide feedback.
    Return JSON: { "clarity": n, "reasoning": n, "depth": n, "confidence": n, "feedback": "..." }`;

    const aiResponse = await callAI(prompt, "You are an AI examiner in a live defense.");
    const scores = JSON.parse(aiResponse.match(/\{[\s\S]*\}/)[0]);
    
    session.aiScore = scores;
    io.to(roomCode).emit('ai-score', { scores });
    res.json({ success: true, scores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.io Logic
io.on('connection', (socket) => {
  socket.on('join-session', ({ roomCode, user }) => {
    socket.join(roomCode);
    const session = sessions.get(roomCode);
    if (session) {
      if (user.role === 'teacher') {
        if (!session.teachers.find(t => t.id === user.id)) {
          session.teachers.push(user);
        }
      } else if (user.role === 'student') {
        session.student = user;
      }
      io.to(roomCode).emit('session-update', session);
    }
  });

  socket.on('phase-change', ({ roomCode, phase, question }) => {
    const session = sessions.get(roomCode);
    if (session) {
      session.phase = phase;
      if (question) session.currentQuestion = question;
      io.to(roomCode).emit('phase-changed', { phase, question });
    }
  });

  socket.on('transcript-chunk', ({ roomCode, text, isFinal }) => {
    io.to(roomCode).emit('transcript-chunk', { text, isFinal });
  });

  socket.on('teacher-interrupt', ({ roomCode, teacherName }) => {
    io.to(roomCode).emit('interrupt-fired', { teacherName });
  });

  socket.on('teacher-score', ({ roomCode, teacherId, scores }) => {
    const session = sessions.get(roomCode);
    if (session) {
      session.scores[teacherId] = scores;
      
      const teacherScores = Object.values(session.scores);
      const flagged = [];
      const dims = ['clarity', 'reasoning', 'depth', 'confidence'];
      
      dims.forEach(dim => {
        const values = teacherScores.map(s => s[dim]);
        if (values.length > 1) {
          const mean = values.reduce((a, b) => a + b) / values.length;
          const stdDev = Math.sqrt(values.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / values.length);
          if (stdDev > 1.0) flagged.push(dim);
        }
      });

      io.to(roomCode).emit('score-update', { 
        grid: session.scores, 
        flagged, 
        canClose: teacherScores.length >= session.teachers.length 
      });
    }
  });

  socket.on('add-panel-question', ({ roomCode, teacherName, question }) => {
    const session = sessions.get(roomCode);
    if (session) {
      const q = { id: uuidv4(), teacherName, question, answered: false };
      session.panelQuestions.push(q);
      io.to(roomCode).emit('panel-question-added', q);
    }
  });

  socket.on('mark-panel-answered', ({ roomCode, questionId }) => {
    const session = sessions.get(roomCode);
    if (session) {
      const q = session.panelQuestions.find(pq => pq.id === questionId);
      if (q) q.answered = true;
      io.to(roomCode).emit('panel-update', session.panelQuestions);
    }
  });

  socket.on('webrtc-offer', (data) => socket.to(data.roomCode).emit('webrtc-offer', data));
  socket.on('webrtc-answer', (data) => socket.to(data.roomCode).emit('webrtc-answer', data));
  socket.on('webrtc-ice', (data) => socket.to(data.roomCode).emit('webrtc-ice', data));
});

httpServer.listen(PORT, async () => {
  await initStorage();
  console.log(`PDRS Server v3.0.0 running at http://localhost:${PORT}`);
  console.log(`AI Provider: Groq (llama3-70b-8192)`);
  console.log(`Data Directory: ${DATA_DIR}`);
});