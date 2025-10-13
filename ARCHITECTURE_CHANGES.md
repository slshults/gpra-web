# Multi-Tenant Architecture Changes

## Overview

This document visualizes the database schema changes from single-user to multi-tenant architecture.

---

## Before: Single-User Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PostgreSQL Database                         │
│                     (Single User - Admin Only)                  │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│     ITEMS        │      │    ROUTINES      │      │  CHORD_CHARTS    │
├──────────────────┤      ├──────────────────┤      ├──────────────────┤
│ id (PK)          │      │ id (PK)          │      │ chord_id (PK)    │
│ item_id          │      │ name             │      │ item_id          │
│ title            │      │ created_at       │      │ title            │
│ notes            │      │ order            │      │ chord_data       │
│ duration         │      └──────────────────┘      │ created_at       │
│ description      │              │                  │ order_col        │
│ order            │              │                  └──────────────────┘
│ tuning           │              │
│ songbook         │              ▼
│ created_at       │      ┌──────────────────┐
│ updated_at       │      │  ROUTINE_ITEMS   │
└──────────────────┘      ├──────────────────┤
                          │ id (PK)          │
┌──────────────────┐      │ routine_id (FK)  │
│  ACTIVE_ROUTINE  │      │ item_id (FK)     │
├──────────────────┤      │ order            │
│ id (PK)          │      │ completed        │
│ routine_id (FK)  │◄─────│ created_at       │
│ updated_at       │      └──────────────────┘
└──────────────────┘

┌──────────────────┐
│  COMMON_CHORDS   │
├──────────────────┤
│ id (PK)          │
│ type             │
│ name             │
│ chord_data       │
│ created_at       │
│ order_col        │
└──────────────────┘

Issues:
❌ No user isolation
❌ No subscription management
❌ All data shared across all users
❌ Cannot deploy as SaaS
```

---

## After: Multi-Tenant Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PostgreSQL Database                             │
│              (Multi-Tenant with Row-Level Security)                 │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┐
│   FLASK-APPBUILDER           │
│   ab_user (Managed by FAB)   │
├──────────────────────────────┤
│ id (PK)                      │
│ username                     │
│ email                        │
│ password_hash                │
│ active                       │
│ created_at                   │
│ ... (many other FAB fields) │
└──────────────────────────────┘
         │
         │ user_id (FK)
         │
         ▼
┌──────────────────────────────┐
│   SUBSCRIPTIONS [NEW]        │
├──────────────────────────────┤
│ id (PK)                      │
│ user_id (FK) ──────────────┐ │
│ stripe_subscription_id      │ │
│ stripe_price_id             │ │
│ tier (5 options)            │ │
│ status                      │ │
│ mrr                         │ │
│ current_period_start        │ │
│ current_period_end          │ │
│ cancel_at_period_end        │ │
│ created_at                  │ │
│ updated_at                  │ │
└──────────────────────────────┘ │
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
         ▼                        ▼                        ▼
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│     ITEMS        │      │    ROUTINES      │      │  CHORD_CHARTS    │
├──────────────────┤      ├──────────────────┤      ├──────────────────┤
│ id (PK)          │      │ id (PK)          │      │ chord_id (PK)    │
│ item_id          │      │ name             │      │ item_id          │
│ title            │      │ created_at       │      │ title            │
│ notes            │      │ order            │      │ chord_data       │
│ duration         │      │ user_id (FK) ◄───┼──────│ created_at       │
│ description      │      └──────────────────┘      │ order_col        │
│ order            │              │                  │ user_id (FK) ◄───┼───┐
│ tuning           │              │                  │ generation_method│   │
│ songbook         │              ▼                  └──────────────────┘   │
│ created_at       │      ┌──────────────────┐                             │
│ updated_at       │      │  ROUTINE_ITEMS   │                             │
│ user_id (FK) ◄───┼──────├──────────────────┤                             │
│ created_via [NEW]│      │ id (PK)          │                             │
└──────────────────┘      │ routine_id (FK)  │                             │
                          │ item_id (FK)     │                             │
┌──────────────────┐      │ order            │                             │
│  ACTIVE_ROUTINE  │      │ completed        │                             │
├──────────────────┤      │ created_at       │                             │
│ id (PK)          │      └──────────────────┘                             │
│ routine_id (FK)  │◄─────────────────────────────────────────────────────┘
│ updated_at       │
│ [Future: user_id]│
└──────────────────┘

┌──────────────────┐
│  COMMON_CHORDS   │  (Shared Reference Data)
├──────────────────┤
│ id (PK)          │
│ type             │
│ name             │
│ chord_data       │
│ created_at       │
│ order_col        │
└──────────────────┘

Benefits:
✅ User isolation (each user sees only their data)
✅ Subscription management (5 tiers with Stripe integration)
✅ PostHog analytics tracking (created_via, generation_method)
✅ Ready for SaaS deployment
✅ Future: Row-Level Security policies
```

