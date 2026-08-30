#!/usr/bin/env bash

set -euo pipefail

CWD=$(pwd)

install () {
    cd $1
    npm install
    RETURN_CODE=$?

    if [ $RETURN_CODE -ne 0 ]; then
        cd $CWD
        exit $RETURN_CODE
    fi


    npm run build
    RETURN_CODE=$?
    cd $CWD

    if [ $RETURN_CODE -ne 0 ]; then
        exit $RETURN_CODE
    fi
}


echo "Installing common dependencies..."
install common

echo "Installing frontend dependencies..."
install frontend

echo "Installing backend dependencies..."
install backend

echo "Vertex installation complete."