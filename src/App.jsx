import "./App.css"
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

const RISK_CONFIDENCE_WEIGHT = 30;
const PAYOUT_CONFIDENCE_WEIGHT = 30;
 
const HIGH_CONFIDENCE_MIN = 80;
const MEDIUM_CONFIDENCE_MIN = 60;
 
const MISSING_ASSESSOR_CONFIDENCE_PENALTY = 40;
 
const ESCALATE_CONFIDENCE_CAP = 50;

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
        confidence: (validAssessments == 0) ? 0 : (100 - (models.length - validAssessments) * MISSING_ASSESSOR_CONFIDENCE_PENALTY),
        confidenceLabel: "Low",
        finalRiskScore: null,
        finalPayout: null,
      }
    }

    const riskSpread = Math.max(...riskScores) - Math.min(...riskScores);
    const payoutSpread = Math.max(...payouts) - Math.min(...payouts);
    const payoutSpreadPct = claim.amount > 0 ? payoutSpread / claim.amount : 0;

    let confidence = 100;
    confidence -= Math.round((riskSpread / RISK_THRESHOLD) * RISK_CONFIDENCE_WEIGHT);
    confidence -= Math.round((payoutSpreadPct / PAYOUT_THRESHOLD) * PAYOUT_CONFIDENCE_WEIGHT);
    if (confidence < 0) {
      confidence = 0;
    }

    if (riskSpread > RISK_THRESHOLD || payoutSpreadPct > PAYOUT_THRESHOLD) {
      confidence = Math.min(confidence, ESCALATE_CONFIDENCE_CAP);
      return {
        status: "ESCALATE",
        confidence: confidence,
        confidenceLabel: confidence >= HIGH_CONFIDENCE_MIN ? "High" : confidence >= MEDIUM_CONFIDENCE_MIN ? "Medium" : "Low",
        finalRiskScore: null,
        finalPayout: null,
      }
    }
    const finalRiskScore = Math.round(riskScores.reduce((a, b) => a + b, 0) / riskScores.length);
    const finalPayout = Math.round(payouts.reduce((a, b) => a + b, 0) / payouts.length);
    return {
      status: "CONSENSUS",
      confidence,
      confidenceLabel: confidence >= HIGH_CONFIDENCE_MIN ? "High" : confidence >= MEDIUM_CONFIDENCE_MIN ? "Medium" : "Low",
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
        const decision_result = decision(claim, models);
        allResults.push({ claim, models: { a: m1, b: m2, gemini: m3 }, decision_result });
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
    <div className="page-wrapper">
      <h1>🏦 Insurance Claim Consensus Engine</h1>
      <p className="page-subtitle">Three models assess each claim independently.</p>

      <button
        onClick={runAssessment}
        disabled={loading}
        className={`run-btn ${loading ? "run-btn--loading" : "run-btn--idle"}`}
      >
        {loading ? `Assessing claim ${progress} of ${CLAIMS.length}...` : "Run Assessment"}
      </button>

      {error && (
        <div className="error-box">
          <strong>Error:</strong> {error}
        </div>
      )}

      {results && results.map((r) => {
        const statusClass = r.decision_result.status === "ESCALATE"
          ? "consensus-panel__status--escalate"
          : "consensus-panel__status--approve";

        return (
          <div key={r.claim.id} className="claim-card">
            <div className="claim-card__header">
              <div className="claim-card__meta">
                <div className="claim-card__label">CLAIM #{r.claim.id}</div>
                <div className="claim-card__description">{r.claim.description}</div>
              </div>
              <div className="claim-card__amount">
                <div className="claim-card__amount-label">Claimed</div>
                <div className="claim-card__amount-value">${r.claim.amount.toLocaleString()}</div>
              </div>
            </div>

            <div className="assessors-grid">
              {[
                ["Assessor A", r.models.a, "assessor-card--a"],
                ["Assessor B", r.models.b, "assessor-card--b"],
                ["Gemini (mock)", r.models.gemini, "assessor-card--gemini"],
              ].map(([name, m, modifier]) => (
                <div key={name} className={`assessor-card ${modifier}`}>
                  <div className="assessor-card__name">{name}</div>
                  <div>Risk: <strong>{m.riskScore}/100</strong></div>
                  <div>Payout: <strong>${m.recommendedPayout}</strong></div>
                  <div className="assessor-card__reasoning">{m.reasoning}</div>
                </div>
              ))}
            </div>

            <div className="consensus-panel consensus-panel--status">
              <div>Status: <strong className={statusClass}>{r.decision_result.status}</strong></div>
              <div>Confidence: <strong>{r.decision_result.confidenceLabel} {`(${r.decision_result.confidence}/100)`}</strong></div>
            </div>

            <div className="consensus-panel consensus-panel--payout">
              {(r.decision_result.finalPayout == null && r.decision_result.finalRiskScore == null) ? (
                <span>
                  Action: <strong className="consensus-panel__review">Human review required</strong>
                </span>
              ) : (
                <>
                  <span>Final Risk: <strong>{r.decision_result.finalRiskScore} / 100</strong></span>
                  <span>Recommended Payout: <strong>${r.decision_result.finalPayout}</strong></span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}