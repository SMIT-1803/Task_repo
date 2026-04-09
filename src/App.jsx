import { useState } from "react";

const CLAIMS = [
  { id: 1, description: "Water damage to basement following burst pipe. Claimant provided plumber invoice and photos.", amount: 18000 },
  { id: 2, description: "Vehicle totaled. Claimant reported theft but two witnesses reported observing a collision.", amount: 34000 },
  { id: 3, description: "House fire originating in kitchen. Fire marshal report confirms accidental cause.", amount: 210000 },
  { id: 4, description: "Slip and fall in grocery store. Claimant reports back injury, no medical records provided yet.", amount: 45000 },
  { id: 5, description: "Roof collapse after heavy snowfall. Claimant has no prior claims history.", amount: 67000 },
  { id: 6, description: "Jewelry theft during home break-in. Police report filed. Items not photographed or appraised.", amount: 28000 },
  { id: 7, description: "Business interruption claim following flood. Revenue loss disputed by insurer's forensic accountant.", amount: 190000 },
  { id: 8, description: "Medical malpractice. Claimant alleges wrong medication administered during routine procedure.", amount: 320000 },

];


const RISK_THRESHOLD = 30;
const PAYOUT_THRESHOLD = 0.3;

function mockGemini(claim) {
  const seeds = [22, 67, 41, 88, 15, 54, 79, 33];
  const base = seeds[claim.id - 1];
  const reasonings = [
    "Two prior claims detected in the last 18 months. Elevated risk profile.",
    "No prior claims history found. Standard risk assessment applies.",
    "Claim documentation is incomplete. Recommend further investigation.",
    "Supporting evidence is consistent with claim description. Low fraud indicators.",
    "Claimant account contains minor inconsistencies. Medium risk flagged.",
  ];
  return {
    riskScore: base,
    recommendedPayout: Math.round(claim.amount * (1 - base / 200)),
    reasoning: reasonings[claim.id % reasonings.length],
  };
}

async function callClaude(prompt) {
  const res = await fetch("/api/assess", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error || `API ${res.status}`);
  }

  return await res.json();
}

