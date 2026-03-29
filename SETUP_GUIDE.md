# Voodoo Fresh Setup Guide (New DigitalOcean Droplet)

This guide is for a brand-new droplet with nothing preinstalled except Ubuntu.

It is step-by-step and beginner-friendly, and includes:
- private GitHub repo deployment
- custom domain setup
- MySQL setup
- PM2 process management
- Nginx + SSL
- Discord + WooCommerce integration basics
- separate Discord workers for sales, join-gate verification, nuke, and sports listings

---

## 1. What You Need Before You Start

- A new DigitalOcean droplet (Ubuntu 22.04 or 24.04).
- SSH access to the droplet.
- A private GitHub repository containing this project.
- A custom domain or subdomain (example: `voodoo.example.com`).
- Discord Developer Portal access for your Discord bot apps.
- WooCommerce store access.

Recommended droplet size:
- `2 vCPU / 4 GB RAM` minimum.

---

## 2. Create the New Droplet

In DigitalOcean:
1. Create Droplet
2. Choose Ubuntu LTS image
3. Choose size (recommended above)
4. Add your SSH key (recommended, avoid password login)
5. Create droplet

After creation, note the public IPv4 address.

---

## 3. Point Domain to the Droplet

In your domain DNS provider:
1. Add `A` record
2. Host: `voodoo` (or `@` if root domain)
3. Value: your droplet IP
4. Save

Example:
- `voodoo.example.com` -> `YOUR_DROPLET_IP`

---

## 4. Connect to Droplet

From your local machine:

```bash
ssh root@YOUR_DROPLET_IP
```

---

## 5. Update Server + Install Base Packages

```bash
apt update && apt upgrade -y
apt install -y curl git nginx mysql-server ufw build-essential
```

Configure firewall:

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status
```

---

## 6. Install Node.js 24.13.1 and pnpm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 24.13.1
nvm alias default 24.13.1
node -v
```

Install pnpm (via Corepack):

```bash
corepack enable
corepack prepare pnpm@10.28.2 --activate
pnpm -v
```

---

## 7. Clone Private GitHub Repo on Droplet

Because your repo is private, use a deploy key.

### 7.1 Generate SSH key on droplet

```bash
ssh-keygen -t ed25519 -C "voodoo-deploy-key" -f ~/.ssh/voodoo_deploy_key
cat ~/.ssh/voodoo_deploy_key.pub
```

### 7.2 Add deploy key in GitHub

In GitHub:
1. Open your private repo
2. `Settings` -> `Deploy keys` -> `Add deploy key`
3. Paste public key from previous command
4. Keep it read-only

### 7.3 Configure SSH host alias

```bash
cat << 'EOF' > ~/.ssh/config
Host github-voodoo
  HostName github.com
  User git
  IdentityFile ~/.ssh/voodoo_deploy_key
  IdentitiesOnly yes
EOF

chmod 600 ~/.ssh/config
ssh-keyscan github.com >> ~/.ssh/known_hosts
```

### 7.4 Clone project

```bash
mkdir -p /var/www
cd /var/www
git clone git@github-voodoo:YOUR_GITHUB_USER_OR_ORG/YOUR_PRIVATE_REPO.git voodoo
cd /var/www/voodoo
```

---

## 8. Configure MySQL

Secure MySQL:

```bash
mysql_secure_installation
```

Create DB and user:

```bash
mysql -u root -p
```

Run inside MySQL:

```sql
CREATE DATABASE voodoo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'voodoo_user'@'localhost' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON voodoo.* TO 'voodoo_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

---

## 9. Create `.env` File

From project root:

```bash
cd /var/www/voodoo
cp .env.example .env
nano .env
```

Paste and update values:

```env
DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN
DISCORD_CLIENT_ID=YOUR_DISCORD_CLIENT_ID
JOIN_GATE_DISCORD_TOKEN=YOUR_JOIN_GATE_BOT_TOKEN
JOIN_GATE_DISCORD_CLIENT_ID=YOUR_JOIN_GATE_BOT_CLIENT_ID
SPORTS_DISCORD_TOKEN=YOUR_SPORTS_BOT_TOKEN
SPORTS_DISCORD_CLIENT_ID=YOUR_SPORTS_BOT_CLIENT_ID
SPORTS_POLL_INTERVAL_MS=30000
SALES_HISTORY_POLL_INTERVAL_MS=30000
SPORTS_API_KEY=YOUR_THESPORTSDB_PAID_API_KEY
SPORTS_API_V1_BASE_URL=https://www.thesportsdb.com/api/v1/json
SPORTS_API_BASE_URL=https://www.thesportsdb.com/api/v2/json
SPORTS_DEFAULT_TIMEZONE=Europe/London
SPORTS_DEFAULT_PUBLISH_TIME=01:00
SPORTS_BROADCAST_COUNTRY=United Kingdom
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_USERNAME=YOUR_TELEGRAM_BOT_USERNAME
NUKE_DISCORD_TOKEN=YOUR_NUKE_BOT_TOKEN
NUKE_DISCORD_CLIENT_ID=YOUR_NUKE_BOT_CLIENT_ID
NUKE_POLL_INTERVAL_MS=30000
DATABASE_URL=mysql://voodoo_user:CHANGE_ME_STRONG_PASSWORD@localhost:3306/voodoo

