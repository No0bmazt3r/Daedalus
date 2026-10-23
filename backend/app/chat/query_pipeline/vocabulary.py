"""The words the query pipeline recognises, kept in one place.

Every stage — normaliser, safety guard, follow-up rewriting, intent classifier —
matches against the text the normaliser produces (`NormalisedQuery.match`:
NFKC-folded, lower-cased), so `CO₂` and `CO2` are one token here and no
pattern needs to spell both. Lists, not a model, because every one of these is
read by an examiner asking "why did it decide that?" and must answer in one
line.

Malay appears alongside English in the few places it matters most — the
control verbs and the plant nouns the safety guard keys on. The lab is in
Malaysia and an operator typing "buka injap" is asking to open a valve; a guard
that only understood English would let that through.
"""

from __future__ import annotations

import re

# ── sensors ──────────────────────────────────────────────────────────────────
#
# Friendly name → how it is written in a question. The friendly names are the
# whitelist PROJECT.md §7.2 gives the tool layer; the column each maps to lives
# there, not here. `display` is how a rewritten question names it.

SENSORS: dict[str, dict[str, object]] = {
    "temperature": {
        "display": "temperature",
        "pattern": r"\btemp(?:erature)?s?\b|°\s*c\b|\bdegrees?(?:\s+c(?:elsius)?)?\b|\bsuhu\b",
    },
    "pressure": {
        "display": "pressure",
        "pattern": r"\bpressures?\b|\bbarg?\b|\bpsi\b|\btekanan\b",
    },
    "ph": {
        "display": "pH",
        "pattern": r"\bp\.?h\b|\bacidity\b|\balkalinity\b",
    },
    "level": {
        "display": "level",
        "pattern": r"\b(?:liquid|tank|fill|reactor)\s+levels?\b|\blevels?\b|\bparas\b",
    },
    "co2": {
        "display": "CO2",
        "pattern": r"\bco2\b|\bcarbon\s+dioxide\b|\bndir\b|\bppm\b|\bkarbon\s+dioksida\b",
    },
    "mode": {
        "display": "mode",
        "pattern": r"\b(?:operating\s+)?modes?\b|\boperating\s+phase\b|\bin\s+(?:absorption|desorption)\b",
    },
}

SENSOR_RES = {name: re.compile(str(spec["pattern"])) for name, spec in SENSORS.items()}


def find_sensors(text: str) -> list[tuple[str, int, int]]:
    """Every sensor mention as (name, start, end), in reading order."""
    hits: list[tuple[str, int, int]] = []
    for name, pattern in SENSOR_RES.items():
        for m in pattern.finditer(text):
            hits.append((name, m.start(), m.end()))
    hits.sort(key=lambda h: h[1])
    # A longer match wins where two overlap ("tank level" over "level").
    kept: list[tuple[str, int, int]] = []
    for hit in hits:
        if kept and hit[1] < kept[-1][2]:
            if hit[2] - hit[1] > kept[-1][2] - kept[-1][1]:
                kept[-1] = hit
            continue
        kept.append(hit)
    # "CO2 level", "pH level": `level` there is a word about the sensor before
    # it, not the tank-level sensor. A bare "level" directly after another
    # sensor's name is dropped; "tank level" and "the level" are kept.
    return [
        hit for i, hit in enumerate(kept)
        if not (
            hit[0] == "level" and i and kept[i - 1][0] != "level"
            and not text[kept[i - 1][2]:hit[1]].strip()
            and text[hit[1]:hit[2]].startswith("level")
        )
    ]


# ── time ─────────────────────────────────────────────────────────────────────
#
# Two kinds, because they decide different intents: a *point* ("at 10:00") asks
# what a value was then (`historical_query`); a *window* ("over the last hour",
# "this morning") asks about a stretch of time (`trend_query`).

_UNIT = r"(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|h|days?|weeks?|shifts?|months?)"

TIME_POINT_RE = re.compile(
    r"\b(?:at|around|about|near|by|before|after|exactly)\s+\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\b"
    r"|\b\d{1,2}:\d{2}\s*(?:am|pm)?\b"
    r"|\b\d{1,2}\s*(?:am|pm)\b"
    r"|\b\d{4}-\d{2}-\d{2}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?)?\b"
    r"|\bpukul\s+\d{1,2}(?:[:.]\d{2})?\b"
)

