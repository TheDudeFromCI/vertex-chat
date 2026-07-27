#!/usr/bin/env bash

set -euo pipefail

CWD=$(pwd)

install_frontend () {
    cd frontend
    npm install
    RETURN_CODE=$?
    cd $CWD

    if [ $RETURN_CODE -ne 0 ]; then
        exit $RETURN_CODE
    fi
}

install_backend () {
    cd backend
    if [ ! -d ".venv" ]; then
        python -m venv .venv
    fi

    source .venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt
    RETURN_CODE=$?
    cd $CWD

    if [ $RETURN_CODE -ne 0 ]; then
        exit $RETURN_CODE
    fi
}

echo "Installing frontend dependencies..."
install_frontend
echo "Installing backend dependencies..."
install_backend
echo "Vertex installation complete."