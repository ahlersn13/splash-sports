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

// The contest/entry URL changes week to week (and possibly season to
// season). Set SPLASH_PICKS_URL in backend/.env to override without
// touching code. Falls back to the URL you're currently using.
const SPLASH_PICKS_URL =
  process.env.SPLASH_PICKS_URL ||
  "https://contests.app.splashsports.com/team-pickem/contests/contest_01M1BS28ATFG1F6FERSSZSF1JH/picks?entryId=entry_01M1BVP7NHWX18FGDT88BTED2M";

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
// Scraper: Splash Sports base lines
// ----------------------
let splashScrapePromise = null; // guards against concurrent Puppeteer launches

async function getSplashBaseLines() {
  if (splashScrapePromise) {
    console.log("Scrape already in progress — reusing existing browser session...");
    return splashScrapePromise;
  }

  splashScrapePromise = (async () => {
    const browser = await puppeteer.launch({
      headless: false,
      userDataDir: PUPPETEER_PROFILE,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });
      await page.setCacheEnabled(false);

      // Go to picks page
      await page.goto(SPLASH_PICKS_URL, {
        waitUntil: "networkidle2",
      });

      // If not logged in, wait for manual login
      if (!(await existsVisible(page, '[data-testid^="game-pick-card-"]', 1500))) {
        console.log("Please log in manually in the opened browser...");
        await waitForEnter("Press Enter after logging in and the pick sheet is visible...");
      }

      // Ensure we're on the picks page with the game cards visible
      await page.goto(SPLASH_PICKS_URL, {
        waitUntil: "networkidle2",
      });

      await page.waitForSelector('[data-testid^="game-pick-card-"]', {
        timeout: 20000,
      });

      const games = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-testid^="game-pick-card-"]')];
        const results = [];

        for (const card of cards) {
          const matchupId = card
            .getAttribute("data-testid")
            .replace("game-pick-card-", "");

          // Site update: the header no longer carries a spread badge.
          // The spread now lives inside each pick button as
          // team-abbrev-{teamId}, e.g. "OKLA -5.5" / "MICH +5.5".
          // Team order in winner-picks is still [away, home].
          const teamRows = [
            ...card.querySelectorAll('[data-testid^="team-row-"]'),
          ];
          if (teamRows.length < 2) continue;

          const parseRow = (row) => {
            const teamId = row
              .getAttribute("data-testid")
              .replace("team-row-", "");

            const nameSpan = row.querySelector(
              ".truncate.text-base.font-bold"
            );
            const team = nameSpan ? nameSpan.textContent.trim() : null;

            const abbrevSpan = row.querySelector(
              `[data-testid="team-abbrev-${teamId}"]`
            );
            let spread = null;
            if (abbrevSpan) {
              // text like "OKLA -5.5" or "MICH +5.5" — take the
              // trailing signed number.
              const match = abbrevSpan.textContent
                .trim()
                .match(/(-?\d+(\.\d+)?)\s*$/);
              if (match) spread = parseFloat(match[1]);
            }

            return { team, spread };
          };

          const away = parseRow(teamRows[0]);
          const home = parseRow(teamRows[1]);

          if (!away.team || !home.team) continue;
          if (away.spread === null || home.spread === null) continue;

          const awayTeam = away.team;
          const homeTeam = home.team;
          const awaySpread = away.spread;
          const homeSpread = home.spread;

          // Over/under total lives in a sibling totals-row within the
          // same card, keyed by the same matchup id.
          let pointTotal = null;
          const totalOverBtn = card.querySelector(
            `[data-testid="total-over-${matchupId}"]`
          );
          if (totalOverBtn) {
            const spans = totalOverBtn.querySelectorAll("span.shrink-0");
            const numberSpan = spans[spans.length - 1]; // last span holds the number
            if (numberSpan) {
              const match = numberSpan.textContent
                .trim()
                .match(/(\d+(\.\d+)?)/);
              if (match) pointTotal = parseFloat(match[0]);
            }
          }

          results.push({
            team1: awayTeam, // away
            team2: homeTeam, // home
            baseLine: awaySpread, // matches old scraper's convention (team1/away spread)
            pointTotal,
          });
        }

        return results;
      });

      console.log("Scraped Splash Sports games:", games.length);
      return games;
    } finally {
      // Close browser to avoid "browser already running" error next time
      try {
        await browser.close();
      } catch (e) {
        console.warn("Error closing browser (can usually ignore):", e.message);
      }
    }
  })();

  try {
    return await splashScrapePromise;
  } finally {
    splashScrapePromise = null; // release the lock once done (success or failure)
  }
}

// ----------------------
// REST Endpoints
// ----------------------

// Raw Splash Sports lines (scraper only)
app.get("/api/lines", async (req, res) => {
  try {
    const data = await getSplashBaseLines();
    res.json(data);
  } catch (err) {
    console.error("Scrape Error:", err);
    res.status(500).json({
      message: "Error scraping Splash Sports lines",
      error: String(err),
    });
  }
});

// Comparison endpoint (Splash Sports vs Odds API)
app.get("/api/compare", async (req, res) => {
  try {
    // compareLines expects getSplashBaseLines as a dependency
    const data = await compareLines(getSplashBaseLines);
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
module.exports = { getSplashBaseLines };