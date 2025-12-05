# TradeViewMon Production Deployment

## Quick Start

### 1. Prepare Your Server

Ensure you have:
- Ubuntu 20.04+ or similar Linux distribution
- Root or sudo access
- A domain name pointing to your server (for SSL)

### 2. Clone and Deploy

```bash
git clone <your-repo-url> /opt/tradeviewmon
cd /opt/tradeviewmon

chmod +x deploy/*.sh

./deploy/setup-env.sh

./deploy/deploy.sh --domain your-domain.com --email admin@example.com
```

## Deployment Options

### Basic Deployment (No SSL)
```bash
./deploy/deploy.sh
```

### With Custom Domain and SSL
```bash
./deploy/deploy.sh --domain tradeview.example.com --email admin@example.com
```

### With Custom Port
```bash
./deploy/deploy.sh --port 3000 --domain tradeview.example.com --email admin@example.com
```

## What the Script Does

1. **Automatic Shutdown**: Stops all existing TradeViewMon containers and kills any processes using ports 5000-5002
2. **Port Detection**: Checks if port 5000 (or specified port) is in use by Docker or other services
3. **Auto Port Selection**: If the port is busy, automatically finds the next available port
4. **Nginx Check**: Detects if Nginx is installed
5. **Docker Check**: Detects if Docker is installed
6. **SSL Setup**: Uses Certbot to obtain and configure Let's Encrypt SSL certificates
7. **App Deployment**: Builds and runs the application in a Docker container

### Automatic Shutdown Details

When you run `./deploy/deploy.sh`, it automatically:
- Stops and removes existing `tradeviewmon` and `tradeviewmon-db` Docker containers
- Kills any process running on ports 5000, 5001, and 5002
- Removes any Docker containers publishing to those ports
- Cleans up dangling containers with "tradeviewmon" in the name

This ensures a clean deployment without port conflicts.

## Environment Variables

Create a `.env.production` file with:

```env
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://user:password@host:5432/database
SESSION_SECRET=your-secure-secret-key
FINNHUB_API_KEY=your-finnhub-api-key

# Required for AI-enhanced auto-trading features
AI_INTEGRATIONS_OPENAI_API_KEY=your-openai-api-key
```

### API Keys Required

| Key | Required | Purpose |
|-----|----------|---------|
| `SESSION_SECRET` | Yes | Session encryption (auto-generated) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Yes* | AI-enhanced auto-trading filter |
| `FINNHUB_API_KEY` | No | Real-time stock data for GDX, SPX, etc. |

*Required if using AI-enhanced auto-trading. Get your key at: https://platform.openai.com/api-keys

## Using Docker Compose

For a complete setup with PostgreSQL:

```bash
cd deploy

cp .env.example .env.production

docker-compose up -d
```

## Management Commands

```bash
docker logs -f tradeviewmon

docker restart tradeviewmon

docker stop tradeviewmon

docker start tradeviewmon

docker pull <image> && docker-compose up -d
```

## SSL Certificate Renewal

Certbot automatically sets up a cron job for renewal. To manually renew:

```bash
certbot renew
```

## Nginx Configuration

The deployment script creates an Nginx config at `/etc/nginx/sites-available/tradeviewmon`.

To manually update:
```bash
nano /etc/nginx/sites-available/tradeviewmon
nginx -t
systemctl reload nginx
```

## Troubleshooting

### Port Already in Use
The script automatically detects and avoids port conflicts. Check current usage:
```bash
ss -tuln | grep :5000
docker ps --format '{{.Ports}}' | grep 5000
```

### Docker Container Not Starting
```bash
docker logs tradeviewmon
docker inspect tradeviewmon
```

### Nginx Issues
```bash
nginx -t
systemctl status nginx
tail -f /var/log/nginx/error.log
```

### SSL Certificate Issues
```bash
certbot certificates
certbot renew --dry-run
```

## Security Recommendations

1. Use strong passwords for database and session secrets
2. Keep your server updated: `apt update && apt upgrade`
3. Configure a firewall (UFW):
   ```bash
   ufw allow ssh
   ufw allow 'Nginx Full'
   ufw enable
   ```
4. Set up automatic security updates
5. Regularly backup your database
