"""Generate Hunch questions from public datasets.

usage: python3 -I scripts/build_hunch.py <raw_dir> [--refresh]

  raw_dir    where downloaded source data is cached (kept out of the repo; treated as data only)
  --refresh  re-download even if a cached file exists

Sources
  Wikidata SPARQL (CC0): countries, cities, rivers, mountains, Nepal places, elements,
                         programming languages, software, skyscrapers, films, books
  IANA registries:       HTTP status codes, service names & port numbers

Output: data/hunch-generated.json  — list of {id, cat, q, a, unit, kind, tol, fact}
Rules: only non-deprecated values; preferred rank wins; dated values use the latest date and the
year goes into the question; items whose values disagree by >5% with no way to pick are skipped.
"""
import csv
import io
import json
import os
import re
import sys
import subprocess
import time
import urllib.parse
from collections import Counter

RAW = sys.argv[1]
REFRESH = "--refresh" in sys.argv
ROOT = __file__.rsplit("/scripts/", 1)[0]
UA = "kindred-hunch-builder/1.0 (hobby trivia game; contact via repo)"
os.makedirs(RAW, exist_ok=True)


# ───────────────────────── fetching ─────────────────────────
def fetch(name, url, max_bytes=8_000_000, headers=None):
    """Download via curl (uses the system's trusted certificates), cached in RAW."""
    path = os.path.join(RAW, name)
    if os.path.exists(path) and not REFRESH:
        with open(path, "rb") as f:
            return f.read()
    cmd = ["curl", "-sSfL", "--max-time", "120", "--max-filesize", str(max_bytes), "-A", UA, "-o", path + ".part"]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    for attempt in range(4):
        r = subprocess.run([*cmd, url], capture_output=True, text=True, check=False)
        if r.returncode == 0:
            os.replace(path + ".part", path)
            time.sleep(1.5)  # be polite to the endpoint
            with open(path, "rb") as f:
                return f.read()
        print(f"  {name}: attempt {attempt + 1} failed: {r.stderr.strip()[:160]}")
        time.sleep(5 * (attempt + 1))
    print(f"  {name}: giving up")
    return None


def sparql(name, query):
    query = " ".join(query.split())  # one line: stable text for the endpoint's result cache
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": query, "format": "json"})
    # Wikidata sometimes fails mid-stream (HTTP 200 + a Java stack trace appended), so retry broken bodies too
    for attempt in range(4):
        raw = fetch(name + ".json", url, headers={"Accept": "application/sparql-results+json"})
        if not raw:
            return []
        try:
            rows = json.loads(raw)["results"]["bindings"]
            print(f"  {name}: {len(rows)} rows")
            return [{k: v["value"] for k, v in r.items()} for r in rows]
        except (ValueError, KeyError):
            print(f"  {name}: broken response (attempt {attempt + 1}), retrying")
            os.remove(os.path.join(RAW, name + ".json"))
            time.sleep(10 * (attempt + 1))
    print(f"  {name}: skipped after repeated broken responses")
    return []


# ───────────────────────── helpers ─────────────────────────
QID = re.compile(r"^Q\d+$")
RANK = {"http://wikiba.se/ontology#PreferredRank": 2, "http://wikiba.se/ontology#NormalRank": 1}


def qid(uri):
    return uri.rsplit("/", 1)[-1]


def good_label(s):
    return bool(s) and not QID.match(s) and len(s) <= 60


def pick(statements):
    """statements: list of (value, rank, date|None). Returns (value, date) or None."""
    st = [s for s in statements if s[1] in RANK]
    if not st:
        return None
    best_rank = max(RANK[s[1]] for s in st)
    st = [s for s in st if RANK[s[1]] == best_rank]
    dated = [s for s in st if s[2]]
    if dated:
        latest = max(s[2] for s in dated)
        vals = {s[0] for s in dated if s[2] == latest}
    else:
        vals = {s[0] for s in st}
        latest = None
    vals = sorted(vals)
    if len(vals) > 1 and (vals[-1] - vals[0]) > 0.05 * abs(vals[-1] or 1):
        return None  # ambiguous
    return vals[0], latest


