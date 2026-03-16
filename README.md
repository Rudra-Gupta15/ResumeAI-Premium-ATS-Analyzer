# ResumeAI — Premium ATS Analyzer 🚀

An AI-powered ATS (Applicant Tracking System) resume analyzer that provides instant scoring, domain-specific feedback, cross-functional career insights, and actionable project suggestions using LLMs.

## ✨ Features

### Core Analysis
- **5-Tab Split-Screen Analysis** — Comprehensive resume evaluation across multiple dimensions
  - 📊 **ATS Scoring** — Overall compatibility, section-by-section breakdown, strengths & critical issues
  - 🎯 **Domain Review** — Interview strengths based on your actual resume content
  - 📈 **Improvements** — Missing skills, what to remove, how to strengthen, next steps
  - 💡 **Project Ideas** — Tailored buildable project suggestions for your target role
  - 🎯 **Abilities** — Cross-functional roles you could pursue with your current skillset

### Dual Processing Engine
- ☁️ **Online Mode**: Powered by [Groq](https://groq.com) (Llama 3.3 70B) — fast, free cloud AI
  - Built-in rate limit timer (60s between analyses with shared demo key)
  - Instant analysis with your own free API key
- 🖥️ **Offline Mode**: Powered by [Ollama](https://ollama.com) — 100% private, local processing
  - No rate limits, unlimited analyses
  - Complete privacy — data never leaves your machine

### Intelligent Features
- **Smart Domain Detection** — Auto-detects specific roles (e.g., "AIML Engineer", "Full Stack Developer") instead of generic titles
- **Realistic Scoring** — Honest, unbiased section scores (40-60 is normal for early-career; only genuinely impressive content gets 80+)
- **Cross-Functional Abilities** — AI identifies 3-5 alternative roles you're qualified for based on transferable skills
- **Clickable Profile Badges** — GitHub, LinkedIn, Portfolio, Kaggle, Hackerrank links with visual indicators
- **Multi-Format Support** — PDF, DOCX, TXT, MD, and images (JPG, PNG, WebP via OCR)

### Premium UI
- **Dark-mode glassmorphism** with iPad-style dashboard layout
- **Responsive design** — Works on desktop, tablet, and mobile
- **Real-time streaming** — Watch feedback generate live
- **Smart timer system** — Visual countdown for rate-limited analyses

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 (via Babel standalone), Vanilla CSS |
| AI (Cloud) | [Groq Cloud API](https://console.groq.com) — Llama 3.3 70B |
| AI (Local) | [Ollama](https://ollama.com) — Llama 3.1, Qwen3, Mistral, etc. |
| PDF Parsing | [pdf.js](https://github.com/mozilla/pdf.js) |
| OCR | [Tesseract.js](https://tesseract.projectnaptha.com/) |
| DOCX Parsing | [Mammoth.js](https://github.com/mwilliamson/mammoth.js) |

> **No build step required** — pure static HTML/CSS/JS with CDN dependencies.

## 🚀 Getting Started

### Quick Start (Browser)

1. **Download** the latest release or clone this repo
2. **Open** `index.html` directly in your browser (double-click)
3. **Choose your mode**:
   - **Online (Groq)**: Get a free API key at [console.groq.com/keys](https://console.groq.com/keys)
   - **Offline (Ollama)**: Install Ollama and run `ollama serve` + `ollama pull llama3.1`
4. **Upload** a resume and click **Analyze Resume**

### Local Development Server
```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/Resume-AI-analyzer.git
cd Resume-AI-analyzer

# Start a local server
python -m http.server 8000
# Or use VS Code "Live Server" extension

# Open http://localhost:8000 in your browser
```

### Using Your Own API Key (Recommended)

**Why?** The demo key has a 60-second rate limit. Your own free key = instant unlimited analyses!

1. Visit [console.groq.com/keys](https://console.groq.com/keys)
2. Sign up (free)
3. Create a new API key
4. In the app, click **"Change"** and paste your key
5. ✅ Enjoy unlimited instant analyses!

> Your API key is stored only in your browser's `localStorage` — it never leaves your machine or gets sent to any server other than Groq.

### Offline Mode with Ollama

For 100% private, offline analysis:
```bash
# Install Ollama from https://ollama.com/download
ollama serve

# Pull a recommended model
ollama pull llama3.1
# OR: ollama pull qwen3
# OR: ollama pull mistral
```

Then in the app:
1. Select **Offline Engine (Ollama)**
2. Choose your model from the dropdown
3. Analyze without any internet connection!

## ☁️ Deploy to Vercel

This project is Vercel-ready as a static site:

1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your repository
4. Click **Deploy** — no build settings needed

> **Note**: On the deployed site, each user enters their own Groq API key. No server-side secrets are needed.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/Resume-AI-analyzer)

## 🎯 How It Works

### 1. Upload & Domain Detection
- Upload your resume (PDF, DOCX, image, or paste text)
- AI auto-detects your target role (e.g., "AI & ML Engineer", "Full Stack Developer")
- Or manually select your role for precision

### 2. Multi-Step AI Analysis
The analyzer runs 4 AI calls in sequence:

1. **Extract Resume Sections** — Parses contact info, skills, experience, projects, etc.
2. **Calculate ATS Scores** — Realistic scoring across 7 sections plus overall compatibility
3. **Generate Review** — Domain-specific interview strengths and improvement suggestions
4. **Identify Adjacent Roles** — Cross-functional career paths based on transferable skills

### 3. Interactive Dashboard
Explore your results across 5 tabs:
- **ATS Scoring**: Overall score, section breakdowns, strengths/issues
- **Domain Review**: What you have that helps in interviews
- **Improvements**: What to add, remove, strengthen, and learn next
- **Project Ideas**: Tailored buildable projects for your target role
- **Abilities**: Alternative roles you're qualified for (with fit scores)

## 🛡️ Privacy & Security

- **Offline Mode (Ollama)**: All processing stays on your machine — zero data sent anywhere
- **Online Mode (Groq)**: Resume text is sent to Groq's API for analysis
  - Your API key is stored only in browser `localStorage`
  - Groq processes your data but doesn't store it permanently
  - See [Groq's privacy policy](https://groq.com/privacy-policy/)
- **No Analytics**: This app has no tracking, no analytics, no data collection
- **Open Source**: All code is visible — audit it yourself!

## 📁 Project Structure
```
Resume-AI-analyzer/
├── index.html        # Entry point (static HTML)
├── app.js            # React app (1400+ lines, Babel JSX)
├── style.css         # All styles (glassmorphism, dark theme)
├── hero.png          # Hero image
├── vercel.json       # Vercel deployment config
├── package.json      # Project metadata
├── env.txt           # Example API key (for reference only)
├── LICENSE           # MIT License
├── README.md         # This file
└── .gitignore        # Git ignore rules
```

## 🆕 What's New

### v2.0 (Latest)
- ✨ **5 separate tabs** instead of nested layouts
- 🎯 **Cross-Functional Abilities** — See alternative career paths
- 📊 **Realistic scoring** — Honest, unbiased section scores
- 🎯 **Split Domain Review** — Interview Strengths + Improvements
- ⏱️ **Rate limit timer** — Visual countdown for shared API key
- 🔗 **Clickable link badges** — GitHub, LinkedIn, etc. with fallback URLs
- 🎨 **Better role detection** — "AIML Engineer" instead of "Machine Learning Engineer"
- 🐛 **Improved error handling** — Console logging for debugging

## 🤝 Contributing

Contributions are welcome! Here's how:

1. Fork this repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Ideas for Contributions
- [ ] Support for more LLM providers (OpenAI, Anthropic, Cohere)
- [ ] Export analysis as PDF report
- [ ] Resume template generator
- [ ] Multi-language support
- [ ] Browser extension version
- [ ] Mobile app (React Native)

## 📝 License

MIT License — see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- [Groq](https://groq.com) for blazing-fast LLM inference
- [Ollama](https://ollama.com) for local LLM deployment
- [pdf.js](https://github.com/mozilla/pdf.js) for PDF parsing
- [Tesseract.js](https://tesseract.projectnaptha.com/) for OCR
- [Mammoth.js](https://github.com/mwilliamson/mammoth.js) for DOCX parsing

## 📧 Contact & Support

- **Creator**: [Rudra Gupta](https://rudra-gupta.vercel.app/)
- **Issues**: [GitHub Issues](https://github.com/YOUR_USERNAME/Resume-AI-analyzer/issues)
- **Discussions**: [GitHub Discussions](https://github.com/YOUR_USERNAME/Resume-AI-analyzer/discussions)

---

**⭐ Star this repo if you found it helpful!**

Made with ❤️ by [Rudra Gupta](https://rudra-gupta.vercel.app/) | [Portfolio](https://rudra-gupta.vercel.app/)
