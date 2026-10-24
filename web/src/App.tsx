import { useEffect, useState } from "react";
import { onUnauthorized, tokenStore } from "./api";
import { ExpensesView } from "./ExpensesView";
import { Login } from "./Login";
import { SummaryView } from "./SummaryView";

type Tab = "expenses" | "summary";

export function App() {
  const [token, setToken] = useState<string | null>(() => tokenStore.get());
  const [email, setEmail] = useState("");
  const [tab, setTab] = useState<Tab>("expenses");

  const logout = () => {
    tokenStore.set(null);
    setToken(null);
  };

  useEffect(() => onUnauthorized(logout), []);

  if (!token) {
    return (
      <Login
        onAuth={(t, e) => {
          tokenStore.set(t);
          setEmail(e);
          setToken(t);
        }}
      />
    );
  }

  return (
    <div className="app">
      <header>
        <h1>Expense Tracker</h1>
        <nav>
          <button className={tab === "expenses" ? "active" : ""} onClick={() => setTab("expenses")}>
            Expenses
          </button>
          <button className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}>
            Monthly summary
          </button>
        </nav>
        <div className="user">
          {email && <span>{email}</span>}
          <button onClick={logout}>Log out</button>
        </div>
      </header>
      <main>{tab === "expenses" ? <ExpensesView /> : <SummaryView />}</main>
    </div>
  );
}