TIME_WINDOW_RE = re.compile(
    rf"\b(?:in\s+the\s+|over\s+the\s+|during\s+the\s+|for\s+the\s+)?(?:last|past|previous)\s+(?:\d+\s+|few\s+|couple\s+of\s+)?{_UNIT}\b"
    r"|\b(?:today|yesterday|tonight|overnight|this\s+(?:morning|afternoon|evening|week|shift|run|cycle)"
    r"|last\s+(?:night|week|run|cycle|shift)|earlier(?:\s+today)?|so\s+far(?:\s+today)?)\b"
    r"|\bbetween\s+\S+\s+and\s+\S+"
    r"|\bsince\s+(?:\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?|this\s+morning|yesterday|midnight|startup|start-?up|the\s+start|morning)\b"
    r"|\b(?:semalam|pagi\s+ini|hari\s+ini)\b"
)


def find_time(text: str) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    """(point spans, window spans). A span inside a window is not also a point."""
    windows = [(m.start(), m.end()) for m in TIME_WINDOW_RE.finditer(text)]
    points = [
        (m.start(), m.end())
        for m in TIME_POINT_RE.finditer(text)
        if not any(ws <= m.start() < we for ws, we in windows)
    ]
    return points, windows


# ── what a question is asking for ────────────────────────────────────────────

LIVE_RE = re.compile(
    r"\b(?:now|right\s+now|currently|current|at\s+the\s+moment|at\s+present|presently|latest"
    r"|live|real[- ]?time|as\s+of\s+now|sekarang|terkini)\b"
)

STATUS_RE = re.compile(
    r"\b(?:status|state|condition|health|healthy|how\s+is|how's|how\s+are"
    r"|running\s+(?:fine|ok|okay|well|normally|smoothly)"
    r"|(?:is|are)\s+(?:it|things|the\s+reactor|the\s+rig|the\s+plant|everything)\s+(?:ok|okay|fine|normal|alright|running|working|stable))\b"
)

TREND_RE = re.compile(
    r"\b(?:average|avg|mean|median|min|minimum|max|maximum|highest|lowest|peak|peaked|trend|trends|trending"
    r"|range|variance|std|standard\s+deviation|fluctuat\w*|stable|stability|over\s+time|rate\s+of\s+change"
    r"|rising|rose|risen|falling|fell|dropp?(?:ed|ing)|increas\w*|decreas\w*|went\s+(?:up|down)"
    r"|changed|changes|compare|comparison|summar(?:y|ise|ize)|how\s+many\s+(?:readings|samples|times)"
    r"|purata|tertinggi|terendah)\b"
)

SOP_STRONG_RE = re.compile(
    r"\b(?:sops?|procedures?|manuals?|instructions?|guidelines?|protocols?|checklists?|step[- ]by[- ]step"
    r"|steps|troubleshoot\w*|calibrat\w*|recalibrat\w*|maintenance|maintain|servic(?:e|ing)|clean(?:ing)?"
    r"|replac(?:e|ing)|install\w*|safety\s+(?:procedures?|precautions?|rules?|measures?)|ppe|uauc|sds|lockout|tagout"
    r"|how\s+(?:do|should|can|would|could)\s+(?:i|we|you|one|an\s+operator)|how\s+to"
    r"|what\s+(?:should|do|must)\s+(?:i|we)\s+do|what\s+to\s+do|recommended|best\s+practice"
    r"|bagaimana|prosedur|langkah)\b"
)
SOP_WEAK_RE = re.compile(
    r"\b(?:what\s+is|what\s+are|what\s+does|what's|explain|meaning\s+of|define|definition|describe"
    r"|tell\s+me\s+about|how\s+does|purpose\s+of|apa\s+itu)\b"
)

CAUSAL_RE = re.compile(
    r"\b(?:why|what\s+caused|what\s+causes|cause[sd]?\s+of|caus(?:e|ing)|reason\s+(?:for|why)|root\s+cause"
    r"|diagnos\w*|what\s+happened|what\s+went\s+wrong|should\s+i\s+(?:be\s+)?(?:worried|concerned)"
    r"|(?:is|was)\s+(?:this|that|it)\s+(?:normal|expected|a\s+problem|dangerous|safe|bad)"
    r"|kenapa|mengapa|punca)\b"
)

# Anything that places a question inside this project's world. A question with
# none of these, no sensor and no SOP cue is `out_of_scope`.
DOMAIN_RE = re.compile(
    r"\b(?:sorption|absorption|adsorption|desorption|sorbent|sorbents|reactor|reactors|rig|plant|lab|laboratory"
    r"|carbon\s+capture|scada|sensors?|ndir|valves?|abv[-\s]?\d*|pumps?|amine|amines|solvent|solvents|column"
    r"|gas|gases|flow|flowrate|inlet|outlet|heater|heaters|chiller|readings?|measurements?|telemetry|data"
    r"|cycle|cycles|batch|experiment|process|operator|daedalus|sop|calibration|alarm|anomaly|anomalies"
    r"|co2sorptiondt|digital\s+twin|injap|pam|reaktor|bacaan)\b"
)