def group(rows, key, val, rank="rank", date="date"):
    out = {}
    for r in rows:
        if val not in r:
            continue
        try:
            v = float(r[val])
        except ValueError:
            continue
        out.setdefault(r[key], {"row": r, "st": []})["st"].append((v, r.get(rank), r.get(date)))
    return out


def year_of(s):
    m = re.match(r"^(-?\d{1,4})-", s or "")
    return int(m.group(1)) if m else None


def fmt(n):
    return f"{n:,.0f}" if abs(n) >= 100 else f"{n:,.2f}".rstrip("0").rstrip(".")


facts, seen = [], set()


def add(id_, cat, q, a, unit="", kind="log", tol=None, fact=""):
    if id_ in seen or a is None:
        return
    if kind == "log" and a <= 0:
        return
    seen.add(id_)
    f = {"id": id_, "cat": cat, "q": q, "a": round(a, 3), "fact": fact}
    if unit:
        f["unit"] = unit
    if kind != "log":
        f["kind"] = kind
        f["tol"] = tol
    facts.append(f)


def desc(r, label):
    d = r.get("itemDescription") or r.get("cDescription") or ""
    return f"{label} — {d}." if d else ""


LABEL = 'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }'

# ───────────────────────── WORLD ─────────────────────────
print("countries")
rows = sparql("countries-pop", f"""
SELECT ?item ?itemLabel ?itemDescription ?v ?rank ?date WHERE {{
  ?item wdt:P31 wd:Q3624078. FILTER NOT EXISTS {{ ?item wdt:P31 wd:Q3024240 }}
  ?item p:P1082 ?s. ?s ps:P1082 ?v; wikibase:rank ?rank. OPTIONAL {{ ?s pq:P585 ?date }}
  {LABEL} }}""")
for k, g in group(rows, "item", "v").items():
    r, p = g["row"], pick(g["st"])
    if not p or not p[1] or not good_label(r.get("itemLabel")):
        continue
    y = year_of(p[1])
    add(f"cpop-{qid(k)}", "world", f"What was the population of {r['itemLabel']} in {y}?", p[0], "people",
        fact=f"{r['itemLabel']} had about {fmt(p[0])} people in {y}.")

rows = sparql("countries-area", f"""
SELECT ?item ?itemLabel ?itemDescription ?v ?rank WHERE {{
  ?item wdt:P31 wd:Q3624078. FILTER NOT EXISTS {{ ?item wdt:P31 wd:Q3024240 }}
  ?item p:P2046 ?s. ?s psn:P2046/wikibase:quantityAmount ?v; wikibase:rank ?rank.
  {LABEL} }}""")
for k, g in group(rows, "item", "v").items():
    r, p = g["row"], pick(g["st"])
    if not p or not good_label(r.get("itemLabel")):
        continue
    km2 = p[0] / 1e6
    add(f"carea-{qid(k)}", "world", f"What is the total area of {r['itemLabel']}?", km2, "km²",
        fact=f"{r['itemLabel']} covers about {fmt(km2)} km².")

print("cities")
rows = sparql("cities", f"""
SELECT ?item ?itemLabel ?countryLabel ?v ?rank ?date WHERE {{
  ?item wdt:P31/wdt:P279* wd:Q515; wdt:P1082 ?any. FILTER(?any >= 1000000)
  ?item p:P1082 ?s. ?s ps:P1082 ?v; wikibase:rank ?rank; pq:P585 ?date. FILTER(YEAR(?date) >= 2010)
  OPTIONAL {{ ?item wdt:P17 ?country }}
  {LABEL} }}""")
