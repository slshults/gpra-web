# Quick Start: Apply Multi-Tenant Migrations

**TL;DR**: This guide gets you from zero to migrated in ~10 minutes.

---

## Prerequisites

- [ ] SSH access to production server (208.113.200.79)
- [ ] Admin user exists in Flask-AppBuilder
- [ ] 10 minutes of time
- [ ] Backup ready (we'll create it first)

---

## Step 1: Backup (2 minutes)

```bash
# SSH to production
ssh steven@208.113.200.79

# Create backup
sudo -u postgres pg_dump gpra_prod > ~/backups/gpra_prod_$(date +%Y%m%d_%H%M%S).sql

# Verify backup
ls -lh ~/backups/ | tail -1
```

---

## Step 2: Sync Files (1 minute)

From your local machine:

```bash
# Sync Alembic files
cd /home/steven/webdev/guitar/practice/gprweb
rsync -avz alembic/ steven@208.113.200.79:~/gprweb/alembic/
rsync -avz alembic.ini steven@208.113.200.79:~/gprweb/
```

---

## Step 3: Install Alembic (1 minute)

Back on production server:

```bash
cd ~/gprweb
source venv/bin/activate
pip install alembic
```

---

## Step 4: Apply Schema Migration (2 minutes)

```bash
# Optional: Preview SQL first
alembic upgrade head --sql | less

# Apply migration
alembic upgrade head

# Verify
alembic current
# Should show: 001 (head)
```

---

## Step 5: Apply Data Migration (2 minutes)

```bash
# Verify admin user exists
sudo -u postgres psql gpra_prod -c "SELECT id, username FROM ab_user WHERE username = 'admin';"

# Apply data migration
alembic upgrade +1

# Verify
alembic current
# Should show: 002 (head)
```

---

## Step 6: Restart & Test (2 minutes)

```bash
# Restart app
sudo systemctl restart gprweb
sudo systemctl status gprweb

# From local machine, test
curl -I https://guitarpr.com
```

---

## Done! 🎉

Your database is now multi-tenant ready!

---

## Next Steps

1. **Implement authentication middleware** - Add user_id filtering to routes
2. **Add signup/login UI** - Let users create accounts
3. **Stripe integration** - Enable paid subscriptions
4. **Row-Level Security** - Database-level isolation

---

## Rollback (If Needed)

```bash
# Stop app
sudo systemctl stop gprweb

# Rollback both migrations
alembic downgrade base

# OR restore from backup
sudo -u postgres psql gpra_prod < ~/backups/gpra_prod_YYYYMMDD_HHMMSS.sql

# Restart
sudo systemctl start gprweb
```

---

## More Details

- **Complete Guide**: `MIGRATION_GUIDE.md`
- **Detailed Checklist**: `MIGRATION_CHECKLIST.md`
- **Architecture Info**: `ARCHITECTURE_CHANGES.md`
- **Alembic Docs**: `alembic/README_MIGRATIONS.md`
