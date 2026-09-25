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

        // Splash's row/list layout duplicates each number in a hidden
        // mobile span and a visible desktop span (CSS-toggled, both
        // present in the DOM at once). There's no dedicated testid for
        // the spread or total number anymore, so we pull it out of the
        // button's full text via regex instead.
        //
        // Team spread e.g. "+21.5" / "-21.5" — must not match inside a
        // win-loss record like "2-0", so require the sign not be
        // preceded by a digit.
        const SPREAD_RE = /(?<!\d)[+-]\d+(\.\d+)?/;
        // Total number e.g. "49.5" inside "O 49.5" / "Over 49.5".
        const NUMBER_RE = /\d+(\.\d+)?/;

        for (const card of cards) {
          const matchupId = card
            .getAttribute("data-testid")
            .replace("game-pick-card-", "");

          const teamRows = [
            ...card.querySelectorAll('[data-testid^="team-row-"]'),
          ];
          if (teamRows.length < 2) continue;

          const parseRow = (row) => {
            // Both the short abbreviation ("NW") and the full name
            // ("Northwestern") share the classes truncate + font-extrabold
            // (one for mobile, one for desktop, both present in the DOM).
            // The full name is the longer of the two.
            const candidates = [
              ...row.querySelectorAll(".truncate.font-extrabold"),
            ]
              .map((el) => el.textContent.trim())
              .filter((t) => t.length > 0);

            const team = candidates.length
              ? candidates.reduce((a, b) => (b.length > a.length ? b : a))
              : null;

            // The spread number sits in its own span with a distinct
            // "font-black" weight class — the record (font-semibold),
            // rank (font-semibold), and team name (font-extrabold) all
            // use different classes, so this isolates just the spread
            // text (e.g. "+21.5") without any adjacent-digit ambiguity
            // from a win-loss record like "2-0" sitting right next to it.
            const spreadSpan = row.querySelector(".font-black");
            const spreadMatch = spreadSpan
              ? spreadSpan.textContent.match(SPREAD_RE)
              : null;
            const spread = spreadMatch ? parseFloat(spreadMatch[0]) : null;

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
            const match = totalOverBtn.textContent.match(NUMBER_RE);
            if (match) pointTotal = parseFloat(match[0]);
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