#!/bin/bash
# Taproot POS — Fresh server setup
# Run once on a clean Ubuntu 22.04 LTS server as root
# Usage: curl -fsSL https://raw.githubusercontent.com/your-org/taproot/main/scripts/setup-server.sh | bash
set -euo pipefail

echo "============================================"
echo "  Taproot POS — Server Setup (Ubuntu 22.04)"
echo "============================================"

# ── System Update ─────────────────────────────────────────────────────────────
echo "→ Updating system packages..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq

# ── Node.js 20 LTS ─────────────────────────────────────────────────────────────
echo "→ Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
apt-get install -y nodejs >/dev/null 2>&1
echo "   Node: $(node --version)  npm: $(npm --version)"

# ── PostgreSQL 15 ─────────────────────────────────────────────────────────────
echo "→ Installing PostgreSQL 15..."
apt-get install -y postgresql-15 postgresql-client-15 >/dev/null 2>&1
systemctl enable postgresql
systemctl start postgresql

# Create taproot DB + user
sudo -u postgres psql -c "
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'taproot') THEN
      CREATE USER taproot WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
    END IF;
  END
  \$\$;
  CREATE DATABASE taproot_prod OWNER taproot;
  GRANT ALL PRIVILEGES ON DATABASE taproot_prod TO taproot;
" 2>/dev/null || true
echo "   PostgreSQL 15 configured"

# ── Redis 7 ───────────────────────────────────────────────────────────────────
echo "→ Installing Redis 7..."
apt-get install -y redis-server >/dev/null 2>&1
# Set Redis to use systemd supervision
sed -i 's/^supervised no/supervised systemd/' /etc/redis/redis.conf
# Require password (replace with strong password)
echo "requirepass CHANGE_ME_REDIS_PASSWORD" >> /etc/redis/redis.conf
systemctl enable redis-server
systemctl start redis-server
echo "   Redis $(redis-server --version | awk '{print $3}') configured"

# ── Nginx ─────────────────────────────────────────────────────────────────────
echo "→ Installing Nginx + Certbot..."
apt-get install -y nginx certbot python3-certbot-nginx >/dev/null 2>&1
systemctl enable nginx
ufw allow 'Nginx Full' 2>/dev/null || true
echo "   Nginx $(nginx -v 2>&1 | awk -F/ '{print $2}') installed"

# ── PM2 ───────────────────────────────────────────────────────────────────────
echo "→ Installing PM2..."
npm install -g pm2 >/dev/null 2>&1
pm2 startup systemd -u taproot --hp /home/taproot >/dev/null 2>&1 || true
echo "   PM2 $(pm2 --version) installed"

# ── AWS CLI v2 ────────────────────────────────────────────────────────────────
echo "→ Installing AWS CLI v2..."
if ! command -v aws &>/dev/null; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install >/dev/null 2>&1
  rm -rf /tmp/awscliv2.zip /tmp/aws
fi
echo "   AWS CLI $(aws --version | awk '{print $1}')"

# ── App User ──────────────────────────────────────────────────────────────────
echo "→ Creating taproot app user..."
if ! id taproot &>/dev/null; then
  useradd -m -s /bin/bash taproot
fi
mkdir -p /home/taproot/app /home/taproot/app/apps/api/uploads
chown -R taproot:taproot /home/taproot/app

# ── Directories ───────────────────────────────────────────────────────────────
echo "→ Creating log + config directories..."
mkdir -p /var/log/taproot
chown taproot:taproot /var/log/taproot

# ── UFW Firewall ──────────────────────────────────────────────────────────────
echo "→ Configuring firewall..."
ufw allow ssh 2>/dev/null || true
ufw allow 80/tcp 2>/dev/null || true
ufw allow 443/tcp 2>/dev/null || true
ufw --force enable 2>/dev/null || true
echo "   UFW enabled (ssh, 80, 443 allowed)"

# ── Fail2ban ──────────────────────────────────────────────────────────────────
echo "→ Installing fail2ban..."
apt-get install -y fail2ban >/dev/null 2>&1
systemctl enable fail2ban
systemctl start fail2ban

# ── Unattended upgrades ───────────────────────────────────────────────────────
echo "→ Enabling unattended security upgrades..."
apt-get install -y unattended-upgrades >/dev/null 2>&1
dpkg-reconfigure -plow unattended-upgrades 2>/dev/null || true

echo ""
echo "============================================"
echo "  ✅ Server setup complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "1. Change Postgres password:  sudo -u postgres psql -c \"ALTER USER taproot PASSWORD 'STRONG_PASS';\""
echo "2. Update Redis password:     vim /etc/redis/redis.conf → requirepass"
echo "3. Obtain SSL cert:           certbot --nginx -d api.taprootpos.com"
echo "4. Copy Nginx config:         cp infra/nginx/nginx.conf /etc/nginx/sites-available/taprootpos.com"
echo "                              ln -s /etc/nginx/sites-available/taprootpos.com /etc/nginx/sites-enabled/"
echo "                              nginx -t && systemctl reload nginx"
echo "5. Clone repo as taproot:     sudo -u taproot git clone https://github.com/your-org/taproot /home/taproot/app"
echo "6. Create .env:               cp apps/api/.env.production.example apps/api/.env && vim apps/api/.env"
echo "7. Run migrations:            npm run db:migrate:safe"
echo "8. Start with PM2:            pm2 start ecosystem.config.js --env production && pm2 save"
echo ""
echo "⚠️  IMPORTANT: Change all default passwords before going live!"