SMALLTALK_RE = re.compile(
    r"^(?:hi|hello|hey|hai|helo|yo|good\s+(?:morning|afternoon|evening|day)|selamat\s+\w+"
    r"|thanks?|thank\s+you|thx|ty|terima\s+kasih|ok|okay|cool|great|nice|bye|goodbye)\b[\s!.?]*$"
)
# Questions about the assistant itself. Conversational fillers in front ("so
# yea what is this about") are allowed, because that is how people actually
# open a chat, and without them the question fell through to `out_of_scope` —
# the one reply that tells a new operator nothing about what to ask.
_FILLER = r"(?:(?:so|ok|okay|yeah|yea|ya|um|uh|hmm|hey|hi|hello|and|but|well|then)[\s,.!]+)*"
ABOUT_RE = re.compile(
    rf"^{_FILLER}(?:who\s+are\s+you|what\s+are\s+you(?:\s+for)?|what\s+can\s+you\s+do|what\s+do\s+you\s+do"
    r"|help|how\s+do\s+i\s+use\s+(?:you|this)|what\s+can\s+i\s+ask(?:\s+you)?"
    r"|what(?:'s|\s+is)\s+(?:this|this\s+(?:about|for|app|thing|system|tool|chat)|it\s+about|daedalus)"
    r"|what(?:'s|\s+is)\s+(?:your|the)\s+(?:purpose|job|role|function|point)"
    r"|what\s+(?:does|do)\s+(?:this|daedalus|it)\s+do|why\s+(?:are\s+you\s+here|do\s+you\s+exist)"
    r"|tell\s+me\s+about\s+(?:yourself|you|daedalus|this\s+(?:app|system|tool)))\b[\s!.?]*$"
)

# Malay function words, for flagging the language rather than refusing it.
MALAY_RE = re.compile(
    r"\b(?:apa|apakah|bagaimana|berapa|adakah|kenapa|mengapa|sekarang|tolong|boleh|saya|kita|ini|itu"
    r"|dengan|untuk|yang|dan|atau|tidak|suhu|tekanan|bacaan|injap|pam|buka|tutup)\b"
)


# ── control, for the safety guard ────────────────────────────────────────────
#
# Split by what a verb acts on, because the object decides whether a sentence
# is a command to the plant. "Open the SOP" is a request to read a document;
# "open ABV-1" is a request to move hardware. The verb alone cannot tell them
# apart, so every command pattern needs a verb *and* a target of its class.

# Acts on equipment.
ACTUATE_VERBS = (
    r"turn\s+(?:on|off)|turn|switch\s+(?:on|off)|switch|power\s+(?:on|off|up|down)|power"
    r"|shut\s+(?:down|off)|shut|open|close|start|restart|stop|halt|pause|resume|begin|initiate|abort"
    r"|activate|deactivate|enable|disable|trigger|actuate|engage|disengage|energi[sz]e|de-?energi[sz]e"
    r"|run|kill|toggle|cycle|purge|vent|drain|fill|flush|bypass|override|reset|reboot"
    r"|calibrate|recalibrate|zero|acknowledge|ack|silence|mute|dismiss|clear"
    r"|buka|tutup|hidupkan|matikan|mulakan|hentikan|nyalakan|padamkan"
)
# Changes a setpoint or a mode.
ADJUST_VERBS = (
    r"set(?!\s+up)|change|adjust|increase|decrease|raise|lower|reduce|boost|tune|modify|ramp"
    r"|tukar|tetapkan|naikkan|turunkan|ubah"
)
# Writes or erases records.
DATA_VERBS = (
    r"delete|remove|erase|drop|truncate|update|insert|write|overwrite|edit|modify|alter|clear|wipe"
    r"|reset|backfill|correct|fix|change|purge|padam|hapus"
)

