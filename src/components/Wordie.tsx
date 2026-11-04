"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartIcon, GameNav, Intro, MemeBackdrop, Modal, SoundIcon, burstConfetti, reducedMotion } from "./Game";
import { MemeImages, MemeMood } from "@/lib/memes";
import { isDirty } from "@/lib/puzzle";
import { isMuted, setMuted, sfx } from "@/lib/sound";
import { playerSeed } from "@/lib/storage";
import { WORDIE_LENGTHS, WORDIE_MAX_GUESSES, hardModeError } from "@/lib/wordie-rules";
import {
  WRecord,
  WRow,
  currentId,
  loadRecord,
  loadSettings,
  loadStats,
  recordResult,
  saveRecord,
  saveSettings,
  setCurrentId,
} from "@/lib/wordie-storage";

const FLIP_STAGGER = 300; // ms between tiles flipping
const FLIP_TIME = 600; // ms for one tile flip (lift + turn)
const LAND_TIME = 450; // ms for the post-flip "landing" (glow burst / wobble / sink)
const CHARGE_TIME = 560; // ms of anticipation before the first tile turns
const HOLD_TIME = 650; // extra dramatic pause before the last tile when the row is nearly solved

/** When each tile of a guess row flips (ms from submit), plus whether the last tile is held back. */
function revealPlan(result: number[]) {
  const rm = reducedMotion();
  const n = result.length;
  const greensBeforeLast = result.slice(0, -1).filter((v) => v === 2).length;
  const hold = !rm && n > 1 && greensBeforeLast >= n - 2;
  const delays: number[] = [];
  let t = rm ? 0 : CHARGE_TIME;
  for (let i = 0; i < n; i++) {
    if (i === n - 1 && hold) t += HOLD_TIME;
    delays.push(t);
    t += rm ? 0 : FLIP_STAGGER;
  }
  return { delays, hold, total: delays[n - 1] + (rm ? 0 : FLIP_TIME + LAND_TIME) + 60 };
}
const PRAISE = ["Unreal!", "Brilliant!", "Sharp!", "Nicely done", "Solid", "Phew!"];
const ERRORS: Record<string, string> = {
  NOT_WORD: "Not in the word list",
  INVALID: "Letters only",
  BAD_LENGTH: "Not enough letters",
  NETWORK: "Something went wrong. Try again.",
};

type WModal = null | "help" | "stats" | "confirm-giveup";

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/wordie", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, seed: playerSeed() }),
  });
  const json = await res.json();
  if (!res.ok && !json.error) throw new Error("network");
  return json as T;
}

/** How the backdrop meme should react to a guess row. */
function rowMood(row: WRow, prev: WRow | undefined, len: number): MemeMood {
  const pts = (r: WRow) => r.result.reduce((s, v) => s + v, 0);
  const g = row.result.filter((v) => v === 2).length;
  const p = pts(row);
  if (prev && pts(prev) >= len && p <= 1) return "letdown";
  if (g >= len - 1) return "near";
  if (p >= len) return "hot";
  if (p >= Math.ceil(len * 0.6)) return "warm";
  if (p > 0) return "cool";
  return "cold";
}

