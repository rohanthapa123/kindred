"""Build the Wordie word lists.

usage: python3 -I scripts/build_wordie.py [dict=/usr/share/dict/web2]

Answers  = common words: in the top TOP_N of data/vocab.txt (GloVe frequency order) AND a lowercase
           entry in the system dictionary (capitalised entries there are proper nouns, so names drop out).
Guesses  = anything in either source (vocab includes plurals/inflections the dictionary lacks).
Output   = data/wordie.json  {"answers": {"5": [...]}, "valid": {"5": [...]}}
"""
import json
import re
import sys

LENGTHS = range(4, 9)
TOP_N = 18000          # how far down the frequency list an answer may come from
MAX_ANSWERS = 2500     # per length
ROOT = __file__.rsplit("/scripts/", 1)[0]

dict_path = sys.argv[1] if len(sys.argv) > 1 else "/usr/share/dict/web2"
alpha = re.compile(r"^[a-z]+$")

with open(dict_path) as f:
    dictionary = {w.strip() for w in f if alpha.match(w.strip())}  # lowercase-only = not a proper noun
# words that also exist capitalised (Taft/taft, Cyrus) or in the names list are usually names: no answers
with open(dict_path) as f:
    capitalised = {w.strip().lower() for w in f if re.match(r"^[A-Z][a-z]+$", w.strip())}
try:
    with open(dict_path.rsplit("/", 1)[0] + "/propernames") as f:
        capitalised |= {w.strip().lower() for w in f}
except OSError:
    pass
with open(f"{ROOT}/data/vocab.txt") as f:
    vocab = [w.strip() for w in f if w.strip()]

# keep rude/blocked words out of the answers (mirror of NAUGHTY + BLOCKED in src/lib/puzzle.ts)
src = open(f"{ROOT}/src/lib/puzzle.ts").read()
rude = set(re.findall(r"[a-z]+", " ".join(re.findall(r'"([a-z ]+)"', src))))
# extra words that slip through as answers: slang slurs, and names that also happen to be dictionary words
rude |= set("bint dago gook spic paki wop jap homo tranny dyke".split())
# names / foreign words spotted in the answer lists; add any others here and re-run
EXCLUDE = set("""taft mona mora plummer sheng buffy decker witter semis petit bari atta campo cyrus amelia
jasper dali naga irian bundy stroud cotta laver neve""".split())
rude |= EXCLUDE

answers, valid = {}, {}
for n in LENGTHS:
    picked = []
    for w in vocab[:TOP_N]:
        if len(w) == n and alpha.match(w) and w in dictionary and w not in capitalised and w not in rude:
            picked.append(w)
        if len(picked) >= MAX_ANSWERS:
            break
    answers[str(n)] = picked
    pool = {w for w in vocab if len(w) == n and alpha.match(w)} | {w for w in dictionary if len(w) == n}
    valid[str(n)] = sorted(pool - set(picked))  # answers are always valid; stored once
    print(f"{n} letters: {len(picked)} answers, {len(pool)} valid guesses")

with open(f"{ROOT}/data/wordie.json", "w") as f:
    json.dump({"answers": answers, "valid": valid}, f, separators=(",", ":"))
