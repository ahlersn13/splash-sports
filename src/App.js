import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [games, setGames] = useState([]);
  const [topSpread, setTopSpread] = useState([]);
  const [topTotal, setTopTotal] = useState([]);

  // Helper: ensures .map never crashes
  const safe = (v) => (Array.isArray(v) ? v : []);

  useEffect(() => {
    fetch("http://localhost:5000/api/compare")
      .then((res) => res.json())
      .then((data) => {
        console.log("COMPARE API RESPONSE:", data);
        if (!Array.isArray(data)) {
          console.error("Backend returned NON-array:", data);
          return;
        }

        setGames(data);

        const spreadSorted = [...data]
          .filter((g) => g.spreadDiff !== null)
          .sort((a, b) => Math.abs(b.spreadDiff) - Math.abs(a.spreadDiff))
          .slice(0, 20);

        const totalSorted = [...data]
          .filter((g) => g.totalDiff !== null)
          .sort((a, b) => Math.abs(b.totalDiff) - Math.abs(a.totalDiff))
          .slice(0, 20);

        setTopSpread(spreadSorted);
        setTopTotal(totalSorted);
      })
      .catch((err) => console.error(err));
  }, []);

  return (
    <div style={{ padding: "20px" }}>
      <h1>OFP vs Odds API Comparison</h1>

      <h2>All Games</h2>
      <table border="1" cellPadding="8">
        <thead>
          <tr>
            <th>Matchup</th>
            <th>OFP Spread</th>
            <th>API Spread</th>
            <th>Diff</th>
            <th>OFP Total</th>
            <th>API Total</th>
            <th>Diff</th>
          </tr>
        </thead>
        <tbody>
          {safe(games).map((g, idx) => (
            <tr key={idx}>
              <td>{g.ofpAwayTeam} @ {g.ofpHomeTeam}</td>
              <td>{g.ofpSpread}</td>
              <td>{g.apiSpread?.toFixed(2)}</td>
              <td>{g.spreadDiff?.toFixed(2)}</td>
              <td>{g.ofpTotal}</td>
              <td>{g.apiTotal?.toFixed(2)}</td>
              <td>{g.totalDiff?.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: "40px" }}>🔥 Top 20 Spread Edges</h2>
      <table border="1" cellPadding="8">
        <tbody>
          {safe(topSpread).map((g, idx) => (
            <tr key={idx}>
              <td>{g.ofpAwayTeam} @ {g.ofpHomeTeam}</td>
              <td>{g.spreadDiff.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: "40px" }}>🔥 Top 20 Total Edges</h2>
      <table border="1" cellPadding="8">
        <tbody>
          {safe(topTotal).map((g, idx) => (
            <tr key={idx}>
              <td>{g.ofpAwayTeam} @ {g.ofpHomeTeam}</td>
              <td>{g.totalDiff.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
