"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChartIcon, GameNav, Intro, MemeBackdrop, Modal, SoundIcon, burstConfetti, reducedMotion } from "./Game";
import { MemeImages, MemeMood } from "@/lib/memes";
import { isMuted, setMuted, sfx } from "@/lib/sound";
import { playerSeed } from "@/lib/storage";
import { HUNCH_CATS, HUNCH_LABEL, HUNCH_PER_ROUND, HunchMode, formatNum, parseGuess } from "@/lib/hunch-rules";
import {
  HAnswer,
  HRecord,
  currentRound,
  loadMode,
  loadRecord,
  loadStats,
  recordRound,
  saveMode,
  saveRecord,
  setCurrentRound,
} from "@/lib/hunch-storage";

type Question = { q: string; unit: string; cat: string };
type HModal = null | "help" | "stats";

const COUNT_MS = 1300; // answer count-up
/** Years, ports, status codes and RFC numbers read wrong with separators ("1,912"), so print them plain. */
const fmtFor = (a: Pick<HAnswer, "kind" | "answer">) => (n: number) =>
  a.kind === "lin" && Number.isInteger(a.answer) && Math.abs(a.answer) >= 1000 ? String(Math.round(n)) : formatNum(n);
const tier = (s: number) => (s >= 90 ? "found" : s >= 70 ? "hot" : s >= 45 ? "warm" : s >= 20 ? "cool" : "cold");
const verdict = (s: number) =>
  s >= 95 ? "Bullseye!" : s >= 80 ? "So close!" : s >= 60 ? "Nice hunch" : s >= 40 ? "Not bad" : s >= 20 ? "Way off" : "Not even close";
const moodFor = (s: number): MemeMood => (s >= 95 ? "found" : s >= 80 ? "near" : s >= 60 ? "hot" : s >= 40 ? "warm" : s >= 20 ? "cool" : "cold");

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/hunch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, seed: playerSeed() }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "network");
  return json as T;
}

