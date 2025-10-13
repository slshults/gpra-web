# Multi-Tenant Migration Checklist

Use this checklist when applying the migrations to production.

---

## Pre-Migration Checklist

- [ ] Read `ALEMBIC_SETUP_SUMMARY.md` for overview
- [ ] Read `MIGRATION_GUIDE.md` for detailed steps
- [ ] Verify admin user exists in Flask-AppBuilder
- [ ] Notify users of planned maintenance window (if applicable)
- [ ] Have database backup strategy ready

---

## Backup Phase

- [ ] SSH to production: `ssh steven@208.113.200.79`
- [ ] Create backup directory: `mkdir -p ~/backups`
- [ ] Run database backup:
  ```bash
  sudo -u postgres pg_dump gpra_prod > ~/backups/gpra_prod_pre_migration_$(date +%Y%m%d_%H%M%S).sql
  ```
- [ ] Verify backup file exists and has reasonable size:
  ```bash
  ls -lh ~/backups/
  ```
- [ ] Optional: Download backup to local machine:
  ```bash
  rsync -avz steven@208.113.200.79:~/backups/ ~/backups/gprweb_production/
  ```

---

## File Sync Phase

From local machine:

- [ ] Sync Alembic directory:
  ```bash
  rsync -avz --progress /home/steven/webdev/guitar/practice/gprweb/alembic/ steven@208.113.200.79:~/gprweb/alembic/
  ```
- [ ] Sync alembic.ini:
  ```bash
  rsync -avz --progress /home/steven/webdev/guitar/practice/gprweb/alembic.ini steven@208.113.200.79:~/gprweb/
  ```
- [ ] Verify files synced:
  ```bash
  ssh steven@208.113.200.79 "ls -la ~/gprweb/alembic/versions/"
  ```

---

## Installation Phase

On production server:

- [ ] Change to project directory: `cd ~/gprweb`
- [ ] Activate virtualenv: `source venv/bin/activate`
- [ ] Install Alembic: `pip install alembic`
- [ ] Verify installation: `alembic --version`

---

## Testing Phase

- [ ] Check database connection: `alembic current`
  - Expected: "Base" or no alembic_version table (both fine)
- [ ] Generate SQL preview:
  ```bash
  alembic upgrade head --sql > /tmp/migration_preview.sql
  ```
- [ ] Review SQL file: `less /tmp/migration_preview.sql`
- [ ] Verify SQL looks correct:
  - [ ] Creates `subscriptions` table
  - [ ] Adds `user_id` to items, routines, chord_charts
  - [ ] Adds `created_via` to items
  - [ ] Adds `generation_method` to chord_charts
  - [ ] Creates indexes and foreign keys

---

## Migration Phase

- [ ] **Optional but recommended:** Stop application:
  ```bash
  sudo systemctl stop gprweb
  ```
- [ ] Run migration 001 (schema changes):
  ```bash
  alembic upgrade head
  ```
- [ ] Watch for success messages:
  - [ ] "Creating subscriptions table..."
  - [ ] "Adding user_id to items table..."
  - [ ] "Adding user_id to routines table..."
  - [ ] "Adding user_id to chord_charts table..."
  - [ ] "✓ Multi-tenant schema migration completed successfully!"
- [ ] Check migration status: `alembic current`
  - Expected: "001 (head)"

---

## Verification Phase

- [ ] Verify subscriptions table:
  ```bash
  sudo -u postgres psql gpra_prod -c "\d subscriptions"
  ```
- [ ] Verify items table:
  ```bash
  sudo -u postgres psql gpra_prod -c "\d items" | grep user_id
  ```
- [ ] Verify routines table:
  ```bash
  sudo -u postgres psql gpra_prod -c "\d routines" | grep user_id
  ```
- [ ] Verify chord_charts table:
  ```bash
  sudo -u postgres psql gpra_prod -c "\d chord_charts" | grep user_id
  ```
- [ ] Check existing data integrity:
  ```bash
  sudo -u postgres psql gpra_prod << EOF
  SELECT
    (SELECT COUNT(*) FROM items) as total_items,
    (SELECT COUNT(*) FROM items WHERE user_id IS NULL) as items_without_user,
    (SELECT COUNT(*) FROM routines) as total_routines,
    (SELECT COUNT(*) FROM routines WHERE user_id IS NULL) as routines_without_user,
    (SELECT COUNT(*) FROM chord_charts) as total_charts,
    (SELECT COUNT(*) FROM chord_charts WHERE user_id IS NULL) as charts_without_user;
  EOF
  ```
  - Expected: All items/routines/charts should have NULL user_id at this point

