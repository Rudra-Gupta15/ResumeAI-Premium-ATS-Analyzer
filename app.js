/* ================================================================
   ResumeAI — Ollama-powered ATS Analyzer
   Page 1: Upload + Level select
   Page 2: Split screen — Resume preview | ATS scores
   ================================================================ */
const { useState, useRef, useCallback, useEffect, useMemo } = React;

const OLLAMA = "http://localhost:11434";
const GROQ_MODEL = "llama-3.3-70b-versatile"; // Default Groq model for fast and accurate responses

/* ── File Extraction helper ─────────────────────────────────── */
async function extractTextFromFile(file, setLoadMsg) {
  const ext = file.name.split(".").pop().toLowerCase();
  
  if (["txt", "md"].includes(ext)) {
    return await file.text();
  }
  
  if (ext === "pdf") {
    setLoadMsg("Reading PDF document...");
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map(item => item.str);
      fullText += strings.join(" ") + "\n";
    }
    return fullText;
  }
  
  if (ext === "docx") {
    setLoadMsg("Reading DOCX document...");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }
  
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
    setLoadMsg("Running OCR on image... This might take a few seconds.");
    const worker = await Tesseract.createWorker('eng');
    const imageUrl = URL.createObjectURL(file);
    const ret = await worker.recognize(imageUrl);
    await worker.terminate();
    URL.revokeObjectURL(imageUrl);
    return ret.data.text;
  }
  
  throw new Error("Unsupported file format.");
}

/* ── Groq helpers ───────────────────────────────────────────── */
async function callGroq(prompt, apiKey) {
  const url = apiKey ? "https://api.groq.com/openai/v1/chat/completions" : "/api/analyze";
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!r.ok) {
    const errText = await r.text();
    console.error("Groq API Error:", errText);
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error && errJson.error.message) {
        throw new Error(`Groq error: ${errJson.error.message}`);
      }
    } catch(e) {}
    throw new Error(`Groq error ${r.status}`);
  }
  const d = await r.json();
  return d.choices[0].message.content || "";
}

async function streamGroq(prompt, onToken, apiKey) {
  const url = apiKey ? "https://api.groq.com/openai/v1/chat/completions" : "/api/analyze";
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: true
    })
  });
  if (!r.ok) {
    const errText = await r.text();
    console.error("Groq Streaming API Error:", errText);
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error && errJson.error.message) {
        throw new Error(`Groq error: ${errJson.error.message}`);
      }
    } catch(e) {}
    throw new Error(`Groq error ${r.status}`);
  }
  
  const reader = r.body.getReader();
  const dec = new TextDecoder("utf-8");
  let full = "";
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = dec.decode(value, { stream: true });
    const lines = chunk.split("\n").filter(line => line.trim() !== "");
    
    for (const line of lines) {
      if (line === "data: [DONE]") return full;
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
            full += data.choices[0].delta.content;
            onToken(full);
          }
        } catch {}
      }
    }
  }
  return full;
}

/* ── Ollama helpers ─────────────────────────────────────────── */
async function checkOllama() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { ok: false, models: [] };
    const d = await r.json();
    return { ok: true, models: (d.models || []).map(m => m.name) };
  } catch { return { ok: false, models: [] }; }
}

async function callOllama(model, prompt) {
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false })
  });
  if (!r.ok) throw new Error(`Ollama error ${r.status}`);
  const d = await r.json();
  return d.response || "";
}

