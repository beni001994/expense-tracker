import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type Category, type Expense } from "./api";
import { centsToInput, formatCents, todayISO, validateExpenseForm, type ExpenseFormInput } from "./logic";

const emptyForm = (categoryId = ""): ExpenseFormInput => ({
  amount: "",
  description: "",
  date: todayISO(),
  categoryId,
});

export function ExpensesView() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ExpenseFormInput>(emptyForm());
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ExpenseFormInput, string>>>({});

  const load = useCallback(async () => {
    try {
      setError("");
      setExpenses(await api.expenses({ from, to, categoryId: filterCategory ? Number(filterCategory) : undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load expenses");
    }
  }, [from, to, filterCategory]);

  useEffect(() => {
    api
      .categories()
      .then((cats) => {
        setCategories(cats);
        setForm((f) => (f.categoryId || !cats[0] ? f : { ...f, categoryId: String(cats[0].id) }));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = () => {
    setEditingId(null);
    setFieldErrors({});
    setForm(emptyForm(categories[0] ? String(categories[0].id) : ""));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = validateExpenseForm(form);
    if (!result.ok) return setFieldErrors(result.errors);
    try {
      if (editingId === null) await api.createExpense(result.value);
      else await api.updateExpense(editingId, result.value);
      reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save expense");
    }
  };

  const edit = (x: Expense) => {
    setEditingId(x.id);
    setFieldErrors({});
    setForm({ amount: centsToInput(x.amountCents), description: x.description, date: x.date, categoryId: String(x.categoryId) });
  };

  const remove = async (x: Expense) => {
    if (!window.confirm(`Delete "${x.description}"?`)) return;
    try {
      await api.deleteExpense(x.id);
      if (editingId === x.id) reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete expense");
    }
  };

  const set = (key: keyof ExpenseFormInput) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const total = expenses.reduce((sum, x) => sum + x.amountCents, 0);

  return (
    <>
      <form className="card expense-form" onSubmit={submit} noValidate>
        <h2>{editingId === null ? "Add expense" : "Edit expense"}</h2>
        <label>
          Amount
          <input value={form.amount} onChange={set("amount")} inputMode="decimal" placeholder="0.00" />
          {fieldErrors.amount && <span className="error">{fieldErrors.amount}</span>}
        </label>
        <label>
          Description
          <input value={form.description} onChange={set("description")} maxLength={200} />
          {fieldErrors.description && <span className="error">{fieldErrors.description}</span>}
        </label>
        <label>
          Date
          <input type="date" value={form.date} onChange={set("date")} />
          {fieldErrors.date && <span className="error">{fieldErrors.date}</span>}
        </label>
        <label>
          Category
          <select value={form.categoryId} onChange={set("categoryId")}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {fieldErrors.categoryId && <span className="error">{fieldErrors.categoryId}</span>}
        </label>
        <div className="row">
          <button type="submit" className="primary">
            {editingId === null ? "Add" : "Save"}
          </button>
          {editingId !== null && (
            <button type="button" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <section className="card">
        <div className="filters">
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            Category
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {expenses.length === 0 ? (
          <p className="empty">No expenses match.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {expenses.map((x) => (
                <tr key={x.id}>
                  <td>{x.date}</td>
                  <td>{x.description}</td>
                  <td>{x.categoryName}</td>
                  <td className="num">{formatCents(x.amountCents)}</td>
                  <td className="actions">
                    <button onClick={() => edit(x)}>Edit</button>
                    <button onClick={() => void remove(x)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total ({expenses.length})</td>
                <td className="num">{formatCents(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </section>
    </>
  );
}
