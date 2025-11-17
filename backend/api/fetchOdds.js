const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
console.log("Loaded API_KEY:", process.env.API_KEY);
const axios = require("axios");

const API_KEY = process.env.API_KEY


async function fetchNCAAFLines() {
  const sport = "americanfootball_ncaaf"; // NCAA football
  const regions = "us";                    // US odds only
  const markets = "spreads,totals";        // which odds you want

  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${API_KEY}&regions=${regions}&markets=${markets}`;

  try{
    const response = await axios.get(url);
    const data = response.data;
    console.log('Fetched ${data.length} games for Odds API');
    return data;
  } catch (error) {
    console.error("Error fetching Odds API:", error.message);
    return[];
  }
}


async function fetchNFLLines() {
  try {
    const response = await axios.get("https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds", {
      params: {
        api_key: process.env.API_KEY,
        regions: "us",
        markets: "spreads,totals",
      },
    });

    return response.data.map(game => ({
      ...game,
      home_team: game.home_team,
      away_team: game.away_team,
      spreads: game.bookmakers?.[0]?.markets?.find(m => m.key === "spreads")?.outcomes?.[0] || null,
    }));
  } catch (err) {
    console.error("NFL odds fetch error:", err);
    return [];
  }
}

module.exports = {
  fetchNFLLines,
  fetchNCAAFLines,
};