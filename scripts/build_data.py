"""Build the Kindred word data from GloVe 100d vectors.

usage: python3 -I build_data.py <glove.model> <glove.npy> <outdir> [target_size]

Outputs:
  vocab.txt     one word per line (ranking vocabulary, frequency order)
  vectors.bin   int8, len(vocab) x 100, L2-normalised then scaled by 127
"""
import math
import pickle
import struct
import sys

model_path, npy_path, outdir = sys.argv[1:4]
TARGET = int(sys.argv[4]) if len(sys.argv) > 4 else 100000
TOTAL = 400000
DIM = 100


class Stub:
    def __init__(self, *a, **k):
        self._args = a

    def __setstate__(self, state):
        self.__dict__["_state"] = state

    def __call__(self, *a, **k):
        return Stub(*a)


class SafeUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if module == "builtins" and name in ("dict", "list", "set", "tuple", "object"):
            return getattr(__builtins__, name) if not isinstance(__builtins__, dict) else __builtins__[name]
        if module == "collections" and name == "defaultdict":
            import collections
            return collections.defaultdict
        return Stub


with open(model_path, "rb") as f:
    obj = SafeUnpickler(f).load()


def find_keys(o, depth=0):
    if depth > 6:
        return None
    st = getattr(o, "__dict__", {}).get("_state")
    if isinstance(st, dict):
        for k in ("index_to_key", "index2word"):
            if isinstance(st.get(k), list) and st[k]:
                return st[k]
        if isinstance(st.get("vocab"), dict) and st["vocab"]:
            out = [None] * len(st["vocab"])
            for w, voc in st["vocab"].items():
                out[voc.__dict__["_state"]["index"]] = w
            return out
        for v in st.values():
            r = find_keys(v, depth + 1)
            if r:
                return r
    return None


keys = find_keys(obj)
assert keys and len(keys) == 400000, "could not locate vocabulary"

with open("/usr/share/dict/words") as f:
    dict_words = {w.strip() for w in f if w.strip() and w.strip().islower()}

STOP = set("""the a an and or but is are was were be been being have has had do does did will would
could should may might must can i you he she it we they me him her us them my your his its our their
this that these those of in on at to for with from by as into onto than then so if not no nor too very
just also there here what which who whom whose when where why how all any each every some such own same
other another more most much many few less least only am ourselves yourself yourselves himself herself
itself themselves myself about above after again against before below between both down during further
off once out over through under until up while""".split())

with open(npy_path, "rb") as f:
    magic = f.read(6)
    assert magic == b"\x93NUMPY"
    major, minor = f.read(2)
    hlen = struct.unpack("<H" if major == 1 else "<I", f.read(2 if major == 1 else 4))[0]
    header = f.read(hlen).decode()
    assert "'<f4'" in header and "(400000, 100)" in header, header
    raw = f.read(TOTAL * DIM * 4)

SUFFIXES = (("ies", "y"), ("es", ""), ("s", ""), ("ed", ""), ("ed", "e"), ("ing", ""), ("ing", "e"),
            ("ly", ""), ("er", ""), ("ers", ""), ("est", ""), ("ness", ""), ("ment", ""), ("ful", ""))


def real_word(w):
    """A lowercase dictionary word, or a regular inflection of one (filters out names and junk)."""
    if w in dict_words:
        return True
    for suf, rep in SUFFIXES:
        if w.endswith(suf) and len(w) - len(suf) >= 2 and (w[: -len(suf)] + rep) in dict_words:
            return True
        # doubled consonant: running -> run, bigger -> big
        if w.endswith(suf) and len(w) - len(suf) >= 3 and w[-len(suf) - 1] == w[-len(suf) - 2] \
                and w[: -len(suf) - 1] in dict_words:
            return True
    return False


def plain(w):
    return w.isascii() and w.isalpha() and w.islower() and 2 <= len(w) <= 20 and w not in STOP


# 1) every dictionary word / inflection GloVe knows
chosen = [i for i in range(TOTAL) if plain(keys[i]) and real_word(keys[i])][:TARGET]
# 2) top up with the most frequent remaining tokens (modern words: internet, email, website...)
need = TARGET - len(chosen)
taken = set(chosen)
extra = [i for i in range(TOTAL) if i not in taken and plain(keys[i]) and len(keys[i]) >= 3][:need]
chosen = sorted(chosen + extra)
print("dictionary words", len(chosen) - len(extra), "frequency top-up", len(extra))

words, vecs = [], bytearray()
last_i = chosen[-1]
for i in chosen:
    w = keys[i]
    v = struct.unpack_from("<100f", raw, i * DIM * 4)
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    q = [max(-127, min(127, round(x / n * 127))) for x in v]
    vecs += struct.pack("<100b", *q)
    words.append(w)

with open(f"{outdir}/vocab.txt", "w") as f:
    f.write("\n".join(words))
with open(f"{outdir}/vectors.bin", "wb") as f:
    f.write(vecs)
print("vocab", len(words), "bytes", len(vecs), "deepest glove index", last_i)
