"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isMuted, setMuted, sfx } from "@/lib/sound";
import { MEMES, MemeImages, MemeMood } from "@/lib/memes";
import { closeness, isDirty, nextHintRank, temperature } from "@/lib/puzzle";
import {
  BUCKETS,
  Entry,
  PuzzleRecord,
  allPuzzles,
  guessCount,
  hintCount,
  loadPuzzle,
  nextUnfinished,
  playerSeed,
  savePuzzle,
  stats,
} from "@/lib/storage";

const ERRORS: Record<string, string> = {
  TOO_SHORT: "That word is too short.",
  TOO_LONG: "That word is too long.",
  INVALID: "Letters only, please.",
  TOO_COMMON: "That word is too common to count.",
  DISALLOWED: "That word isn't allowed.",
  NOT_FOUND: "We don't know that word.",
  DUPLICATE: "You already tried that one.",
  NETWORK: "Something went wrong. Try again.",
};

type Modal = null | "help" | "stats" | "archive" | "confirm-hint" | "confirm-giveup";
type Closest = { word: string; rank: number }[];

async function post<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, seed: playerSeed() }),
  });
  const json = await res.json();
  if (!res.ok && !json.error) throw new Error("network");
  return json as T;
}

export default function Game({ count, memeImages = {} }: { count: number; memeImages?: MemeImages }) {
  const [id, setId] = useState<number | null>(null);
  const [rec, setRec] = useState<PuzzleRecord | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Entry | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [answer, setAnswer] = useState<{ word: string; closest: Closest } | null>(null);
  const [showClosest, setShowClosest] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [intro, setIntro] = useState<"on" | "leaving" | "off">("on");
  // >0 while the latest attempt was a rude word; the number rotates through the "dirty" memes
  const [dirty, setDirty] = useState(0);
  const [muted, setMutedState] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const boardRef = useFlip<HTMLOListElement>();

  useEffect(() => setMutedState(isMuted()), []);

  // opening animation: play once per load, tap to skip
  useEffect(() => {
    if (intro !== "on") return;
    const t = window.setTimeout(() => setIntro("leaving"), reducedMotion() ? 0 : 1900);
    return () => window.clearTimeout(t);
  }, [intro]);
  useEffect(() => {
    if (intro !== "leaving") return;
    const t = window.setTimeout(() => setIntro("off"), reducedMotion() ? 0 : 650);
    return () => window.clearTimeout(t);
  }, [intro]);

  const shake = () => {
    if (reducedMotion()) return;
    formRef.current?.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-8px)" },
        { transform: "translateX(7px)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(3px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 380, easing: "ease-out" },
    );
  };
  const fail = (msg: string) => {
    setError(msg);
    sfx.error();
    shake();
  };

  // ----- boot: puzzle from URL (?p=N, 1-based), else the first unfinished one -----
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("p");
    const q = param === null || param === "" ? NaN : Number(param) - 1;
    setId(Number.isInteger(q) && q >= 0 && q < count ? q : (nextUnfinished(count, -1) ?? 0));
    try {
      if (!window.localStorage.getItem("kindred:v1:seen-help")) {
        setModal("help");
        window.localStorage.setItem("kindred:v1:seen-help", "1");
      }
    } catch {}
  }, [count]);

  useEffect(() => {
    if (id === null) return;
    const r = loadPuzzle(id);
    setRec(r);
    setLast(null);
    setError(null);
    setInput("");
    setAnswer(null);
    setShowClosest(false);
    setDirty(0);
    window.history.replaceState(null, "", `?p=${id + 1}`);
    window.scrollTo({ top: 0 });
  }, [id]);

  // focus the input whenever a playable puzzle is on screen
  const recId = rec?.id;
  const recStatus = rec?.status;
  useEffect(() => {
    if (recStatus === "playing") inputRef.current?.focus();
  }, [recId, recStatus]);

  // fetch answer + closest words once the round is over
  useEffect(() => {
    if (!rec || rec.status === "playing" || answer) return;
    post<{ word: string; closest: Closest }>("/api/reveal", { id: rec.id })
      .then(setAnswer)
      .catch(() => {});
  }, [rec, answer]);

  const update = useCallback((r: PuzzleRecord) => {
    savePuzzle(r);
    setRec(r);
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  };

  const sorted = useMemo(() => (rec ? [...rec.entries].sort((a, b) => a.rank - b.rank) : []), [rec]);
  const best = sorted.length ? sorted[0].rank : null;
  const hintRank = useMemo(
    () => (rec ? nextHintRank(best, new Set(rec.entries.map((e) => e.rank))) : null),
    [rec, best],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rec || rec.status !== "playing" || busy) return;
    const word = input.trim().toLowerCase();
    if (!word) return;
    setError(null);
    setDirty(isDirty(word) ? (d) => (d > 0 ? d : 0) + 1 : 0);
    setBusy(true);
    try {
      const res = await post<{ word: string; rank: number } | { error: string }>("/api/guess", {
        id: rec.id,
        word,
      });
      if ("error" in res) {
        fail(ERRORS[res.error] ?? ERRORS.NETWORK);
        return;
      }
      const dup = rec.entries.find((x) => x.word === res.word);
      if (dup) {
        fail(ERRORS.DUPLICATE);
        setLast(dup);
        setInput("");
        return;
      }
      const entry: Entry = { word: res.word, rank: res.rank };
      const won = res.rank === 1;
      update({
        ...rec,
        entries: [...rec.entries, entry],
        status: won ? "won" : "playing",
        finishedAt: won ? Date.now() : undefined,
      });
      setLast(entry);
      setInput("");
      if (won) {
        sfx.win();
        burstConfetti();
      } else sfx.guess(closeness(res.rank));
    } catch {
      fail(ERRORS.NETWORK);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function takeHint() {
    setModal(null);
    if (!rec || hintRank === null) return;
    setBusy(true);
    try {
      const res = await post<{ word: string; rank: number }>("/api/hint", { id: rec.id, rank: hintRank });
      const entry: Entry = { word: res.word, rank: res.rank, hint: true };
      const existing = rec.entries.find((x) => x.word === res.word);
      if (!existing) update({ ...rec, entries: [...rec.entries, entry] });
      setLast(existing ?? entry);
      setError(null);
      sfx.hint();
    } catch {
      fail(ERRORS.NETWORK);
    } finally {
      setBusy(false);
    }
  }

  function giveUp() {
    setModal(null);
    if (!rec) return;
    update({ ...rec, status: "lost", finishedAt: Date.now() });
    sfx.lose();
  }

  function goNext() {
    if (id === null) return;
    const next = nextUnfinished(count, id);
    if (next === null) {
      flash("You've finished every puzzle!");
      setModal("archive");
      return;
    }
    sfx.swoosh();
    setId(next);
  }

  const openModal = (m: Modal) => {
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

  async function share() {
    if (!rec) return;
    const tally = { hot: 0, warm: 0, cool: 0, cold: 0, found: 0 };
    rec.entries.forEach((e) => tally[temperature(e.rank)]++);
    const head =
      rec.status === "won"
        ? `Kindred #${rec.id + 1} — found in ${guessCount(rec)} guess${guessCount(rec) === 1 ? "" : "es"}${
            hintCount(rec) ? ` + ${hintCount(rec)} hint${hintCount(rec) === 1 ? "" : "s"}` : ""
          }`
        : `Kindred #${rec.id + 1} — gave up after ${guessCount(rec)} guesses`;
    const bar = (n: number, sq: string) => sq.repeat(Math.min(n, 12)) + (n > 12 ? "…" : "") + ` ${n}`;
    const lines = [
      head,
      bar(tally.hot + tally.found, "🟩"),
      bar(tally.warm, "🟨"),
      bar(tally.cool, "🟧"),
      bar(tally.cold, "🟥"),
      window.location.origin,
    ];
    const text = lines.join("\n");
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

  const splash = intro !== "off" && (
    <Intro leaving={intro === "leaving"} onSkip={() => setIntro((s) => (s === "on" ? "leaving" : s))} />
  );

  if (id === null || !rec) {
    return (
      <main className="shell" aria-busy="true">
        {splash}
      </main>
    );
  }

  const over = rec.status !== "playing";
  const g = guessCount(rec);
  const h = hintCount(rec);

  return (
    <main className="shell">
      {splash}
      <MemeBackdrop
        mood={over ? (rec.status === "won" ? "found" : "lost") : dirty ? "dirty" : guessMood(rec.entries, last)}
        turn={dirty && !over ? dirty : rec.entries.length}
        images={memeImages}
      />
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
            kin<span>dred</span>
          </h1>
          <p className="sub">
            Puzzle <span key={id} className="num-swap">#{id + 1}</span> <span className="of">of {count}</span>
          </p>
          <GameNav current="kindred" />
        </div>
        <div className="actions">
          <button className="icon" aria-label="All puzzles" onClick={() => openModal("archive")}>
            <GridIcon />
          </button>
          <button className="icon" aria-label="Statistics" onClick={() => openModal("stats")}>
            <ChartIcon />
          </button>
        </div>
      </header>

      <div key={id} className="stage">
      <div className="meta">
        <span>
          Guesses <b>{g}</b>
        </span>
        {h > 0 && (
          <span>
            Hints <b>{h}</b>
          </span>
        )}
        {!over && (
          <span className="meta-actions">
            <button className="link" disabled={busy || hintRank === null} onClick={() => openModal("confirm-hint")}>
              Hint
            </button>
            <button className="link danger" disabled={busy || g + h === 0} onClick={() => openModal("confirm-giveup")}>
              Give up
            </button>
            <button className="link" disabled={busy} onClick={goNext}>
              Skip
            </button>
          </span>
        )}
      </div>

      {over ? (
        <ResultCard
          rec={rec}
          answer={answer?.word ?? null}
          onShare={share}
          onNext={goNext}
          onArchive={() => openModal("archive")}
          showClosest={showClosest}
          toggleClosest={() => setShowClosest((s) => !s)}
          closest={answer?.closest ?? null}
        />
      ) : (
        <form ref={formRef} onSubmit={submit} className="entry">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => {
              const v = e.target.value.replace(/\s/g, "");
              if (v.length > input.length) sfx.tap();
              setInput(v);
              setError(null);
            }}
            placeholder={g + h === 0 ? "type any word…" : "try another word…"}
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={24}
            aria-label="Your guess"
            readOnly={busy}
          />
          <button type="submit" disabled={busy || !input.trim()} aria-label="Submit guess">
            {busy ? <span className="spin" /> : "↵"}
          </button>
        </form>
      )}
      <p className="error" role="status">
        {error ?? " "}
      </p>

      {last && !over && (
        <div className="last" key={last.word}>
          <Row entry={last} highlight countUp />
        </div>
      )}

      {sorted.length > 0 ? (
        <ol className="board" ref={boardRef}>
          {sorted.map((e) => (
            <li key={e.word} data-flip={e.word}>
              <Row entry={e} highlight={!!last && e.word === last.word} />
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty">
          <p>Find the secret word.</p>
          <p className="muted">Every guess tells you how close you are — the lower the number, the warmer you are.</p>
        </div>
      )}
      </div>

      {modal === "help" && <HelpModal onClose={closeModal} />}
      {modal === "stats" && <StatsModal count={count} onClose={closeModal} />}
      {modal === "archive" && (
        <ArchiveModal
          count={count}
          current={id}
          onPick={(d) => {
            setId(d);
            setModal(null);
          }}
          onClose={closeModal}
        />
      )}
      {modal === "confirm-hint" && (
        <Confirm
          title="Take a hint?"
          body={
            best === null
              ? "We'll reveal a word that's somewhere in the neighbourhood. Hints are counted in your score."
              : `We'll reveal a word closer than your best guess (#${best}). Hints are counted in your score.`
          }
          confirm="Reveal a word"
          onConfirm={takeHint}
          onClose={closeModal}
        />
      )}
      {modal === "confirm-giveup" && (
        <Confirm
          title="Give up?"
          body="The secret word will be revealed and this round will count as a loss."
          confirm="Show me the word"
          danger
          onConfirm={giveUp}
          onClose={closeModal}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
      <canvas className="confetti" aria-hidden />
    </main>
  );
}

function Row({ entry, highlight, countUp }: { entry: Entry; highlight?: boolean; countUp?: boolean }) {
  const t = temperature(entry.rank);
  const shown = useCountUp(entry.rank, !!countUp);
  return (
    <div className={`row t-${t}${highlight ? " hl" : ""}`}>
      <div className="fill" style={{ width: `${closeness(entry.rank) * 100}%` }} />
      <span className="word">
        {entry.word}
        {entry.hint && <span className="tag">hint</span>}
      </span>
      <span className="rank">{entry.rank === 1 ? "★" : shown.toLocaleString()}</span>
    </div>
  );
}

function ResultCard(props: {
  rec: PuzzleRecord;
  answer: string | null;
  onShare: () => void;
  onNext: () => void;
  onArchive: () => void;
  showClosest: boolean;
  toggleClosest: () => void;
  closest: Closest | null;
}) {
  const { rec, answer } = props;
  const won = rec.status === "won";
  const g = guessCount(rec);
  const h = hintCount(rec);
  return (
    <section className={`result ${won ? "won" : "lost"}`}>
      <p className="eyebrow">{won ? "You got it!" : "No luck this time"}</p>
      <p className="answer" aria-label={answer ?? undefined}>
        {answer
          ? [...answer].map((ch, i) => (
              <span key={i} style={{ animationDelay: `${120 + i * 55}ms` }} aria-hidden>
                {ch}
              </span>
            ))
          : "…"}
      </p>
      <p className="muted">
        {won
          ? `Found in ${g} guess${g === 1 ? "" : "es"}${h ? ` and ${h} hint${h === 1 ? "" : "s"}` : ""}.`
          : `The word was “${answer ?? "…"}”. You made ${g} guess${g === 1 ? "" : "es"}.`}
      </p>
      <div className="result-actions">
        <button className="btn primary" onClick={props.onNext} autoFocus>
          Next word →
        </button>
        <button className="btn" onClick={props.onShare}>
          Share
        </button>
        <button className="btn" onClick={props.toggleClosest}>
          {props.showClosest ? "Hide closest" : "Closest words"}
        </button>
        <button className="btn" onClick={props.onArchive}>
          All puzzles
        </button>
      </div>
      {props.showClosest && (
        <ol className="closest">
          {(props.closest ?? []).map((c) => (
            <li key={c.word} className={`t-${temperature(c.rank)}`}>
              <span className="rank">{c.rank}</span>
              {c.word}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, reducedMotion() ? 0 : 170);
  }, [onClose]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [close]);
  return (
    <div className={`overlay${closing ? " closing" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" aria-label="Close" onClick={close}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Confirm(props: {
  title: string;
  body: string;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <p className="muted">{props.body}</p>
      <div className="result-actions">
        <button className="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button className={`btn ${props.danger ? "danger" : "primary"}`} onClick={props.onConfirm} autoFocus>
          {props.confirm}
        </button>
      </div>
    </Modal>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <div className="help">
        <p>Find the secret word in as few tries as you can. Finish one and jump straight to the next — play as many as you like.</p>
        <p>
          Every word you try gets a <b>number</b>: how close its meaning is to the secret word. The secret word is
          <b> #1</b>, its nearest neighbour is #2, and so on through 100,000 words.
        </p>
        <p className="muted">If the secret word were <b>ocean</b>:</p>
        <div className="demo">
          <Row entry={{ word: "sea", rank: 2 }} />
          <Row entry={{ word: "harbor", rank: 22 }} />
          <Row entry={{ word: "ozone", rank: 1101 }} />
          <Row entry={{ word: "ledges", rank: 5601 }} />
          <Row entry={{ word: "pencil", rank: 31104 }} />
        </div>
        <p>
          Closeness comes from how words are used together in a huge body of text, so it can be about
          meaning, context or topic.
        </p>
        <p className="muted">
          Stuck? A <b>hint</b> reveals a word closer than your best guess. You can give up to see the answer, or
          skip to another word and come back later from the puzzle list.
        </p>
      </div>
    </Modal>
  );
}

function StatsModal({ count, onClose }: { count: number; onClose: () => void }) {
  const s = useMemo(() => stats(count), [count]);
  const max = Math.max(1, ...s.dist.map((d) => d.count));
  return (
    <Modal title="Statistics" onClose={onClose}>
      <div className="stat-grid">
        <Stat n={s.played} l="Played" />
        <Stat n={s.winPct} l="Win %" />
        <Stat n={s.current} l="Streak" />
        <Stat n={s.best} l="Best streak" />
        <Stat n={s.avg} l="Avg. guesses" />
      </div>
      <h3 className="dist-title">Guess distribution</h3>
      <div className="dist">
        {s.dist.map((d, i) => (
          <div className="dist-row" key={d.label}>
            <span className="dist-label">{d.label}</span>
            <span
              className={`dist-bar${i === BUCKETS.length ? " lost" : ""}`}
              style={{ width: `${Math.max(6, (d.count / max) * 100)}%`, animationDelay: `${i * 60}ms` }}
            >
              {d.count}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Stat({ n, l }: { n: number; l: string }) {
  return (
    <div className="stat">
      <b>{n}</b>
      <span>{l}</span>
    </div>
  );
}

function ArchiveModal(props: { count: number; current: number; onPick: (d: number) => void; onClose: () => void }) {
  const records = useMemo(() => {
    const m = new Map<number, PuzzleRecord>();
    allPuzzles(props.count).forEach((r) => m.set(r.id, r));
    return m;
  }, [props.count]);
  const done = [...records.values()].filter((r) => r.status !== "playing").length;
  return (
    <Modal title="All puzzles" onClose={props.onClose}>
      <p className="muted archive-sum">
        {done} of {props.count} finished
      </p>
      <ul className="archive">
        {Array.from({ length: props.count }, (_, d) => {
          const r = records.get(d);
          const status = !r || (r.status === "playing" && r.entries.length === 0) ? "new" : r.status;
          return (
            <li key={d} style={{ animationDelay: `${Math.min(d, 40) * 12}ms` }}>
              <button className={d === props.current ? "on" : ""} onClick={() => props.onPick(d)}>
                <span className="a-num">#{d + 1}</span>
                <span className={`a-status s-${status}`}>
                  {status === "won"
                    ? `✓ ${guessCount(r!) + hintCount(r!)}`
                    : status === "lost"
                      ? "gave up"
                      : status === "playing"
                        ? "…"
                        : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
export function ChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

export function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      {muted ? <path d="m22 9-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
    </svg>
  );
}

export function Intro({
  leaving,
  onSkip,
  word = "kindred",
  accentFrom = 3,
  tagline = "how close can you get?",
}: {
  leaving: boolean;
  onSkip: () => void;
  word?: string;
  accentFrom?: number;
  tagline?: string;
}) {
  return (
    <div className={`intro${leaving ? " leaving" : ""}`} onClick={onSkip} aria-hidden>
      <div className="intro-rings">
        <i />
        <i />
        <i />
      </div>
      <div className="intro-word">
        {[...word].map((ch, i) => (
          <span key={i} className={i >= accentFrom ? "acc" : ""} style={{ animationDelay: `${150 + i * 85}ms` }}>
            {ch}
          </span>
        ))}
      </div>
      <p className="intro-tag">{tagline}</p>
      <div className="intro-bar">
        <b />
      </div>
      {/* CSS-only fallback: only appears if the app script never starts (the splash is normally gone by then) */}
      <a className="intro-stuck" href="/" onClick={(e) => e.stopPropagation()}>
        Taking too long? Tap to reload
      </a>
    </div>
  );
}

export function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Animate a number from 0 up to `target` (only when `on`). */
function useCountUp(target: number, on: boolean) {
  const [n, setN] = useState(on && !reducedMotion() ? 0 : target);
  useEffect(() => {
    if (!on || reducedMotion()) {
      setN(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const dur = 650;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.max(1, Math.round(target * eased)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, on]);
  return n;
}

/**
 * FLIP animation for a list: children with `data-flip` keys glide to their new position
 * when the list re-sorts, and new children slide in.
 */
function useFlip<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const prev = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = ref.current;
    const next = new Map<string, number>();
    if (!el) {
      prev.current = next;
      return;
    }
    const motion = !reducedMotion();
    const first = prev.current.size === 0;
    el.querySelectorAll<HTMLElement>("[data-flip]").forEach((child) => {
      const key = child.dataset.flip!;
      const top = child.offsetTop; // layout position, unaffected by running transforms
      next.set(key, top);
      if (!motion || first) return;
      const old = prev.current.get(key);
      if (old !== undefined) {
        const dy = old - top;
        if (Math.abs(dy) > 1)
          child.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], {
            duration: 420,
            easing: "cubic-bezier(.2,.8,.2,1)",
          });
      } else {
        child.animate(
          [
            { opacity: 0, transform: "translateX(-14px) scale(.98)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
      }
    });
    prev.current = next;
  });
  return ref;
}

/** Fire a burst of confetti on the full-screen canvas. */
export function burstConfetti() {
  if (reducedMotion()) return;
  const canvas = document.querySelector<HTMLCanvasElement>("canvas.confetti");
  const c = canvas?.getContext("2d");
  if (!canvas || !c) return;
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  c.scale(dpr, dpr);
  const colors = ["#7c5cff", "#a78bfa", "#e25bd0", "#f472b6", "#ff7a59", "#3ee6a8", "#5b8def", "#ffffff"];
  const parts = Array.from({ length: 160 }, (_, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    return {
      x: W / 2 + side * (W * 0.1),
      y: H * 0.35,
      vx: side * (2 + Math.random() * 7) + (Math.random() - 0.5) * 3,
      vy: -6 - Math.random() * 9,
      r: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      color: colors[i % colors.length],
    };
  });
  const start = performance.now();
  const frame = (now: number) => {
    const t = now - start;
    c.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.28;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      c.save();
      c.globalAlpha = Math.max(0, 1 - t / 2600);
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.fillStyle = p.color;
      c.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      c.restore();
    }
    if (t < 2600) requestAnimationFrame(frame);
    else c.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(frame);
}

/** Faint reaction meme behind the board; changes with every guess. */
export function MemeBackdrop({ mood, turn, images }: { mood: MemeMood | null; turn: number; images: MemeImages }) {
  if (!mood) return null;
  const pics = images[mood];
  const list = MEMES[mood];
  const m = list[turn % list.length];
  return (
    <div className={`meme m-${mood}`} aria-hidden>
      {pics?.length ? (
        <div
          key={`${mood}-${turn}`}
          // files named *.light.png have a white background (line art etc.): blend the white away
          className={`meme-card photo${/\.light\.\w+$/i.test(pics[turn % pics.length]) ? " light-bg" : ""}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pics[turn % pics.length]} alt="" />
        </div>
      ) : (
        <div key={`${mood}-${turn}`} className="meme-card">
          <span className="meme-emoji">{m.emoji}</span>
          <span className="meme-cap">{m.caption}</span>
        </div>
      )}
    </div>
  );
}

/** Which reaction a (non-final, non-rude) guess gets. */
function guessMood(entries: Entry[], last: Entry | null): MemeMood | null {
  if (!last) return null;
  if (last.rank > 1 && last.rank <= 25) return "near";
  const others = entries.filter((e) => e.word !== last.word).map((e) => e.rank);
  const prevBest = others.length ? Math.min(...others) : Infinity;
  if (prevBest <= 2000 && last.rank > 2000 && last.rank >= prevBest * 5) return "letdown";
  return temperature(last.rank);
}

/** Switch between the two games. */
export function GameNav({ current }: { current: "kindred" | "wordie" }) {
  return (
    <nav className="game-nav" aria-label="Games">
      <span className={`game-nav-pill ${current}`} aria-hidden />
      <a href="/" className={current === "kindred" ? "on" : ""} aria-current={current === "kindred" ? "page" : undefined}>
        Kindred
      </a>
      <a href="/wordie" className={current === "wordie" ? "on" : ""} aria-current={current === "wordie" ? "page" : undefined}>
        Wordie
      </a>
    </nav>
  );
}