for k, g in group(rows, "item", "v").items():
    r, p = g["row"], pick(g["st"])
    if not p or not p[1] or p[0] < 1e6 or not good_label(r.get("itemLabel")):
        continue
    y = year_of(p[1])
    if not y or y < 1990:
        continue
    where = f"{r['itemLabel']}, {r['countryLabel']}" if good_label(r.get("countryLabel")) else r["itemLabel"]
    add(f"city-{qid(k)}", "world", f"What was the population of {where} in {y}?", p[0], "people",
        fact=f"{r['itemLabel']} counted about {fmt(p[0])} people in {y}.")

print("rivers")
rows = sparql("rivers", f"""
SELECT ?item ?itemLabel ?itemDescription ?v ?rank WHERE {{
  ?item wdt:P31 wd:Q4022; wikibase:sitelinks ?sl. FILTER(?sl >= 8)
  ?item p:P2043 ?s. ?s psn:P2043/wikibase:quantityAmount ?v; wikibase:rank ?rank. FILTER(?v >= 500000)
  {LABEL} }}""")
for k, g in group(rows, "item", "v").items():
    r, p = g["row"], pick(g["st"])
    if not p or not good_label(r.get("itemLabel")):
        continue
    km = p[0] / 1000
    name = r["itemLabel"] if "river" in r["itemLabel"].lower() else f"the {r['itemLabel']} river"
    add(f"river-{qid(k)}", "world", f"How long is {name}?", km, "km", fact=desc(r, r["itemLabel"]) or f"About {fmt(km)} km long.")

print("mountains")
for band, lo, hi in [("a", 6000, 6500), ("b", 6500, 7000), ("c", 7000, 9000)]:
    rows = sparql(f"mountains-{band}", f"""
    SELECT ?item ?itemLabel ?itemDescription ?v ?rank ?nepal WHERE {{
      ?item wdt:P31 wd:Q8502; wikibase:sitelinks ?sl. FILTER(?sl >= 4)
      ?item p:P2044 ?s. ?s psn:P2044/wikibase:quantityAmount ?v; wikibase:rank ?rank. FILTER(?v >= {lo} && ?v < {hi})
      BIND(EXISTS {{ ?item wdt:P17 wd:Q837 }} AS ?nepal)
      {LABEL} }}""")
    for k, g in group(rows, "item", "v").items():
        r, p = g["row"], pick(g["st"])
        if not p or not good_label(r.get("itemLabel")):
            continue
        cat = "nepal" if r.get("nepal") == "true" else "world"
        add(f"mtn-{qid(k)}", cat, f"How tall is {r['itemLabel']}?", p[0], "m", fact=desc(r, r["itemLabel"]) or f"{fmt(p[0])} m high.")

print("skyscrapers")
rows = sparql("skyscrapers", f"""
SELECT ?item ?itemLabel ?cityLabel ?v ?rank WHERE {{
  ?item wdt:P31 wd:Q11303; wikibase:sitelinks ?sl. FILTER(?sl >= 4)
  ?item p:P2048 ?s. ?s psn:P2048/wikibase:quantityAmount ?v; wikibase:rank ?rank. FILTER(?v >= 200)
  OPTIONAL {{ ?item wdt:P131 ?city }}
  {LABEL} }}""")
for k, g in group(rows, "item", "v").items():
    r, p = g["row"], pick(g["st"])
    if not p or not good_label(r.get("itemLabel")):
        continue
    where = f" in {r['cityLabel']}" if good_label(r.get("cityLabel")) else ""
    add(f"sky-{qid(k)}", "world", f"How tall is {r['itemLabel']}{where}?", p[0], "m",
        fact=f"{r['itemLabel']} stands about {fmt(p[0])} m tall.")