async function streamOllama(model, prompt, onToken) {
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: true })
  });
  if (!r.ok) throw new Error(`Ollama error ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split("\n").filter(Boolean)) {
      try {
        const obj = JSON.parse(line);
        if (obj.response) { full += obj.response; onToken(full); }
        if (obj.done) return full;
      } catch {}
    }
  }
  return full;
}

function safeJSON(t) {
  try { const m = t.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; }
  catch { return null; }
}

/* ── Score color ────────────────────────────────────────────── */
function scoreColor(s) {
  if (s >= 75) return "#00d4aa";
  if (s >= 50) return "#f5a623";
  return "#ff5c5c";
}
function scoreBadge(s) {
  if (s >= 75) return "badge-high";
  if (s >= 50) return "badge-mid";
  return "badge-low";
}

/* ── Ring SVG ───────────────────────────────────────────────── */
function Ring({ score, size = 88 }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(Math.max(score || 0, 0), 100);
  const dash = (pct / 100) * circ;
  const color = scoreColor(pct);
  return (
    <svg className="ring-svg" width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#222738" strokeWidth="7"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="7"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.16,1,0.3,1)" }}/>
    </svg>
  );
}

/* ── Footer Component ───────────────────────────────────────── */
function Footer() {
  return (
    <footer className="footer">
      <div className="footer-content">
        <span>Made with ❤️ by </span>
        <a href="https://rudra-gupta.vercel.app/" target="_blank" rel="noopener noreferrer" className="footer-link">
          Rudra Gupta | Portfolio
        </a>
      </div>
    </footer>
  );
}

/* ── Markdown Renderer ─────────────────────────────────────── */
function MarkdownText({ text, streaming, active }) {
  if (!text) return null;
  const lines = text.split('\n');
  
  return (
    <div className="review-text" style={{ whiteSpace: 'normal' }}>
      {lines.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} style={{ height: '8px' }}/>;
        
        // Headers
        if (t.startsWith('###')) {
          return <h4 key={i} style={{ color: 'var(--text-main)', marginTop: i===0?'0.5rem':'1.5rem', marginBottom: '0.75rem', fontSize: '14px', letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-light)', paddingBottom: '4px' }}>{t.replace(/###\s*/, '')}</h4>;
        }
        if (t.startsWith('##')) {
          // Hide orphaned ## PROJECT headers inside the content blocks since we have custom static headers
          if (t.toUpperCase().includes('PROJECT')) return null;
          return <h3 key={i} style={{ color: 'var(--info)', marginTop: i===0?'0.5rem':'1.5rem', marginBottom: '1rem', fontSize: '16px' }}>{t.replace(/##\s*/, '')}</h3>;
        }
        
        // Bullets
        if (t.startsWith('- ') || t.startsWith('* ')) {
          let content = t.substring(2);
          const parts = content.split(/(\*\*.*?\*\*)/g);
          return (
            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px', lineHeight: '1.5', color: 'var(--text-muted)' }}>
              <span style={{ color: 'var(--primary)' }}>•</span>
              <span>
                {parts.map((part, j) => {
                  if (part.startsWith('**') && part.endsWith('**')) {
                    return <strong key={j} style={{ color: 'var(--text-main)' }}>{part.slice(2, -2)}</strong>;
                  }
                  return part;
                })}
              </span>
            </div>
          );
        }
        
        // Normal text with bold parsing
        const parts = t.split(/(\*\*.*?\*\*)/g);
        return (
          <div key={i} style={{ marginBottom: '8px', lineHeight: '1.5', color: 'var(--text-muted)' }}>
            {parts.map((part, j) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={j} style={{ color: 'var(--text-main)' }}>{part.slice(2, -2)}</strong>;
              }
              return part;
            })}
          </div>
        );
      })}
      {streaming && active && <span className="cursor" style={{ display: 'inline-block', width: '8px', height: '16px', background: 'var(--primary)', marginLeft: '4px', verticalAlign: 'middle', animation: 'blink 1s step-end infinite' }}/>}
    </div>
  );
}

/* ── Levels config ──────────────────────────────────────────── */
const LEVELS = [
  {
    id: "beginner",
    icon: "🌱",
    name: "Beginner",
    years: "< 1 year",
    desc: "Just starting out — scored on formatting, clarity, education & skills presentation",
    criteria: "under 1 year of experience — evaluate based on formatting, education quality, core skills, and potential. Be objective and critical.",
    scoringRules: "SCORING ETHOS: BE OBJECTIVE. Do not inflate scores. High quality beginners can reach 80+, but mediocre or poorly structured resumes should be in the 30-50 range. Focus on whether they have the fundamental skills for ${finalDomain}."
  },
  {
    id: "intermediate",
    icon: "⚡",
    name: "Intermediate",
    years: "1 – 5 years",
    desc: "Growing professional — scored on impact, quantified results & relevant experience",
    criteria: "1 to 5 years of experience — evaluate based on quantified achievements, project impact, skill relevance, and career progression.",
    scoringRules: "SCORING ETHOS: BE STRICT. Demand quantified impact (numbers, %, $). A score of 50-65 is NORMAL for a solid intermediate resume. Only give 80+ for truly exceptional leadership and clear career growth."
  },
  {
    id: "advanced",
    icon: "🏆",
    name: "Advanced",
    years: "5+ years",
    desc: "Senior professional — scored on leadership, architecture decisions & measurable impact",
    criteria: "5+ years of experience — evaluate based on leadership, strategic impact, domain expertise, and seniority signals.",
    scoringRules: "SCORING ETHOS: BE HARDEST AND MOST CRITICAL. Demand leadership, architecture decisions, and massive measurable results. A score of 40-55 is NORMAL for a senior resume. 80+ is extremely rare and only for industry leaders."
  }
];

/* ── Resume Preview component ───────────────────────────────── */
function ResumePreview({ file, fileURL, pasteText }) {
  if (file && fileURL) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "pdf") {
      return (
        <div className="resume-preview">
          <iframe src={fileURL} title="Resume PDF"/>
        </div>
      );
    }
    if (["png","jpg","jpeg","webp"].includes(ext)) {
      return (
        <div className="resume-preview" style={{ overflow:"auto", display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"1rem" }}>
          <img src={fileURL} alt="Resume" style={{ maxWidth:"100%", height:"auto", borderRadius:6 }}/>
        </div>
      );
    }
  }
  return (
    <div className="resume-text-view">{pasteText || "No preview available."}</div>
  );
}

/* ================================================================
   MAIN APP
================================================================ */
function App() {
  /* Ollama state */
  const [ollamaOk, setOllamaOk]       = useState(false);
  const [checking, setChecking]        = useState(true);
  const [models, setModels]            = useState([]);
  const [model, setModel]              = useState("");

  /* Input state */
  const [file, setFile]                = useState(null);
  const [fileURL, setFileURL]          = useState("");
  const [pasteText, setPasteText]      = useState("");
  const [drag, setDrag]                = useState(false);
  const [level, setLevel]              = useState("intermediate");
  const [domainMode, setDomainMode]    = useState("auto");
  const [customDomain, setCustomDomain] = useState("");
  const [detectedDomain, setDetectedDomain] = useState("");
  const [processingMode, setProcessingMode] = useState("online"); // online | offline
  const [onlineOption, setOnlineOption]       = useState("developer"); // developer | personal

  /* App flow */
  const [page, setPage]                = useState("home"); // home | loading | analysis
  const [loadMsg, setLoadMsg]          = useState("");
  const [loadPct, setLoadPct]          = useState(0);
  const [error, setError]              = useState("");

  /* Analysis results */
  const [contact, setContact]          = useState(null);
  const [sections, setSections]        = useState(null);
  const [scores, setScores]            = useState(null);
  const [streaming, setStreaming]      = useState(false);
  const [reviewText, setReviewText]    = useState("");
  const [activeTab, setActiveTab]      = useState("ats"); // ats | domain | projects
  const [links, setLinks]              = useState(null);
  const [groqKey, setGroqKey]          = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [adjacentRoles, setAdjacentRoles] = useState([]);
  const [waitTime, setWaitTime]        = useState(0); // Seconds to wait before next analysis
  const [isUsingDefaultKey, setIsUsingDefaultKey] = useState(true);
  const [serverKeyAvailable, setServerKeyAvailable] = useState(false);

  const fileRef = useRef();
  
  const DEFAULT_API_KEY = "";
  const RATE_LIMIT_SECONDS = 60; // Wait 60 seconds between analyses when using shared key

  /* Save Groq key to localStorage whenever it changes */
  const updateGroqKey = useCallback((key) => {
    setGroqKey(key);
    if (key) {
      localStorage.setItem('resumeai_groq_key', key);
    } else {
      localStorage.removeItem('resumeai_groq_key');
    }
  }, []);

  /* Check Ollama & Load saved API key from localStorage */
  useEffect(() => {
    checkOllama().then(({ ok, models: m }) => {
      setOllamaOk(ok);
      setChecking(false);
      if (ok) {
        setModels(m);
        const pref = ["llama3.1", "llama3", "mistral", "qwen3", "phi3", "gemma3"];
        const found = pref.find(p => m.some(mm => mm.startsWith(p)));
        setModel(found ? m.find(mm => mm.startsWith(found)) : m[0] || "");
      }
    });
    
    // Check if server-side key is available
    fetch('/api/status')
      .then(r => r.json())
      .then(d => {
        setServerKeyAvailable(d.configured);
        if (d.configured) {
          setOnlineOption("developer");
        } else {
          setOnlineOption("personal");
        }
      })
      .catch(() => setServerKeyAvailable(false));

    // Load Groq API key from localStorage
    const savedKey = localStorage.getItem('resumeai_groq_key');
    if (savedKey) {
      setGroqKey(savedKey);
    }
    
    // Check if using default key
    setIsUsingDefaultKey(groqKey === DEFAULT_API_KEY || !savedKey);
    
    // Check for rate limit timer
    const lastAnalysisTime = localStorage.getItem('resumeai_last_analysis');
    if (lastAnalysisTime && (groqKey === DEFAULT_API_KEY || !savedKey)) {
      const elapsed = Math.floor((Date.now() - parseInt(lastAnalysisTime)) / 1000);
      const remaining = RATE_LIMIT_SECONDS - elapsed;
      if (remaining > 0) {
        setWaitTime(remaining);
      }
    }
  }, []);
  
  /* Timer countdown effect */
  useEffect(() => {
    if (waitTime > 0) {
      const timer = setTimeout(() => {
        setWaitTime(waitTime - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [waitTime]);
  
  /* Update isUsingDefaultKey when groqKey or onlineOption changes */
  useEffect(() => {
    setIsUsingDefaultKey(onlineOption === "developer");
  }, [groqKey, onlineOption]);

  /* File handling */
  const handleFile = useCallback((f) => {
    if (!f) return;
    setFile(f);
    setFileURL(URL.createObjectURL(f));
    setError("");
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDrag(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const levelConfig = useMemo(() => LEVELS.find(l => l.id === level), [level]);

  /* ── Analyze ─────────────────────────────────────────────── */
  async function analyze() {
    setError("");
    const hasInput = file || pasteText.trim().length > 50;
    if (!hasInput) { setError("Please upload a resume or paste at least 50 characters of text."); return; }
    if (processingMode === "offline" && !ollamaOk) { setError("Ollama is not running. Start it with: ollama serve"); return; }
    if (processingMode === "offline" && !model) { setError("No model selected."); return; }

    setPage("loading");
    setLoadPct(5);
    
    const currentKey = onlineOption === "personal" ? groqKey : null;

    // Set rate limit timer if using developer key
    if (onlineOption === "developer" && processingMode === "online") {
      localStorage.setItem('resumeai_last_analysis', Date.now().toString());
      setWaitTime(RATE_LIMIT_SECONDS);
    }

    try {
      /* Get resume text */
      let resumeText = pasteText.trim();
      if (file) {
        setLoadMsg("Extracting text from " + file.name + "...");
        resumeText = await extractTextFromFile(file, setLoadMsg);
        if (!resumeText || resumeText.trim().length < 30) {
          throw new Error("Could not extract enough text from the file.");
        }
      }

      /* Step 0 — Domain Inference */
      setDetectedDomain("");
      let finalDomain = domainMode === "custom" ? customDomain.trim() : domainMode;
      if (!finalDomain) finalDomain = "General Professional";
      
      if (domainMode === "auto") {
        setLoadMsg("Auto-detecting target role/domain...");
        const domainPrompt = `You are an elite Tech Recruiter. Analyze the resume to determine the candidate's SPECIFIC target role.

### DETECTION PRIORITY (Check in order):
1. **PROJECTS & INTERNSHIPS** - Most important! What did they actually build?
2. **SKILLS SECTION** - What tools/frameworks do they list?
3. **EXPERIENCE** - What roles have they held?
4. **EDUCATION** - Only if above are unclear

### BE SPECIFIC - DO NOT OVERSIMPLIFY:
❌ WRONG: "Software Engineer" (too generic)
✅ RIGHT: "Full Stack Developer", "Backend Developer", "Frontend Developer"

❌ WRONG: "Machine Learning Engineer" (when AI/ML projects are present)
✅ RIGHT: "AI & ML Engineer", "AIML Engineer", "Deep Learning Engineer"

❌ WRONG: "Data Analyst" (when they do ML)
✅ RIGHT: "Data Scientist", "ML Data Scientist"

### SPECIFIC ROLE PATTERNS:
- **AI/ML Projects** (CNN, NLP, Computer Vision, LLMs, Deep Learning) → "AI & ML Engineer" or "AIML Engineer"
- **Full Stack Projects** (Frontend + Backend + Database) → "Full Stack Developer"
- **Only Frontend** (React, Vue, Angular) → "Frontend Developer"
- **Only Backend** (APIs, databases, servers) → "Backend Developer"
- **Data Analysis + ML Models** → "Data Scientist"
- **Data Pipelines + ETL** → "Data Engineer"
- **Mobile Apps** (React Native, Flutter, Swift) → "Mobile App Developer"
- **DevOps/Cloud** (Docker, Kubernetes, AWS, CI/CD) → "DevOps Engineer"
- **Security Focus** → "Cybersecurity Engineer"
- **Blockchain Projects** → "Blockchain Developer"

### IMPORTANT RULES:
- Use the EXACT role name from their resume/projects if it's specific
- DO NOT downgrade specific roles to generic ones
- If multiple specializations, pick the DOMINANT one from recent work
- Prefer compound terms like "AI & ML Engineer" over simplified "ML Engineer"

### OUTPUT FORMAT:
Return ONLY the specific role name. No quotes, explanations, or extra words.

RESUME:
${resumeText.slice(0, 4000)}`;
        const rawDomain = processingMode === "online" 
          ? await callGroq(domainPrompt, currentKey)
          : await callOllama(model, domainPrompt);
        finalDomain = rawDomain.trim();
        // Remove quotes if model returned them
        finalDomain = finalDomain.replace(/^"|"$/g, '');
      }
      setDetectedDomain(finalDomain);

      /* Step 1 — Extract sections */
      setLoadMsg("Extracting resume sections...");
      setLoadPct(15);

      const extractPrompt = `You are an expert resume parser. Extract all sections from the resume below. Return ONLY valid JSON with no extra text or markdown.

Format:
{
  "contact": { "name": "", "email": "", "phone": "", "location": "" },
  "links": { "github": "", "portfolio": "", "kaggle": "", "linkedin": "", "hackerrank": "" },
  "sections": {
    "summary": "",
    "skills": "",
    "experience": "",
    "education": "",
    "projects": "",
    "internship": "",
    "certificate": "",
    "extracurricular": ""
  }
}

Only include sections that exist. For "extracurricular", include any evidence of activities, participation, clubs, volunteering, or academic events.

### ROBUST LINK DETECTION RULE:
In the header/contact zone, look for platform names (LinkedIn, GitHub, Kaggle, Hackerrank) or their icons/placeholders. 
1. If a URL is present, extract it.
2. If only the platform name (e.g., "LinkedIn") or a clear handle is present, extract at least the handle or platform name as a signal. 
3. DO NOT ignore a platform if the word is physically there. Be extremely aggressive in the header. Empty string for missing ones.

RESUME:
${resumeText.slice(0, 4500)}

JSON only:`;

      const rawExtract = processingMode === "online" 
          ? await callGroq(extractPrompt, currentKey)
          : await callOllama(model, extractPrompt);
      const parsed = safeJSON(rawExtract);
      if (!parsed) throw new Error("Failed to parse resume. Try pasting as plain text.");
      setContact(parsed.contact || {});
      setSections(parsed.sections || {});
      setLinks(parsed.links || {});
      setLoadPct(50);

      /* Step 2 — ATS Score */
      setLoadMsg("Calculating ATS scores...");

      const levelConf = LEVELS.find(l => l.id === level);
      const scorePrompt = `You are an ATS (Applicant Tracking System) expert and resume reviewer with 10 years of experience.

The candidate is targeting the role: "${finalDomain}"
Experience level: ${levelConf.criteria}
LEVEL-SPECIFIC SCORING: ${levelConf.scoringRules}

CRITICAL SCORING RULES - BE REALISTIC AND HONEST:
- Avoid "score compression". Resumes should span the full 0-100 range.
- If a resume is generic or lacks impact, do not be afraid to score below 50.
- The "Overall ATS Score" MUST be a realistic reflection of the individual section scores.
- Strictly follow the SCORING ETHOS provided for the candidate's level.

PENALTY CHECKLIST (Apply these strictly):
- No relevant skills for ${finalDomain}: Max section score is 40.
- No quantified impact (numbers, %, $): Overall score cannot exceed 65.
- Poor formatting or unprofessional language: Deduct 15 points from Overall.
- No projects or experience shown: Overall score cannot exceed 40.

SECTION-COUNT BENCHMARKS (Overall score depends on completeness):
- 2 sections filled = 60+ (Base score)
- 4 sections filled = 70+ (Strong profile)
- 5+ sections filled = Near 80+ (Comprehensive profile)
(Apply these provided the quality is maintained. A resume with 5 poor sections should still be penalized.)

SCORING GUIDELINES BY SECTION:
- **Skills**: Score based on relevance to ${finalDomain}. Generic skills (MS Office) = low score. Role-specific tools = high score.
- **Experience**: Score based on relevance and impact. Relevant roles with achievements = high score.
- **Projects**: Score based on technical depth. "To-do app" = 30-40. Complex, unique apps = 70-90.
- **Education**: Relevant degree = 75-85. Irrelevant degree = 45-55.
- **Internship**: Relevant ones = 70-85. Otherwise 40-50.
- **Certificate**: Credible industry certs = 70-90. Generic courses = 40-50.
- **Extracurricular**: Be lenient. 1 item = 60, 2 items = 70, 3 items = 80, 4+ items = 90+. Always check quality; leadership roles or activities highly relevant to ${finalDomain} should receive a bonus.

Return ONLY valid JSON with ATS scores. No markdown.

{
  "overall_score": 55,
  "ats_compatibility": 60,
  "profile_scores": {
    "email": { "present": true, "score": 90, "feedback": "Professional format" },
    "github": { "present": true, "score": 100, "feedback": "Included" },
    "linkedin": { "present": true, "score": 100, "feedback": "Included" },
    "portfolio": { "present": false, "score": 0, "feedback": "Missing" },
    "kaggle": { "present": false, "score": 0, "feedback": "Missing" },
    "hackerrank": { "present": false, "score": 0, "feedback": "Missing" }
  },
  "section_scores": {
    "skills": { "score": 45, "feedback": "Missing core domain-specific tools for ${finalDomain}." },
    "experience": { "score": 50, "feedback": "Lacks quantified impact. Uses generic descriptions." },
    "education": { "score": 70, "feedback": "Relevant degree but missing honors/distinction." },
    "projects": { "score": 30, "feedback": "Only basic school assignments found." },
    "internship": { "score": 0, "feedback": "Not found" },
    "certificate": { "score": 40, "feedback": "Only generic course completions found." },
    "extracurricular": { "score": 20, "feedback": "No relevant participation." }
  },
  "strengths": ["specific strength 1", "specific strength 2"],
  "critical_issues": ["specific issue 1", "specific issue 2"],
  "verdict": "2 sentence professional assessment - BE BLUNT if the resume is weak."
}

RAW RESUME TEXT:
${resumeText.slice(0, 2000)}

PARSED SECTIONS (JSON):
${JSON.stringify(parsed, null, 2).slice(0, 4000)}

JSON only:`;

      const rawScores = processingMode === "online" 
          ? await callGroq(scorePrompt, currentKey)
          : await callOllama(model, scorePrompt);
      const parsedScores = safeJSON(rawScores);
      if (!parsedScores) throw new Error("Failed to calculate scores. Try a different model.");
      setScores(parsedScores);
      setLoadPct(80);

      /* Step 3 — Stream improvement review */
      setLoadMsg("Generating domain review and projects...");
      setPage("analysis");
      setActiveTab("domain"); // Auto-switch to domain tab to show streaming text
      setStreaming(true);
      setReviewText("");

      const reviewPrompt = `You are a professional resume coach specialized in "${finalDomain}". The candidate is targeting "${finalDomain}" and their experience level is ${levelConf.criteria}.

Write a concise, actionable review tailored strictly to the target role. You MUST use these exact three headers to separate your response:

## INTERVIEW_STRENGTHS
List 4-6 specific things FROM THE RESUME that will help in interviews for ${finalDomain} roles:
- Specific technical skills they have
- Relevant projects with measurable outcomes
- Tools/frameworks they've used
- Problem-solving approaches demonstrated
- Leadership or collaboration examples
Focus on WHAT THEY HAVE, not what they're missing. Be specific - reference actual projects or experiences from their resume.

## IMPROVEMENTS
### Missing for Target Role:
- 2-3 specific skills, keywords, or experiences missing for a ${finalDomain} role
### Remove or Reduce:
- 1-2 things that weaken the resume or distract from the targeted role
### Strengthen:
- 2-3 specific rewrites to make existing content sound more like a ${finalDomain}
### Next Steps:
- 1-2 skills to learn, 1-2 things to build/add, and 1 relevant certification

## PROJECTS
Suggest 2 highly relevant buildable project ideas tailored to ${finalDomain} and the candidate's existing skills. Include a difficulty level for each. Ensure they are impressive and not generic.
### Project Idea 1: [Name]
**Difficulty:** [Level] | **Tech Stack:** [Tools]
- [Details]

Keep your response direct, practical, and highly specific to the resume provided. Do not use asterisks for bullet points, only dashes.

RESUME:
${JSON.stringify(parsed.sections, null, 2).slice(0, 3000)}`;

      if (processingMode === "online") {
        await streamGroq(reviewPrompt, (text) => setReviewText(text), currentKey);
      } else {
        await streamOllama(model, reviewPrompt, (text) => setReviewText(text));
      }
      
      setStreaming(false);
      
      /* Step 4 — Generate Adjacent Roles */
      setLoadMsg("Identifying cross-functional abilities...");
      const adjacentPrompt = `Analyze this resume and identify 3-5 alternative roles this person could work in (beyond their primary target of "${finalDomain}").

For each role, provide:
- The role name
- A fit score (0-100)
- A brief reason why they're qualified

IMPORTANT: Return ONLY a valid JSON array. No markdown, no backticks, no explanation. Just the raw JSON array.

Example format:
[{"role":"Data Scientist","fit_score":85,"reason":"Has Python, ML models, and data analysis skills"},{"role":"Frontend Developer","fit_score":70,"reason":"Built React UIs in 2 projects"}]

Resume data:
${JSON.stringify(parsed.sections, null, 2).slice(0, 2500)}

JSON array only:`;

      try {
        const adjacentRaw = processingMode === "online"
          ? await callGroq(adjacentPrompt, currentKey)
          : await callOllama(model, adjacentPrompt);
        
        console.log("Adjacent roles raw response:", adjacentRaw);
        
        // Clean the response - remove markdown code blocks if present
        let cleaned = adjacentRaw.trim();
        cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        cleaned = cleaned.trim();
        
        console.log("Cleaned response:", cleaned);
        
        const adjacentParsed = JSON.parse(cleaned);
        
        if (Array.isArray(adjacentParsed) && adjacentParsed.length > 0) {
          setAdjacentRoles(adjacentParsed.slice(0, 5)); // Max 5 roles
          console.log("Successfully set adjacent roles:", adjacentParsed);
        } else {
          console.warn("Adjacent roles response not an array or empty:", adjacentParsed);
          setAdjacentRoles([]);
        }
      } catch (e) {
        console.error("Failed to generate adjacent roles:", e);
        console.error("Error details:", e.message);
        // Set empty array so UI shows that generation completed but found nothing
        setAdjacentRoles([]);
      }
      
      setLoadPct(100);

    } catch (e) {
      setError(e.message);
      setPage("home");
    }
  }

  /* ── HOME PAGE ──────────────────────────────────────────── */
  if (page === "home") {
    return (
      <div className="home">
        <div className="home-inner">

          {/* LEFT ─ Graphic and Title */}
          <div className="home-left">
            <div className="home-hero-content">
              <img src="hero.png" alt="AI Resume Analysis Graphic" className="home-hero-img" />
            </div>
            <div className="home-header-left">
              <div className="home-logo">ResumeAI · ATS Analyzer</div>
              <h1 className="home-title">Is your resume <strong>ATS ready?</strong></h1>
              <p className="home-subtitle">Upload your resume, pick your experience level, and get instant AI-powered ATS scoring with section-by-section feedback.</p>
            </div>
          </div>

          {/* RIGHT ─ Upload & Settings */}
          <div className="home-right">
            {/* Engine selector */}
            <div className="card" style={{ padding: "1rem" }}>
              <div className="tags-row" style={{ marginTop: 0, justifyContent: "center" }}>
                <div 
                  className={`tag ${processingMode === "online" ? "tag-green" : ""}`}
                  style={{
                    cursor: "pointer", 
                    border: processingMode !== "online" ? "1px solid var(--border-light)" : "", 
                    background: processingMode !== "online" ? "var(--bg-hover)" : "", 
                    color: processingMode !== "online" ? "var(--text-main)" : "",
                    flex: 1, textAlign: "center", display: "flex", justifyContent: "center", alignItems: "center", gap: "6px", padding: "10px"
                  }}
                  onClick={() => setProcessingMode("online")}
                >
                  <div className={`dot ${processingMode === "online" ? "dot-green" : ""}`} style={{ background: processingMode !== "online" ? "var(--border-glow)" : "" }}/>
                  Online Engine (Groq)
                </div>
                <div 
                  className={`tag ${processingMode === "offline" ? "tag-green" : ""}`}
                  style={{
                    cursor: "pointer", 
                    border: processingMode !== "offline" ? "1px solid var(--border-light)" : "", 
                    background: processingMode !== "offline" ? "var(--bg-hover)" : "", 
                    color: processingMode !== "offline" ? "var(--text-main)" : "",
                    flex: 1, textAlign: "center", display: "flex", justifyContent: "center", alignItems: "center", gap: "6px", padding: "10px"
                  }}
                  onClick={() => setProcessingMode("offline")}
                >
                  <div className={`dot ${processingMode === "offline" && ollamaOk ? "dot-green" : (processingMode === "offline" ? "dot-red" : "")}`} style={{ background: processingMode !== "offline" ? "var(--border-glow)" : "" }}/>
                  Offline Engine (Ollama)
                </div>
              </div>
            </div>

            {/* Ollama status + setup */}
            {processingMode === "offline" && checking && (
              <div style={{ display:"flex", justifyContent:"center" }}>
                <div className="ollama-pill"><div className="dot dot-pulse"/> Connecting to Ollama...</div>
              </div>
            )}

            {processingMode === "offline" && !checking && !ollamaOk && (
              <div className="setup-card">
                <strong style={{color:"#ff5c5c"}}>⚠ Ollama not detected.</strong> Start it first:<br/>
                1. Install from <a href="https://ollama.com/download" target="_blank">ollama.com/download</a><br/>
                2. Run in terminal: <code>ollama serve</code><br/>
                3. Pull a model: <code>ollama pull llama3.1</code><br/>
                4. Refresh this page
              </div>
            )}

            {/* Upload card */}
            <div className="card">
              <div className="card-label">Resume File</div>
              <div
                className={`dropzone ${drag ? "active" : ""}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
              >
                <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
                  onChange={e => handleFile(e.target.files[0])} style={{opacity:0,position:"absolute",inset:0,cursor:"pointer"}}/>
                <div className="dz-icon">
                  <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              </div>
              {file ? (
                <>
                  <div className="dz-title">{file.name}</div>
                  <div className="dz-sub">{(file.size/1024).toFixed(0)} KB · click to change</div>
                  <div className="dz-badge">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    File attached
                  </div>
                </>
              ) : (
                <>
                  <div className="dz-title">Drop your resume here</div>
                  <div className="dz-sub">PDF, PNG, JPG, WEBP, TXT supported</div>
                </>
              )}
            </div>

            {/* Paste fallback */}
            <div style={{ margin:"1rem 0 0.5rem", fontSize:11, color:"var(--text3)", fontFamily:"var(--mono)", letterSpacing:"0.08em", textTransform:"uppercase" }}>
              or paste text
            </div>
            <textarea
              placeholder="Paste your resume text here..."
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              style={{ minHeight:90 }}
            />
          </div>

          {/* Level selector */}
          <div className="card">
            <div className="card-label">Experience Level</div>
            <div className="levels">
              {LEVELS.map(l => (
                <div
                  key={l.id}
                  className={`level-card level-${l.id} ${level === l.id ? "selected" : ""}`}
                  onClick={() => setLevel(l.id)}
                >
                  <div className="level-icon">{l.icon}</div>
                  <div className="level-name">{l.name}</div>
                  <div className="level-years">{l.years}</div>
                  <div className="level-desc">{l.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Domain selector */}
          <div className="card">
            <div className="card-label">Target Domain / Role</div>
            <div className="tags-row" style={{ marginTop: 0, marginBottom: domainMode === "custom" || domainMode === "auto" ? "12px" : "0" }}>
              {[
                {id: "auto", label: "✨ Auto-detect"},
                {id: "Software Engineer", label: "Software Eng"},
                {id: "Data Scientist", label: "Data Science"},
                {id: "Frontend Developer", label: "Frontend"},
                {id: "Backend Developer", label: "Backend"},
                {id: "custom", label: "Custom..."}
              ].map(d => (
                <div 
                  key={d.id} 
                  className={`tag ${domainMode === d.id ? "tag-green" : ""}`}
                  style={{
                    cursor: "pointer", 
                    border: domainMode !== d.id ? "1px solid var(--border-light)" : "", 
                    background: domainMode !== d.id ? "var(--bg-hover)" : "", 
                    color: domainMode !== d.id ? "var(--text-main)" : ""
                  }}
                  onClick={() => setDomainMode(d.id)}
                >
                  {d.label}
                </div>
              ))}
            </div>
            {domainMode === "custom" && (
              <input 
                type="text"
                placeholder="e.g. Product Manager, DevOps..."
                value={customDomain}
                onChange={e => setCustomDomain(e.target.value)}
                style={{
                  width: "100%", padding: "10px 14px",
                  background: "rgba(0,0,0,0.2)", color: "var(--text-main)",
                  border: "1px solid var(--border-light)", borderRadius: "var(--r-sm)",
                  fontFamily: "var(--font-sans)", fontSize: "13px", outline: "none",
                  transition: "border-color 0.2s"
                }}
                onFocus={e => { e.target.style.borderColor = "var(--primary)"; e.target.style.boxShadow = "0 0 0 2px var(--primary-dim)"; }}
                onBlur={e => { e.target.style.borderColor = "var(--border-light)"; e.target.style.boxShadow = "none"; }}
              />
            )}
            {domainMode === "auto" && (
              <div style={{fontSize: "12px", color: "var(--text-muted)"}}>
                AI will infer your target role based on resume content.
              </div>
            )}
          </div>

            {/* Model + analyze */}
            <div className="card">
              <div className="card-label">AI Engine Status</div>
              {processingMode === "online" ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Selection between Developer Key and Personal Key */}
                  <div className="tags-row" style={{ marginTop: 0, marginBottom: "4px" }}>
                    <div 
                      className={`tag ${onlineOption === "developer" ? "tag-green" : ""}`}
                      style={{
                        cursor: serverKeyAvailable ? "pointer" : "not-allowed", 
                        border: onlineOption !== "developer" ? "1px solid var(--border-light)" : "", 
                        background: onlineOption !== "developer" ? "var(--bg-hover)" : "", 
                        color: onlineOption !== "developer" ? "var(--text-main)" : "",
                        flex: 1, textAlign: "center", fontSize: "11px", opacity: serverKeyAvailable ? 1 : 0.5
                      }}
                      onClick={() => serverKeyAvailable && setOnlineOption("developer")}
                      title={!serverKeyAvailable ? "Developer API key not configured on Vercel" : ""}
                    >
                      {serverKeyAvailable ? "✨ Online (Free)" : "❌ Online (N/A)"}
                    </div>
                    <div 
                      className={`tag ${onlineOption === "personal" ? "tag-green" : ""}`}
                      style={{
                        cursor: "pointer", 
                        border: onlineOption !== "personal" ? "1px solid var(--border-light)" : "", 
                        background: onlineOption !== "personal" ? "var(--bg-hover)" : "", 
                        color: onlineOption !== "personal" ? "var(--text-main)" : "",
                        flex: 1, textAlign: "center", fontSize: "11px"
                      }}
                      onClick={() => setOnlineOption("personal")}
                    >
                      🔑 Personal API Key
                    </div>
                  </div>

                  <div className="model-row">
                    <div className="ollama-pill" style={{ borderColor: (onlineOption === "developer" || groqKey) ? 'var(--primary)' : 'var(--danger)', background: (onlineOption === "developer" || groqKey) ? 'var(--primary-dim)' : 'var(--danger-dim)', color: (onlineOption === "developer" || groqKey) ? 'var(--primary)' : 'var(--danger)' }}>
                      <div className={`dot ${(onlineOption === "developer" || groqKey) ? 'dot-green' : 'dot-red'}`}/> 
                      {(onlineOption === "developer" || groqKey) ? "Engine Ready" : "Enter API Key"}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", flex: 1, textAlign: "right", paddingRight: "8px" }}>
                      {GROQ_MODEL}
                    </div>
                  </div>

                  {/* API Key Input - Only for Personal Option */}
                  {onlineOption === "personal" ? (
                    groqKey && !showKeyInput ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ flex: 1, padding: '8px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-light)', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-dim)', letterSpacing: '0.05em' }}>
                          {'•'.repeat(12)} {groqKey.slice(-6)}
                        </div>
                        <button onClick={() => setShowKeyInput(true)} style={{ padding: '8px 12px', background: 'var(--bg-hover)', border: '1px solid var(--border-light)', borderRadius: 'var(--r-sm)', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 500, transition: 'all 0.2s' }}>Change</button>
                        <button onClick={() => updateGroqKey('')} style={{ padding: '8px 12px', background: 'var(--danger-dim)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--r-sm)', cursor: 'pointer', color: 'var(--danger)', fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 500, transition: 'all 0.2s' }}>Clear</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="password"
                          placeholder="Paste your Groq API key (gsk_...)"
                          value={showKeyInput ? '' : groqKey}
                          onChange={e => {
                            updateGroqKey(e.target.value.trim());
                            if (showKeyInput && e.target.value.trim()) setShowKeyInput(false);
                          }}
                          onBlur={() => { if (groqKey) setShowKeyInput(false); }}
                          autoFocus={showKeyInput}
                          style={{
                            flex: 1, padding: '10px 14px',
                            background: 'rgba(0,0,0,0.2)', color: 'var(--text-main)',
                            border: '1px solid var(--border-light)', borderRadius: 'var(--r-sm)',
                            fontFamily: 'var(--font-mono)', fontSize: '12px', outline: 'none',
                            transition: 'border-color 0.2s'
                          }}
                          onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 2px var(--primary-dim)'; }}
                        />
                      </div>
                    )
                  ) : (
                    <div style={{ 
                      padding: "10px 14px", 
                      background: "rgba(16,185,129,0.05)", 
                      border: "1px dashed rgba(16,185,129,0.3)", 
                      borderRadius: "var(--r-sm)",
                      fontSize: "12px",
                      color: "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px"
                    }}>
                      <span style={{ fontSize: "16px" }}>🚀</span>
                      Using developer's shared Groq API key hosted on Vercel.
                    </div>
                  )}

                  {onlineOption === "personal" && (
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: '1.5' }}>
                      Get a free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>console.groq.com/keys</a> · Stored locally in your browser
                    </div>
                  )}
                </div>
              ) : (
                ollamaOk && models.length > 0 ? (
                  <div className="model-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
                    <div className="ollama-pill" style={{ margin: 0 }}>
                      <div className="dot dot-green"/> Ollama Models
                    </div>
                    <div className="tags-row scrollable-tags" style={{ width: '100%', margin: 0 }}>
                      {models.map(m => (
                        <div 
                          key={m} 
                          className={`tag ${model === m ? "tag-green" : ""}`}
                          style={{
                            cursor: "pointer", 
                            border: model !== m ? "1px solid var(--border-light)" : "", 
                            background: model !== m ? "var(--bg-hover)" : "", 
                            color: model !== m ? "var(--text-main)" : "",
                            whiteSpace: "nowrap"
                          }}
                          onClick={() => setModel(m)}
                        >
                          {m}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="ollama-pill">
                    <div className={`dot ${checking ? "dot-pulse" : "dot-red"}`}/>
                    {checking ? "Checking..." : "Ollama offline"}
                  </div>
                )
              )}
              {error && <div className="err" style={{marginTop:"1rem"}}>{error}</div>}
              
              <button className="btn-analyze" style={{marginTop:"1rem"}}
                onClick={analyze}
                disabled={(processingMode === "offline" && (!ollamaOk || !model || checking)) || 
                         (processingMode === "online" && ((onlineOption === "personal" && !groqKey) || (onlineOption === "developer" && waitTime > 0)))}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                {(onlineOption === "developer" && waitTime > 0 && processingMode === "online") 
                  ? `Wait ${waitTime}s to analyze` 
                  : "Analyze Resume"}
              </button>
              
              {processingMode === "online" && (
                <div style={{
                  marginTop: "1rem",
                  padding: "12px",
                  background: onlineOption === "developer" ? "rgba(245,158,11,0.1)" : "rgba(16,185,129,0.1)",
                  border: `1px solid ${onlineOption === "developer" ? "rgba(245,158,11,0.3)" : "rgba(16,185,129,0.3)"}`,
                  borderRadius: "var(--r-sm)",
                  fontSize: "11px",
                  lineHeight: "1.6",
                  color: "var(--text-muted)"
                }}>
                  {onlineOption === "developer" ? (
                    <>
                      <div style={{fontWeight: "600", color: "var(--warning)", marginBottom: "6px"}}>
                        ⚠️ Using Online Engine (Developer Key)
                      </div>
                      <div style={{marginBottom: "6px"}}>
                        You're using the developer's shared API key. To avoid rate limits, you must wait <strong>{RATE_LIMIT_SECONDS} seconds</strong> between analyses.
                      </div>
                      <div>
                        💡 <strong>Use your own key</strong> to analyze without waiting! Switch to "Personal API Key" above.
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{fontWeight: "600", color: "var(--primary)", marginBottom: "6px"}}>
                        ✅ Using Your Personal API Key
                      </div>
                      <div>
                        You are using your own API key. No wait time between analyses. Enjoy!
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

          </div> {/* END RIGHT */}
        </div> {/* END INNER */}
        <Footer />
      </div>
    );
  }

  /* ── LOADING PAGE ───────────────────────────────────────── */
  if (page === "loading") {
    return (
      <div className="loading-screen">
        <div className="loading-ring"/>
        <div className="loading-msg">{loadMsg}</div>
        <div className="loading-bar-wrap">
          <div className="loading-bar" style={{ width:`${loadPct}%` }}/>
        </div>
        <div style={{ fontSize:11, color:"var(--text3)", fontFamily:"var(--mono)" }}>
          Using {model} · {levelConfig?.name} level
        </div>
        <Footer />
      </div>
    );
  }

  /* ── ANALYSIS PAGE ──────────────────────────────────────── */
  const sectionEntries = scores?.section_scores
    ? Object.entries(scores.section_scores).filter(([k]) => sections?.[k] || k === "contact")
    : [];

  return (
    <div className="analysis-page">

      {/* Top bar */}
      <div className="topbar">
        <div className="topbar-logo">ResumeAI</div>
        <div className="topbar-sep"/>
        {contact?.name && (
          <div className="topbar-info">
            <strong>{contact.name}</strong>
            {contact.email && ` · ${contact.email}`}
          </div>
        )}
        <div className={`topbar-level ${level}`}>{levelConfig?.name} · {levelConfig?.years}</div>
        {detectedDomain && (
          <div className="topbar-level" style={{background: "var(--bg-hover)", color: "var(--text-main)", border: "1px solid var(--border-light)"}}>
            🎯 {detectedDomain}
          </div>
        )}
        <div className="topbar-right">
          <div className="ollama-pill" style={processingMode === "online" ? { borderColor: 'var(--primary)', background: 'var(--primary-dim)', color: 'var(--primary)' } : {}}>
            <div className="dot dot-green"/> {processingMode === "online" ? "Cloud AI" : model}
          </div>
          <button className="btn-back" onClick={() => { setPage("home"); setError(""); }}>
            ← New Resume
          </button>
        </div>
      </div>

      {/* Split screen */}
      <div className="split">

        {/* LEFT — Resume preview */}
        <div className="pane-left">
          <div className="pane-header">
            <span>Resume Preview</span>
            {file && <span className="pane-header-name">{file.name}</span>}
          </div>
          <ResumePreview file={file} fileURL={fileURL} pasteText={pasteText}/>
        </div>

        {/* RIGHT — ATS Scores & Review Tabs */}
        <div className="pane-right">
          <div className="pane-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <span>Resume Analysis</span>
            {scores && (
              <span className="pane-header-score">
                ATS Compat: <span style={{ color: scoreColor(scores.ats_compatibility), fontWeight: 'bold' }}>{scores.ats_compatibility}%</span>
              </span>
            )}
          </div>

          <div className="tab-bar">
            {[
              { id: 'ats', label: '📊 ATS Scoring' },
              { id: 'domain', label: '🎯 Domain Review' },
              { id: 'improvements', label: '📈 Improvements' },
              { id: 'projects', label: '💡 Project Ideas' },
              { id: 'abilities', label: '🎯 Abilities' }
            ].map(t => (
              <div 
                key={t.id}
                className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </div>
            ))}
          </div>
          
          {/* Profile Scores (Always visible above tabs or part of the header area) */}
          {scores && scores.profile_scores && (
            <div style={{ padding: '0.75rem 1.5rem', display: 'flex', gap: '8px', flexWrap: 'wrap', borderBottom: '1px solid var(--border-light)', background: 'rgba(0,0,0,0.1)' }}>
              {Object.entries(scores.profile_scores).map(([key, val]) => {
                let url = links?.[key];
                
                // If platform is marked present but no URL extracted, try to construct default URL
                if (val.present && !url && key !== 'email') {
                  const platformDefaults = {
                    'github': 'https://github.com/',
                    'linkedin': 'https://linkedin.com/in/',
                    'portfolio': null, // Can't construct without domain
                    'kaggle': 'https://kaggle.com/',
                    'hackerrank': 'https://hackerrank.com/'
                  };
                  url = platformDefaults[key];
                }
                
                const isClickable = val.present && url && key !== 'email';
                
                const chip = (
                  <div key={key} style={{ 
                    display: 'flex', alignItems: 'center', gap: '6px', 
                    padding: '4px 10px', borderRadius: '100px', 
                    fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: '600',
                    background: val.present || val.score >= 50 ? 'var(--primary-dim)' : 'var(--danger-dim)',
                    color: val.present || val.score >= 50 ? 'var(--primary)' : 'var(--danger)',
                    border: `1px solid ${val.present || val.score >= 50 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    cursor: isClickable ? 'pointer' : 'default',
                    transition: 'all 0.2s ease',
                    userSelect: 'none',
                    opacity: (val.present && !url && key !== 'email') ? 0.6 : 1
                  }}
                  className={isClickable ? 'profile-chip-clickable' : ''}
                  title={isClickable ? `Visit ${key}` : (val.present && !url ? `${key} detected but URL not found in resume` : '')}
                  >
                    <span style={{ textTransform: 'capitalize' }}>{key}</span>
                    <span style={{ opacity: 0.6 }}>|</span>
                    <span>{key === 'email' ? `${val.score}%` : (val.present ? '✓' : '✗')}</span>
                  </div>
                );

                if (isClickable) {
                  return (
                    <a key={key} href={url.startsWith('http') ? url : `https://${url}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                      {chip}
                    </a>
                  );
                }
                return chip;
              })}
            </div>
          )}

          <div className="scores-scroll">
            
            {/* TAB: ATS Scoring */}
            <div style={{ display: activeTab === 'ats' ? 'flex' : 'none', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Overall score ring */}
              {scores && (
                <div className="inner-card overall-ring-wrap">
                <Ring score={scores.overall_score} size={110}/>
                <div className="overall-info">
                  <div className="overall-label">Overall ATS Score</div>
                  <div className="overall-score">
                    {scores.overall_score}<span>/100</span>
                  </div>
                  <div className="overall-verdict">{scores.verdict}</div>
                </div>
              </div>
            )}

            {/* Per-section scores */}
            {sectionEntries.length > 0 && (
              <div className="inner-card section-scores-card">
                <div className="section-title-row">
                  <div className="section-title">Section Scores</div>
                  <div className="section-count">{sectionEntries.length} sections</div>
                </div>
                {sectionEntries.map(([key, val]) => (
                  <div key={key} className="sec-row">
                    <div className="sec-top">
                      <div className="sec-name">{key}</div>
                      <div className={`sec-score-badge ${scoreBadge(val.score)}`}>{val.score}/100</div>
                    </div>
                    <div className="sec-bar-track">
                      <div className="sec-bar-fill"
                        style={{ width:`${val.score}%`, background: scoreColor(val.score) }}/>
                    </div>
                    {val.feedback && <div className="sec-feedback">{val.feedback}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Strengths & Issues */}
            {scores && (
              <div className="tags-grid">
                <div className="inner-card tags-card">
                  <div className="section-title" style={{marginBottom:0}}>✓ Strengths</div>
                  <div className="tags-row">
                    {(scores.strengths||[]).map((s,i) => (
                      <div key={i} className="tag tag-green">{s}</div>
                    ))}
                  </div>
                </div>
                <div className="inner-card tags-card">
                  <div className="section-title" style={{marginBottom:0}}>✗ Issues</div>
                  <div className="tags-row">
                    {(scores.critical_issues||[]).map((s,i) => (
                      <div key={i} className="tag tag-red">{s}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            </div> {/* END ATS TAB */}

            {/* TABS: Domain Review & Projects */}
            {(() => {
               const pIndex = reviewText.toUpperCase().indexOf("## PROJECT"); // Catch 'PROJECT' or 'PROJECTS'
               let domainText = reviewText;
               let pText = "";
               if (pIndex !== -1) {
                 domainText = reviewText.substring(0, pIndex);
                 pText = reviewText.substring(pIndex);
               }
               
               // Split domain review into Interview Strengths and Improvements
               const strengthsIndex = domainText.toUpperCase().indexOf("## INTERVIEW");
               const improvementsIndex = domainText.toUpperCase().indexOf("## IMPROVEMENTS");
               
               let strengthsText = "";
               let improvementsText = "";
               
               if (strengthsIndex !== -1 && improvementsIndex !== -1) {
                 strengthsText = domainText.substring(strengthsIndex, improvementsIndex);
                 improvementsText = domainText.substring(improvementsIndex);
                 
                 // Clean headers from both sections - more aggressive cleanup
                 strengthsText = strengthsText
                   .replace(/##\s*INTERVIEW[_\s]*STRENGTHS?/gi, "")
                   .replace(/^[\s\n]+/, "")
                   .trim();
                 
                 improvementsText = improvementsText
                   .replace(/##\s*IMPROVEMENTS?/gi, "")
                   .replace(/^[\s\n]+/, "")
                   .trim();
               } else {
                 // Fallback if headers not found (old format or streaming)
                 strengthsText = domainText
                   .replace(/##\s*DOMAIN[_\s]*REVIEW/gi, "")
                   .replace(/##\s*INTERVIEW[_\s]*STRENGTHS?/gi, "")
                   .replace(/^[\s\n]+/, "")
                   .trim();
               }
               
               // Clean project text
               pText = pText.replace(/##\s*PROJECTS?/gi, "").replace(/^[\s\n]+/, "").trim();

               return (
                 <>
                   {/* Domain Review Tab */}
                   <div style={{ display: activeTab === 'domain' ? 'block' : 'none' }}>
                     <div className="inner-card review-card">
                       <div className="divider-label" style={{marginBottom:"1rem"}}>
                         🎯 Interview Strengths
                       </div>
                       <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: '1.5' }}>
                         What's in your resume that will help you in interviews:
                       </div>
                       {strengthsText || streaming ? (
                         <MarkdownText text={strengthsText} streaming={streaming} active={activeTab === 'domain'} />
                       ) : (
                         <div className="stream-loading">
                           <div className="spin-sm"/> Waiting for generation...
                         </div>
                       )}
                     </div>
                   </div>
                   
                   {/* Improvements Tab */}
                   <div style={{ display: activeTab === 'improvements' ? 'block' : 'none' }}>
                     <div className="inner-card review-card">
                       <div className="divider-label" style={{marginBottom:"1rem"}}>
                         📈 Improvements
                       </div>
                       <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: '1.5' }}>
                         What to add or change:
                       </div>
                       {improvementsText ? (
                         <MarkdownText text={improvementsText} streaming={false} active={activeTab === 'improvements'} />
                       ) : (
                         <div className="stream-loading">
                           {streaming ? <><div className="spin-sm"/> Generating improvements...</> : "No improvements generated yet."}
                         </div>
                       )}
                     </div>
                   </div>
                   
                   <div style={{ display: activeTab === 'projects' ? 'block' : 'none' }}>
                    <div className="inner-card review-card">
                      <div className="divider-label" style={{marginBottom:"1rem"}}>
                        💡 Tailored Project Suggestions
                      </div>
                      {pText || (streaming && reviewText.length > 50) ? (
                        <MarkdownText text={pText} streaming={streaming} active={activeTab === 'projects'} />
                      ) : (
                        <div className="stream-loading">
                          {streaming ? <><div className="spin-sm"/> Generating projects...</> : "No projects generated."}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Abilities Tab */}
                  <div style={{ display: activeTab === 'abilities' ? 'block' : 'none' }}>
                    <div className="inner-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', padding: '1.25rem', maxWidth: '800px', margin: '0 auto' }}>
                      <div className="divider-label" style={{marginBottom:"1rem"}}>
                        🎯 Cross-Functional Abilities
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: '1.5' }}>
                        Based on your resume, you could also work in:
                      </div>
                      {adjacentRoles.length > 0 ? (
                        <>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {adjacentRoles.map((role, idx) => (
                              <div key={idx} style={{
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid var(--border-light)',
                                borderRadius: 'var(--r-sm)',
                                padding: '12px',
                                transition: 'all 0.2s ease',
                                cursor: 'default'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                                e.currentTarget.style.borderColor = 'var(--border-glow)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                                e.currentTarget.style.borderColor = 'var(--border-light)';
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                  <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-main)' }}>
                                    {role.role}
                                  </div>
                                  <div style={{
                                    fontSize: '10px',
                                    fontFamily: 'var(--font-mono)',
                                    fontWeight: '600',
                                    padding: '2px 8px',
                                    borderRadius: '100px',
                                    background: role.fit_score >= 80 ? 'var(--primary-dim)' : role.fit_score >= 60 ? 'var(--warning-dim)' : 'var(--info-dim)',
                                    color: role.fit_score >= 80 ? 'var(--primary)' : role.fit_score >= 60 ? 'var(--warning)' : 'var(--info)',
                                    border: `1px solid ${role.fit_score >= 80 ? 'rgba(16,185,129,0.3)' : role.fit_score >= 60 ? 'rgba(245,158,11,0.3)' : 'rgba(59,130,246,0.3)'}`
                                  }}>
                                    {role.fit_score}% fit
                                  </div>
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                                  {role.reason}
                                </div>
                              </div>
                            ))}
                          </div>
                          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-light)', fontSize: '10px', color: 'var(--text-dim)', lineHeight: '1.5' }}>
                            💡 Tip: Highlight transferable skills in your resume to make pivoting easier.
                          </div>
                        </>
                      ) : (
                        <div style={{ 
                          padding: '2rem', 
                          textAlign: 'center',
                          color: 'var(--text-muted)',
                          fontSize: '13px',
                          lineHeight: '1.6'
                        }}>
                          <div style={{ fontSize: '32px', marginBottom: '1rem', opacity: 0.5 }}>🔍</div>
                          <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: 'var(--text-main)' }}>
                            Analyzing Cross-Functional Abilities
                          </div>
                          <div>
                            This may take a moment. Check the browser console (F12) for details if this persists.
                          </div>
                          <div style={{ 
                            marginTop: '1rem', 
                            padding: '12px',
                            background: 'rgba(59,130,246,0.1)',
                            border: '1px solid rgba(59,130,246,0.3)',
                            borderRadius: 'var(--r-sm)',
                            fontSize: '11px'
                          }}>
                            💡 Tip: Try analyzing again if no results appear after 10 seconds
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
               )
            })()}

          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