export default function Wordie({ counts, memeImages = {} }: { counts: Record<number, number>; memeImages?: MemeImages }) {
  const [len, setLen] = useState<number | null>(null);
  const [hard, setHard] = useState(false);
  const [rec, setRec] = useState<WRecord | null>(null);
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealing, setRevealing] = useState<number | null>(null); // row index currently flipping
  const [plan, setPlan] = useState<ReturnType<typeof revealPlan> | null>(null);
  const [celebrate, setCelebrate] = useState(false); // win bounce on the solved row
  const [showResult, setShowResult] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<WModal>(null);
  const [muted, setMutedState] = useState(false);
  const [focused, setFocused] = useState(false);
  const [intro, setIntro] = useState<"on" | "leaving" | "off">("on");
  const [mood, setMood] = useState<{ mood: MemeMood; turn: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const toastTimer = useRef(0);

  // ----- boot -----
  useEffect(() => {
    const s = loadSettings();
    setHard(s.hard);
    setLen(s.len);
    setMutedState(isMuted());
    try {
      if (!window.localStorage.getItem("kindred:wordie:v1:seen-help")) {
        setModal("help");
        window.localStorage.setItem("kindred:wordie:v1:seen-help", "1");
      }
    } catch {}
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

  // load the puzzle for the chosen length
  useEffect(() => {
    if (len === null) return;
    const r = loadRecord(len, currentId(len) % counts[len]);
    setRec(r);
    setCurrent("");
    setRevealing(null);
    setCelebrate(false);
    setShowResult(r.status !== "playing");
    setMood(null);
    if (r.status !== "playing" && !r.answer) {
      post<{ word: string }>({ action: "reveal", len, id: r.id }).then((res) => {
        const withAnswer = { ...r, answer: res.word };
        saveRecord(withAnswer);
        setRec(withAnswer);
      }).catch(() => {});
    }
  }, [len, counts]);

  const flash = useCallback((msg: string, ms = 1600) => {
    window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  const shakeRow = (i: number) => {
    sfx.error();
    if (reducedMotion()) return;
    rowRefs.current[i]?.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-9px)" },
        { transform: "translateX(8px)" },
        { transform: "translateX(-6px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 400, easing: "ease-out" },
    );
  };

  const focusInput = () => inputRef.current?.focus({ preventScroll: true });

  const playing = !!rec && rec.status === "playing" && revealing === null;

  async function submit() {
    if (!rec || !len || !playing || busy) return;
    const row = rec.rows.length;
    if (current.length < len) {
      flash(ERRORS.BAD_LENGTH);
      shakeRow(row);
      return;
    }
    if (hard) {
      const err = hardModeError(current, rec.rows);
      if (err) {
        flash(err);
        shakeRow(row);
        return;
      }
    }
    setBusy(true);
    try {
      const res = await post<{ result: number[] } | { error: string }>({ len, id: rec.id, word: current });
      if ("error" in res) {
        flash(ERRORS[res.error] ?? ERRORS.NETWORK);
        shakeRow(row);
        return;
      }
      const guess = current;
      const rows = [...rec.rows, { word: guess, result: res.result }];
      const won = res.result.every((v) => v === 2);
      const lost = !won && rows.length >= WORDIE_MAX_GUESSES;
      const next: WRecord = { ...rec, rows, status: won ? "won" : lost ? "lost" : "playing", hard, answer: won ? guess : undefined };
      saveRecord(next);
      setRec(next);
      setCurrent("");
      const p = revealPlan(res.result);
      setPlan(p);
      setRevealing(row);
      if (won || lost) recordResult(len, won, rows.length);

      // tile-by-tile flip sounds, then the outcome
      // charge-up drumroll, a tense tick while the last tile is held, then one sound per tile
      sfx.charge(p.delays[0]);
      if (p.hold) window.setTimeout(() => sfx.tense(HOLD_TIME), p.delays[len - 1] - HOLD_TIME);
      res.result.forEach((s, i) => {
        window.setTimeout(() => sfx.flip(s, i), p.delays[i] + FLIP_TIME / 2);
        if (s === 2) window.setTimeout(() => sfx.sparkle(i), p.delays[i] + FLIP_TIME);
      });
      const done = p.total;
      window.setTimeout(async () => {
        setRevealing(null);
        if (won) {
          setCelebrate(true);
          setMood({ mood: "found", turn: rows.length });
          sfx.win();
          burstConfetti();
          flash(PRAISE[Math.min(rows.length, PRAISE.length) - 1], 2200);
          window.setTimeout(() => setShowResult(true), 900);
        } else if (lost) {
          setMood({ mood: "lost", turn: rows.length });
          sfx.lose();
          try {
            const r = await post<{ word: string }>({ action: "reveal", len, id: rec.id });
            const withAnswer = { ...next, answer: r.word };
            saveRecord(withAnswer);
            setRec(withAnswer);
          } catch {}
          window.setTimeout(() => setShowResult(true), 500);
        } else {
          const m = isDirty(guess) ? "dirty" : rowMood(rows[rows.length - 1], rows[rows.length - 2], len);
          setMood({ mood: m, turn: rows.length });
        }
      }, done);
    } catch {
      flash(ERRORS.NETWORK);
    } finally {
      setBusy(false);
    }
  }

  // physical keyboard anywhere on the page feeds the hidden input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.activeElement === inputRef.current) return; // the input handles it
      if (/^[a-zA-Z]$/.test(e.key) || e.key === "Backspace" || e.key === "Enter") {
        const target = e.target as HTMLElement;
        if (e.key === "Enter" && target.tagName === "BUTTON") return; // let buttons work
        e.preventDefault();
        focusInput();
        if (e.key === "Enter") void submit();
        else if (e.key === "Backspace") setCurrent((c) => c.slice(0, -1));
        else if (playing && len && current.length < len) {
          sfx.tap();
          setCurrent((c) => (c + e.key.toLowerCase()).slice(0, len));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // auto-focus once the intro is gone and a round is live (desktop; mobile needs a tap)
  useEffect(() => {
    if (intro === "off" && playing && !modal) focusInput();
  }, [intro, playing, modal]);

  function changeLen(n: number) {
    if (n === len || busy || revealing !== null) return;
    sfx.swoosh();
    saveSettings({ len: n, hard });
    setLen(n);
  }

  function toggleHard() {
    if (!rec || !len) return;
    const midRound = rec.status === "playing" && rec.rows.length > 0;
    if (!hard && midRound) {
      flash("Hard mode can only be turned on at the start of a round");
      return;
    }
    sfx.tap();
    saveSettings({ len, hard: !hard });
    setHard(!hard);
  }

  function nextWord() {
    if (!rec || !len) return;
    const id = (rec.id + 1) % counts[len];
    setCurrentId(len, id);
    sfx.swoosh();
    const r = loadRecord(len, id);
    setRec(r);
    setCurrent("");
    setCelebrate(false);
    setShowResult(r.status !== "playing");
    setMood(null);
  }

  function giveUp() {
    setModal(null);
    if (!rec || !len || rec.status !== "playing") return;
    const next: WRecord = { ...rec, status: "lost" };
    saveRecord(next);
    setRec(next);
    recordResult(len, false, rec.rows.length);
    sfx.lose();
    setMood({ mood: "lost", turn: rec.rows.length });
    post<{ word: string }>({ action: "reveal", len, id: rec.id })
      .then((r) => {
        const withAnswer = { ...next, answer: r.word };
        saveRecord(withAnswer);
        setRec(withAnswer);
      })
      .catch(() => {})
      .finally(() => setShowResult(true));
  }

  async function share() {
    if (!rec || !len) return;
    const head = `Wordie #${rec.id + 1} (${len} letters) ${rec.status === "won" ? rec.rows.length : "X"}/${WORDIE_MAX_GUESSES}${rec.hard ? "*" : ""}`;
    const grid = rec.rows.map((r) => r.result.map((v) => (v === 2 ? "🟩" : v === 1 ? "🟨" : "⬛")).join("")).join("\n");
    const text = `${head}\n${grid}\n${window.location.origin}/wordie`;
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

  const openModal = (m: WModal) => {
    sfx.open();
    setModal(m);
  };
  const closeModal = () => {
    sfx.close();
    setModal(null);
  };
  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    setMutedState(m);
    if (!m) sfx.tap();
  };

  const splash = intro !== "off" && (
    <Intro
      word="wordie"
      accentFrom={3}
      tagline="six tries. one word."
      leaving={intro === "leaving"}
      onSkip={() => setIntro((s) => (s === "on" ? "leaving" : s))}
    />
  );

  if (!rec || !len) {
    return (
      <main className="shell" aria-busy="true">
        {splash}
      </main>
    );
  }

  const over = rec.status !== "playing";
  const activeRow = rec.status === "playing" ? rec.rows.length : -1;

  return (
    <main className="shell wordie">
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
            wor<span>die</span>
          </h1>
          <p className="sub">
            Word <span key={`${len}-${rec.id}`} className="num-swap">#{rec.id + 1}</span>{" "}
            <span className="of">of {counts[len].toLocaleString()}</span>
          </p>
          <GameNav current="wordie" />
        </div>
        <div className="actions">
          <button className="icon" aria-label="Statistics" onClick={() => openModal("stats")}>
            <ChartIcon />
          </button>
        </div>
      </header>

      <div className="w-controls">
        <div className="seg" role="radiogroup" aria-label="Word length" style={{ "--n": WORDIE_LENGTHS.length, "--i": WORDIE_LENGTHS.indexOf(len) } as React.CSSProperties}>
          <span className="seg-pill" aria-hidden />
          {WORDIE_LENGTHS.map((n) => (
            <button key={n} role="radio" aria-checked={n === len} className={n === len ? "on" : ""} onClick={() => changeLen(n)}>
              {n}
            </button>
          ))}
        </div>
        <span className="seg-label">letters</span>
        <button className={`switch${hard ? " on" : ""}`} role="switch" aria-checked={hard} onClick={toggleHard}>
          <span className="switch-track">
            <span className="switch-thumb" />
          </span>
          Hard
        </button>
      </div>

      <div className="stage" key={`${len}-${rec.id}`}>
        <div
          className={`w-board${focused ? " focused" : ""}`}
          style={{ "--len": len } as React.CSSProperties}
          onClick={focusInput}
          role="grid"
          aria-label="Guesses"
        >
          {Array.from({ length: WORDIE_MAX_GUESSES }, (_, r) => {
            const row = rec.rows[r];
            const isActive = r === activeRow;
            const flipping = r === revealing;
            const won = celebrate && rec.status === "won" && r === rec.rows.length - 1;
            return (
              <div
                key={r}
                ref={(el) => {
                  rowRefs.current[r] = el;
                }}
                className={`w-row${flipping ? " flipping" : ""}${won ? " win" : ""}${
                  isActive && playing && current.length === len ? " ready" : ""
                }${isActive ? " active" : ""}`}
                style={flipping && plan ? ({ "--charge": `${plan.delays[0]}ms` } as React.CSSProperties) : undefined}
                role="row"
              >
                {Array.from({ length: len }, (_, c) => {
                  const ch = row ? row.word[c] : isActive ? current[c] : undefined;
                  const state = row ? row.result[c] : -1;
                  const caret = isActive && focused && c === current.length && playing;
                  return (
                    <div
                      key={c}
                      role="gridcell"
                      className={`tile${ch ? " filled" : ""}${state >= 0 ? ` s${state}` : ""}${caret ? " caret" : ""}${
                        flipping && plan?.hold && c === len - 1 ? " hold" : ""
                      }`}
                      style={{ "--d": `${flipping && plan ? plan.delays[c] : c * 90}ms` } as React.CSSProperties}
                    >
                      {ch && (
                        <span key={isActive ? `${c}-${ch}` : c} className="tile-ch">
                          {ch}
                        </span>
                      )}
                      {ch && isActive && <span key={`ring-${c}-${ch}`} className="tile-ring" aria-hidden />}
                    </div>
                  );
                })}
              </div>
            );
          })}
          <input
            ref={inputRef}
            className="w-input"
            value={current}
            onChange={(e) => {
              if (!playing) return;
              const v = e.target.value.toLowerCase().replace(/[^a-z]/g, "").slice(0, len);
              if (v.length > current.length) sfx.tap();
              else if (v.length < current.length) sfx.back();
              setCurrent(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-label="Type your guess"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="go"
            inputMode="text"
          />
        </div>

        {!over && (
          <div className="w-meta">
            <span>
              Guess <b>{Math.min(rec.rows.length + 1, WORDIE_MAX_GUESSES)}</b> / {WORDIE_MAX_GUESSES}
            </span>
            {!focused && (
              <span className="w-tap">
                <span className="touch-only">tap the board to type</span>
                <span className="mouse-only">just start typing</span>
              </span>
            )}
            <button className="link danger" disabled={busy || rec.rows.length === 0} onClick={() => openModal("confirm-giveup")}>
              Give up
            </button>
          </div>
        )}

        {over && showResult && (
          <section className={`result ${rec.status}`}>
            <p className="eyebrow">{rec.status === "won" ? PRAISE[Math.min(rec.rows.length, PRAISE.length) - 1] : "Out of tries"}</p>
            <p className="answer" aria-label={rec.answer}>
              {rec.answer
                ? [...rec.answer].map((ch, i) => (
                    <span key={i} style={{ animationDelay: `${120 + i * 55}ms` }} aria-hidden>
                      {ch}
                    </span>
                  ))
                : "…"}
            </p>
            <p className="muted">
              {rec.status === "won"
                ? `Solved in ${rec.rows.length}/${WORDIE_MAX_GUESSES}${rec.hard ? " on hard mode" : ""}.`
                : "Better luck on the next one."}
            </p>
            <div className="result-actions">
              <button className="btn primary" onClick={nextWord} autoFocus>
                Next word →
              </button>
              <button className="btn" onClick={share}>
                Share
              </button>
              <button className="btn" onClick={() => openModal("stats")}>
                Stats
              </button>
            </div>
          </section>
        )}
      </div>

      {modal === "help" && <WordieHelp onClose={closeModal} />}
      {modal === "stats" && <WordieStats len={len} onClose={closeModal} />}
      {modal === "confirm-giveup" && (
        <Modal title="Give up?" onClose={closeModal}>
          <p className="muted">The word will be revealed and this round counts as a loss.</p>
          <div className="result-actions">
            <button className="btn" onClick={closeModal}>
              Cancel
            </button>
            <button className="btn danger" onClick={giveUp} autoFocus>
              Show me the word
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" key={toast}>
          {toast}
        </div>
      )}
      <canvas className="confetti" aria-hidden />
    </main>
  );
}

function DemoRow({ word, result }: { word: string; result: number[] }) {
  return (
    <div className="w-row demo" style={{ "--len": word.length } as React.CSSProperties}>
      {[...word].map((ch, i) => (
        <div key={i} className={`tile filled s${result[i]}`}>
          <span className="tile-ch">{ch}</span>
        </div>
      ))}
    </div>
  );
}

function WordieHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <div className="help">
        <p>
          Guess the hidden word in <b>{WORDIE_MAX_GUESSES} tries</b>. Just start typing — no on-screen keyboard. On a
          phone, tap the board to bring up your keyboard. Press <b>Enter</b> to guess.
        </p>
        <p className="muted">After each guess the tiles show how close you were:</p>
        <div className="demo w-demo">
          <DemoRow word="crane" result={[2, 0, 0, 0, 0]} />
          <p className="muted">
            <b>C</b> is in the word and in the right spot.
          </p>
          <DemoRow word="pilot" result={[0, 0, 1, 0, 0]} />
          <p className="muted">
            <b>L</b> is in the word but somewhere else.
          </p>
          <DemoRow word="vague" result={[0, 0, 0, 0, 0]} />
          <p className="muted">None of these letters are in the word.</p>
        </div>
        <p>
          Pick any length from <b>4 to 8 letters</b> — each length has its own words, progress and stats.{" "}
          <b>Hard mode</b> makes you reuse every hint you&apos;ve uncovered.
        </p>
      </div>
    </Modal>
  );
}

function WordieStats({ len, onClose }: { len: number; onClose: () => void }) {
  const s = useMemo(() => loadStats(len), [len]);
  const max = Math.max(1, ...s.dist);
  return (
    <Modal title={`Statistics · ${len} letters`} onClose={onClose}>
      <div className="stat-grid four">
        <div className="stat">
          <b>{s.played}</b>
          <span>Played</span>
        </div>
        <div className="stat">
          <b>{s.played ? Math.round((s.wins / s.played) * 100) : 0}</b>
          <span>Win %</span>
        </div>
        <div className="stat">
          <b>{s.streak}</b>
          <span>Streak</span>
        </div>
        <div className="stat">
          <b>{s.best}</b>
          <span>Best streak</span>
        </div>
      </div>
      <h3 className="dist-title">Guess distribution</h3>
      <div className="dist">
        {s.dist.map((n, i) => (
          <div className="dist-row" key={i}>
            <span className="dist-label">{i + 1}</span>
            <span className="dist-bar" style={{ width: `${Math.max(6, (n / max) * 100)}%`, animationDelay: `${i * 60}ms` }}>
              {n}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