print("elements")
rows = sparql("elements", f"""
SELECT ?item ?itemLabel ?z ?disc ?mp WHERE {{
  ?item wdt:P31 wd:Q11344; wdt:P1086 ?z. FILTER(?z >= 1 && ?z <= 118)
  OPTIONAL {{ ?item wdt:P575 ?disc }}
  OPTIONAL {{ ?item p:P2101 ?ms. ?ms psn:P2101/wikibase:quantityAmount ?mp; wikibase:rank ?mr. FILTER(?mr != wikibase:DeprecatedRank) }}
  {LABEL} }}""")
els = {}
for r in rows:
    e = els.setdefault(r["item"], {"label": r.get("itemLabel"), "z": int(float(r["z"])), "disc": set(), "mp": set()})
    if r.get("disc"):
        y = year_of(r["disc"])
        if y:
            e["disc"].add(y)
    if r.get("mp"):
        e["mp"].add(round(float(r["mp"]) - 273.15, 1))
for k, e in els.items():
    if not good_label(e["label"]):
        continue
    L = e["label"].capitalize()
    add(f"elz-{qid(k)}", "world", f"What is the atomic number of {e['label']}?", e["z"], kind="lin", tol=4,
        fact=f"{L} has {e['z']} protons in its nucleus.")
    if len(e["disc"]) == 1:
        y = next(iter(e["disc"]))
        if y >= 1600:
            add(f"eld-{qid(k)}", "world", f"In what year was {e['label']} discovered?", y, kind="lin", tol=15,
                fact=f"{L} was discovered in {y}.")
    if len(e["mp"]) == 1:
        c = next(iter(e["mp"]))
        add(f"elm-{qid(k)}", "world", f"What is the melting point of {e['label']}, in °C?", c, "°C", kind="lin",
            tol=max(40, abs(c) * 0.15), fact=f"{L} melts at about {fmt(c)} °C.")

# ───────────────────────── NEPAL ─────────────────────────
print("nepal")
ADMIN = re.compile(r"district|municipality|metropolitan|province|zone|rural|ward|vdc|development committee", re.IGNORECASE)
REGION = re.compile(r"himalaya|range|region|valley|hills|plain|terai|basin|watershed", re.IGNORECASE)


def nepal_ok(kind, name, description):
    """Keep questions that have one clear answer: no 'altitude of a district' or 'area of the Himalayas'."""
    text = f"{name} {description}"
    if kind == "elev":
        building = re.search(r"campus|college|school|university|hospital|bank|hotel|stadium|office|company", text, re.IGNORECASE)
        return not ADMIN.search(text) and not REGION.search(text) and not building
    if kind == "len":
        return bool(re.search(r"river|khola|nadi", text, re.IGNORECASE))
    if kind == "area":
        return bool(re.search(r"district|municipality|metropolitan|national park|conservation|reserve|lake|province", text, re.IGNORECASE))
    return not REGION.search(text) and not re.search(r"ethnic|people|caste|tribe", text, re.IGNORECASE)


for prop, label, unit, conv, tmpl in [
    ("P2044", "elev", "m", 1, "At what altitude is {x}?"),
    ("P2046", "area", "km²", 1e-6, "What is the area of {x}?"),
    ("P2043", "len", "km", 1e-3, "How long is {x}?"),
]:
    rows = sparql(f"nepal-{label}", f"""
    SELECT ?item ?itemLabel ?itemDescription ?v ?rank WHERE {{
      ?item wdt:P17 wd:Q837; wikibase:sitelinks ?sl. FILTER(?sl >= 3)
      ?item p:{prop} ?s. ?s psn:{prop}/wikibase:quantityAmount ?v; wikibase:rank ?rank.
      {LABEL} }}""")
    for k, g in group(rows, "item", "v").items():
        r, p = g["row"], pick(g["st"])
        if not p or not good_label(r.get("itemLabel")):
            continue
        v = p[0] * conv
        name = r["itemLabel"]
        if v <= 0 or not nepal_ok(label, name, r.get("itemDescription", "")):
            continue
        add(f"np{label}-{qid(k)}", "nepal", tmpl.format(x=r["itemLabel"]), v, unit,
            fact=desc(r, r["itemLabel"]) or f"{fmt(v)} {unit}.")
