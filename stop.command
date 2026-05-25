#!/bin/bash

# Portfolio Tracker - Stop Server
# Double-click this file in Finder to stop the Portfolio Tracker server

echo ""
echo "  📊 Portfolio Tracker"
echo "  ─────────────────────"
echo ""

# Check if server is running on port 3000
if lsof -ti :3000 &> /dev/null; then
    echo "  🛑 Stopping server..."
    kill -9 $(lsof -ti :3000) 2>/dev/null
    sleep 0.5
    if lsof -ti :3000 &> /dev/null; then
        echo "  ⚠️  Server process still alive. Try: kill -9 $(lsof -ti :3000)"
    else
        echo "  ✅ Server stopped"
    fi
else
    echo "  ℹ️  No server running on port 3000"
fi

echo ""
read -p "  Press Enter to close..."
exit 0