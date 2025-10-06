import React, { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid, BarChart, Bar, Legend } from "recharts";
import { Plus, Trash2, Sparkles, Calendar, PiggyBank, TrendingDown, Gauge, Target, Trophy, Settings, Save, RotateCcw } from "lucide-react";

/**
 * Debt‑Payoff Coach — single‑file React app
 * - Add debts (name, balance, APR, minimum, due day)
 * - Enter income and extra payment budget
 * - Choose strategy: Avalanche (highest APR first) or Snowball (smallest balance first)
 * - Generates month‑by‑month payoff plan, payoff dates, interest saved vs. minimums‑only
 * - "What‑if" slider for extra amount
 * - Dashboard KPIs + charts + gamified milestones/streaks
 * - Autosaves to localStorage
 *
 * Notes: Pure front‑end math (approximate but conservative):
 * Interest compounds monthly using APR/12. Each month we apply minimums first, then distribute extra to target debt; any overflow cascades automatically.
 */

const currency = (n) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const pct = (n, d = 0) => `${(n * 100).toFixed(d)}%`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const EMPTY_DEBT = { id: "", name: "", balance: 0, apr: 0, min: 0, dueDay: 1 };

const exampleDebts = [
  { id: crypto.randomUUID(), name: "Visa", balance: 5200, apr: 22.99, min: 110, dueDay: 12 },
  { id: crypto.randomUUID(), name: "Auto Loan", balance: 9800, apr: 6.5, min: 275, dueDay: 5 },
  { id: crypto.randomUUID(), name: "Store Card", balance: 1350, apr: 25.49, min: 35, dueDay: 18 },
];

const STORAGE_KEY = "debt_coach_v1";

function usePersistentState(defaultState) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : defaultState;
    } catch {
      return defaultState;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);
  return [state, setState];
}

