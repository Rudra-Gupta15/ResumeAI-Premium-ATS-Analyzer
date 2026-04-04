/**
 * Improvements.js
 * Logic for extracting resume improvement suggestions.
 */

window.Improvements = {
  extractImprovements: (reviewText) => {
    const improvementsRegex = /##\s*IMPROVEMENTS?/i;
    const projectRegex = /##\s*PROJECTS?/i;

    const pMatch = reviewText.match(projectRegex);
    const pIndex = pMatch ? pMatch.index : -1;

    let domainText = reviewText;
    if (pIndex !== -1) {
      domainText = reviewText.substring(0, pIndex);
    }
    
    const iMatch = domainText.match(improvementsRegex);
    const improvementsIndex = iMatch ? iMatch.index : -1;
    
    let improvementsText = "";
    
    if (improvementsIndex !== -1) {
      improvementsText = domainText.substring(improvementsIndex).replace(improvementsRegex, "").trim();
    }
    
    return improvementsText;
  }
};
