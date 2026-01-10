# Trady Production Deployment

## Quick Start

### 1. Prepare Your Server

Ensure you have:
- Ubuntu 20.04+ or similar Linux distribution
- Root or sudo access
- A domain name pointing to your server (for SSL)

### 2. Clone and Deploy

```bash
git clone <your-repo-url> /opt/trady
cd /opt/trady

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

1. **Trady Shutdown**: Stops ONLY existing Trady containers (other apps are not touched)
2. **Port Detection**: Checks if port 5000 (or specified port) is in use by Docker or other services
3. **Auto Port Selection**: If the port is busy, automatically finds the next available port
4. **Nginx Check**: Detects if Nginx is installed
5. **Docker Check**: Detects if Docker is installed
6. **SSL Setup**: Uses Certbot to obtain and configure Let's Encrypt SSL certificates
7. **App Deployment**: Builds and runs the application in a Docker container

### Safe Shutdown Behavior

When you run `./deploy/deploy.sh`, it **ONLY** stops Trady:
- Stops and removes `trady` and `trady-db` Docker containers
- Cleans up any containers with "trady" in the name
- **Does NOT kill other applications** on any ports
- **Does NOT stop unrelated Docker containers**

If port 5000 is in use by another app, Trady will automatically use the next available port (5001, 5002, etc.).

## Environment Variables

Create a `.env.production` file with:

```env
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://user:password@host:5432/database
SESSION_SECRET=your-secure-secret-key
FINNHUB_API_KEY=your-finnhub-api-key
```

### API Keys Required

| Key | Required | Purpose |
|-----|----------|---------|
| `SESSION_SECRET` | Yes | Session encryption (auto-generated) |
| `FINNHUB_API_KEY` | No | Real-time stock data for GDX, SPX, etc. |

### OpenAI API Key Configuration

The OpenAI API key for AI-enhanced auto-trading is configured via the **Settings page** in the application UI, not through environment variables. 

After deployment:
1. Log in as superadmin
2. Go to Settings page
3. Enter your OpenAI API key
4. The key is encrypted and stored securely in the database

This approach means:
- No need to edit `.env` files for OpenAI
- Key persists in the database across deployments
- Can be updated anytime through the UI

Get your OpenAI key at: https://platform.openai.com/api-keys

## Database Schema

The deploy script automatically handles database setup:

1. **Tables are created automatically** - All required tables are created if they don't exist
2. **Columns are added safely** - Missing columns are added to existing tables
3. **Existing data is preserved** - The script uses IF NOT EXISTS to avoid breaking your data

If you need to manually run database migrations:
```bash
# Run the init script
docker exec -i trady-db psql -U trady -d trady < deploy/migrations/init_database.sql

# Or use drizzle push
docker exec trady npm run db:push
```

## Using Docker Compose

For a complete setup with PostgreSQL:

```bash
cd deploy

cp .env.example .env.production

docker-compose up -d
```

## Management Commands

```bash
docker logs -f trady

docker restart trady

docker stop trady

docker start trady

docker pull <image> && docker-compose up -d
```

## SSL Certificate Renewal

Certbot automatically sets up a cron job for renewal. To manually renew:

```bash
certbot renew
```

## Nginx Configuration

The deployment script creates an Nginx config at `/etc/nginx/sites-available/trady`.

To manually update:
```bash
nano /etc/nginx/sites-available/trady
nginx -t
systemctl reload nginx
```

## Troubleshooting

### Database "role does not exist" Error

If you see an error like:
```
FATAL: role "trady" does not exist
```

This usually happens when you have a stale PostgreSQL data volume from a previous installation with different credentials.

**Solution 1: Reset the database volume (if you don't have important data)**
```bash
docker compose -f deploy/docker-compose.yml down -v
./deploy/deploy.sh
```

**Solution 2: Use your existing credentials**
Edit the `.env` file and update `POSTGRES_USER` and `POSTGRES_DB` to match your existing database credentials, then redeploy:
```bash
nano .env
# Update POSTGRES_USER and POSTGRES_DB to match existing credentials
./deploy/deploy.sh
```

### Port Already in Use
The script automatically detects and avoids port conflicts. Check current usage:
```bash
ss -tuln | grep :5000
docker ps --format '{{.Ports}}' | grep 5000
```

### Docker Container Not Starting
```bash
docker logs trady
docker inspect trady
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
