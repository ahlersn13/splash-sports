const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const axios = require("axios");

const API_KEY = process.env.API_KEY;

async function testFetch() {
  const sport = "americanfootball_ncaaf";
  const regions = "us";
  const markets = "spreads,totals";

  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${API_KEY}&regions=${regions}&markets=${markets}`;

  try {
    const response = await axios.get(url);
    console.log("API request successful!");
    console.log("Number of games returned:", response.data.length);
    console.log("First game:", response.data[0]);
  } catch (err) {
    console.error("Error fetching Odds API:", err.response?.status, err.response?.data || err.message);
  }
}

testFetch();