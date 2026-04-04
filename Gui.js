/* ================================================================
   ResumeAI — Ollama-powered ATS Analyzer
   GUI & Application Orchestration (MODULAR VERSION)
   ================================================================ */
const { useState, useRef, useCallback, useEffect, useMemo } = React;

const OLLAMA = "http://127.0.0.1:11434";
const GROQ_MODEL = "llama-3.3-70b-versatile"; 

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


/* ── Markdown Renderer ─────────────────────────────────────── */
function MarkdownText({ text, streaming, active, loading, type = "insights" }) {
  if (loading && !text) {
    return (
      <div className="stream-loading" style={{ padding: '1rem 0' }}>
         <div className="spin-sm"/> Generating {type}...
      </div>
    );
  }
  
  if (!text && !streaming && !loading) {
    return (
      <div style={{ padding: '1rem 0', color: 'var(--text-dim)', fontSize: '13px', fontStyle: 'italic' }}>
        No {type} generated for this section.
      </div>
    );
  }

  const lines = text ? text.split('\n') : [];
  
  return (
    <div className="review-text" style={{ whiteSpace: 'normal', minHeight: '40px' }}>
      {lines.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} style={{ height: '8px' }}/>;
        
        // Headers
        if (t.startsWith('###')) {
          const content = t.replace(/###\s*/, '');
          if(content.toLowerCase().startsWith('project idea')) {
            return <div key={i} style={{ display: 'inline-block', color: 'var(--bg)', background: 'var(--primary)', padding: '6px 12px', borderRadius: '4px', marginTop: i===0?'0.5rem':'1.5rem', marginBottom: '0.75rem', fontSize: '13px', fontWeight: 'bold', letterSpacing: '0.05em', textTransform: 'uppercase', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)' }}>{content}</div>;
          }
          return <h4 key={i} style={{ color: 'var(--text-main)', marginTop: i===0?'0.5rem':'1.5rem', marginBottom: '0.75rem', fontSize: '15px', fontWeight: '600', letterSpacing: '0.03em', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px' }}>{content}</h4>;
        }
        if (t.startsWith('##')) {
          const upper = t.toUpperCase();
          if (upper.includes('PROJECT') || upper.includes('STRENGTH') || upper.includes('IMPROVEMENT')) return null;
          return <h3 key={i} style={{ color: '#fff', marginTop: i===0?'0.5rem':'1.5rem', marginBottom: '1rem', fontSize: '18px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{width:'8px', height:'8px', background:'var(--primary)', borderRadius:'50%'}}></div>{t.replace(/##\s*/, '')}</h3>;
        }
        
        // Bullets
        if (t.startsWith('- ') || t.startsWith('* ')) {
          let content = t.substring(2);
          const parts = content.split(/(\*\*.*?\*\*)/g);
          return (
            <div key={i} style={{ display: 'flex', gap: '12px', marginBottom: '10px', lineHeight: '1.6', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', padding: '14px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.2s ease', cursor: 'default' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'} onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}>
              <div style={{ color: 'var(--primary)', marginTop: '2px', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <span style={{ fontSize: '14px' }}>
                {parts.map((part, j) => {
                  if (part.startsWith('**') && part.endsWith('**')) {
                    const inner = part.slice(2,-2);
                    if(inner.includes('Difficulty') || inner.includes('Tech Stack') || inner.includes('Missing for') || inner.includes('Remove') || inner.includes('Strengthen') || inner.includes('Next Steps')) {
                       return <strong key={j} style={{ color: 'var(--text-main)', fontSize: '12px', background: 'rgba(0,0,0,0.3)', padding: '3px 8px', borderRadius: '100px', marginRight: '6px', border: '1px solid rgba(255,255,255,0.1)' }}>{inner}</strong>;
                    }
                    return <strong key={j} style={{ color: '#fff', fontWeight: '600' }}>{inner}</strong>;
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
          <div key={i} style={{ marginBottom: '12px', lineHeight: '1.6', color: 'var(--text-muted)', fontSize: '14.5px' }}>
            {parts.map((part, j) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={j} style={{ color: '#fff', fontWeight: '600' }}>{part.slice(2, -2)}</strong>;
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

const SCORING_SECTIONS = [
  { id: 'education', name: 'Education' },
  { id: 'skills', name: 'Skills' },
  { id: 'projects', name: 'Projects' },
  { id: 'experience', name: 'Internship/Experience' },
  { id: 'certificate', name: 'Certifications' },
  { id: 'extracurricular', name: 'Extra Curricular' },
  { id: 'layout', name: 'Resume Layout' }
];

/* ── Levels config ──────────────────────────────────────────── */
const LEVELS = [
  {
    id: "beginner",
    icon: "🌱",
    name: "Beginner",
    years: "< 1 year",
    desc: "Just starting out — scored on formatting, clarity, education & skills presentation",
    criteria: "under 1 year of experience — evaluate based on formatting, education quality, core skills, and potential. Be objective and critical.",
    scoringRules: "SCORING ETHOS: BE OBJECTIVE. Do not inflate scores. High quality beginners can reach 80+, but mediocre or poorly structured resumes should be in the 30-50 range. Focus on whether they have the fundamental skills for the domain."
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
  const [activeTab, setActiveTab]      = useState("ats");
  const [links, setLinks]              = useState(null);
  const [groqKey, setGroqKey]          = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [adjacentRoles, setAdjacentRoles] = useState([]);
  const [loadingAbilities, setLoadingAbilities] = useState(false);
  const [waitTime, setWaitTime]        = useState(0); 
  const [serverKeyAvailable, setServerKeyAvailable] = useState(false);
  const [analyzing, setAnalyzing]      = useState(false);

  const fileRef = useRef();
  
  const RATE_LIMIT_SECONDS = 60; 

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

    const savedKey = localStorage.getItem('resumeai_groq_key');
    if (savedKey) setGroqKey(savedKey);
    
    const lastAnalysisTime = localStorage.getItem('resumeai_last_analysis');
    if (lastAnalysisTime && (onlineOption === "developer")) {
      const elapsed = Math.floor((Date.now() - parseInt(lastAnalysisTime)) / 1000);
      const remaining = RATE_LIMIT_SECONDS - elapsed;
      if (remaining > 0) setWaitTime(remaining);
    }
  }, []);
  
  useEffect(() => {
    if (waitTime > 0) {
      const timer = setTimeout(() => setWaitTime(waitTime - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [waitTime]);
  
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
    if (analyzing) return;
    setAnalyzing(true);
    setError("");
    const hasInput = file || pasteText.trim().length > 50;
    if (!hasInput) { setError("Please upload a resume or paste at least 50 characters of text."); setAnalyzing(false); return; }
    if (processingMode === "offline" && !ollamaOk) { setError("Ollama is not running. Start it with: ollama serve"); setAnalyzing(false); return; }
    if (processingMode === "offline" && !model) { setError("No model selected."); setAnalyzing(false); return; }

    setPage("loading");
    setLoadPct(5);
    
    const currentKey = onlineOption === "personal" ? groqKey : null;

    if (onlineOption === "developer" && processingMode === "online") {
      localStorage.setItem('resumeai_last_analysis', Date.now().toString());
      setWaitTime(RATE_LIMIT_SECONDS);
    }

    try {
      let resumeText = pasteText.trim();
      if (file) {
        resumeText = await extractTextFromFile(file, setLoadMsg);
      }

      let finalDomain = domainMode === "custom" ? customDomain.trim() : domainMode;
      if (!finalDomain) finalDomain = "General Professional";
      
      if (domainMode === "auto") {
        setLoadMsg("Auto-detecting target role/domain...");
        // Truncate for role detection - most roles are defined early.
        const domainText = resumeText.slice(0, 2000); 
        const domainPrompt = `Primary Role Analysis. Identify the candidate's core professional title (1-2 words).

### STRICT HIERARCHY (ML/AI Priority):
- If the resume contains "AIML", "CNN", "YOLO", "OpenCV", "Deep Learning", or "Neural Networks" -> IMMEDIATELY Return "AI & ML Engineer". 
- Do NOT return specific project titles like "Computer Vision Engineer" if general AIML keywords are present.

### SECONDARY MAPPING:
- "React", "Frontend", "UI/UX" -> "Frontend Developer"
- "Node", "Backend", "API", "SQL" -> "Backend Developer"
- "Arduino", "Electronics", "Embedded" -> "Hardware Engineer"

### RULES:
- Use EXACTLY one or two words.
- DO NOT explain. 

RESUME:
${domainText}

Output Title:`;
        
        try {
          const rawDomain = processingMode === "online" 
            ? await callGroq(domainPrompt, currentKey)
            : await callOllama(model, domainPrompt);
          
          let cleaned = rawDomain.trim().split('\n')[0].replace(/^"|"$/g, '').trim();
          // Force common variations to the master title for consistency
          const lower = cleaned.toLowerCase();
          if (lower.includes("vision") || lower.includes("machine learning") || lower.includes("deep learning") || lower.includes("ml") || lower.includes("ai")) {
             cleaned = "AI & ML Engineer";
          }
          
          if (cleaned.length > 60 || cleaned.toLowerCase().includes("resume") || !cleaned) {
            finalDomain = "General Professional";
          } else {
            finalDomain = cleaned;
          }
        } catch (e) {
          console.error("Domain detection failed:", e);
          finalDomain = "General Professional";
        }
      }
      setDetectedDomain(finalDomain);

      setLoadMsg("Extracting resume sections...");
      setLoadPct(15);
      const extractPrompt = `You are a world-class resume parser. Extract sections as valid JSON. JSON ONLY.

### SCHEMA:
{
  "contact": { "name": "", "email": "", "phone": "", "location": "" },
  "links": { "github": "", "portfolio": "Assign ANY link ending in .vercel.app, .netlify.app, .lovable.dev, .github.io here", "kaggle": "", "linkedin": "", "hackerrank": "" },
  "total_experience_months": 0,
  "sections": {
    "summary": "",
    "skills": "",
    "experience": "ALL professional work history, including internships and full-time roles.",
    "education": "",
    "projects": "",
    "certificate": "",
    "extracurricular": "Look for headers like 'Extra-Curricular', 'Extra Curricular', 'Activities', 'Achievements'"
  }
}

### RULES:
- If a section is missing, use empty string.
- total_experience_months MUST be an integer.
- Return ONLY the JSON object.

### INTERNSHIP RULE:
- Treat "Internships" as professional "Experience". Categorize them in the "experience" section. Do NOT create a separate internship field.

### EXTRA CURRICULAR RULE:
- Be highly aggressive in finding "Extra-Curricular" or "Extra Curricular" activities. Even if it is a single line, extract and include it!

### LINKS & PORTFOLIO RULE:
- Look extremely closely at the contact header. Extract ALL links.
- ANY url ending in vercel.app, onrender.com, netlify.app, lovable.dev, or github.io MUST be captured under "portfolio".
- ALWAYS extract "kaggle.com" links into "kaggle". Do not miss them!
- Ensure all extracted URLs are clean strings without spaces. Add "https://" if missing.

RESUME:
${resumeText.slice(0, 4000)}

JSON:`;

      const rawExtract = processingMode === "online" 
          ? await callGroq(extractPrompt, currentKey)
          : await callOllama(model, extractPrompt);
      const parsed = safeJSON(rawExtract);
      if (!parsed) throw new Error("Failed to parse resume. Try pasting as plain text.");
      
      // Sanitize links
      let cleanLinks = parsed.links || {};
      Object.keys(cleanLinks).forEach(k => {
        let u = cleanLinks[k];
        if (u && typeof u === 'string') {
          u = u.replace(/\s+/g, '').replace(/<[^>]*>?/gm, ''); // remove spaces/html
          if (u && !u.startsWith('http') && (u.includes('.com') || u.includes('.app') || u.includes('.dev') || u.includes('.io') || u.includes('.net'))) {
            u = 'https://' + u;
          }
          cleanLinks[k] = u;
        }
      });
      
      setContact(parsed.contact || {});
      setSections(parsed.sections || {});
      setLinks(cleanLinks);
      setLoadPct(50);

      setLoadMsg("Calculating ATS scores...");
      const scorePrompt = window.ATS_Scoring.getPrompt(finalDomain, levelConfig, resumeText, parsed);
      const rawScores = processingMode === "online" 
          ? await callGroq(scorePrompt, currentKey)
          : await callOllama(model, scorePrompt);
      let parsedScores = safeJSON(rawScores);
      if (!parsedScores) throw new Error("Failed to calculate scores. Try a different model.");

      // Calculate Average of present sections
      const secScores = parsedScores.section_scores || {};
      let presentCount = 0;
      let totalSecScore = 0;
      let weakSectionsCount = 0;
      SCORING_SECTIONS.forEach(s => {
        const sc = secScores[s.id] || { score: 0 };
        if (sc.score > 0) {
          presentCount++;
          totalSecScore += sc.score;
          if (sc.score < 60) {
            weakSectionsCount++;
          }
        }
      });
      
      let avgScore = presentCount > 0 ? Math.round(totalSecScore / presentCount) : 0;
      
      // Deduct penalty if less than 5 sections present
      if (presentCount > 0 && presentCount < 5) {
        const penalty = Math.floor(Math.random() * 3) + 4; // 4 to 6
        avgScore = Math.max(0, avgScore - penalty);
      }
      
      // Level Modifications
      let leniencyFactor = 0;
      if (level === "beginner") {
        leniencyFactor = 0.15;
      }
      
      if (leniencyFactor > 0) {
        avgScore = Math.min(100, Math.round(avgScore + (100 - avgScore) * leniencyFactor));
      }
      
      // Advanced strictness check
      if (level === "advanced") {
        const skillsScore = (secScores["skills"] && secScores["skills"].score) || 0;
        const projectsScore = (secScores["projects"] && secScores["projects"].score) || 0;
        
        // If an advanced profile doesn't have very strong skills and projects, penalize
        if (skillsScore < 75 || projectsScore < 75) {
           avgScore = Math.max(0, avgScore - 10);
           if (!parsedScores.critical_issues) parsedScores.critical_issues = [];
           const issueMsg = `Advanced Level Guard: Expected highly impressive Skills and Projects to justify "Advanced" seniority (-10 ATS penalty).`;
           if (!parsedScores.critical_issues.includes(issueMsg)) {
             parsedScores.critical_issues.push(issueMsg);
           }
        }
      }
      
      // Strict Penalty for Weak Sections (< 60)
      if (weakSectionsCount > 0) {
        const weakPenalty = weakSectionsCount * 7;
        avgScore = Math.max(0, avgScore - weakPenalty);
        if (!parsedScores.critical_issues) parsedScores.critical_issues = [];
        // Prevent duplicate string entry
        const issueMsg = `Major red flag: ${weakSectionsCount} section(s) scored below 60/100 (-${weakPenalty} ATS penalty).`;
        if (!parsedScores.critical_issues.includes(issueMsg)) {
           parsedScores.critical_issues.push(issueMsg);
        }
      }
      
      parsedScores.overall_score = avgScore;
      
      setScores(parsedScores);
      setLoadPct(80);

      setLoadMsg("Generating review...");
      setReviewText("");
      setStreaming(true);
      setPage("analysis");
      setActiveTab("domain");
      const reviewPrompt = window.Domain_Review.getPrompt(finalDomain, levelConfig, parsed.sections);
      try {
        if (processingMode === "online") {
          await streamGroq(reviewPrompt, (text) => setReviewText(text), currentKey);
        } else {
          const rawReview = await callOllama(model, reviewPrompt);
          setReviewText(rawReview);
        }
      } finally {
        setStreaming(false);
      }
      
      setLoadMsg("Identifying abilities...");
      setLoadingAbilities(true);
      try {
        const adjacentPrompt = window.Abilities.getPrompt(finalDomain, parsed.sections);
        const adjacentRaw = processingMode === "online" ? await callGroq(adjacentPrompt, currentKey) : await callOllama(model, adjacentPrompt);
        let cleaned = window.Abilities.cleanResponse(adjacentRaw);
        const adjacentParsed = JSON.parse(cleaned);
        if (Array.isArray(adjacentParsed)) setAdjacentRoles(adjacentParsed.slice(0, 5));
      } catch (e) {
        setAdjacentRoles([]);
      } finally {
        setLoadingAbilities(false);
      }
      
      setLoadPct(100);
      setAnalyzing(false);

    } catch (e) {
      setError(e.message);
      setPage("home");
      setAnalyzing(false);
    }
  }

  /* ── HOME PAGE ──────────────────────────────────────────── */
  if (page === "home") {
    return (
      <div className="home-aura">
        {/* Left Panel: Brand Anchor */}
        <div className="home-left">
          <div className="aura-logo-abs" style={{color: '#fff', textShadow: '0 0 20px rgba(16,185,129,0.5)'}}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{marginRight:8}}>
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            ResumeAI
          </div>
          <img src="hero.png" alt="Workspace"/>
          <div style={{position:'absolute', bottom:'2rem', left:'3rem', color:'rgba(255,255,255,0.6)', fontSize:'12px', fontFamily:'var(--font-mono)'}}>
            VER 3.5.0 // CORE ENGINE READY
          </div>
        </div>

        {/* Right Panel: Analysis Command Center */}
        <div className="home-right">
          <div className="aura-header-area" style={{marginBottom: "3.5rem"}}>
            <h1 className="aura-title" style={{marginBottom: "0.75rem", fontSize: "42px", color: "#fff"}}>Analyze Your <br/>Professional Future.</h1>
            <p className="aura-subtitle" style={{color: "var(--aura-grey)", fontSize: "15px", maxWidth: "450px"}}>A high-precision ATS engine designed to optimize your resume for the modern engineering landscape.</p>
          </div>

          <div style={{display: 'flex', flexDirection: 'column', gap: '2.5rem'}}>
            
            {/* 1. Resume Data Source */}
            <div className="aura-section">
              <div className="aura-grid-label">Resume Data Source</div>
              <div
                className={`dropzone ${drag ? "active" : ""}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
                style={{marginBottom: '1rem', borderStyle: 'dashed', background: 'rgba(255,255,255,0.02)'}}
              >
                <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
                  onChange={e => handleFile(e.target.files[0])} style={{display:'none'}}/>
                <div className="dz-title" style={{color: '#fff', fontSize: '15px'}}>{file ? file.name : "Upload Resume File"}</div>
                <div className="dz-sub" style={{fontSize: '12px'}}>{file ? `Ready for ingestion (${(file.size/1024).toFixed(1)} KB)` : "Drag & drop PDF, Docx, or Image"}</div>
              </div>

              <textarea 
                className="aura-textarea"
                placeholder="Alternatively, paste raw resume text here for instant analysis..."
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                style={{minHeight: '120px', background: 'rgba(0,0,0,0.2)'}}
              />
            </div>

            {/* 2. Career Stage */}
            <div className="aura-section">
              <div className="aura-grid-label">Career Stage</div>
              <div className="aura-grid" style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem'}}>
                {LEVELS.map(l => (
                  <div 
                    key={l.id} 
                    className={`aura-card ${level === l.id ? 'active' : ''}`}
                    onClick={() => setLevel(l.id)}
                    style={{padding: '1.5rem 1rem'}}
                  >
                    <div className="aura-card-icon">{l.icon}</div>
                    <div className="aura-card-name" style={{margin:'4px 0'}}>{l.name}</div>
                    <div className="aura-card-desc" style={{fontSize:'10px', opacity:0.7}}>{l.years} Experience</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. AI Engine Status Dashboard */}
            <div className="aura-section">
              <div className="aura-grid-label">AI Engine Status</div>
              <div className="aura-engine-card">
                
                {/* Mode Toggles */}
                <div className="aura-toggle-group">
                  <div 
                    className={`aura-toggle-btn ${processingMode === 'online' ? 'active' : ''}`}
                    onClick={() => setProcessingMode('online')}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.5 19L22 12L17.5 5M6.5 19L2 12L6.5 5M12 2V22"/>
                    </svg>
                    Online (Free)
                  </div>
                  <div 
                    className={`aura-toggle-btn ${processingMode === 'offline' ? 'active' : ''}`}
                    onClick={() => setProcessingMode('offline')}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                    Local Engine
                  </div>
                </div>

                {/* Status Bar */}
                <div className="aura-pill-row">
                  {processingMode === 'online' ? (
                    <>
                      <div className={`aura-pill-status ${onlineOption === 'personal' && !groqKey ? 'aura-pill-status-err' : 'aura-pill-status-ok'}`}>
                        <div className={`dot ${onlineOption === 'personal' && !groqKey ? 'dot-red' : 'dot-green dot-pulse'}`}/>
                        {onlineOption === 'personal' && !groqKey ? 'Enter API Key' : 'Engine Ready'}
                      </div>
                      <div className="aura-model-badge">{GROQ_MODEL}</div>
                    </>
                  ) : (
                    <>
                      <div className={`aura-pill-status ${ollamaOk ? 'aura-pill-status-ok' : 'aura-pill-status-err'}`}>
                        <div className={`dot ${ollamaOk ? 'dot-green dot-pulse' : 'dot-red'}`}/>
                        {ollamaOk ? 'Engine Ready' : 'Ollama Offline'}
                      </div>
                      {ollamaOk && model && <div className="aura-model-badge">{model}</div>}
                    </>
                  )}
                </div>

                {/* Cloud Specific Context */}
                {processingMode === 'online' && (
                  <div style={{marginTop: '1.5rem'}}>
                    {serverKeyAvailable && (
                      <div style={{display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '1.25rem'}}>
                        <div className="aura-info-dotted" style={{marginBottom: 0}}>
                          <span>🚀</span>
                          <span>Using developer's shared Groq API key hosted on Vercel.</span>
                        </div>
                        <div className="aura-status-pill" style={{fontSize: '10px', color: 'var(--primary)', border: '1px solid var(--primary-dim)', width: 'fit-content', background: 'rgba(16, 185, 129, 0.05)', letterSpacing: '0.1em', fontWeight: '700'}}>
                           SYSTEM_KEY // AUTHORIZED (VERCEL ENV)
                        </div>
                      </div>
                    )}

                    <div style={{display: 'flex', gap: '8px', marginBottom: '1.25rem'}}>
                      <div 
                        className={`aura-status-pill ${onlineOption === 'developer' ? 'tag-green' : ''}`} 
                        style={{cursor: 'pointer', flex: 1, justifyContent: 'center'}}
                        onClick={() => setOnlineOption('developer')}
                      >
                        Cloud Shared
                      </div>
                      <div 
                        className={`aura-status-pill ${onlineOption === 'personal' ? 'tag-green' : ''}`} 
                        style={{cursor: 'pointer', flex: 1, justifyContent: 'center'}}
                        onClick={() => setOnlineOption('personal')}
                      >
                        Personal Key
                      </div>
                    </div>

                    {onlineOption === 'personal' ? (
                      <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                        <input 
                          type="password" placeholder="Paste your Groq API key (gsk_...)" 
                          value={groqKey} onChange={e => updateGroqKey(e.target.value.trim())}
                          className="aura-textarea" style={{height: '52px', padding: '0 20px', background: 'rgba(0,0,0,0.2)'}}
                        />
                        <div style={{fontSize: '11px', color: 'var(--aura-grey)', paddingLeft: '4px'}}>
                          Get a free key at <a href="https://console.groq.com/keys" target="_blank" style={{color: 'var(--primary)'}}>console.groq.com/keys</a> • Stored locally
                        </div>
                      </div>
                    ) : (
                      <div className="aura-notice-box aura-notice-warning">
                        <div className="aura-notice-title">
                          <span>⚠️</span> Using Online Engine (Developer Key)
                        </div>
                        <div className="aura-notice-body">
                          You're using the developer's shared API key. To avoid rate limits, you must wait <strong>{RATE_LIMIT_SECONDS} seconds</strong> between analyses.
                          <div style={{marginTop: '8px', fontWeight: '600', color: '#fff'}}>
                            {waitTime > 0 ? `Please wait ${waitTime}s...` : 'Ready for next analysis!'}
                          </div>
                          <div style={{marginTop: '10px', fontSize: '12px', color: 'var(--danger)', background: 'rgba(239, 68, 68, 0.1)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.2)'}}>
                            <strong>Note:</strong> If you receive a <code>429 (Too Many Requests)</code> error while trying to analyze, today's limit is over.
                          </div>
                        </div>
                        <div style={{marginTop: '10px', fontSize: '12px', opacity: 0.8, fontStyle: 'italic'}}>
                          💡 Use your own key to analyze without waiting! Switch to "Personal API Key" above.
                        </div>
                      </div>
                    )}

                    {onlineOption === 'personal' && groqKey && (
                      <div className="aura-notice-box aura-notice-success">
                        <div className="aura-notice-title">
                          <span>✅</span> Using Your Personal API Key
                        </div>
                        <div className="aura-notice-body">
                          You are using your own API key. No wait time between analyses. Enjoy!
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Local Specific Context */}
                {processingMode === 'offline' && ollamaOk && (
                  <div style={{marginTop: '1.5rem'}}>
                    <div className="aura-grid-label" style={{fontSize: '11px', marginBottom: '10px'}}>Select Local Model</div>
                    <div style={{display:'flex', flexWrap:'wrap', gap:'8px'}}>
                      {models.slice(0, 8).map(m => (
                        <div 
                          key={m} 
                          className={`tag ${model === m ? "tag-green" : ""}`}
                          onClick={() => setModel(m)}
                          style={{cursor:'pointer', fontSize:'11px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--aura-border)'}}
                        >
                          {m}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 4. Target Specialization */}
            <div className="aura-section" style={{paddingBottom: '6rem'}}>
              <div className="aura-grid-label">Target Specialization</div>
              <div className="tags-row" style={{marginBottom: '16px'}}>
                {["auto", "AI & ML Engineer", "Software Engineer", "Backend Dev", "custom"].map(d => (
                  <div 
                    key={d} 
                    className={`tag ${domainMode === d ? "tag-green" : ""}`}
                    onClick={() => setDomainMode(d)}
                    style={{cursor: 'pointer', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--aura-border)', padding: '8px 16px'}}
                  >
                    {d === 'auto' ? '⚡ Auto-Detect' : (d === 'custom' ? 'Custom Input' : d)}
                  </div>
                ))}
              </div>
              {domainMode === 'custom' && (
                <input 
                  type="text" placeholder="e.g. Senior Embedded System Developer" 
                  value={customDomain} onChange={e => setCustomDomain(e.target.value)}
                  className="aura-textarea" style={{height: '46px', padding: '0 18px'}}
                />
              )}

              {error && <div className="err" style={{marginTop:"1.5rem", borderRadius: '8px'}}>{error}</div>}

              <button 
                className="btn-aura btn-aura-primary" 
                style={{marginTop: "2.5rem", width: '100%', height: '60px', fontSize: '15px', textTransform: 'uppercase', letterSpacing: '2px'}}
                onClick={analyze}
                disabled={analyzing}
              >
                {analyzing ? "Initializing Analysis..." : (waitTime > 0 ? `Rate Limit: Wait ${waitTime}s` : "Execute Full Analysis")}
              </button>
            </div>

            {/* Landing Page Footer */}
            <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0 0 0', marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-muted)', fontSize: '13px' }}>
              <div style={{ letterSpacing: '0.02em' }}>Made by <strong style={{color: '#fff', fontWeight: '600'}}>Rudra Gupta</strong></div>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                <a href="https://www.linkedin.com/in/rudra-kumar-gupta/" target="_blank" rel="noopener noreferrer" style={{color: 'var(--text-muted)', transition: 'color 0.2s', display: 'flex', alignItems: 'center'}} onMouseOver={e=>e.currentTarget.style.color='var(--primary)'} onMouseOut={e=>e.currentTarget.style.color='var(--text-muted)'} aria-label="LinkedIn">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>
                </a>
                <a href="https://github.com/Rudra-Gupta15" target="_blank" rel="noopener noreferrer" style={{color: 'var(--text-muted)', transition: 'color 0.2s', display: 'flex', alignItems: 'center'}} onMouseOver={e=>e.currentTarget.style.color='var(--primary)'} onMouseOut={e=>e.currentTarget.style.color='var(--text-muted)'} aria-label="GitHub">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                </a>
                <a href="https://www.kaggle.com/rudrakumargupta" target="_blank" rel="noopener noreferrer" style={{color: 'var(--text-muted)', transition: 'color 0.2s', display: 'flex', alignItems: 'center', fontSize: '18px', fontWeight: '800', lineHeight:'1', textDecoration: 'none', fontFamily: 'sans-serif'}} onMouseOver={e=>e.currentTarget.style.color='var(--primary)'} onMouseOut={e=>e.currentTarget.style.color='var(--text-muted)'} aria-label="Kaggle">
                  k
                </a>
              </div>
            </footer>
          </div>
        </div>
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
      </div>
    );
  }

  /* ── ANALYSIS PAGE ──────────────────────────────────────── */

  return (
    <div className="analysis-page">

      {/* Top bar */}
      <div className="topbar">
        <div className="topbar-logo">ResumeAI</div>
        <div className="topbar-sep"/>
        
        <div className="topbar-profile">
          <img src="avatar_placeholder.png" alt="Avatar" className="topbar-avatar"/>
          <div className="topbar-user-info">
            <div className="topbar-user-name">{contact?.name || "Rudra Gupta"}</div>
            <div className="topbar-user-email">{contact?.email || "kumargutarudra15@gmail.com"}</div>
          </div>
        </div>

        <div className="topbar-sep"/>

        <div className={`topbar-level ${level}`}>
          {level === 'beginner' ? '🌳' : (level === 'intermediate' ? '🚀' : '🔥')} {levelConfig?.name} · {levelConfig?.years}
        </div>
        
        {detectedDomain && (
          <div className="topbar-level" style={{background: "rgba(245, 158, 11, 0.08)", color: "#f59e0b", border: "1px solid rgba(245, 158, 11, 0.15)"}}>
            🧠 {detectedDomain}
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
          
          {/* Profile Scores */}
          {scores && scores.profile_scores && (
            <div style={{ padding: '0.75rem 1.5rem', display: 'flex', gap: '8px', flexWrap: 'wrap', borderBottom: '1px solid var(--border-light)', background: 'rgba(0,0,0,0.1)' }}>
              {Object.entries(scores.profile_scores).map(([key, val]) => {
                let url = links?.[key];
                if (val.present && !url && key !== 'email') {
                  const platformDefaults = {
                    'github': 'https://github.com/',
                    'linkedin': 'https://linkedin.com/in/',
                    'portfolio': null,
                    'kaggle': 'https://kaggle.com/',
                    'hackerrank': 'https://hackerrank.com/'
                  };
                  url = platformDefaults[key];
                }
                const isClickable = val.present && url && key !== 'email';
                const chipContainerStyle = { 
                  display: 'flex', alignItems: 'center', gap: '8px', 
                  padding: '6px 14px', borderRadius: '100px', 
                  fontSize: '11.5px', fontFamily: 'var(--font-mono)', fontWeight: '700',
                  background: val.present || val.score >= 50 ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                  color: val.present || val.score >= 50 ? 'var(--aura-forest)' : 'var(--danger)',
                  border: `1px solid ${val.present || val.score >= 50 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}`,
                  cursor: isClickable ? 'pointer' : 'default',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  userSelect: 'none',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  backdropFilter: 'blur(8px)',
                  opacity: (val.present && !url && key !== 'email') ? 0.6 : 1
                };
                const chip = (
                  <div key={key} style={chipContainerStyle} className={isClickable ? 'aura-chip-clickable' : ''}>
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

            {scores && (
              <div className="inner-card section-scores-card">
                <div className="section-title-row">
                  <div className="section-title">Section Evaluation</div>
                  <div className="section-count">7 mandatory areas</div>
                </div>
                {SCORING_SECTIONS.map((s) => {
                  const val = scores.section_scores?.[s.id] || { score: 0, feedback: "Not present" };
                  const isMissing = val.score === 0 || val.feedback?.toLowerCase().includes("not present");
                  
                  return (
                    <div key={s.id} className={`sec-row ${isMissing ? 'sec-row-missing' : ''}`} style={{ opacity: isMissing ? 0.6 : 1 }}>
                      <div className="sec-top">
                        <div className="sec-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {s.name}
                          {isMissing && <span style={{ fontSize: '10px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>Not Present</span>}
                        </div>
                        <div className={`sec-score-badge ${scoreBadge(val.score)}`}>{val.score}/100</div>
                      </div>
                      <div className="sec-bar-track">
                        <div className="sec-bar-fill"
                          style={{ width:`${val.score}%`, background: isMissing ? 'var(--danger)' : scoreColor(val.score) }}/>
                      </div>
                      <div className="sec-feedback" style={{ fontStyle: isMissing ? 'italic' : 'normal' }}>
                        {val.feedback || (isMissing ? "Not found in resume." : "")}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {scores && (
              <div className="tags-grid">
                <div className="inner-card tags-card">
                  <div className="section-title" style={{marginBottom:0}}>Strengths</div>
                  <div className="tags-row">
                    {(scores.strengths||[]).map((s,i) => {
                      const isSystem = s.toLowerCase().includes("experience bonus");
                      return (
                        <div key={i} className={`tag ${isSystem ? 'tag-system' : 'tag-green'}`}>
                          <span>{isSystem ? '🧠' : '✨'}</span> {s}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="inner-card tags-card">
                  <div className="section-title" style={{marginBottom:0}}>Issues</div>
                  <div className="tags-row">
                    {(scores.critical_issues||[]).map((s,i) => (
                      <div key={i} className="tag tag-red">
                        <span>⚠️</span> {s}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            </div>

            {(() => {
               const projectRegex = /##\s*PROJECTS?/i;
               const strengthsRegex = /##\s*INTERVIEW[_\s]*STRENGTHS?/i;
               const improvementsRegex = /##\s*IMPROVEMENTS?/i;
               const pMatch = reviewText.match(projectRegex);
               const pIndex = pMatch ? pMatch.index : -1;
               let domainText = reviewText, pText = "";
               if (pIndex !== -1) { domainText = reviewText.substring(0, pIndex); pText = reviewText.substring(pIndex).replace(projectRegex, "").trim(); }
               const sMatch = domainText.match(strengthsRegex), iMatch = domainText.match(improvementsRegex);
               const strengthsIndex = sMatch ? sMatch.index : -1, improvementsIndex = iMatch ? iMatch.index : -1;
               let strengthsText = "", improvementsText = "";
               if (strengthsIndex !== -1 && improvementsIndex !== -1) { strengthsText = domainText.substring(strengthsIndex, improvementsIndex).replace(strengthsRegex, "").trim(); improvementsText = domainText.substring(improvementsIndex).replace(improvementsRegex, "").trim(); }
               else if (strengthsIndex !== -1) strengthsText = domainText.substring(strengthsIndex).replace(strengthsRegex, "").trim();
               else if (improvementsIndex !== -1) improvementsText = domainText.substring(improvementsIndex).replace(improvementsRegex, "").trim();
               else strengthsText = domainText.trim();

               return (
                 <>
                   <div style={{ display: activeTab === 'domain' ? 'block' : 'none' }}>
                     <div className="inner-card review-card">
                       <div className="divider-label" style={{marginBottom:"1rem"}}>🎯 Candidate Strengths</div>
                       <MarkdownText text={strengthsText} streaming={streaming} loading={streaming && !strengthsText} active={activeTab === 'domain'} type="strengths" />
                     </div>
                   </div>
                   <div style={{ display: activeTab === 'improvements' ? 'block' : 'none' }}>
                     <div className="inner-card review-card">
                       <div className="divider-label" style={{marginBottom:"1rem"}}>📈 Improvements</div>
                       {improvementsText ? <MarkdownText text={improvementsText} streaming={false} active={activeTab === 'improvements'} /> : <div className="stream-loading">{streaming ? <><div className="spin-sm"/> Generating improvements...</> : "No improvements."}</div>}
                     </div>
                   </div>
                   <div style={{ display: activeTab === 'projects' ? 'block' : 'none' }}>
                     <div className="inner-card review-card">
                       <div className="divider-label" style={{marginBottom:"1rem"}}>💡 Tailored Project Suggestions</div>
                       {pText || (streaming && reviewText.length > 50) ? <MarkdownText text={pText} streaming={streaming} active={activeTab === 'projects'} /> : <div className="stream-loading">{streaming ? <><div className="spin-sm"/> Generating projects...</> : "No projects."}</div>}
                     </div>
                   </div>
                    <div style={{ display: activeTab === 'abilities' ? 'block' : 'none' }}>
                      <div className="inner-card aura-abilities-card">
                        <div className="divider-label" style={{marginBottom:"1.5rem"}}>🎯 Cross-Functional Abilities</div>
                        {adjacentRoles.length > 0 ? (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
                            {adjacentRoles.map((role, idx) => (
                              <div key={idx} style={{ background: 'linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)', borderRadius: '12px', padding: '18px 20px', border: '1px solid rgba(255,255,255,0.05)', position: 'relative', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
                                <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: role.fit_score >= 80 ? 'var(--primary)' : 'var(--info)' }} />
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', paddingLeft: '8px' }}>
                                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#fff', letterSpacing: '0.02em' }}>{role.role}</div>
                                  <div style={{ fontSize: '12px', fontWeight: '700', padding: '4px 10px', borderRadius: '100px', background: role.fit_score >= 80 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(56, 189, 248, 0.15)', color: role.fit_score >= 80 ? 'var(--aura-forest)' : 'var(--info)', border: `1px solid ${role.fit_score >= 80 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)'}` }}>
                                    {role.fit_score}% FIT
                                  </div>
                                </div>
                                <div style={{ fontSize: '13.5px', color: 'var(--aura-grey)', lineHeight: '1.6', paddingLeft: '8px' }}>{role.reason}</div>
                              </div>
                            ))}
                          </div>
                        ) : <div className="stream-loading">{loadingAbilities ? "Analyzing abilities..." : "No roles found."}</div>}
                      </div>
                    </div>
                 </>
               )
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
