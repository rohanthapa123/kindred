"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { closeness, nextHintRank, temperature } from "@/lib/puzzle";
import {
  BUCKETS,
  Entry,
  PuzzleRecord,
  allPuzzles,
  guessCount,
  hintCount,
  loadPuzzle,
  nextUnfinished,
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

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok && !json.error) throw new Error("network");
  return json as T;
}

export default function Game({ count }: { count: number }) {
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
  const inputRef = useRef<HTMLInputElement>(null);

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
    setBusy(true);
    try {
      const res = await post<{ word: string; rank: number } | { error: string }>("/api/guess", {
        id: rec.id,
        word,
      });
      if ("error" in res) {
        setError(ERRORS[res.error] ?? ERRORS.NETWORK);
        return;
      }
      const dup = rec.entries.find((x) => x.word === res.word);
      if (dup) {
        setError(ERRORS.DUPLICATE);
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
    } catch {
      setError(ERRORS.NETWORK);
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
    } catch {
      setError(ERRORS.NETWORK);
    } finally {
      setBusy(false);
    }
  }

  function giveUp() {
    setModal(null);
    if (!rec) return;
    update({ ...rec, status: "lost", finishedAt: Date.now() });
  }

  function goNext() {
    if (id === null) return;
    const next = nextUnfinished(count, id);
    if (next === null) {
      flash("You've finished every puzzle!");
      setModal("archive");
      return;
    }
    setId(next);
  }

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

  if (id === null || !rec) {
    return <main className="shell" aria-busy="true" />;
  }

  const over = rec.status !== "playing";
  const g = guessCount(rec);
  const h = hintCount(rec);

  return (
    <main className="shell">
      <header className="top">
        <button className="icon" aria-label="How to play" onClick={() => setModal("help")}>
          ?
        </button>
        <div className="brand">
          <h1>
            kin<span>dred</span>
          </h1>
          <p className="sub">
            Puzzle #{id + 1} <span className="of">of {count}</span>
          </p>
        </div>
        <div className="actions">
          <button className="icon" aria-label="All puzzles" onClick={() => setModal("archive")}>
            <GridIcon />
          </button>
          <button className="icon" aria-label="Statistics" onClick={() => setModal("stats")}>
            <ChartIcon />
          </button>
        </div>
      </header>

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
            <button className="link" disabled={busy || hintRank === null} onClick={() => setModal("confirm-hint")}>
              Hint
            </button>
            <button className="link danger" disabled={busy || g + h === 0} onClick={() => setModal("confirm-giveup")}>
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
          onArchive={() => setModal("archive")}
          showClosest={showClosest}
          toggleClosest={() => setShowClosest((s) => !s)}
          closest={answer?.closest ?? null}
        />
      ) : (
        <form onSubmit={submit} className="entry">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value.replace(/\s/g, ""));
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
        <div className="last">
          <Row entry={last} highlight />
        </div>
      )}

      {sorted.length > 0 ? (
        <ol className="board">
          {sorted.map((e) => (
            <li key={e.word}>
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

      {modal === "help" && <HelpModal onClose={() => setModal(null)} />}
      {modal === "stats" && <StatsModal count={count} onClose={() => setModal(null)} />}
      {modal === "archive" && (
        <ArchiveModal
          count={count}
          current={id}
          onPick={(d) => {
            setId(d);
            setModal(null);
          }}
          onClose={() => setModal(null)}
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
          onClose={() => setModal(null)}
        />
      )}
      {modal === "confirm-giveup" && (
        <Confirm
          title="Give up?"
          body="The secret word will be revealed and this round will count as a loss."
          confirm="Show me the word"
          danger
          onConfirm={giveUp}
          onClose={() => setModal(null)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function Row({ entry, highlight }: { entry: Entry; highlight?: boolean }) {
  const t = temperature(entry.rank);
  return (
    <div className={`row t-${t}${highlight ? " hl" : ""}`}>
      <div className="fill" style={{ width: `${closeness(entry.rank) * 100}%` }} />
      <span className="word">
        {entry.word}
        {entry.hint && <span className="tag">hint</span>}
      </span>
      <span className="rank">{entry.rank === 1 ? "★" : entry.rank.toLocaleString()}</span>
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
      <p className="answer">{answer ?? "…"}</p>
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

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" aria-label="Close" onClick={onClose}>
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
              style={{ width: `${Math.max(6, (d.count / max) * 100)}%` }}
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
            <li key={d}>
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
function ChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}
