/**
 * Abilities.js
 * Logic for identifying cross-functional abilities and alternative career roles.
 */

window.Abilities = {
  getPrompt: (finalDomain, parsedSections) => {
    return `Analyze this resume and identify 3-5 alternative roles this person could work in (beyond their primary target of "${finalDomain}").

For each role, provide:
- The role name
- A fit score (0-100)
- A brief reason why they're qualified

IMPORTANT: Return ONLY a valid JSON array. No markdown, no backticks, no explanation. Just the raw JSON array.

Example format:
[{"role":"Data Scientist","fit_score":85,"reason":"Has Python, ML models, and data analysis skills"},{"role":"Frontend Developer","fit_score":70,"reason":"Built React UIs in 2 projects"}]

Resume data:
${JSON.stringify(parsedSections, null, 2).slice(0, 2500)}

JSON array only:`;
  },

  cleanResponse: (rawResponse) => {
    // Clean the response - remove markdown code blocks if present
    let cleaned = rawResponse.trim();
    cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    cleaned = cleaned.trim();
    return cleaned;
  }
};