---

## Data Migration Phase

- [ ] Verify admin user exists:
  ```bash
  sudo -u postgres psql gpra_prod -c "SELECT id, username, email FROM ab_user WHERE username = 'admin';"
  ```
- [ ] Run migration 002 (data assignment):
  ```bash
  alembic upgrade +1
  ```
- [ ] Watch for success messages:
  - [ ] "Found admin user: admin (ID: X, ...)"
  - [ ] "Assigning X items to admin user..."
  - [ ] "Assigning X routines to admin user..."
  - [ ] "Assigning X chord charts to admin user..."
  - [ ] "Created unlimited tier subscription"
  - [ ] "✓ Data migration completed successfully!"
- [ ] Verify data assignment:
  ```bash
  sudo -u postgres psql gpra_prod << EOF
  SELECT
    (SELECT COUNT(*) FROM items WHERE user_id IS NULL) as items_without_user,
    (SELECT COUNT(*) FROM routines WHERE user_id IS NULL) as routines_without_user,
    (SELECT COUNT(*) FROM chord_charts WHERE user_id IS NULL) as charts_without_user;
  EOF
  ```
  - Expected: All counts should be 0

---

## Application Restart Phase

- [ ] Restart application:
  ```bash
  sudo systemctl restart gprweb
  ```
- [ ] Check status:
  ```bash
  sudo systemctl status gprweb
  ```
  - Expected: "active (running)" in green
- [ ] Monitor logs for errors:
  ```bash
  sudo journalctl -u gprweb -f
  ```
  - Watch for startup messages
  - Press Ctrl+C after 30 seconds if no errors

---

## Smoke Testing Phase

From local machine:

- [ ] Test homepage: `curl -I https://guitarpr.com`
  - Expected: HTTP 200 OK
- [ ] Test Flask-AppBuilder admin: Browse to `https://guitarpr.com/admin/`
  - Expected: Login page loads
- [ ] Login as admin and verify:
  - [ ] Can see items in Items view
  - [ ] Can see routines in Routines view
  - [ ] Can see chord charts (if admin interface exists for them)

---

## Post-Migration Tasks

- [ ] Document migration completion time and any issues
- [ ] Update project documentation with new schema
- [ ] Plan next steps:
  - [ ] Implement multi-tenant middleware
  - [ ] Add subscription tier checks
  - [ ] Enable Row-Level Security policies
  - [ ] Integrate Stripe webhooks
  - [ ] Add signup/login UI

---

## Rollback Plan (If Needed)

If something goes wrong:

- [ ] Stop application: `sudo systemctl stop gprweb`
- [ ] Downgrade migrations:
  ```bash
  alembic downgrade base
  ```
- [ ] OR restore from backup:
  ```bash
  sudo -u postgres psql gpra_prod < ~/backups/gpra_prod_pre_migration_YYYYMMDD_HHMMSS.sql
  ```
- [ ] Restart application: `sudo systemctl start gprweb`
- [ ] Investigate issue before retrying
- [ ] Document what went wrong for future reference

---

## Success Criteria

Migration is successful when:

- ✅ All migrations applied: `alembic current` shows "002 (head)"
- ✅ Subscriptions table exists with proper schema
- ✅ All items/routines/chord_charts have user_id assigned
- ✅ Admin user has subscription record
- ✅ Application starts without errors
- ✅ Homepage and admin interface accessible
- ✅ No data loss (record counts match pre-migration)

---

## Notes / Issues

Use this section to document any issues encountered:

```
Date: ___________
Issue: _____________________________________________
Resolution: _________________________________________

Date: ___________
Issue: _____________________________________________
Resolution: _________________________________________
```

---

## Migration Completed

- [ ] All checklist items completed successfully
- [ ] Application running normally
- [ ] Users notified that maintenance is complete
- [ ] Documentation updated
- [ ] Next steps planned

**Completed by:** _________________
**Date:** _________________
**Duration:** _________ minutes