/** Animated number that eases from `from` to `to` once `run` turns true. */
function useTween(to: number, run: boolean, ms: number, from = 0) {
  const [v, setV] = useState(run && reducedMotion() ? to : from);
  useEffect(() => {
    if (!run) {
      setV(from);
      return;
    }
    if (reducedMotion()) {
      setV(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 4);
      setV(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, run, ms, from]);
  return v;
}

export default function Hunch({ counts, memeImages = {} }: { counts: Record<HunchMode, number>; memeImages?: MemeImages }) {
  const [mode, setMode] = useState<HunchMode | null>(null);
  const [rec, setRec] = useState<HRecord | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<HAnswer | null>(null); // the answer being revealed for the current question
  const [step, setStep] = useState(0); // reveal stage: 1 counting, 2 landed, 3 scored
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<HModal>(null);
  const [muted, setMutedState] = useState(false);
  const [intro, setIntro] = useState<"on" | "leaving" | "off">("on");
  const [mood, setMood] = useState<{ mood: MemeMood; turn: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef(0);
  const timers = useRef<number[]>([]);

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => {
    setMode(loadMode());
    setMutedState(isMuted());
    try {
      if (!window.localStorage.getItem("kindred:hunch:v1:seen-help")) {
        setModal("help");
        window.localStorage.setItem("kindred:hunch:v1:seen-help", "1");
      }
    } catch {}
    return clearTimers;
  }, []);

  useEffect(() => {
    if (intro !== "on") return;
    const t = window.setTimeout(() => setIntro("leaving"), reducedMotion() ? 0 : 1700);
    return () => window.clearTimeout(t);
  }, [intro]);
  useEffect(() => {
    if (intro !== "leaving") return;
    const t = window.setTimeout(() => setIntro("off"), reducedMotion() ? 0 : 650);
    return () => window.clearTimeout(t);
  }, [intro]);

  const loadRound = useCallback(
    (m: HunchMode, round: number) => {
      clearTimers();
      const r = loadRecord(m, round % counts[m]);
      setRec(r);
      setReveal(null);
      setStep(0);
      setInput("");
      setMood(null);
      setQuestions(null);
      post<{ questions: Question[] }>({ action: "round", mode: m, round: r.round })
        .then((res) => setQuestions(res.questions))
        .catch(() => flash("Couldn't load questions. Refresh to try again."));
    },
    [counts],
  );

  useEffect(() => {
    if (mode) loadRound(mode, currentRound(mode));
  }, [mode, loadRound]);

  const flash = (msg: string, ms = 1700) => {
    window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  };

  const index = rec ? rec.answers.length - (reveal ? 1 : 0) : 0; // question on screen
  const done = !!rec && rec.answers.length >= HUNCH_PER_ROUND && !reveal;
  const asking = !!rec && !!questions && !reveal && !done;

  useEffect(() => {
    if (asking && intro === "off" && !modal) inputRef.current?.focus({ preventScroll: true });
  }, [asking, intro, modal, index]);

  function shake() {
    sfx.error();
    if (reducedMotion()) return;
    cardRef.current?.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-9px)" },
        { transform: "translateX(8px)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 380, easing: "ease-out" },
    );
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!rec || !mode || !asking || busy) return;
    const g = parseGuess(input);
    if (g === null) {
      flash("Type a number — like 1500, 2.5k or 3m");
      shake();
      return;
    }
    setBusy(true);
    try {
      const res = await post<Omit<HAnswer, "guess">>({ mode, round: rec.round, index: rec.answers.length, guess: g });
      const ans: HAnswer = { ...res, guess: g };
      const next = { ...rec, answers: [...rec.answers, ans] };
      saveRecord(next);
      if (next.answers.length === HUNCH_PER_ROUND) recordRound(next);
      setRec(next);
      setReveal(ans);
      setInput("");
      // reveal sequence: drumroll while the answer counts up → markers land → score
      const rm = reducedMotion();
      setStep(1);
      sfx.charge(rm ? 0 : COUNT_MS - 150);
      later(() => {
        setStep(2);
        sfx.flip(ans.score >= 45 ? 2 : ans.score >= 20 ? 1 : 0, 2);
      }, rm ? 0 : COUNT_MS);
      later(() => {
        setStep(3);
        setMood({ mood: moodFor(ans.score), turn: next.answers.length });
        if (ans.score >= 95) {
          sfx.win();
          burstConfetti();
        } else if (ans.score >= 60) sfx.hint();
        else if (ans.score >= 20) sfx.guess(ans.score / 100);
        else sfx.lose();
      }, rm ? 0 : COUNT_MS + 650);
    } catch {
      flash("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function nextQuestion() {
    if (!rec) return;
    clearTimers();
    sfx.swoosh();
    setReveal(null);
    setStep(0);
    if (rec.answers.length >= HUNCH_PER_ROUND) {
      const total = rec.answers.reduce((t, a) => t + a.score, 0);
      if (total >= 400 && !reducedMotion()) window.setTimeout(burstConfetti, 400);
      window.setTimeout(() => (total >= 300 ? sfx.win() : sfx.guess(total / 500)), 300);
    }
  }

  function nextRound() {
    if (!rec || !mode) return;
    const r = (rec.round + 1) % counts[mode];
    setCurrentRound(mode, r);
    sfx.swoosh();
    loadRound(mode, r);
  }

  function changeMode(m: HunchMode) {
    if (m === mode || busy) return;
    sfx.swoosh();
    saveMode(m);
    setMode(m);
  }

  function appendSuffix(sfxText: string) {
    sfx.tap();
    setInput((v) => v.replace(/[kmbt]$/i, "") + sfxText);
    inputRef.current?.focus();
  }
  function toggleSign() {
    sfx.tap();
    setInput((v) => (v.startsWith("-") ? v.slice(1) : "-" + v));
    inputRef.current?.focus();
  }

  async function share() {
    if (!rec || !mode) return;
    const total = rec.answers.reduce((t, a) => t + a.score, 0);
    const sq = (s: number) => (s >= 90 ? "🟩" : s >= 70 ? "🟨" : s >= 45 ? "🟧" : s >= 20 ? "🟪" : "🟥");
    const text = `Hunch · ${HUNCH_LABEL[mode]} #${rec.round + 1} — ${total}/500\n${rec.answers.map((a) => sq(a.score)).join("")}\n${window.location.origin}/hunch`;
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        flash("Copied to clipboard");
      }
    } catch {
      flash("Couldn't copy");
    }
  }

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    setMutedState(m);
    if (!m) sfx.tap();
  };
  const openModal = (m: HModal) => {
    sfx.open();
    setModal(m);
  };
  const closeModal = () => {
    sfx.close();
    setModal(null);
  };

  const splash = intro !== "off" && (
    <Intro
      word="hunch"
      accentFrom={2}
      tagline="trust your gut. guess the number."
      leaving={intro === "leaving"}
      onSkip={() => setIntro((s) => (s === "on" ? "leaving" : s))}
    />
  );
  if (!mode || !rec) {
    return (
      <main className="shell" aria-busy="true">
        {splash}
      </main>
    );
  }

  const parsed = parseGuess(input);
  const showPreview = parsed !== null && /[a-z]/i.test(input);
  const total = rec.answers.reduce((t, a) => t + a.score, 0);
  const q = questions?.[index];

  return (
    <main className="shell hunch">
      {splash}
      <MemeBackdrop mood={mood?.mood ?? null} turn={mood?.turn ?? 0} images={memeImages} />
      <header className={`top${intro === "off" ? " in" : ""}`}>
        <div className="actions left">
          <button className="icon" aria-label="How to play" onClick={() => openModal("help")}>
            ?
          </button>
          <button className="icon" aria-label={muted ? "Unmute sounds" : "Mute sounds"} onClick={toggleMute}>
            <SoundIcon muted={muted} />
          </button>
        </div>
        <div className="brand">
          <h1>
            hu<span>nch</span>
          </h1>
          <p className="sub">
            Round <span key={`${mode}-${rec.round}`} className="num-swap">#{rec.round + 1}</span>{" "}
            <span className="of">of {counts[mode]}</span>
          </p>
          <GameNav current="hunch" />
        </div>
        <div className="actions">
          <button className="icon" aria-label="Statistics" onClick={() => openModal("stats")}>
            <ChartIcon />
          </button>
        </div>
      </header>

      <div className="w-controls">
        <div className="seg wide" role="radiogroup" aria-label="Category" style={{ "--n": HUNCH_CATS.length, "--i": HUNCH_CATS.indexOf(mode) } as React.CSSProperties}>
          <span className="seg-pill" aria-hidden />
          {HUNCH_CATS.map((m) => (
            <button key={m} role="radio" aria-checked={m === mode} className={m === mode ? "on" : ""} onClick={() => changeMode(m)}>
              {HUNCH_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="h-progress" aria-label={`Question ${Math.min(index + 1, HUNCH_PER_ROUND)} of ${HUNCH_PER_ROUND}`}>
        {Array.from({ length: HUNCH_PER_ROUND }, (_, i) => {
          const a = rec.answers[i];
          const shown = a && (i < index || step >= 3 || done);
          return (
            <span key={i} className={`h-dot${shown ? ` t-${tier(a.score)} on` : ""}${i === index && !done ? " cur" : ""}`}>
              {shown ? a.score : ""}
            </span>
          );
        })}
        <span className="h-total">
          <b>{rec.answers.slice(0, done ? undefined : index).reduce((t, a) => t + a.score, 0) + (reveal && step >= 3 ? reveal.score : 0)}</b> pts
        </span>
      </div>

      <div className="stage" key={`${mode}-${rec.round}`}>
        {!done && (
          <div className="h-card" ref={cardRef} key={index}>
            <p className="h-qnum">
              Question {index + 1} of {HUNCH_PER_ROUND}
              {q && mode === "mixed" && <span className={`h-chip c-${q.cat}`}>{HUNCH_LABEL[q.cat as HunchMode]}</span>}
            </p>
            <h2 className="h-q">{q ? q.q : <span className="h-skel" />}</h2>

            {!reveal ? (
              <form className="h-form" onSubmit={submit}>
                <div className="entry h-entry">
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value.replace(/[^0-9.,\-kmbtKMBT ]/g, ""))}
                    placeholder="your guess"
                    inputMode="decimal"
                    autoComplete="off"
                    enterKeyHint="go"
                    aria-label="Your guess"
                    readOnly={busy}
                  />
                  {q?.unit && <span className="h-unit">{q.unit}</span>}
                  <button type="submit" disabled={busy || !input.trim() || !q} aria-label="Lock in guess">
                    {busy ? <span className="spin" /> : "↵"}
                  </button>
                </div>
                <div className="h-tools">
                  <button type="button" className="link" onClick={toggleSign}>
                    ±
                  </button>
                  <button type="button" className="link" onClick={() => appendSuffix("k")}>
                    ×1K
                  </button>
                  <button type="button" className="link" onClick={() => appendSuffix("m")}>
                    ×1M
                  </button>
                  <button type="button" className="link" onClick={() => appendSuffix("b")}>
                    ×1B
                  </button>
                  <span className="h-preview">{showPreview ? `= ${formatNum(parsed!)}` : " "}</span>
                </div>
              </form>
            ) : (
              <Reveal a={reveal} step={step} />
            )}

            {reveal && step >= 3 && (
              <button className="btn primary h-next" onClick={nextQuestion} autoFocus>
                {rec.answers.length >= HUNCH_PER_ROUND ? "See results →" : "Next question →"}
              </button>
            )}
          </div>
        )}

        {done && questions && (
          <Summary
            rec={rec}
            questions={questions}
            total={total}
            onNext={nextRound}
            onShare={share}
            onStats={() => openModal("stats")}
          />
        )}
      </div>

      {modal === "help" && <HunchHelp onClose={closeModal} />}
      {modal === "stats" && <HunchStats onClose={closeModal} />}
      {toast && (
        <div className="toast" key={toast}>
          {toast}
        </div>
      )}
      <canvas className="confetti" aria-hidden />
    </main>
  );
}

/** The suspense part: answer counts up, both markers drop onto the scale, then the score ring fills. */
function Reveal({ a, step }: { a: HAnswer; step: number }) {
  const shown = useTween(a.answer, step >= 1, COUNT_MS, a.kind === "lin" && Math.abs(a.answer) > 1000 ? a.answer - (a.tol ?? 10) * 6 : 0);
  const sc = useTween(a.score, step >= 3, 900);
  const t = tier(a.score);
  const fmt = fmtFor(a);
  const decimals = (String(a.answer).split(".")[1] ?? "").length; // count up in the answer's own precision

  // place both values on a scale (log for quantities, linear for years etc.)
  const { pg, pa } = (() => {
    if (a.kind === "lin" || a.guess <= 0 || a.answer <= 0) {
      const span = Math.max(Math.abs(a.guess - a.answer) * 1.6, (a.tol ?? 1) * 3);
      const mid = (a.guess + a.answer) / 2;
      const f = (x: number) => (x - (mid - span)) / (2 * span);
      return { pg: f(a.guess), pa: f(a.answer) };
    }
    const lo = Math.log(Math.min(a.guess, a.answer) / 3);
    const hi = Math.log(Math.max(a.guess, a.answer) * 3);
    const f = (x: number) => (Math.log(x) - lo) / (hi - lo);
    return { pg: f(a.guess), pa: f(a.answer) };
  })();
  const left = Math.min(pg, pa) * 100;
  const width = Math.abs(pg - pa) * 100;
  const off = a.answer !== 0 ? a.guess / a.answer : 0;
  const offText =
    a.kind === "lin"
      ? `${a.guess === a.answer ? "exactly right" : `off by ${formatNum(Math.abs(a.guess - a.answer))}`}`
      : off >= 1
        ? `${off < 1.005 ? "exactly right" : `${formatNum(off)}× too high`}`
        : `${off > 0.995 ? "exactly right" : `${formatNum(1 / off)}× too low`}`;

  return (
    <div className={`h-reveal t-${t}${step >= 3 ? " scored" : ""}`}>
      <div className="h-nums">
        <div className="h-num">
          <span className="h-lbl">You said</span>
          <b>{fmt(a.guess)}</b>
        </div>
        <div className={`h-num ans${step >= 2 ? " landed" : ""}`}>
          <span className="h-lbl">Answer</span>
          <b>
            {fmt(step >= 2 ? a.answer : Number(shown.toFixed(decimals)))}
            {a.unit && <small> {a.unit}</small>}
          </b>
        </div>
      </div>

      <div className="h-scale" aria-hidden>
        <div className="h-track" />
        <div className={`h-gap${step >= 2 ? " on" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} />
        <span className="h-pin you" style={{ left: `${pg * 100}%` }}>
          <i />
          you
        </span>
        <span className={`h-pin ans${step >= 2 ? " on" : ""}`} style={{ left: `${pa * 100}%` }}>
          <i />
          answer
        </span>
      </div>

      <div className={`h-score${step >= 3 ? " on" : ""}`}>
        <svg viewBox="0 0 80 80" className="h-ring" aria-hidden>
          <circle cx="40" cy="40" r="34" className="bg" />
          <circle cx="40" cy="40" r="34" className="fg" style={{ strokeDashoffset: 213.6 * (1 - sc / 100) }} />
        </svg>
        <div className="h-score-txt">
          <b>{Math.round(sc)}</b>
          <span>pts</span>
        </div>
        <div className="h-verdict">
          <p className="h-v">{step >= 3 ? verdict(a.score) : "…"}</p>
          <p className="muted">{step >= 3 ? offText : " "}</p>
        </div>
      </div>
      <p className={`h-fact${step >= 3 ? " on" : ""}`}>💡 {a.fact}</p>
    </div>
  );
}

function Summary(props: {
  rec: HRecord;
  questions: Question[];
  total: number;
  onNext: () => void;
  onShare: () => void;
  onStats: () => void;
}) {
  const shown = useTween(props.total, true, 1200);
  const head =
    props.total >= 450 ? "Human calculator" : props.total >= 350 ? "Sharp instincts" : props.total >= 250 ? "Solid gut" : props.total >= 150 ? "Getting there" : "Trust issues with your gut";
  return (
    <section className="result h-summary">
      <p className="eyebrow">{head}</p>
      <p className="answer h-big">
        {Math.round(shown)}
        <small>/500</small>
      </p>
      <ol className="h-list">
        {props.rec.answers.map((a, i) => (
          <li key={i} className={`t-${tier(a.score)}`} style={{ animationDelay: `${200 + i * 90}ms` }}>
            <p className="h-lq">{props.questions[i]?.q}</p>
            <p className="h-la">
              you <b>{fmtFor(a)(a.guess)}</b> · answer <b>{fmtFor(a)(a.answer)}</b>
              {a.unit ? ` ${a.unit}` : ""}
            </p>
            <span className="h-lbar">
              <span style={{ width: `${a.score}%`, animationDelay: `${300 + i * 90}ms` }} />
            </span>
            <span className="h-ls">{a.score}</span>
          </li>
        ))}
      </ol>
      <div className="result-actions">
        <button className="btn primary" onClick={props.onNext} autoFocus>
          Next round →
        </button>
        <button className="btn" onClick={props.onShare}>
          Share
        </button>
        <button className="btn" onClick={props.onStats}>
          Stats
        </button>
      </div>
    </section>
  );
}

function HunchHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <div className="help">
        <p>
          Each round has <b>{HUNCH_PER_ROUND} questions</b> with a number for an answer. Trust your gut and guess — the closer
          you are, the more points you get, up to <b>100</b> per question.
        </p>
        <p>
          Big numbers are scored by <b>ratio</b>: guessing 2,000 when it&apos;s 1,000 costs the same as guessing 2 million
          when it&apos;s 1 million. Years and small counts are scored by how far off you are.
        </p>
        <p className="muted">
          Shortcuts: type <b>2.5k</b>, <b>3m</b> or <b>1.2b</b>, or tap ×1K / ×1M / ×1B. Pick <b>World</b>, <b>Nepal</b>,{" "}
          <b>Tech</b> or <b>Mixed</b> questions.
        </p>
      </div>
    </Modal>
  );
}

function HunchStats({ onClose }: { onClose: () => void }) {
  const s = loadStats();
  return (
    <Modal title="Statistics" onClose={onClose}>
      <div className="stat-grid four">
        <div className="stat">
          <b>{s.rounds}</b>
          <span>Rounds</span>
        </div>
        <div className="stat">
          <b>{s.rounds ? Math.round(s.total / s.rounds) : 0}</b>
          <span>Avg / 500</span>
        </div>
        <div className="stat">
          <b>{s.best}</b>
          <span>Best round</span>
        </div>
        <div className="stat">
          <b>{s.bullseyes}</b>
          <span>Bullseyes</span>
        </div>
      </div>
    </Modal>
  );
}
