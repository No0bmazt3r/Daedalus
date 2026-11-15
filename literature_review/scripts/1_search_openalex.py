"""PRISMA identification step: run each logged query on OpenAlex, save every record."""
import json, urllib.error, urllib.request, urllib.parse, time, datetime
UA={"User-Agent":"lit-review-script/1.0"}
DATE="from_publication_date:2023-01-01,to_publication_date:2026-12-31"
QUERIES={
 "G1": '("small language model" OR "on-device language model" OR "edge LLM") AND (industrial OR IoT OR SCADA OR sensor)',
 "G2": '("tool calling" OR "function calling" OR "LLM agent" OR ReAct) AND (SCADA OR "industrial IoT" OR IIoT OR "sensor data")',
 "G3": '("retrieval-augmented generation" OR RAG) AND (SCADA OR "industrial IoT" OR IIoT OR "sensor data" OR "process plant")',
 "G4": '("large language model" OR LLM OR chatbot OR conversational) AND (SCADA OR HMI OR "human-machine interface")',
 "G5": '("GraphRAG" OR "graph RAG" OR "graph retrieval-augmented generation") AND ("vector RAG" OR versus OR comparison OR "systematic evaluation")',
}
def inv(ab):
    if not ab: return ""
    pos=[(p,w) for w,ps in ab.items() for p in ps]; return " ".join(w for _,w in sorted(pos))
out={"run_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"database":"OpenAlex (api.openalex.org)","filter":DATE,"queries":QUERIES,"counts":{},"records":[]}
for g,q in QUERIES.items():
    page=1; n=0
    while page:
        url="https://api.openalex.org/works?"+urllib.parse.urlencode({"filter":f"title_and_abstract.search:{q},{DATE}","per-page":200,"page":page,
            "select":"id,doi,title,publication_year,type,language,primary_location,abstract_inverted_index"})
        for attempt in range(8):
            try:
                d=json.load(urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=60)); break
            except urllib.error.HTTPError as e:
                if e.code not in (401,429,503) or attempt==7: raise
                time.sleep(15*(attempt+1))
        out["counts"][g]=d["meta"]["count"]
        for w in d["results"]:
            src=((w.get("primary_location") or {}).get("source") or {}).get("display_name")
            out["records"].append({"group":g,"id":w["id"],"doi":w.get("doi"),"title":w.get("title") or "","year":w.get("publication_year"),
                "type":w.get("type"),"lang":w.get("language"),"venue":src,"abstract":inv(w.get("abstract_inverted_index"))})
            n+=1
        page=page+1 if d["results"] and page*200<d["meta"]["count"] else None
        time.sleep(2)
    print(g, out["counts"][g], "fetched", n)
json.dump(out,open("identified.json","w"),indent=1)
