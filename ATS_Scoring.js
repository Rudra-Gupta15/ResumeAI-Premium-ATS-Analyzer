/**
 * ATS_Scoring.js
 * Logic for calculating ATS scores and generating section-specific feedback.
 * Optimized for better accuracy in both Online and Offline (Ollama) mode.
 */

window.ATS_Scoring = {
  getPrompt: (finalDomain, levelConf, resumeText, parsedSections) => {
    return `You are an elite ATS (Applicant Tracking System) algorithm and Senior Recruiter. 
Analyze the resume for the specific role: "${finalDomain}" (Experience Level: ${levelConf.name}).

### MANDATORY EVALUATION SECTIONS:
You MUST provide a score (0-100) and feedback for EXACTLY these 7 sections:
1. "education"
2. "skills"
3. "projects"
4. "experience" (Evaluation of all Internship and Work experience)
5. "certificate" (Professional Certifications)
6. "extracurricular" (Extra Curricular activities)
7. "layout" (Evaluation of Resume Structure, Formatting, and Readability)

### SCORING RUBRIC (0-100):
- **90-100 (Exceptional)**: Perfect alignment. Industry-leading skills and massive quantified impact ($/ % / #).
- **70-89 (Strong)**: Clear evidence of domain expertise and relevant achievements.
- **50-69 (Average)**: Decent effort but missing key specialized tools or lacks measurable results.
- **0-49 (Weak)**: Missing core domain-specific requirements for ${finalDomain}.
- **IF SECTION IS MISSING**: Set score to 0 and feedback to "Not present in resume".

### CRITICAL SCORING LOGIC:
1. **Tool Match**: Look deeply for tools/frameworks relevant to ${finalDomain}. Do not ignore synonyms.
2. **Balanced Penalty**: If core tools are missing, apply a severe penalty, but still grant points for general professional quality and education.
3. **Quantified Impact**: For ${levelConf.name} level, check for "Numbers/Data". If achievements are vague, the Overall Score should not exceed 65.
4. **Scoring Ethos**: ${levelConf.scoringRules}
5. **HALLUCINATION GUARD**: Do NOT invent missing sections if they are present in the PARSED SECTIONS. If a section exists and has content (not an empty string), the MINIMUM score you should give is 40. Never score below 40 for an existing, populated section.
6. **QUANTITY SCORING GUARD**: For the 'certificate' and 'extracurricular' sections ONLY, you MUST use this exact quantity-based scoring rubric:
   - If exactly 1 item/entry is present: score = 50.
   - If exactly 2 items/entries are present: score = 65.
   - If 3 or more items/entries are present: score between 75 and 85 depending on quality.

### OUTPUT SCHEMA (JSON ONLY):
Return as valid JSON.

{
  "key_findings": "Briefly list the 3 most important keywords or results you found.",
  "overall_score": 0,
  "ats_compatibility": 0,
  "profile_scores": {
    "email": { "present": true, "score": 90, "feedback": "Professional format" },
    "github": { "present": true, "score": 100, "feedback": "Included" },
    "linkedin": { "present": true, "score": 100, "feedback": "Included" },
    "portfolio": { "present": false, "score": 0, "feedback": "Missing" },
    "kaggle": { "present": false, "score": 0, "feedback": "Missing" },
    "hackerrank": { "present": false, "score": 0, "feedback": "Missing" }
  },
  "section_scores": {
    "education": { "score": 0, "feedback": "" },
    "skills": { "score": 0, "feedback": "" },
    "projects": { "score": 0, "feedback": "" },
    "experience": { "score": 0, "feedback": "" },
    "certificate": { "score": 0, "feedback": "" },
    "extracurricular": { "score": 0, "feedback": "" },
    "layout": { "score": 0, "feedback": "" }
  },
  "strengths": ["string"],
  "critical_issues": ["string"],
  "verdict": "A blunt, professional assessment of the candidate's fit for ${finalDomain}."
}

RESUME TEXT:
${resumeText.slice(0, 2000)}

PARSED SECTIONS:
${JSON.stringify(parsedSections, null, 2).slice(0, 4000)}

JSON only:`;
  }
};
