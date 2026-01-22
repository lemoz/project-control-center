#!/bin/sh
set -eu

if [ ! -e /repos/pcc/node_modules ]; then
  ln -s /app/node_modules /repos/pcc/node_modules
fi

if [ ! -e /repos/pcc/server/dist ]; then
  mkdir -p /repos/pcc/server
  ln -s /app/server/dist /repos/pcc/server/dist
fi

exec node /app/server/dist/index.js
