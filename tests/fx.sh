#!/bin/bash
# fx.sh SCRIPT ARGS: run a Python Playwright script with the home-folder Firefox libraries
export LD_LIBRARY_PATH=$HOME/.cache/ms-playwright/firefox-1555/firefox:$HOME/.local/fxlibs/usr/lib/aarch64-linux-gnu:$HOME/.local/chromelibs/usr/lib/aarch64-linux-gnu
exec $HOME/.local/venv-browser/bin/python -I "$@"