function monthAdd(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function formatMonth(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Core simulator
function simulatePlan(inputDebts, extra, strategy = "avalanche", today = new Date()) {
  const debts = inputDebts
    .map((d) => ({ ...d, balance: +d.balance, apr: +d.apr, min: +d.min }))
    .filter((d) => d.balance > 0 && d.apr >= 0 && d.min >= 0);
  if (!debts.length) return { months: 0, timeline: [], totalInterest: 0, payoff: [], plan: [] };

  const totalStart = debts.reduce((s, d) => s + d.balance, 0);
  const maxMonths = 600; // safety cap (50 years)

  const payoff = debts.map((d) => ({ id: d.id, name: d.name, startBalance: d.balance, payoffMonthIndex: null, payoffDate: null, interestPaid: 0 }));
  const timeline = []; // {monthIndex, totalBalance, interestPaid}
  const plan = []; // per-month breakdown rows

  let monthIndex = 0;
  let active = debts.map((d) => ({ ...d }));

  // helper: pick target by strategy
  const pickTargetIndex = () => {
    const open = active.filter((x) => x.balance > 0);
    if (!open.length) return -1;
    if (strategy === "snowball") {
      const smallest = Math.min(...open.map((x) => x.balance));
      return active.findIndex((x) => x.balance === smallest && x.balance > 0);
    } else {
      // avalanche (default): highest APR
      const hi = Math.max(...open.map((x) => x.apr));
      return active.findIndex((x) => x.apr === hi && x.balance > 0);
    }
  };

  while (monthIndex < maxMonths && active.some((d) => d.balance > 0.005)) {
    // accrue interest & compute minimums
    let monthInterest = 0;
    const minimums = new Array(active.length).fill(0);

    for (let i = 0; i < active.length; i++) {
      const d = active[i];
      if (d.balance <= 0) continue;
      const r = d.apr / 100 / 12;
      const interest = d.balance * r;
      monthInterest += interest;
      d.balance += interest;

      const minPay = clamp(d.min, 0, d.balance);
      d.balance -= minPay;
      minimums[i] = minPay;
    }

    // distribute extra toward target (with cascading overflow)
    let remainingExtra = Math.max(0, +extra || 0);
    let payments = [...minimums];

    while (remainingExtra > 0.0001 && active.some((d) => d.balance > 0.0001)) {
      const idx = pickTargetIndex();
      if (idx < 0) break;
      const d = active[idx];
      const pay = Math.min(remainingExtra, d.balance);
      d.balance -= pay;
      payments[idx] += pay;
      remainingExtra -= pay;
    }

    // mark any paid‑off debts
    for (let i = 0; i < active.length; i++) {
      const d = active[i];
      if (d.balance <= 0.0001 && payoff[i].payoffMonthIndex == null) {
        payoff[i].payoffMonthIndex = monthIndex;
        payoff[i].payoffDate = monthAdd(today, monthIndex + 1); // end of the month
      }
    }

    // total remaining
    const totalRemain = active.reduce((s, d) => s + Math.max(0, d.balance), 0);

    // accumulate interest for each debt for reporting
    for (let i = 0; i < active.length; i++) payoff[i].interestPaid += 0; // placeholder (already accounted globally)

    timeline.push({ monthIndex, totalBalance: totalRemain, interestPaid: monthInterest });

    const row = {
      monthIndex,
      date: monthAdd(today, monthIndex + 1),
      payments,
      remaining: active.map((d) => Math.max(0, d.balance)),
      interest: monthInterest,
      totalRemaining: totalRemain,
    };
    plan.push(row);

    monthIndex++;
    if (totalRemain <= 0.01) break;
  }

  const totalInterest = timeline.reduce((s, t) => s + t.interestPaid, 0);

  return { months: monthIndex, totalStart, timeline, totalInterest, payoff, plan };
}

function onlyMinimumsPlan(debts) {
  // simulate with zero extra to calculate baseline interest and timeline
  return simulatePlan(debts, 0, "avalanche");
}

function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-2xl p-4 bg-white shadow-sm border border-slate-200 flex items-center gap-3">
      <div className="p-2 rounded-xl bg-slate-100"><Icon className="w-5 h-5" /></div>
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-lg font-semibold">{value}</div>
        {sub && <div className="text-xs text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

function Card({ title, children, right }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-semibold">{title}</h3>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function App() {
  const [state, setState] = usePersistentState({
    debts: exampleDebts,
    income: 5200,
    extra: 400,
    strategy: "avalanche", // or "snowball"
    whatIfExtra: 400,
  });

  const totalMinimum = useMemo(() => state.debts.reduce((s, d) => s + (+d.min || 0), 0), [state.debts]);
  const baseline = useMemo(() => onlyMinimumsPlan(state.debts), [state.debts]);
  const plan = useMemo(() => simulatePlan(state.debts, state.whatIfExtra, state.strategy), [state.debts, state.whatIfExtra, state.strategy]);

  const totalPrincipal = state.debts.reduce((s, d) => s + (+d.balance || 0), 0);
  const paidPrincipal = totalPrincipal - (plan.timeline.at(-1)?.totalBalance ?? totalPrincipal);
  const progress = totalPrincipal ? clamp(paidPrincipal / totalPrincipal, 0, 1) : 0;

  const interestSaved = Math.max(0, baseline.totalInterest - plan.totalInterest);
  const payoffDate = monthAdd(new Date(), plan.months);

  const milestones = [0.25, 0.5, 0.75, 1].map((m) => ({ label: `${pct(m, 0)} paid`, hit: progress >= m }));

  // gamified streak: consecutive months with extra >= 1% of principal
  const streak = useMemo(() => {
    const threshold = Math.max(25, totalPrincipal * 0.01);
    let s = 0;
    for (let i = 0; i < plan.plan.length; i++) {
      const extraThisMonth = plan.plan[i].payments.reduce((sum, p, idx) => sum + p - (state.debts[idx]?.min || 0), 0);
      if (extraThisMonth >= threshold) s += 1; else s = 0;
    }
    return s;
  }, [plan.plan, state.debts, totalPrincipal]);

  const resetAll = () => setState({ debts: [structuredClone(EMPTY_DEBT)], income: 0, extra: 0, whatIfExtra: 0, strategy: "avalanche" });

  useEffect(() => {
    if (!state.debts.length) setState((s) => ({ ...s, debts: [structuredClone(EMPTY_DEBT)] }));
  }, [state.debts, setState]);

  const addDebt = () => setState((s) => ({ ...s, debts: [...s.debts, { ...structuredClone(EMPTY_DEBT), id: crypto.randomUUID() }] }));
  const removeDebt = (id) => setState((s) => ({ ...s, debts: s.debts.filter((d) => d.id !== id) }));
  const updateDebt = (id, patch) => setState((s) => ({ ...s, debts: s.debts.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));

  // Ensure IDs exist
  useEffect(() => {
    setState((s) => ({
      ...s,
      debts: s.debts.map((d) => ({ ...d, id: d.id || crypto.randomUUID() })),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthlyBudget = totalMinimum + (state.extra || 0);

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="px-6 py-4 flex items-center justify-between border-b bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          <h1 className="text-lg font-semibold">Debt‑Payoff Coach</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 flex items-center gap-2" onClick={() => localStorage.setItem(STORAGE_KEY, JSON.stringify(state))}>
            <Save className="w-4 h-4"/> Save
          </button>
          <button className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 flex items-center gap-2" onClick={resetAll}>
            <RotateCcw className="w-4 h-4"/> Reset
          </button>
        </div>
      </header>

      <main className="p-6 grid gap-6 lg:grid-cols-3">
        {/* LEFT: Inputs */}
        <section className="lg:col-span-1 space-y-6">
          <Card title="Your Details" right={
            <div className="text-xs text-slate-500">Autosaves locally</div>
          }>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-500">Monthly Income
                <input type="number" className="mt-1 w-full rounded-xl border p-2" value={state.income}
                  onChange={(e) => setState({ ...state, income: +e.target.value })} />
              </label>
              <label className="text-xs text-slate-500">Extra Toward Debt (base)
                <input type="number" className="mt-1 w-full rounded-xl border p-2" value={state.extra}
                  onChange={(e) => setState({ ...state, extra: +e.target.value, whatIfExtra: +e.target.value })} />
              </label>
              <label className="text-xs text-slate-500 col-span-2">Strategy</label>
              <div className="col-span-2 flex gap-2">
                {[
                  { id: "avalanche", label: "Avalanche (highest APR)" },
                  { id: "snowball", label: "Snowball (smallest balance)" },
                ].map((s) => (
                  <button key={s.id} onClick={() => setState({ ...state, strategy: s.id })}
                          className={`px-3 py-2 rounded-xl border ${state.strategy === s.id ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Debts">
            <div className="space-y-3">
              {state.debts.map((d, idx) => (
                <div key={d.id} className="grid grid-cols-12 gap-2 items-end bg-slate-50 p-3 rounded-xl border">
                  <div className="col-span-4">
                    <label className="text-xs text-slate-500">Name
                      <input className="mt-1 w-full rounded-xl border p-2" value={d.name}
                             onChange={(e) => updateDebt(d.id, { name: e.target.value })} />
                    </label>
                  </div>
                  <div className="col-span-3">
                    <label className="text-xs text-slate-500">Balance
                      <input type="number" className="mt-1 w-full rounded-xl border p-2" value={d.balance}
                             onChange={(e) => updateDebt(d.id, { balance: +e.target.value })} />
                    </label>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-500">APR %
                      <input type="number" step="0.01" className="mt-1 w-full rounded-xl border p-2" value={d.apr}
                             onChange={(e) => updateDebt(d.id, { apr: +e.target.value })} />
                    </label>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-500">Minimum
                      <input type="number" className="mt-1 w-full rounded-xl border p-2" value={d.min}
                             onChange={(e) => updateDebt(d.id, { min: +e.target.value })} />
                    </label>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={() => removeDebt(d.id)} className="p-2 rounded-lg border bg-white hover:bg-slate-50" title="Remove"><Trash2 className="w-4 h-4"/></button>
                  </div>
                </div>
              ))}
              <button onClick={addDebt} className="w-full py-2 rounded-xl border bg-white hover:bg-slate-50 flex items-center justify-center gap-2">
                <Plus className="w-4 h-4"/> Add another debt
              </button>
            </div>
          </Card>

          <Card title="What‑If Calculator" right={<div className="text-xs">Try different extra amounts</div>}>
            <div>
              <input type="range" min={0} max={Math.max(0, state.extra * 3 || 1000)} value={state.whatIfExtra} onChange={(e) => setState({ ...state, whatIfExtra: +e.target.value })} className="w-full"/>
              <div className="flex items-center justify-between text-sm text-slate-600 mt-2">
                <span>Extra: <b>{currency(state.whatIfExtra)}</b> / mo</span>
                <span>Total Monthly Budget: <b>{currency(totalMinimum + state.whatIfExtra)}</b></span>
              </div>
            </div>
          </Card>
        </section>

        {/* RIGHT: Analytics */}
        <section className="lg:col-span-2 space-y-6">
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
            <Stat icon={Calendar} label="Debt‑free in" value={`${plan.months} months`} sub={`~ ${payoffDate.toLocaleString(undefined, { month: 'short', year: 'numeric' })}`}/>
            <Stat icon={TrendingDown} label="Interest (plan)" value={currency(plan.totalInterest)} sub={`${currency(interestSaved)} saved vs. minimums`}/>
            <Stat icon={PiggyBank} label="Minimums / mo" value={currency(totalMinimum)} sub={`Budget now: ${currency(monthlyBudget)}`}/>
            <Stat icon={Gauge} label="Progress" value={pct(progress, 0)} sub={`${currency(paidPrincipal)} paid of ${currency(totalPrincipal)}`}/>
          </div>

          <Card title="Payoff Timeline">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={plan.timeline.map((t) => ({ month: t.monthIndex + 1, balance: t.totalBalance }))}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month"/>
                  <YAxis tickFormatter={(v) => (v/1000).toFixed(0) + 'k'} />
                  <Tooltip formatter={(v) => currency(v)} labelFormatter={(l) => `Month ${l}`}/>
                  <Area type="monotone" dataKey="balance" stroke="#0ea5e9" fillOpacity={1} fill="url(#g1)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Payoff Order & Dates">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2">Debt</th>
                    <th>Start Balance</th>
                    <th>APR</th>
                    <th>Minimum</th>
                    <th>Payoff Date</th>
                  </tr>
                </thead>
                <tbody>
                  {state.debts
                    .map((d, i) => ({
                      ...d,
                      payoffDate: plan.plan.length ? plan.plan[plan.plan.findLastIndex((r) => r.remaining[i] <= 0)]?.date : null,
                    }))
                    .sort((a, b) => (a.payoffDate?.getTime() || 0) - (b.payoffDate?.getTime() || 0))
                    .map((d) => (
                    <tr key={d.id} className="border-t">
                      <td className="py-2 font-medium">{d.name || "(unnamed)"}</td>
                      <td>{currency(+d.balance || 0)}</td>
                      <td>{(+d.apr || 0).toFixed(2)}%</td>
                      <td>{currency(+d.min || 0)}</td>
                      <td>{d.payoffDate ? d.payoffDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            <Card title="Interest by Month (Plan)">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={plan.timeline.map((t) => ({ month: t.monthIndex + 1, interest: t.interestPaid }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month"/>
                    <YAxis tickFormatter={(v) => (v/100).toFixed(0)}/>
                    <Tooltip formatter={(v) => currency(v)} labelFormatter={(l) => `Month ${l}`}/>
                    <Bar dataKey="interest" fill="#818cf8" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Gamification: Streaks & Milestones">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Target className="w-4 h-4"/>
                  <div><b>Extra‑payment streak:</b> {streak} month{streak === 1 ? "" : "s"} in a row</div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {milestones.map((m, i) => (
                    <div key={i} className={`rounded-xl p-3 border text-center ${m.hit ? "bg-emerald-50 border-emerald-200" : "bg-slate-50"}`}>
                      <div className="text-xs text-slate-500">Milestone</div>
                      <div className="font-semibold">{m.label}</div>
                      <div className={`text-xs mt-1 ${m.hit ? "text-emerald-600" : "text-slate-400"}`}>{m.hit ? "Unlocked" : "Locked"}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </section>
      </main>

      <footer className="p-6 text-xs text-center text-slate-500">
        This tool provides educational estimates — always verify numbers with your lenders.
      </footer>
    </div>
  );
}