export default function InsuranceConsensus() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);

  const decision = (claim, models) => {
    let validAssessments = 0;
    const riskScores = [];
    const payouts = [];
    models.forEach(model => {
      const isValidRiskScore =
        typeof model.riskScore === "number" &&
        model.riskScore >= 0 &&
        model.riskScore <= 100;

      const isValidPayout =
        typeof model.recommendedPayout === "number" &&
        model.recommendedPayout >= 0;
      if (isValidRiskScore && isValidPayout) {
        validAssessments += 1;
        riskScores.push(model.riskScore);
        payouts.push(model.recommendedPayout);
      }
    });

    if (validAssessments < models.length) {
      return {
        status: "ESCALATE",
        confidence: (validAssessments == 0) ? 0 : (100 - (models.length - validAssessments) * 40),
        confidenceLabel: "Low",
        finalRiskScore: null,
        finalPayout: null,
      }
    }

    const riskSpread = Math.max(...riskScores) - Math.min(...riskScores);
    const payoutSpread = Math.max(...payouts) - Math.min(...payouts);
    const payoutSpreadPct = claim.amount > 0 ? payoutSpread / claim.amount : 0;

    let confidence = 100;
    confidence -= Math.round((riskSpread / RISK_THRESHOLD) * 30);
    confidence -= Math.round((payoutSpreadPct / PAYOUT_THRESHOLD) * 30);
    if (confidence < 0) {
      confidence = 0;
    }

    if (riskSpread > RISK_THRESHOLD || payoutSpreadPct > PAYOUT_THRESHOLD) {
      confidence = Math.min(confidence, 50);
      return {
        status: "ESCALATE",
        confidence: confidence,
        confidenceLabel: confidence >= 80 ? "High" : confidence >= 55 ? "Medium" : "Low",
        finalRiskScore: null,
        finalPayout: null,
      }
    }
    const finalRiskScore = Math.round(riskScores.reduce((a, b) => a + b, 0) / riskScores.length);
    const finalPayout = Math.round(payouts.reduce((a, b) => a + b, 0) / payouts.length);
    return {
      status: "CONSENSUS",
      confidence,
      confidenceLabel: confidence >= 80 ? "High" : confidence >= 60 ? "Medium" : "Low",
      finalRiskScore,
      finalPayout
    };
  }

  async function runAssessment() {
    try {
      setLoading(true);
      setError(null);
      setResults(null);
      setProgress(0);

      const allResults = [];

      for (const claim of CLAIMS) {
        let m1, m2;

        try {
          m1 = await callClaude(
            `You are an insurance risk assessor. Assess this claim.\n\nClaim: ${claim.description}\nAmount: $${claim.amount}\n\nReturn JSON only — no markdown, no explanation:\n{"riskScore": 0-100, "recommendedPayout": number, "reasoning": "one sentence"}`
          );
        } catch (e) {
          m1 = { riskScore: undefined, recommendedPayout: undefined, reasoning: "Assessor A unavailable: " + e.message };
        }

        try {
          m2 = await callClaude(
            `You are a skeptical senior claims adjuster. Be critical. Assess this insurance claim.\n\nClaim: ${claim.description}\nAmount: $${claim.amount}\n\nReturn JSON only — no markdown, no explanation:\n{"riskScore": 0-100, "recommendedPayout": number, "reasoning": "one sentence"}`
          );
        } catch (e) {
          m2 = { riskScore: undefined, recommendedPayout: undefined, reasoning: "Assessor B unavailable: " + e.message };
        }

        const m3 = mockGemini(claim);
        const models = [m1, m2, m3]
        const consensus = decision(claim, models);
        allResults.push({ claim, models: { a: m1, b: m2, gemini: m3 }, consensus });
        setProgress(allResults.length);
      }
      setResults(allResults);
    } catch (error) {
      setError(error.message || "Something went wrong while running assessments.");
    } finally {
      setLoading(false);
    }
  }
  return (

    <div style={{ padding: 32, maxWidth: 900, margin: "0 auto", fontFamily: "sans-serif" }}>
      <h1>🏦 Insurance Claim Consensus Engine</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>Three models assess each claim independently.</p>

      <button
        onClick={runAssessment}
        disabled={loading}
        style={{ padding: "12px 32px", fontSize: 16, background: loading ? "#6b7280" : "#1a1a2e", color: "white", border: "none", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer", marginBottom: 24 }}
      >
        {loading ? `Assessing claim ${progress} of ${CLAIMS.length}...` : "Run Assessment"}
      </button>

      {error && (
        <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: 16, marginBottom: 24, color: "#991b1b", fontSize: 14 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {results && results.map((r) => {
        const statusColor = r.consensus.status === "ESCALATE" ? "red" : "green";
        return (
          <div key={r.claim.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>CLAIM #{r.claim.id}</div>
                <div style={{ fontSize: 14, color: "#374151" }}>{r.claim.description}</div>
              </div>
              <div style={{ textAlign: "right", marginLeft: 16, flexShrink: 0 }}>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>Claimed</div>
                <div style={{ fontWeight: 700 }}>${r.claim.amount.toLocaleString()}</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
              {[["Assessor A", r.models.a, "#dbeafe"], ["Assessor B", r.models.b, "#dcfce7"], ["Gemini (mock)", r.models.gemini, "#f3e8ff"]].map(([name, m, bg]) => (
                <div key={name} style={{ background: bg, borderRadius: 8, padding: 10, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 11 }}>{name}</div>
                  <div>Risk: <strong>{m.riskScore}/100</strong></div>
                  <div>Payout: <strong>${m.recommendedPayout}</strong></div>
                  <div style={{ color: "#6b7280", marginTop: 4, fontSize: 11, fontStyle: "italic" }}>{m.reasoning}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#1a1a2e", color: "white", borderRadius: 8, padding: "12px 16px", display: "flex", flexDirection: "column", gap: "5px", fontSize: 14, marginBottom: 12 }}>

              <div>Status: <strong style={{ color: statusColor }}>{r.consensus.status}</strong></div>
              <div>Confidence: <strong>{r.consensus.confidenceLabel} {`(${r.consensus.confidence}/100)`} </strong></div>
            </div>

            <div style={{ background: "#1a1a2e", color: "white", borderRadius: 8, padding: "12px 16px", display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              {(r.consensus.finalPayout == null && r.consensus.finalRiskScore == null) ?
                <span>
                  Action: <strong style={{ color: "red" }}>Human review required</strong>
                </span> :
                <>
                  <span>
                    Final Risk: <strong>{r.consensus.finalRiskScore} / 100</strong>
                  </span>
                  <span>
                    Recommended Payout: <strong>${r.consensus.finalPayout}</strong>
                  </span>
                </>
              }
            </div>
          </div>
        )
      })}
    </div>
  );
}