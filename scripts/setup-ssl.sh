#!/bin/bash
# setup-ssl.sh — Provision Let's Encrypt TLS certificate via certbot (webroot challenge)
#
# Usage:
#   ./scripts/setup-ssl.sh <domain> <email>
#   make ssl-setup DOMAIN=api.yourdomain.com EMAIL=admin@yourdomain.com
#
# Prerequisites:
#   - Docker Compose stack running (docker compose up -d) — nginx must be serving port 80
#   - DNS A record for <domain> pointing to this server's IP
#   - Port 80 accessible from the internet (certbot uses HTTP challenge)
#
# What this does:
#   1. Runs certbot in standalone mode via Docker to issue an initial certificate
#   2. Certificate stored in letsencrypt_data volume at /etc/letsencrypt/live/<domain>/
#   3. After cert is issued, restart nginx to pick up the new certificate
#   4. The certbot service in docker-compose.yml handles automatic renewal every 12h
#
# After running this script:
#   - Update nginx/nginx.conf: replace $DOMAIN with your actual domain name
#   - Restart nginx: docker compose restart nginx

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "ERROR: Domain and email required."
  echo "Usage: $0 <domain> <email>"
  echo "Example: $0 api.yourdomain.com admin@yourdomain.com"
  exit 1
fi

echo "Provisioning Let's Encrypt certificate for: $DOMAIN"
echo "Contact email: $EMAIL"
echo ""

# Stop nginx temporarily so certbot can bind port 80 for the challenge
# (only needed if using standalone mode; webroot mode does not require this)
echo "Running certbot via webroot challenge..."
echo "Ensure docker compose is running (docker compose up -d) before continuing."
echo ""

# Run certbot in webroot mode (nginx serves the challenge files from certbot_webroot volume)
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

echo ""
echo "Certificate issued successfully!"
echo ""
echo "Next steps:"
echo "  1. Edit nginx/nginx.conf — replace '\$DOMAIN' with '$DOMAIN' in ssl_certificate lines"
echo "  2. Restart nginx: docker compose restart nginx"
echo "  3. Verify HTTPS: curl -I https://$DOMAIN/api/health"
echo ""
echo "Automatic renewal is handled by the certbot service in docker-compose.yml."
