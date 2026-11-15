"""Duplicate removal and rule-based exclusion (Table 2.1). Every decision is logged."""
import json, re, csv
from collections import Counter
d=json.load(open("identified.json"))
norm=lambda s: re.sub(r"[^a-z0-9]","",(s or "").lower())
seen={}; dup=0; recs=[]
for r in d["records"]:
    k=(r["doi"] or "").lower() or norm(r["title"])
    k2=norm(r["title"])
    if k in seen or k2 in seen:
        seen.get(k, seen.get(k2))["groups"].add(r["group"]); dup+=1; continue
    r["groups"]={r["group"]}; seen[k]=r; seen[k2]=r; recs.append(r)
KEEP_TYPES={"article","conference-paper","preprint","review","report"}
LM=re.compile(r"language model|\bllms?\b|\bslms?\b|\bgpt|chatbot|chat ?gpt|retrieval[- ]augmented|\brag\b|graphrag|generative ai|conversational (agent|ai|assistant)|foundation model",re.I)
reasons=Counter(); kept=[]
for r in recs:
    text=r["title"]+" "+r["abstract"]
    if r["type"] not in KEEP_TYPES: why=f"publication type: {r['type']}"
    elif r["lang"] and r["lang"]!="en": why="not English"
    elif len(r["abstract"])<200: why="no abstract sufficient for assessment"
    elif not LM.search(text): why="not about language models"
    else: why=""
    r["stage_a"]=why or "pass"
    if why: reasons[why.split(":")[0]]+=1
    else: kept.append(r)
print("identified",len(d["records"]),"duplicates",dup,"unique",len(recs))
print("excluded at rules:",sum(reasons.values()),dict(reasons)); print("to title/abstract screening:",len(kept))
json.dump([{**r,"groups":sorted(r["groups"])} for r in recs],open("unique.json","w"),indent=1)
