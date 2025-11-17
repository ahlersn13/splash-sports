const compareLines = require("./compareLines");

(async () => {
  console.log("Running testCompare.js...");
  const result = await compareLines();
  console.log("RESULT:", JSON.stringify(result, null, 2));
})();