rows = sparql("nepal-pop", f"""
SELECT ?item ?itemLabel ?itemDescription ?v ?rank ?date WHERE {{
  ?item wdt:P17 wd:Q837; wikibase:sitelinks ?sl. FILTER(?sl >= 3)
  FILTER(?item != wd:Q837)
  ?item p:P1082 ?s. ?s ps:P1082 ?v; wikibase:rank ?rank. OPTIONAL {{ ?s pq:P585 ?date }}
  {LABEL} }}""")
for k, g in group(rows, "item", "v").items():
    r, p = g["row"], pick(g["st"])
    if not p or not p[1] or p[0] < 10000 or not good_label(r.get("itemLabel")):
        continue
    y = year_of(p[1])
    if not y or y < 2011 or not nepal_ok("pop", r["itemLabel"], r.get("itemDescription", "")):
        continue
    add(f"nppop-{qid(k)}", "nepal", f"What was the population of {r['itemLabel']} in {y}?", p[0], "people",
        fact=desc(r, r["itemLabel"]) or f"About {fmt(p[0])} people in {y}.")

# ───────────────────────── TECH ─────────────────────────
print("tech")
def year_items(name, cls, min_sl, cat, tmpl, tol, extra="", reroute=None, need_one_by=False, direct=False):
    """reroute: {qid: (cat, template)} — e.g. video games found in the software list go to culture."""
    rows = sparql(name, f"""
    SELECT ?item ?itemLabel ?itemDescription ?d {extra and '?byLabel'} WHERE {{
      ?item {"wdt:P31" if direct else "wdt:P31/wdt:P279*"} wd:{cls}; wikibase:sitelinks ?sl. FILTER(?sl >= {min_sl})
      {{ ?item wdt:P577 ?d }} UNION {{ ?item wdt:P571 ?d }}
      {extra}
      {LABEL} }}""")
    best = {}
    for r in rows:
        y = year_of(r.get("d"))
        if not y or not good_label(r.get("itemLabel")):
            continue
        b = best.setdefault(r["item"], {"row": r, "y": y, "by": set()})
        b["y"] = min(b["y"], y)
        if good_label(r.get("byLabel")):
            b["by"].add(r["byLabel"])
    for k, b in best.items():
        r, y = b["row"], b["y"]
        if y < 1800 or y > 2026 or "wikipedia" in r["itemLabel"].lower():
            continue
        if need_one_by and len(b["by"]) != 1:
            continue  # e.g. anthems/librettos filed as "literary work" have no single author
        by = f" ({next(iter(b['by']))})" if len(b["by"]) == 1 else ""  # only when unambiguous
        c, t = (reroute or {}).get(qid(k), (cat, tmpl))
        add(f"{name}-{qid(k)}", c, t.format(x=r["itemLabel"], by=by), y, kind="lin", tol=tol,
            fact=desc(r, r["itemLabel"]) or f"First released in {y}.")

year_items("lang", "Q9143", 10, "tech", "In what year was the {x} programming language first released?", 5)
games = {qid(r["item"]) for r in sparql("games", """
SELECT DISTINCT ?item WHERE { ?item wdt:P31 wd:Q7889; wikibase:sitelinks ?sl. FILTER(?sl >= 25) }""")}
year_items("software", "Q7397", 25, "tech", "In what year was {x} first released?", 4,
           reroute={g: ("culture", "In what year was the video game {x} released?") for g in games})

raw = fetch("http-status.csv", "https://www.iana.org/assignments/http-status-codes/http-status-codes-1.csv", 200_000)
if raw:
    for row in csv.DictReader(io.StringIO(raw.decode("utf-8"))):
        v, d = row.get("Value", ""), (row.get("Description") or "").strip()
        if v.isdigit() and d and d.lower() not in ("unassigned", "(unused)"):
            add(f"http-{v}", "tech", f'What HTTP status code means "{d}"?', int(v), kind="lin", tol=25,
                fact=f"{v} {d} — from the IANA HTTP status code registry.")

