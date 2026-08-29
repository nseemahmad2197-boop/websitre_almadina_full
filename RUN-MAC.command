#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node.js 22 or newer from https://nodejs.org/"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing project dependencies for the first time..."
  npm install
fi

echo "Starting Almadina Express..."
npm run dev
