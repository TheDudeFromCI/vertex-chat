#!/bin/bash

set -euo pipefail

CWD=$(pwd)

if [ -f .env ]; then
    echo "Loading environment variables from .env file"
    set -a && source .env && set +a
fi

./install.sh
cd backend || exit 1

echo "Starting Vertex server"
npm run start
RETURN_CODE=$?
cd $CWD

if [ $RETURN_CODE -ne 0 ]; then
    exit $RETURN_CODE
fi
