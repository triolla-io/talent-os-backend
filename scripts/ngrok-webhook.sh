#!/usr/bin/env bash
# ngrok-webhook.sh — Start ngrok tunnel for local Mailgun webhook testing
#
# Usage:
#   ./scripts/ngrok-webhook.sh
#   make ngrok
#
# Prerequisites:
#   - ngrok installed and authenticated (ngrok config add-authtoken <token>)
#   - Local API running on port 3000 (run 'make up' first)
#   - MAILGUN_WEBHOOK_SIGNING_KEY in .env (used by MailgunAuthGuard to verify the HMAC signature)
#
# What this does:
#   Opens an HTTPS tunnel to localhost:3000, prints the public URL.
#   Point a Mailgun route at: <ngrok-url>/api/webhooks/email
#   (No credentials in the URL — Mailgun signs each request.)
#
# NOTE: ngrok URL changes on each restart. Update the Mailgun route each session.
set -euo pipefail

PORT=${PORT:-3000}
WEBHOOK_PATH="/api/webhooks/email"

echo "Starting ngrok tunnel on port $PORT..."
echo "Webhook path: $WEBHOOK_PATH"
echo ""

# Start ngrok in background
ngrok http "$PORT" --log=stdout --log-format=json > /tmp/ngrok-telent.log 2>&1 &
NGROK_PID=$!

# Wait for tunnel to be established (poll ngrok local API)
echo "Waiting for tunnel..."
for i in $(seq 1 15); do
  sleep 1
  TUNNEL_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
    | grep -o '"public_url":"https://[^"]*"' \
    | head -1 \
    | sed 's/"public_url":"//' \
    | sed 's/"$//' || true)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
done

if [ -z "$TUNNEL_URL" ]; then
  echo "ERROR: Could not get tunnel URL after 15 seconds."
  echo "       Is ngrok installed? Run: brew install ngrok"
  echo "       Do you need to authenticate? Run: ngrok authtoken YOUR_TOKEN"
  kill "$NGROK_PID" 2>/dev/null || true
  exit 1
fi

# Mailgun signs each request (HMAC-SHA256), so no credentials go in the URL.
WEBHOOK_URL="${TUNNEL_URL}${WEBHOOK_PATH}"

echo ""
echo "=========================================="
echo "  ngrok tunnel active"
echo "=========================================="
echo ""
echo "  Mailgun webhook URL:"
echo "  $WEBHOOK_URL"
echo ""
echo "  Configure in Mailgun:"
echo "  Receiving -> Routes -> Forward -> paste the above"
echo ""
echo "  Press Ctrl+C to stop the tunnel"
echo "=========================================="
echo ""

# Keep running and show ngrok output
wait "$NGROK_PID"
