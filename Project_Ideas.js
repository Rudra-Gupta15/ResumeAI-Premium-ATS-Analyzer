/**
 * Project_Ideas.js
 * Logic for generating and extracting project suggestions.
 */

window.Project_Ideas = {
  extractProjects: (reviewText) => {
    const projectRegex = /##\s*PROJECTS?/i;
    const pMatch = reviewText.match(projectRegex);
    const pIndex = pMatch ? pMatch.index : -1;

    let pText = "";
    if (pIndex !== -1) {
      pText = reviewText.substring(pIndex).replace(projectRegex, "").trim();
    }
    return pText;
  }
};
