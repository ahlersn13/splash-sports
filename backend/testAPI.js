const { fetchNCAAFLines } = require("./api/fetchOdds");

(async () => {
  const games = await fetchNCAAFLines();
  console.log(JSON.stringify(games, null, 2));
})();