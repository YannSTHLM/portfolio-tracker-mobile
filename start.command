#!/bin/bash

# Portfolio Tracker - Quick Start
# Double-click this file in Finder to launch the Portfolio Tracker

DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  📊 Portfolio Tracker"
echo "  ─────────────────────"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "  ❌ Node.js is not installed."
    echo "     Install it from https://nodejs.org"
    echo ""
    read -p "  Press Enter to close..."
    exit 1
fi

# Check if server is already running on port 3000
if lsof -i :3000 -sTCP:LISTEN &> /dev/null; then
    echo "  ⚠️  Server is already running on port 3000"
    echo "     Opening browser..."
    open "http://localhost:3000/index.html"
    echo ""
    read -p "  Press Enter to close..."
    exit 0
fi

# Kill any previous server on port 3000
lsof -ti :3000 &> /dev/null && kill -9 $(lsof -ti :3000) 2>/dev/null

# Start the server
echo "  🚀 Starting server..."
cd "$DIR" && node server.js &
SERVER_PID=$!

# Wait for server to be ready
echo "  ⏳ Waiting for server..."
for i in {1..20}; do
    sleep 0.5
    if lsof -i :3000 -sTCP:LISTEN &> /dev/null; then
        echo "  ✅ Server started successfully"
        echo "  🌐 Opening Portfolio Tracker..."
        sleep 0.5
        open "http://localhost:3000/index.html"
        echo ""
        echo "  ─────────────────────────────"
        echo "  The server is running."
        echo "  Close this window to stop the server,"
        echo "  or leave it open — it'll stop when you"
        echo "  close this Terminal window."
        echo "  ─────────────────────────────"
        echo ""
        read -p "  Press Enter to stop the server and exit..."
        kill $SERVER_PID 2>/dev/null
        echo "  👋 Server stopped. Goodbye!"
        exit 0
    fi
done

# If we get here, server failed to start
echo "  ❌ Server failed to start after 10 seconds"
echo ""
read -p "  Press Enter to close..."
exit 1