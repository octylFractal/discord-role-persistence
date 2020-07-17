#!/usr/bin/env bash
set -e
./node_modules/.bin/tsc --incremental

node ./dist/index.js
