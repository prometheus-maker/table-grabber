#!/usr/bin/env python3
"""Build the Chromium (Chrome / Edge / Opera) package: dist/chromium/ + dist/table-grabber-chromium-VERSION.zip.
Same code as Firefox; only the manifest differs (service_worker background, no gecko settings)."""
import json, pathlib, shutil, zipfile
root = pathlib.Path(__file__).resolve().parent.parent
m = json.loads((root / "manifest.json").read_text())
m.pop("browser_specific_settings", None)
m["background"] = {"service_worker": m["background"]["scripts"][0]}
out = root / "dist/chromium"
shutil.rmtree(out, ignore_errors=True); out.mkdir(parents=True)
for d in ("src", "icons"):
    shutil.copytree(root / d, out / d)
shutil.copy(root / "LICENSE", out / "LICENSE")
(out / "manifest.json").write_text(json.dumps(m, indent=2) + "\n")
z = root / f"dist/table-grabber-chromium-{m['version']}.zip"
with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as f:
    for p in sorted(out.rglob("*")):
        if p.is_file(): f.write(p, p.relative_to(out))
print(z)
