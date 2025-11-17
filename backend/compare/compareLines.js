const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const stringSimilarity = require("string-similarity");
const { fetchNCAAFLines, fetchNFLLines } = require("../api/fetchOdds");

// ----------------------
// Load Master Team Map
// ----------------------
const masterMapPath = path.join(__dirname, "masterTeamMapWithIDs.json");
if (!fs.existsSync(masterMapPath)) {
  console.error("❌ Master map JSON not found at", masterMapPath);
  process.exit(1);
}

const masterMap = JSON.parse(fs.readFileSync(masterMapPath, "utf-8"));

console.log("Master map keys:", Object.keys(masterMap));

// ----------------------
// Normalization & Indices
// ----------------------
function normalizeTeamName(name) {
  if (!name) return "";
  return name
    .replace(/#\d+\s*/g, "")            // remove rankings (#9)
    .replace(/\(\d+-\d+\)/g, "")        // remove records (7-2)
    .replace(/[+–-]\d+(\.\d+)?/g, "")   // remove spreads like +7.5 or -3
    .replace(/\./g, "")                 // remove dots
    .replace(/\s+/g, " ")               // normalize spaces
    .trim()
    .toLowerCase();
}

const ofpIndex = {};   // normalized name -> teamId
const oddsIndex = {};  // normalized name -> teamId
const teamsById = {};  // teamId -> full team object

for (const id in masterMap) {
  const team = masterMap[id];

  if (!team || typeof team !== "object") {
    console.error("❌ NULL OR INVALID TEAM FOUND at id:", id, "->", team);
    continue;
  }

  teamsById[id] = team;

  if (Array.isArray(team.ofp_names)) {
    team.ofp_names.forEach((name) => {
      const norm = normalizeTeamName(name);
      if (norm) ofpIndex[norm] = id;
    });
  }

  if (Array.isArray(team.odds_api_names)) {
    team.odds_api_names.forEach((name) => {
      const norm = normalizeTeamName(name);
      if (norm) oddsIndex[norm] = id;
    });
  }

  if (team.canonical) {
    const canon = normalizeTeamName(team.canonical);
    if (canon) {
      oddsIndex[canon] = oddsIndex[canon] || id;
      ofpIndex[canon] = ofpIndex[canon] || id;
    }
  }
}

// ----------------------
// Lookup Helpers
// ----------------------
function getOFPTeamId(rawName) {
  const norm = normalizeTeamName(rawName);
  return ofpIndex[norm] || null;
}

function getOddsTeamId(rawName) {
  const norm = normalizeTeamName(rawName);
  return oddsIndex[norm] || null;
}

function describeTeam(id) {
  const t = teamsById[id];
  return t ? t.canonical : `Team ${id}`;
}

// ----------------------
// Odds API Helpers
// ----------------------

// Get averaged spread for a specific team in a game (home OR away)
function extractAveragedSpreadForTeam(game, teamName) {
  if (!game || !Array.isArray(game.bookmakers)) return null;

  const normalizedTarget = normalizeTeamName(teamName);
  const spreads = [];

  for (const book of game.bookmakers) {
    const spreadMarket = book.markets?.find((m) => m.key === "spreads");
    if (!spreadMarket) continue;

    const outcome = spreadMarket.outcomes?.find(
      (o) => normalizeTeamName(o.name) === normalizedTarget
    );

    if (outcome && typeof outcome.point === "number") {
      spreads.push(outcome.point);
    }
  }

  if (spreads.length === 0) return null;

  const sum = spreads.reduce((a, b) => a + b, 0);
  return sum / spreads.length;
}

function extractAveragedTotal(game) {
  if (!game || !Array.isArray(game.bookmakers)) return null;

  const totals = [];

  for (const book of game.bookmakers) {
    const totalMarket = book.markets?.find((m) => m.key === "totals");
    if (!totalMarket) continue;

    const overOutcome = totalMarket.outcomes?.find(
      (o) => typeof o.name === "string" && o.name.toLowerCase() === "over"
    );

    if (overOutcome && typeof overOutcome.point === "number") {
      totals.push(overOutcome.point);
    }
  }

  if (totals.length === 0) return null;

  const sum = totals.reduce((a, b) => a + b, 0);
  return sum / totals.length;
}

// ----------------------
// Compare Lines
// ----------------------
// NOTE: getOFPBaseLines is passed in from server.js
async function compareLines(getOFPBaseLines) {
  try {
    console.log("Fetching NCAA & NFL Odds API lines...");
    const ncaaGames = await fetchNCAAFLines();
    const nflGames = await fetchNFLLines();
    const oddsGames = [...ncaaGames, ...nflGames];

    console.log(
      `Fetched ${ncaaGames.length} NCAA games and ${nflGames.length} NFL games`
    );
    console.log(`Total Odds API games loaded: ${oddsGames.length}`);

    console.log("Fetching OFP base lines...");
    const ofpGames = await getOFPBaseLines();
    console.log(`Fetched ${ofpGames.length} OFP games`);

    const oddsGamesWithIds = oddsGames.map((g) => ({
      ...g,
      homeId: getOddsTeamId(g.home_team),
      awayId: getOddsTeamId(g.away_team),
    }));

    const results = [];

    for (const ofpGame of ofpGames) {
      if (!ofpGame.team1 || !ofpGame.team2 || ofpGame.baseLine == null) {
        console.warn("⚠️ Skipping OFP game due to missing data:", ofpGame);
        continue;
      }

      // From scraper: team1 = away, team2 = home
      const ofpAwayId = getOFPTeamId(ofpGame.team1);
      const ofpHomeId = getOFPTeamId(ofpGame.team2);

      if (!ofpAwayId || !ofpHomeId) {
        console.warn(
          `⚠️ Could not map OFP teams to IDs: "${ofpGame.team1}" (${ofpAwayId}), "${ofpGame.team2}" (${ofpHomeId})`
        );
        continue;
      }

      let match = null;
      let orientation = null; // "normal" or "reversed"

      // 1) normal: Odds home == OFP home, away == OFP away
      match = oddsGamesWithIds.find(
        (g) => g.homeId === ofpHomeId && g.awayId === ofpAwayId
      );
      if (match) orientation = "normal";

      // 2) reversed: Odds home == OFP away, away == OFP home
      if (!match) {
        match = oddsGamesWithIds.find(
          (g) => g.homeId === ofpAwayId && g.awayId === ofpHomeId
        );
        if (match) orientation = "reversed";
      }

      // 3) fallback string similarity
      if (!match) {
        match = oddsGames.find((g) => {
          const homeSim = stringSimilarity.compareTwoStrings(
            normalizeTeamName(g.home_team),
            normalizeTeamName(ofpGame.team2)
          );
          const awaySim = stringSimilarity.compareTwoStrings(
            normalizeTeamName(g.away_team),
            normalizeTeamName(ofpGame.team1)
          );
          return homeSim > 0.9 && awaySim > 0.9;
        });
        orientation = "normal";
      }

      if (!match) {
        console.warn(
          `⚠️ Could not find matching Odds API game for IDs ${ofpAwayId} @ ${ofpHomeId} (${describeTeam(
            ofpAwayId
          )} @ ${describeTeam(ofpHomeId)})`
        );
        continue;
      }

      const ofpSpread = ofpGame.baseLine;
      const ofpTotal = ofpGame.pointTotal;

      // Figure out which Odds API team name corresponds to OFP team1 (away)
      let apiNameForOfpAway;
      if (orientation === "reversed") {
        apiNameForOfpAway = match.home_team;
      } else {
        apiNameForOfpAway = match.away_team || match.home_team;
      }

      const apiSpread = extractAveragedSpreadForTeam(
        match,
        apiNameForOfpAway
      );
      const apiTotal = extractAveragedTotal(match);

      const spreadDiff =
        apiSpread != null && ofpSpread != null ? ofpSpread - apiSpread : null;
      const totalDiff =
        apiTotal != null && ofpTotal != null ? ofpTotal - apiTotal : null;

      console.log(
        `✅ Matched: OFP ${describeTeam(ofpAwayId)} @ ${describeTeam(
          ofpHomeId
        )}  |  Odds API: ${match.away_team} @ ${match.home_team}`
      );
      console.log(
        `   OFP spread (team1 side): ${ofpSpread}, API spread (same team): ${apiSpread}`
      );
      if (ofpTotal != null || apiTotal != null) {
        console.log(`   OFP total: ${ofpTotal}, API total: ${apiTotal}`);
      }
      if (spreadDiff !== null) {
        console.log(
          `   ➤ Spread Difference (OFP - API): ${spreadDiff.toFixed(2)}`
        );
      }
      if (totalDiff !== null) {
        console.log(
          `   ➤ Total Difference (OFP - API): ${totalDiff.toFixed(2)}`
        );
      }

      results.push({
        ofpAwayTeam: describeTeam(ofpAwayId),
        ofpHomeTeam: describeTeam(ofpHomeId),
        apiAwayTeam: match.away_team,
        apiHomeTeam: match.home_team,
        ofpSpread,
        apiSpread,
        spreadDiff,
        ofpTotal,
        apiTotal,
        totalDiff,
      });
    }

    return results;
  } catch (err) {
    console.error("❌ Error comparing lines:", err);
    throw err;
  }
}

module.exports = compareLines;