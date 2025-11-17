import React, { useEffect, useState } from "react";

export default function SimpleTable() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("http://localhost:5000/api/compare");
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error("Fetch error:", err);
      }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <p>Loading matchups...</p>;

  return (
    <div style={{ padding: "20px" }}>
      <h2>Line Comparison</h2>

      <table border="1" cellPadding="8" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th>Matchup</th>
            <th>OFP Spread</th>
            <th>API Spread</th>
            <th>Spread Diff</th>
            <th>OFP Total</th>
            <th>API Total</th>
            <th>Total Diff</th>
          </tr>
        </thead>

        <tbody>
          {data.map((g, i) => (
            <tr key={i}>
              <td><strong>{g.team1}</strong> @ <strong>{g.team2}</strong></td>

              <td>{g.ofpSpread ?? "-"}</td>
              <td>{g.apiSpread ?? "-"}</td>
              <td style={{ background: "#eef" }}>
                {g.spreadDiff !== null ? g.spreadDiff.toFixed(2) : "-"}
              </td>

              <td>{g.ofpTotal ?? "-"}</td>
              <td>{g.apiTotal ?? "-"}</td>
              <td style={{ background: "#efe" }}>
                {g.totalDiff !== null ? g.totalDiff.toFixed(2) : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
