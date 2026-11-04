import "server-only";
import fs from "node:fs";
import path from "node:path";
import { permutation } from "./shuffle";
import { WORDIE_LENGTHS, WORDIE_MAX_GUESSES } from "./wordie-rules";

type Lists = { answers: Record<string, string[]>; valid: Map<number, Set<string>> };
let lists: Lists | null = null;

function load(): Lists {
  if (lists) return lists;
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "wordie.json"), "utf8")) as {
    answers: Record<string, string[]>;
    valid: Record<string, string[]>;
  };
  const valid = new Map<number, Set<string>>();
  for (const n of WORDIE_LENGTHS) valid.set(n, new Set([...raw.valid[n], ...raw.answers[n]]));
  lists = { answers: raw.answers, valid };
  return lists;
}

export function answerCounts(): Record<number, number> {
  const { answers } = load();
  return Object.fromEntries(WORDIE_LENGTHS.map((n) => [n, answers[n].length]));
}

function secret(len: number, id: number, seed: number): string {
  const list = load().answers[len];
  return list[permutation(list.length, seed ^ (len * 0x9e3779b1))[id]];
}

export function validPuzzle(len: unknown, id: unknown): boolean {
  if (typeof len !== "number" || !WORDIE_LENGTHS.includes(len)) return false;
  return typeof id === "number" && Number.isInteger(id) && id >= 0 && id < load().answers[len].length;
}

/** 2 = right letter right spot, 1 = in the word elsewhere, 0 = not in the word (duplicates handled). */
export function score(guess: string, answer: string): number[] {
  const res = new Array(guess.length).fill(0);
  const left = new Map<string, number>();
  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) res[i] = 2;
    else left.set(answer[i], (left.get(answer[i]) ?? 0) + 1);
  }
  for (let i = 0; i < guess.length; i++) {
    if (res[i] === 2) continue;
    const n = left.get(guess[i]) ?? 0;
    if (n > 0) {
      res[i] = 1;
      left.set(guess[i], n - 1);
    }
  }
  return res;
}

export type WordieError = "BAD_LENGTH" | "INVALID" | "NOT_WORD";

export function wordieGuess(len: number, id: number, seed: number, raw: string): { result: number[] } | { error: WordieError } {
  const word = raw.trim().toLowerCase();
  if (word.length !== len) return { error: "BAD_LENGTH" };
  if (!/^[a-z]+$/.test(word)) return { error: "INVALID" };
  if (!load().valid.get(len)!.has(word)) return { error: "NOT_WORD" };
  return { result: score(word, secret(len, id, seed)) };
}

/** Only meant for finished rounds; the client calls it after a win or after the last guess. */
export function wordieReveal(len: number, id: number, seed: number) {
  return { word: secret(len, id, seed), maxGuesses: WORDIE_MAX_GUESSES };
}
