"""Load pages in headless Firefox, inject src/core.js, print the top candidates: probe.py URL [URL ...] [--n 3].
Run: LD_LIBRARY_PATH=<firefox libs> ~/.local/venv-browser/bin/python -I tests/probe.py URL"""
import json, pathlib, sys
from playwright.sync_api import sync_playwright

CORE = pathlib.Path(__file__).resolve().parents[1] / "src/core.js"
JS = """(n) => { const t0 = performance.now(); const c = TableGrabber.detect(document);
  const nx = TableGrabber.findNext(document);
  return {ms: Math.round(performance.now() - t0), next: nx, cands: c.slice(0, n).map(x => ({kind: x.kind, sel: x.selector || "",
    n: x.rows.length, cols: x.columns.filter((c, i) => !(x.hidden || [])[i]), score: Math.round(x.score), sample: x.rows.slice(0, 2)}))}; }"""

def main(urls, n=3):
    with sync_playwright() as p:
        b = p.firefox.launch()
        pg = b.new_context(bypass_csp=True).new_page()
        for u in urls:
            pg.goto(u, wait_until="load", timeout=60000)
            pg.add_script_tag(path=str(CORE))
            r = pg.evaluate(JS, n)
            print(f"=== {u}  ({r['ms']} ms)  next={r['next'] and (r['next']['href'] or r['next']['selector'])}")
            for c in r["cands"]:
                print(f"  [{c['kind']}] {c['n']} rows  score={c['score']}  {c['sel'][-70:]}")
                print("     cols:", c["cols"][:10])
                for s in c["sample"]:
                    print("     ", json.dumps(s, ensure_ascii=False)[:300])
        b.close()

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a.startswith("http")]
    main(args, int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 3)