---

## Schema Change Details

### New Table: `subscriptions`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | Integer | Primary key |
| `user_id` | Integer (FK) | References ab_user.id |
| `stripe_subscription_id` | String(255) | Stripe subscription identifier |
| `stripe_price_id` | String(255) | Stripe price/plan identifier |
| `tier` | String(50) | free, basic, standard, pro, unlimited |
| `status` | String(50) | active, canceled, past_due, trialing, incomplete |
| `mrr` | Numeric(10,2) | Monthly recurring revenue |
| `current_period_start` | DateTime(TZ) | Billing period start |
| `current_period_end` | DateTime(TZ) | Billing period end |
| `cancel_at_period_end` | Boolean | Cancel flag |
| `created_at` | DateTime(TZ) | Record creation time |
| `updated_at` | DateTime(TZ) | Record update time |

**Indexes:**
- `idx_subscriptions_user_id` on `user_id`
- `idx_subscriptions_status` on `status`
- `idx_subscriptions_tier` on `tier`
- Unique constraint on `stripe_subscription_id`

---

### Modified Table: `items`

**New Columns:**
- `user_id` (Integer, FK to ab_user.id, nullable, CASCADE on delete)
- `created_via` (String(50), default='manual') - Tracks if manually created or imported

**New Index:**
- `idx_items_user_id` on `user_id`

**Purpose:**
- Enable per-user item lists
- Track item creation method for analytics

---

### Modified Table: `routines`

**New Columns:**
- `user_id` (Integer, FK to ab_user.id, nullable, CASCADE on delete)

**New Index:**
- `idx_routines_user_id` on `user_id`

**Purpose:**
- Enable per-user routines
- Prepare for routine sharing features

---

### Modified Table: `chord_charts`

**New Columns:**
- `user_id` (Integer, FK to ab_user.id, nullable, CASCADE on delete)
- `generation_method` (String(50), nullable) - Tracks autocreate_file, autocreate_youtube, manual

**New Index:**
- `idx_chord_charts_user_id` on `user_id`

**Purpose:**
- Enable per-user chord chart libraries
- Track chart generation method for analytics

---

## Subscription Tiers

| Tier | Monthly Price | Items Limit | API Calls/Day | Features |
|------|--------------|-------------|---------------|----------|
| **Free** | $0 | 25 | 10 | Ads, basic features |
| **Basic** | $4.99 | 100 | 50 | No ads, email support |
| **Standard** | $9.99 | 500 | 200 | Priority support, exports |
| **Pro** | $19.99 | 2000 | 1000 | Advanced features, analytics |
| **Unlimited** | $49.99 | ∞ | ∞ | Everything, white-label option |

---

## Authentication Flow

### Before: No Authentication
```
User → App → Database (all shared data)
```

### After: Multi-Tenant Authentication
```
User → Login/Signup → Flask-AppBuilder Auth → Session Cookie
                                                     │
                                                     ▼
                                         ┌──────────────────────┐
                                         │  Middleware checks:  │
                                         │  1. User logged in?  │
                                         │  2. Subscription OK? │
                                         │  3. Within limits?   │
                                         └──────────────────────┘
                                                     │
                                                     ▼
User Request → Flask Route → DataLayer → PostgreSQL (filtered by user_id)
                                                     ▲
                                                     │
                                         ┌──────────────────────┐
                                         │  Row-Level Security  │
                                         │  Enforces user_id    │
                                         │  at database level   │
                                         └──────────────────────┘
```

---

## Row-Level Security (Future)

After migration, enable RLS policies:

