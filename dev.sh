#!/bin/bash

echo "Running in development mode"

FRONTEND_PID=""
BACKEND_PID=""
EXIT_CODE=0

kill_group() {
    local pid="$1"
    local signal="$2"

    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "-$signal" "-$pid" 2>/dev/null || true
    fi
}

safe_kill() {
    local pid="$1"

    [ -n "$pid" ] || return 0

    # If the process is already gone, there is nothing to do.
    if ! kill -0 "$pid" 2>/dev/null; then
        return 0
    fi

    kill_group "$pid" TERM

    # Give the process up to 30 seconds to shut down cleanly.
    local i
    for ((i = 0; i < 300; i++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
            return 0
        fi

        # kill -0 still succeeds for a zombie, so explicitly check
        # the process state.
        local state
        state=$(ps -o stat= -p "$pid" 2>/dev/null)

        if [[ "$state" == Z* || -z "$state" ]]; then
            return 0
        fi

        sleep 0.1
    done

    # Still running after 30 seconds.
    kill_group "$pid" KILL
}

cleanup() {
    local status=$?

    trap - EXIT INT TERM

    if [ "$EXIT_CODE" -eq 0 ] && [ "$status" -ne 0 ]; then
        EXIT_CODE=$status
    fi

    safe_kill "$BACKEND_PID" &
    BACKEND_KILL_PID=$!

    safe_kill "$FRONTEND_PID" &
    FRONTEND_KILL_PID=$!

    wait "$BACKEND_KILL_PID" "$FRONTEND_KILL_PID" 2>/dev/null || true

    # Reap the service children from the parent shell.
    wait "$BACKEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true

    exit "$EXIT_CODE"
}

handle_interrupt() {
    echo

    echo "Stopping services..."

    kill_group "$BACKEND_PID" INT
    kill_group "$FRONTEND_PID" INT

    EXIT_CODE=130
    exit
}

trap cleanup EXIT
trap handle_interrupt INT TERM

if [ -f .env ]; then
    echo "Loading environment variables from .env file"
    set -a && source .env && set +a
fi

if ! cd frontend; then
    echo "Error: frontend directory does not exist"
    EXIT_CODE=1
    exit
fi

setsid npm run watch &
FRONTEND_PID=$!

if ! cd ..; then
    echo "Error: failed to return to project root"
    EXIT_CODE=1
    exit
fi

setsid ./run.sh &
BACKEND_PID=$!

# Wait for either service to exit.
wait -n -p EXITED_PID "$FRONTEND_PID" "$BACKEND_PID"
EXIT_CODE=$?

if [ "$EXITED_PID" = "$FRONTEND_PID" ]; then
    echo "Frontend stopped (exit code $EXIT_CODE)"
else
    echo "Backend stopped (exit code $EXIT_CODE)"
fi

exit "$EXIT_CODE"
