import { useEffect, useState } from "react";
import { api, type Summary } from "./api";
import { formatCents, monthLabel, monthOf, shiftMonth, toBars } from "./logic";

export function SummaryView() {
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    api
      .summary(month)
      .then((s) => !cancelled && setSummary(s))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [month]);

  const bars = summary ? toBars(summary.categories) : [];

  return (
    <section className="card">
      <div className="month-nav">
        <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
          &larr;
        </button>
        <h2>{monthLabel(month)}</h2>
        <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
          &rarr;
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {summary && (
        <>
          <p className="total">
            Total spent: <strong>{formatCents(summary.totalCents)}</strong>
          </p>
          {bars.length === 0 ? (
            <p className="empty">No expenses this month.</p>
          ) : (
            <ul className="bars">
              {bars.map((b) => (
                <li key={b.categoryId}>
                  <span className="bar-label">{b.name}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${b.widthPct}%` }} />
                  </div>
                  <span className="bar-value">
                    {formatCents(b.totalCents)} <small>({b.sharePct}%)</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