```sql
-- Enable RLS on tables
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE chord_charts ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY items_user_isolation ON items
  USING (user_id = current_setting('app.current_user_id')::INTEGER);

CREATE POLICY routines_user_isolation ON routines
  USING (user_id = current_setting('app.current_user_id')::INTEGER);

CREATE POLICY chord_charts_user_isolation ON chord_charts
  USING (user_id = current_setting('app.current_user_id')::INTEGER);
```

**Middleware sets user context:**
```python
# In Flask request handler
@app.before_request
def set_user_context():
    if current_user.is_authenticated:
        db.execute(f"SET app.current_user_id = {current_user.id}")
```

**Result:** Database-level enforcement of multi-tenancy - even if application code has bugs, data isolation is guaranteed.

---

## Data Flow Comparison

### Before: Single Query Returns All Data
```python
# Returns ALL items regardless of user
items = db.query(Item).all()
```

### After: Filtered by User
```python
# Option 1: Application-level filtering
items = db.query(Item).filter(Item.user_id == current_user.id).all()

# Option 2: RLS (automatic filtering)
items = db.query(Item).all()  # RLS automatically filters by user_id
```

---

## Migration Path

```
1. Initial State
   └─► Single-user database
       └─► All data unassigned

2. Run Migration 001
   └─► Add user_id columns (nullable)
       └─► Create subscriptions table
           └─► Add indexes and foreign keys

3. Run Migration 002
   └─► Assign existing data to admin
       └─► Create admin subscription

4. Implement Authentication
   └─► Add signup/login UI
       └─► Enable OAuth providers
           └─► Session management

5. Implement Middleware
   └─► Inject user_id into queries
       └─► Enforce subscription limits
           └─► Track usage for billing

6. Enable RLS Policies
   └─► Database-level isolation
       └─► Defense in depth
           └─► Audit data access

7. Stripe Integration
   └─► Webhook handlers
       └─► Subscription lifecycle
           └─► Payment processing

8. Launch Multi-Tenant SaaS
   └─► Users sign up
       └─► Choose subscription tier
           └─► Use isolated environments
```

---

## Compatibility Notes

### Backward Compatibility

✅ **Existing code continues to work:**
- Nullable `user_id` columns don't break existing queries
- Can gradually add user filtering to routes
- No breaking changes to API responses

✅ **Existing data preserved:**
- All items/routines/chord_charts remain intact
- After migration 002, all data assigned to admin
- No data loss or corruption

✅ **Gradual rollout possible:**
- Can deploy schema changes before authentication
- Can test with single user before going multi-tenant
- Can enable features incrementally

---

## Next Development Tasks

### Phase 1: Core Multi-Tenant (Current)
- [x] Design schema changes
- [x] Create Alembic migrations
- [x] Write documentation
- [ ] Apply migrations to production
- [ ] Verify data integrity

### Phase 2: Authentication
- [ ] Add signup/login UI components
- [ ] Integrate Google OAuth
- [ ] Integrate SoundCloud OAuth
- [ ] Email/password authentication
- [ ] Session management
- [ ] Password reset flow

### Phase 3: Middleware & Filtering
- [ ] Create auth decorators
- [ ] Add user_id filtering to all routes
- [ ] Implement subscription checks
- [ ] Add usage tracking
- [ ] Enforce tier limits

### Phase 4: Subscriptions
- [ ] Stripe integration
- [ ] Webhook handlers
- [ ] Billing UI
- [ ] Plan upgrade/downgrade
- [ ] Payment processing

### Phase 5: Row-Level Security
- [ ] Create RLS policies
- [ ] Implement middleware for SET user context
- [ ] Test data isolation
- [ ] Security audit

### Phase 6: Polish & Launch
- [ ] PostHog event tracking
- [ ] User onboarding flow
- [ ] Documentation
- [ ] Marketing pages
- [ ] Launch! 🚀

---

## Resources

- **ALEMBIC_SETUP_SUMMARY.md** - Overview of what was created
- **MIGRATION_GUIDE.md** - Step-by-step production deployment
- **MIGRATION_CHECKLIST.md** - Detailed checklist for applying migrations
- **alembic/README_MIGRATIONS.md** - Alembic usage guide
- **CLAUDE.md** - Project architecture and development guidelines
