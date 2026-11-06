#!/bin/bash
# tests/real.sh: pack the add-on as an .xpi and test it installed in a real Firefox (see real_install.py)
set -e
cd "$(dirname "$0")/.."
rm -f /tmp/table-grabber.xpi
python3 -c "import zipfile,glob; z=zipfile.ZipFile('/tmp/table-grabber.xpi','w',zipfile.ZIP_DEFLATED); [z.write(f) for f in ['manifest.json']+sorted(glob.glob('src/*.js'))+sorted(glob.glob('icons/*.png'))]"
export LD_LIBRARY_PATH=$HOME/.local/fxlibs/usr/lib/aarch64-linux-gnu:$HOME/.local/chromelibs/usr/lib/aarch64-linux-gnu
exec $HOME/.local/venv-browser/bin/python -I tests/real_install.py /tmp/table-grabber.xpi
