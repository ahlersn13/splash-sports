const fs = require("fs");
const path = require("path");
const { getOFPBaseLines } = require("./server"); // Puppeteer scraper
const { fetchNCAAFLines } = require("./api/fetchOdds");

// Helper to clean team names (remove rankings, win-loss, punctuation, extra spaces)
function cleanTeamName(name) {
  return name
    .toUpperCase()
    .replace(/#[0-9]+/g, "")          // remove rankings
    .replace(/\([0-9\-]+\)/g, "")     // remove win-loss
    .replace(/[^A-Z\s]/g, "")         // remove non-letter characters
    .replace(/\s+/g, " ")             // collapse multiple spaces
    .trim();
}

async function exportTeamNames() {
  const ofpLines = await getOFPBaseLines();
  const apiLines = await fetchNCAAFLines();

  // Extract OFP teams
  const ofpTeams = new Set();
  ofpLines.forEach(game => {
    ofpTeams.add(cleanTeamName(game.team1));
    ofpTeams.add(cleanTeamName(game.team2));
  });

  // Extract API teams
  const apiTeams = new Set();
  apiLines.forEach(game => {
    apiTeams.add(cleanTeamName(game.home_team));
    apiTeams.add(cleanTeamName(game.away_team));
  });

  const masterTeamMap = {
    ofp: Array.from(ofpTeams).sort(),
    api: Array.from(apiTeams).sort()
  };

  fs.writeFileSync(
    path.join(__dirname, "masterTeamMap.json"),
    JSON.stringify(masterTeamMap, null, 2)
  );

  console.log("Cleaned OFP Teams:", masterTeamMap.ofp);
  console.log("Cleaned API Teams:", masterTeamMap.api);
  console.log("Master team map saved to masterTeamMap.json");
}

exportTeamNames();