# well-known services only (IANA service name → how players know it)
PORTS = {
    "ftp": "FTP (control)", "ssh": "SSH", "telnet": "Telnet", "smtp": "SMTP", "domain": "DNS", "tftp": "TFTP",
    "http": "HTTP", "kerberos": "Kerberos", "pop3": "POP3", "ntp": "NTP", "imap": "IMAP", "snmp": "SNMP",
    "bgp": "BGP", "ldap": "LDAP", "https": "HTTPS", "submission": "SMTP submission", "ldaps": "LDAPS",
    "imaps": "IMAPS", "pop3s": "POP3S", "ms-sql-s": "Microsoft SQL Server", "mysql": "MySQL",
    "ms-wbt-server": "Remote Desktop (RDP)", "postgresql": "PostgreSQL", "amqp": "AMQP (RabbitMQ)",
    "xmpp-client": "XMPP client", "rfb": "VNC", "redis": "Redis", "mongodb": "MongoDB", "mqtt": "MQTT",
    "sip": "SIP", "bootps": "DHCP server", "syslog": "Syslog", "rsync": "rsync", "openvpn": "OpenVPN",
    "nfs": "NFS", "irc": "IRC", "memcache": "Memcached", "http-alt": "HTTP alternate", "git": "git://",
    "svn": "Subversion", "zabbix-agent": "Zabbix agent", "kafka": "Kafka", "etcd-client": "etcd client",
    "cassandra": "Cassandra",
}
raw = fetch("ports.csv", "https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.csv", 5_000_000)
if raw:
    got = {}
    for row in csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))):
        name, port, proto = (row.get("Service Name") or "").strip(), (row.get("Port Number") or "").strip(), row.get("Transport Protocol")
        if name in PORTS and port.isdigit() and proto in ("tcp", "udp") and name not in got:
            got[name] = int(port)
    for name, port in got.items():
        add(f"port-{name}", "tech", f"What port is registered for {PORTS[name]}?", port, kind="lin", tol=max(5, port * 0.08),
            fact=f"IANA registers port {port} for '{name}'.")

# ───────────────────────── CULTURE ─────────────────────────
print("culture")
for band, lo, hi in [("f", 35, 38), ("g", 38, 42), ("e", 42, 50), ("a", 50, 70), ("b", 70, 100), ("c", 100, 1000)]:
    year_items(f"film{band}", "Q11424", lo, "culture", "In what year was the film {x}{by} released?", 5,
               extra=f"FILTER(?sl < {hi}) OPTIONAL {{ ?item wdt:P57 ?by }}", direct=band in ("e", "f", "g"))
for band, lo, hi in [("c", 20, 30), ("a", 30, 45), ("b", 45, 1000)]:
    year_items(f"book{band}", "Q7725634", lo, "culture", "In what year was {x}{by} first published?", 6,
               extra=f"FILTER(?sl < {hi}) OPTIONAL {{ ?item wdt:P50 ?by }}", need_one_by=True)

# ───────────────────────── write ─────────────────────────
# same question text for two different things (two cities called Suzhou, several Salado Rivers) is
# unanswerable — drop every copy
for f in facts:
    f["q"] = f["q"].replace("People's Republic of China", "China")
texts = Counter(f["q"] for f in facts)
facts = [f for f in facts if texts[f["q"]] == 1]
print("facts by category:", dict(Counter(f["cat"] for f in facts)), "total", len(facts))
if len(facts) < 100:
    sys.exit("too few facts generated — not overwriting data/hunch-generated.json")
with open(f"{ROOT}/data/hunch-generated.json", "w") as f:
    json.dump(facts, f, ensure_ascii=False, separators=(",", ":"))