PLANT_TARGET_RE = re.compile(
    r"\b(?:valves?|abv[-\s]?\d*|pumps?|heaters?|chillers?|coolers?|fans?|blowers?|compressors?|mixers?"
    r"|stirrers?|agitators?|reactors?|columns?|sensors?|actuators?|solenoids?|motors?|relays?|breakers?"
    r"|power|gas\s+(?:flow|supply|feed)|flow|feed|inlet|outlet|supply|setpoints?|set\s+points?|modes?"
    r"|cycles?|process|absorption|desorption|alarms?|interlocks?|scada|plc|system|plant|equipment|rig"
    r"|ndir|heating|cooling|injap|pam|pemanas|reaktor|penggera)\b"
)
PARAMETER_TARGET_RE = re.compile(
    r"\b(?:temp(?:erature)?|pressure|p\.?h|levels?|co2|concentration|flow\s*rate|flowrate|flow|speed|rpm"
    r"|setpoints?|set\s+points?|modes?|duty|power|suhu|tekanan)\b"
)
DATA_TARGET_RE = re.compile(
    r"\b(?:database|db|tables?|records?|readings?|data|logs?|entry|entries|values?|rows?|history"
    r"|flags?|measurements?|telemetry|timestamps?)\b"
)
# Verbs too general to trust with a distant object: "run a report on the sensor"
# is analysis, "run the pump" is not. For these the target must follow closely.
WEAK_VERBS = frozenset({"run", "cycle", "fill", "reset", "clear", "zero", "trigger", "toggle", "move"})

# The object is something to read, not something to move: "open the SOP for
# NDIR calibration", "change the chart to pressure".
DOCUMENT_OBJECT_RE = re.compile(
    r"^\s*(?:up\s+|me\s+)?(?:the\s+|a\s+|an\s+|my\s+|this\s+|that\s+)?(?:[\w-]+\s+){0,2}"
    r"(?:sops?|manuals?|documents?|docs?|files?|pdfs?|reports?|pages?|procedures?|guides?|instructions?"
    r"|checklists?|dashboard|charts?|graphs?|plots?|views?|windows?|tabs?|settings|forge|blueprints"
    r"|conversation|chat|session|summary|table\s+of|list)\b"
)

# "put the reactor into desorption", "bring the pressure down".
PLACEMENT_RE = re.compile(
    r"^(?:bring|put|move|take|place|send)\s+(?P<rest>.{0,60}?)\b(?:to|into|in|up|down|online|offline|back)\b"
)

PRONOUN_TARGET_RE = re.compile(r"^\s*(?:it|that|this|them|those|these|everything|all)\b")

# Asking the assistant to act, rather than asking it something.
REQUEST_PREFIX_RE = re.compile(
    r"^(?:(?:please|pls|plz|kindly|now|just|quickly|immediately|right\s+now|ok|okay|alright|hey|so|then|and|also"
    r"|daedalus|go\s+ahead\s+and|i\s+want\s+you\s+to|i\s+need\s+you\s+to|i'?d\s+like\s+you\s+to"
    r"|i\s+would\s+like\s+you\s+to|you\s+(?:should|must|need\s+to|have\s+to|can)"
    r"|(?:can|could|would|will)\s+(?:you|u)(?:\s+please)?|try\s+to|help\s+me|tolong|sila|boleh)"
    r"[\s,]+)+"
)

# Words that never start a command: a clause opening with one of these is a
# question about the plant, however many control words follow.
QUESTION_START_RE = re.compile(
    r"^(?:how|what|why|when|where|which|who|whom|whose|is|are|was|were|does|do|did|has|have|had"
    r"|should|shall|may|might|if|whether|in\s+case|tell\s+me|explain|show\s+me|describe|bagaimana|apa|kenapa)\b"
)

SQL_WRITE_RE = re.compile(
    r"\b(?:drop\s+(?:table|database)|delete\s+from|insert\s+into|update\s+\w+\s+set|alter\s+table"
    r"|truncate\s+(?:table\s+)?\w+|replace\s+into)\b"
)

OVERRIDE_RE = re.compile(
    r"\b(?:ignore|disregard|forget|override|bypass|turn\s+off|disable)\b.{0,40}?"
    r"\b(?:instructions?|rules?|guard(?:rails?)?|safety|previous|prompt|system\s+prompt|restrictions?"
    r"|read[- ]only|limitations?|policy|policies)\b"
    r"|\b(?:you\s+are\s+now|from\s+now\s+on\s+you|act\s+as\s+(?:an?\s+)?(?:operator|admin|root|controller)"
    r"|pretend\s+(?:to\s+be|you\s+(?:are|can))|developer\s+mode|jailbreak|dan\s+mode|sudo)\b"
)

# Splits a message into clauses, so "tell me the pressure and then open ABV-1"
# is checked as two requests rather than one question.
CLAUSE_SPLIT_RE = re.compile(
    r"[.;!?\n]+|,\s*|\s+(?:and\s+then|and|then|also|after\s+that|afterwards|next|plus|lalu|kemudian|dan)\s+"
)
