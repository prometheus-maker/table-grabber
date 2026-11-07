"""Score detection quality on a golden set of real pages: golden.py [golden.json] [--only SUBSTRING].
Run: tests/fx.sh tests/golden.py
For each page in golden.json the TOP candidate of TableGrabber.detect() must match the expectation (top1);
we also report whether any of the top 3 candidates matches (top3). Results go to tests/golden-results.json."""
import json, pathlib, sys, time
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
CORE = HERE.parent / "src/core.js"
JS = """() => TableGrabber.detect(document).slice(0, 3).map(x => {
  const keep = x.columns.map((c, i) => !(x.hidden || [])[i]);
  return {kind: x.kind, selector: x.selector || "", n: x.rows.length,
    cols: x.columns.filter((c, i) => keep[i]),
    rows: x.rows.map(r => r.filter((v, i) => keep[i]))}; })"""


def check(exp, c):
    """Return a list of problems (empty = match). Hidden columns don't count: the user doesn't see them."""
    why = []
    if exp.get("kind", "any") not in ("any", c["kind"]):
        why.append(f"kind {c['kind']}!={exp['kind']}")
    lo, hi = exp.get("min_rows", 1), exp.get("max_rows", 10 ** 9)
    if not lo <= c["n"] <= hi:
        why.append(f"rows {c['n']} not in [{lo},{hi}]")
    first = " ␟ ".join(c["rows"][0]) if c["rows"] else ""
    miss = [s for s in exp.get("first_item_contains", []) if s not in first]
    if miss:
        why.append(f"row0 lacks {miss}")
    rows = [" ␟ ".join(r) for r in c["rows"]]
    miss = [s for s in exp.get("any_row_contains", []) if not any(s in r for r in rows)]
    if miss:
        why.append(f"no row has {miss}")
    return why


def main():
    args = sys.argv[1:]
    only = args[args.index("--only") + 1] if "--only" in args else None
    files = [a for a in args if a.endswith(".json")]
    gold = json.loads(pathlib.Path(files[0] if files else HERE / "golden.json").read_text())
    if only:
        gold = [g for g in gold if only in g["url"]]
    results, t1, t3 = [], 0, 0
    with sync_playwright() as p:
        b = p.firefox.launch()
        ctx = b.new_context(bypass_csp=True, viewport={"width": 1366, "height": 900})
        for g in gold:
            r = {"url": g["url"], "category": g.get("category", "")}
            pg = ctx.new_page()
            try:
                t0 = time.time()
                pg.goto(g["url"], wait_until="commit", timeout=45000)
                for state, ms in (("domcontentloaded", 40000), ("load", 20000)):
                    try:  # some pages never fire these (long polling, slow trackers): use what has rendered
                        pg.wait_for_load_state(state, timeout=ms)
                    except Exception:
                        pass
                pg.wait_for_timeout(g.get("wait_ms", 3000))  # let client-side lists render
                pg.add_script_tag(path=str(CORE))
                cands = pg.evaluate(JS)
                r["cands"] = [{"kind": c["kind"], "n": c["n"], "cols": c["cols"][:12], "selector": c["selector"],
                               "row0": c["rows"][0][:12] if c["rows"] else []} for c in cands]
                probs = [check(g, c) for c in cands]
                r["top1"] = bool(cands) and not probs[0]
                r["top3"] = any(not x for x in probs)
                r["top1_problems"] = probs[0] if cands else ["no candidates"]
                r["match_rank"] = next((i + 1 for i, x in enumerate(probs) if not x), None)
                r["secs"] = round(time.time() - t0, 1)
            except Exception as e:  # a page that fails to load counts as a failure, not a crash
                r.update(top1=False, top3=False, error=str(e).splitlines()[0][:200], cands=[])
            finally:
                pg.close()
            t1 += r["top1"]
            t3 += r["top3"]
            results.append(r)
            top = r["cands"][0] if r["cands"] else None
            desc = f"{top['kind']} {top['n']}r {len(top['cols'])}c" if top else r.get("error", "no candidates")
            status = "PASS" if r["top1"] else ("top3" if r["top3"] else "FAIL")
            print(f"{status:4}  {g['url'][:80]:80}  top: {desc}" +
                  ("" if r["top1"] else f"  | {'; '.join(r.get('top1_problems', []))}"
                   + (f" (match at #{r['match_rank']})" if r.get("match_rank") else "")), flush=True)
        b.close()
    print(f"top1 {t1}/{len(gold)}, top3 {t3}/{len(gold)}")
    if not only:
        (HERE / "golden-results.json").write_text(json.dumps(
            {"top1": t1, "top3": t3, "n": len(gold), "pages": results}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
