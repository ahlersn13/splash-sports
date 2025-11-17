const fs = require("fs");
const stringSimilarity = require("string-similarity");

// Load the masterTeamMap.json
const masterMap = JSON.parse(fs.readFileSync("./masterTeamMap.json", "utf8"));

function normalize(name) {
  return name.toUpperCase()
             .replace(/[^A-Z]/g, "") // remove non-letter chars
             .replace(/ST$/, "STATE") // standardize abbreviations
             .trim();
}

const ofp = masterMap.ofp;
const api = masterMap.api;

const finalMap = {};

ofp.forEach(ofpTeam => {
  const normOFP = normalize(ofpTeam);

  // Try exact match first
  let match = api.find(a => normalize(a).includes(normOFP) || normOFP.includes(normalize(a)));

  // Fuzzy fallback
  if (!match) {
    const bestMatch = stringSimilarity.findBestMatch(normOFP, api.map(normalize));
    if (bestMatch.bestMatch.rating > 0.7) {
      match = api[bestMatch.bestMatchIndex];
    }
  }

  finalMap[ofpTeam] = match || null;
});

fs.writeFileSync("./masterTeamMapWithIDs.json", JSON.stringify(finalMap, null, 2));
console.log("Master map with API matches saved to masterTeamMapWithIDs.json");