LOG_LEVEL=info
DISCORD_CLIENT_SECRET=YOUR_DISCORD_CLIENT_SECRET
DISCORD_REDIRECT_URI=https://voodoo.example.com/api/auth/discord/callback

SESSION_SECRET=LONG_RANDOM_STRING_MIN_32_CHARS
ENCRYPTION_KEY=LONG_RANDOM_STRING_MIN_32_CHARS
CHECKOUT_SIGNING_SECRET=LONG_RANDOM_STRING_MIN_32_CHARS

# Super admin Discord IDs can run /activation grant, /activation revoke, and /activation list.
SUPER_ADMIN_DISCORD_IDS=123456789012345678
BOT_PUBLIC_URL=https://voodoo.example.com
DISCORD_TEST_GUILD_ID=
```

Generate strong random values:

```bash
openssl rand -base64 48
```

---

## 10. Install Dependencies and Build

```bash
cd /var/www/voodoo
pnpm install
pnpm lint --fix
pnpm typecheck
pnpm test --coverage
pnpm build
```

Run migrations and deploy slash commands:

```bash
pnpm migrate
pnpm deploy:commands
```

Telegram does not require slash-command deployment. After the dashboard is online, generate a Telegram link command from `Workspace & Server`, add the Telegram bot to the target group, and run `/connect <token>` as a Telegram group admin. `TELEGRAM_BOT_USERNAME` is also required because `/sale` now hands customers off from the group into a private DM with the bot.
`pnpm deploy:commands` now deploys the sales bot, join-gate bot, nuke bot, and sports bot command sets together.

---

## 11. Run App with PM2

Install PM2:

```bash
pnpm add -g pm2
```

Create PM2 config:

```bash
cat << 'EOF' > /var/www/voodoo/ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'voodoo-web',
      cwd: '/var/www/voodoo/apps/web-app',
      script: 'node',
      args: 'node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_file: '/var/www/voodoo/.env'
    },
    {
      name: 'voodoo-bot',
      cwd: '/var/www/voodoo',
      script: 'node',
      args: 'apps/bot-worker/dist/index.js',
      env: {
        NODE_ENV: 'production'
      },
      env_file: '/var/www/voodoo/.env'
    },
    {
      name: 'voodoo-telegram',
      cwd: '/var/www/voodoo',
      script: 'node',
      args: 'apps/telegram-worker/dist/index.js',
      env: {
        NODE_ENV: 'production'
      },
      env_file: '/var/www/voodoo/.env'
    },
    {
      name: 'voodoo-join-gate',
      cwd: '/var/www/voodoo',
      script: 'node',
      args: 'apps/join-gate-worker/dist/index.js',
      env: {
        NODE_ENV: 'production'
      },
      env_file: '/var/www/voodoo/.env'
    },
    {
      name: 'voodoo-nuke',
      cwd: '/var/www/voodoo',
      script: 'node',
      args: 'apps/nuke-worker/dist/index.js',
      env: {
        NODE_ENV: 'production'
      },
      env_file: '/var/www/voodoo/.env'
    },
    {
      name: 'voodoo-sports',
      cwd: '/var/www/voodoo',
      script: 'node',
      args: 'apps/sports-worker/dist/index.js',
      env: {
        NODE_ENV: 'production'
      },
      env_file: '/var/www/voodoo/.env'
    }
  ]
};
EOF
```

Start all processes:

```bash
cd /var/www/voodoo
pm2 start ecosystem.config.cjs
pm2 status
```

Enable boot persistence:

```bash
pm2 startup
pm2 save
```

Useful logs:

```bash
pm2 logs voodoo-web --lines 100
pm2 logs voodoo-bot --lines 100
pm2 logs voodoo-telegram --lines 100
pm2 logs voodoo-join-gate --lines 100
pm2 logs voodoo-nuke --lines 100
pm2 logs voodoo-sports --lines 100
```

---

## 12. Configure Nginx (Domain -> Web App)

Create site config:

```bash
cat << 'EOF' > /etc/nginx/sites-available/voodoo
server {
    listen 80;
    server_name voodoo.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
```

Enable config:

```bash
ln -s /etc/nginx/sites-available/voodoo /etc/nginx/sites-enabled/voodoo
nginx -t
systemctl reload nginx
```

---

## 13. Enable HTTPS with Certbot

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d voodoo.example.com
```

Test renewal:

```bash
certbot renew --dry-run
```

---

## 14. Configure Discord Applications

### 14.1 Main sales bot app

In Discord Developer Portal:
1. Open your main sales bot app
2. `OAuth2` -> add redirect URI:
   - `https://voodoo.example.com/api/auth/discord/callback`
3. Save changes

### 14.2 Join-gate bot app

In Discord Developer Portal:
1. Open your join-gate bot app
2. `Bot` -> enable:
   - `SERVER MEMBERS INTENT`
   - `MESSAGE CONTENT INTENT`
3. Save changes

The join-gate worker is a separate Discord application/token. It does not use OAuth login, but it must be invited to the same server and it must have:
- `Manage Roles`
- `Manage Channels`
- `Kick Members`
- permission to read the configured lookup channels and send in the fallback verify channel

### 14.3 Nuke bot app

Make sure the nuke bot app is also invited and has the permissions required by `/nuke`.

### 14.4 Sports bot app

Make sure the sports bot app is also invited and has the permissions required by `/sports`:

- `View Channels`
- `Manage Channels`
- `Send Messages`
- `Embed Links`
- `Manage Messages`
- `Read Message History`

The sports worker also needs a paid `SPORTS_API_KEY` from TheSportsDB for full daily coverage. The public test key is not enough for a production sports schedule bot.

After updates:

```bash
cd /var/www/voodoo
pnpm deploy:commands
pm2 restart voodoo-web
pm2 restart voodoo-bot
pm2 restart voodoo-telegram
pm2 start ecosystem.config.cjs --only voodoo-join-gate --update-env
pm2 start ecosystem.config.cjs --only voodoo-nuke --update-env
pm2 start ecosystem.config.cjs --only voodoo-sports --update-env
pm2 save
```

---

## 15. Configure WooCommerce Webhook

In dashboard:
1. Save Woo base URL, webhook secret, API key, API secret
2. Copy generated webhook URL

Join-gate is configured in Discord only, not in the web dashboard. After the server is linked and the join-gate bot is in the server, run this in Discord:

```text
/join-gate setup fallback_channel:#verify verified_role:@verified ticket_category:Verification current_lookup_channel:#current-customers new_lookup_channel:#new-customers
```

Then run:
- `/join-gate sync`
- `/join-gate install`
- `/join-gate status`

Optional join-gate commands:
- `/join-gate staff-add role:@Staff`
- `/join-gate staff-remove role:@Staff`
- `/join-gate staff-list`
- `/join-gate panel title:"Welcome" message:"Custom welcome text for new members"`
- `/join-gate panel-reset`

The fallback verify panel now includes a `Resend DM` button so members can request the DM prompt again without needing staff help.

The join-gate worker is default-deny until a super admin activates it for the server:
- Run `/join-gate authorized` to confirm whether the server already has an allowlist entry
- Run `/join-gate grant user:@someone` to activate the server for the first allowed Discord user
- Use `/join-gate revoke user:@someone` later if you need to remove extra `/join-gate` access

To turn it off again later, run `/join-gate disable`.

Without that activation step, automatic new-member verification stays locked for the server.

Server permissions pattern:
- `@everyone` should only see the fallback verify area
- the verified role and your normal server roles should see the normal channels
- the lookup channels should be readable by the join-gate bot
- the join-gate staff roles added with `/join-gate staff-add` can see newly opened verification tickets

In WooCommerce:
1. Create webhook for order updates
2. Set delivery URL to generated webhook URL
3. Use same webhook secret
4. Enable webhook

Also add snippet from:
- `docs/wordpress-snippet.php`

This stores `vd_order_session_id` on orders for reliable matching.

---

## 16. How to Update in Production

```bash
cd /var/www/voodoo
git pull
pnpm install
pnpm build
pnpm migrate
pnpm deploy:commands
pm2 restart voodoo-web
pm2 restart voodoo-bot
pm2 restart voodoo-telegram
pm2 start ecosystem.config.cjs --only voodoo-join-gate --update-env
pm2 start ecosystem.config.cjs --only voodoo-nuke --update-env
pm2 start ecosystem.config.cjs --only voodoo-sports --update-env
pm2 save
```

---

## 17. Final Verification

```bash
pm2 status
curl -I https://voodoo.example.com
```

Expected:
- All PM2 apps are `online`
- Domain responds with HTTP success code
- `/dashboard` opens in browser
- Dashboard shows the mobile-first setup flow strip and compact current-context card
- Dashboard sections expand/collapse correctly and the catalog builder shows the four guided steps
- New members only see the fallback verify area until join-gate verification succeeds

---

## 18. Common Problems and Fixes

- `pnpm migrate` fails with MySQL access denied:
  - Re-check username/password in `DATABASE_URL`
  - Re-check MySQL grants

- Discord OAuth callback fails:
  - Redirect URI in Discord must exactly match `DISCORD_REDIRECT_URI`

- Domain not loading:
  - Check DNS A record points to droplet IP
  - Check Nginx config with `nginx -t`
  - Check PM2 web logs

- Bot offline:
  - Verify `DISCORD_TOKEN`
  - Check `pm2 logs voodoo-bot`

- Telegram bot offline:
  - Verify `TELEGRAM_BOT_TOKEN`
  - Check `pm2 logs voodoo-telegram`
  - Generate a fresh dashboard link command and reconnect the group with `/connect <token>`

- Web app keeps restarting and PM2 error log shows `/usr/bin/bash: --filter: invalid option`:
  - Your PM2 web entry is still using `script: 'pnpm'` with `args: '--filter @voodoo/web-app start'`
  - Replace it with the `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000` entry shown above
  - Then run `pm2 delete voodoo-web && pm2 start ecosystem.config.cjs --only voodoo-web --update-env && pm2 save`

- Nuke worker offline:
  - Verify `NUKE_DISCORD_TOKEN`
  - Verify `NUKE_DISCORD_CLIENT_ID`
  - If PM2 says `Process or Namespace voodoo-nuke not found`, register it first with `pm2 start ecosystem.config.cjs --only voodoo-nuke --update-env`
  - Run `pm2 save` after it starts successfully
  - Check `pm2 logs voodoo-nuke`

- Nuke worker logs `Nuke lock could not be renewed.` on every scheduled/manual run:
  - Pull the latest code and redeploy the worker build
  - Restart `voodoo-nuke`
  - This symptom was caused by MySQL timestamp precision truncating the stored lock lease

- `/nuke` says the worker is locked for this server:
  - `/nuke` is now default-deny for every server until a super admin activates it
  - Use the Discord account listed in `SUPER_ADMIN_DISCORD_IDS`
  - Run `/nuke authorized` to inspect the current server allowlist
  - Run `/nuke grant user:@someone` to activate the server for the first allowed user
  - Run `/nuke revoke user:@someone` to remove an allowed user later
  - After activation, `/nuke delete confirm:DELETE` permanently removes the current channel without making a replacement channel

- Join-gate worker offline:
  - Verify `JOIN_GATE_DISCORD_TOKEN`
  - Verify `JOIN_GATE_DISCORD_CLIENT_ID`
  - If PM2 says `Process or Namespace voodoo-join-gate not found`, register it first with `pm2 start ecosystem.config.cjs --only voodoo-join-gate --update-env`
  - Run `pm2 save` after it starts successfully
  - Check `pm2 logs voodoo-join-gate`

- `/join-gate status` shows missing privileged intents:
  - Open the join-gate bot application in Discord Developer Portal
  - Enable `SERVER MEMBERS INTENT`
  - Enable `MESSAGE CONTENT INTENT`
  - Restart `voodoo-join-gate`

- `/join-gate status` shows missing permissions:
  - Make sure the join-gate bot role is above the configured verified role
  - Give the bot `Manage Roles`, `Manage Channels`, and `Kick Members`
  - Make sure it can view the lookup channels and the fallback verify channel

- `/join-gate` says the worker is locked for this server:
  - The server has not been activated for join-gate yet
  - Use a Discord account listed in `SUPER_ADMIN_DISCORD_IDS`
  - Run `/join-gate authorized` to inspect the current allowlist
  - Run `/join-gate grant user:@someone` to activate the server for the first allowed user

- New members can still see the whole server before verification:
  - Your Discord channel permissions are too open
  - Restrict normal channels to staff + verified role
  - Leave only the fallback verify area visible to `@everyone`

- Join-gate email lookups do not match:
  - Make sure the correct lookup channels are configured with `/join-gate setup`
  - Run `/join-gate sync` after changing lookup-channel history
  - Confirm the email address exists in the configured lookup channel content or embeds
