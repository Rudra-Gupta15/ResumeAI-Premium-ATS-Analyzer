/**
 * Domain_Review.js
 * Logic for generating domain-specific interview strengths and insights.
 */

window.Domain_Review = {
  getPrompt: (finalDomain, levelConfig, parsedSections) => {
    return `You are a professional resume coach specialized in "${finalDomain}". The candidate is targeting "${finalDomain}" and their experience level is ${levelConfig.criteria}.

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
${JSON.stringify(parsedSections, null, 2).slice(0, 3000)}`;
  },

  extractStrengths: (reviewText, activeTab, streaming) => {
    const strengthsRegex = /##\s*INTERVIEW[_\s]*STRENGTHS?/i;
    const improvementsRegex = /##\s*IMPROVEMENTS?/i;
    const projectRegex = /##\s*PROJECTS?/i;

    const pMatch = reviewText.match(projectRegex);
    const pIndex = pMatch ? pMatch.index : -1;

    let domainText = reviewText;
    if (pIndex !== -1) {
      domainText = reviewText.substring(0, pIndex);
    }
    
    const sMatch = domainText.match(strengthsRegex);
    const iMatch = domainText.match(improvementsRegex);

    const strengthsIndex = sMatch ? sMatch.index : -1;
    const improvementsIndex = iMatch ? iMatch.index : -1;
    
    let strengthsText = "";
    
    if (strengthsIndex !== -1 && improvementsIndex !== -1) {
      strengthsText = domainText.substring(strengthsIndex, improvementsIndex).replace(strengthsRegex, "").trim();
    } else if (strengthsIndex !== -1) {
      strengthsText = domainText.substring(strengthsIndex).replace(strengthsRegex, "").trim();
    } else {
      strengthsText = domainText.trim();
    }
    return strengthsText;
  }
};
