#!/bin/bash

set -euo pipefail

CWD=$(pwd)

compile_frontend() {
    cd frontend
    npm install
    npm run build
    RETURN_CODE=$?
    cd $CWD

    if [ $RETURN_CODE -ne 0 ]; then
        exit $RETURN_CODE
    fi
}

launch_backend() {
    cd backend
    source .venv/bin/activate
    uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
    RETURN_CODE=$?
    cd $CWD

    if [ $RETURN_CODE -ne 0 ]; then
        exit $RETURN_CODE
    fi
}

compile_frontend
launch_backend