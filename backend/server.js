require("dotenv").config();
const path = require("path");
const readline = require("readline");
const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");

// Odds API compare logic
const compareLines = require("./compare/compareLines");

const app = express();
app.use(cors());
app.use(express.json());

const PUPPETEER_PROFILE = path.join(__dirname, "puppeteer_profile");

// ----------------------
// Helpers for Puppeteer
// ----------------------
function waitForEnter(promptText = "Press Enter to continue...") {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(promptText, () => {
      rl.close();
      resolve();
    })
  );
}

async function existsVisible(page, selector, timeout = 2000) {
  try {
    await page.waitForSelector(selector, { visible: true, timeout });
    return true;
  } catch {
    return false;
  }
}

// ----------------------
// Scraper: OFP base lines
// ----------------------
async function getOFPBaseLines() {
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: PUPPETEER_PROFILE,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    // Go to picks page
    await page.goto("https://www.officefootballpool.com/picks.cfm", {
      waitUntil: "networkidle2",
    });

    // If not logged in, wait for manual login
    if (!(await existsVisible(page, ".SPREAD", 1500))) {
      console.log("Please log in manually in the opened browser...");
      await waitForEnter("Press Enter after logging in and the pick sheet is visible...");
    }

    // Ensure we're on the picks page with the gamerows visible
    await page.goto("https://www.officefootballpool.com/picks.cfm", {
      waitUntil: "networkidle2",
    });

    await page.waitForSelector(".gamerow", { timeout: 20000 });

    const games = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".row.gamerow")];
      const results = [];

      for (let i = 0; i < rows.length; i += 2) {
        const teamRow = rows[i];
        const totalRow = rows[i + 1];
        if (!totalRow) break;

        const teamBoxes = teamRow.querySelectorAll(".col-5, .col-md-4");
        if (teamBoxes.length < 2) continue;

        const t1 = teamBoxes[0].innerText.trim();
        const t2 = teamBoxes[1].innerText.trim();

        const s1 = parseFloat(
          teamBoxes[0].querySelector(".SPREAD")?.innerText
        );
        const s2 = parseFloat(
          teamBoxes[1].querySelector(".SPREAD")?.innerText
        );

        const totals = totalRow.querySelectorAll(".ouTotal");
        let oTotal = null;

        if (totals.length > 0) {
          const match = totals[0].innerText.match(/(\d+(\.\d+)?)/);
          if (match) oTotal = parseFloat(match[0]);
        }

        results.push({
          team1: t1,
          team2: t2,
          baseLine: s1,
          pointTotal: oTotal,
        });
      }

      return results;
    });

    console.log("Scraped OFP games:", games.length);
    return games;
  } finally {
    // Close browser to avoid "browser already running" error next time
    try {
      await browser.close();
    } catch (e) {
      console.warn("Error closing browser (can usually ignore):", e.message);
    }
  }
}

// ----------------------
// REST Endpoints
// ----------------------

// Raw OFP lines (scraper only)
app.get("/api/lines", async (req, res) => {
  try {
    const data = await getOFPBaseLines();
    res.json(data);
  } catch (err) {
    console.error("Scrape Error:", err);
    res.status(500).json({
      message: "Error scraping OFP lines",
      error: String(err),
    });
  }
});

// Comparison endpoint (OFP vs Odds API)
app.get("/api/compare", async (req, res) => {
  try {
    // compareLines expects getOFPBaseLines as a dependency
    const data = await compareLines(getOFPBaseLines);
    res.json(data);
  } catch (err) {
    console.error("Compare Error:", err);
    res.status(500).json({
      message: "Error comparing lines",
      error: String(err),
    });
  }
});

// ----------------------
// Start server
// ----------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Export scraper (optional, used if you ever run compareLines directly)
module.exports = { getOFPBaseLines };