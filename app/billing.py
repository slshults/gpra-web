"""Stripe billing integration for GPRA"""
import os
import logging
import stripe
from flask import jsonify, request, g
from sqlalchemy.orm import Session
from app.models import Subscription
from app.subscription_tiers import SUBSCRIPTION_TIERS
from datetime import datetime

# Initialize Stripe with secret key
stripe.api_key = os.getenv('STRIPE_SECRET_KEY')

logger = logging.getLogger(__name__)


def timestamp_to_datetime(unix_timestamp):
    """Convert Stripe Unix timestamp to datetime object"""
    if unix_timestamp is None:
        return None
    return datetime.utcfromtimestamp(unix_timestamp).replace(tzinfo=None)


def create_checkout_session(db: Session):
    """Create a Stripe Checkout Session for subscription purchase"""
    try:
        data = request.json
        tier = data.get('tier')
        billing_period = data.get('billing_period')  # 'monthly' or 'yearly'

        if not tier or not billing_period:
            return jsonify({'error': 'Missing tier or billing_period'}), 400

        # Validate tier
        if tier not in SUBSCRIPTION_TIERS or tier == 'free':
            return jsonify({'error': 'Invalid tier'}), 400

        # Get price ID from tier config
        tier_config = SUBSCRIPTION_TIERS[tier]
        price_id = tier_config.get(f'stripe_price_id_{billing_period}')

        if not price_id:
            return jsonify({'error': 'Price ID not configured for this tier'}), 400

        # Get current user
        from flask_login import current_user
        if not current_user or not current_user.is_authenticated:
            return jsonify({'error': 'Not authenticated'}), 401

        user_id = current_user.id
        user_email = current_user.email

        # Check if user already has a Stripe customer ID
        subscription = db.query(Subscription).filter_by(user_id=user_id).first()

        # Prepare checkout session params
        checkout_params = {
            'line_items': [{
                'price': price_id,
                'quantity': 1,
            }],
            'mode': 'subscription',
            'success_url': f"{request.host_url}#Account?upgrade=success&session_id={{CHECKOUT_SESSION_ID}}",
            'cancel_url': f"{request.host_url}#Account?upgrade=cancelled",
            'metadata': {
                'user_id': str(user_id),
                'tier': tier,
            },
            'subscription_data': {
                'metadata': {
                    'user_id': str(user_id),
                    'tier': tier,
                    'billing_period': billing_period,  # Add billing period to metadata
                },
            },
            # Custom branding to match GPRA's dark theme
            'branding_settings': {
                'display_name': 'Guitar Practice Routine App',
                'font_family': 'roboto',
                'border_style': 'rounded',
                'background_color': '#1f2937',  # gray-800 - matches GPRA dark background
                'button_color': '#ea580c',      # orange-600 - matches GPRA primary buttons
            }
        }

        # Only add proration_behavior for existing customers with active subscriptions
        if subscription and subscription.stripe_subscription_id and subscription.status in ['active', 'trialing']:
            checkout_params['subscription_data']['proration_behavior'] = 'create_prorations'

        # Use existing customer or create new one
        if subscription and subscription.stripe_customer_id:
            checkout_params['customer'] = subscription.stripe_customer_id

            # Log if user already has an active subscription (potential upgrade/change scenario)
            if subscription.stripe_subscription_id and subscription.status in ['active', 'trialing']:
                logger.info(f"User {user_id} with existing {subscription.tier} subscription creating checkout for {tier}")
        else:
            checkout_params['customer_email'] = user_email

        # Create checkout session
        checkout_session = stripe.checkout.Session.create(**checkout_params)

        logger.info(f"Created checkout session for user {user_id}, tier {tier}, period {billing_period}")

        return jsonify({'url': checkout_session.url})

    except stripe.error.StripeError as e:
        logger.error(f"Stripe error creating checkout session: {str(e)}")
        return jsonify({'error': f'Stripe error: {str(e)}'}), 400
    except Exception as e:
        logger.error(f"Error creating checkout session: {str(e)}")
        return jsonify({'error': 'Failed to create checkout session'}), 500


def create_portal_session(db: Session):
    """Create a Stripe Customer Portal Session for subscription management"""
    try:
        from flask_login import current_user
        if not current_user or not current_user.is_authenticated:
            return jsonify({'error': 'Not authenticated'}), 401

        user_id = current_user.id

        # Get user's subscription to find stripe_customer_id
        subscription = db.query(Subscription).filter_by(user_id=user_id).first()

        if not subscription or not subscription.stripe_customer_id:
            return jsonify({'error': 'No active subscription found'}), 404

        # Prepare portal session parameters
        portal_params = {
            'customer': subscription.stripe_customer_id,
            'return_url': f"{request.host_url}#Account",
        }

        # Try to add configuration if it's set in environment
        # In Stripe, you need to set up a billing portal configuration first
        # If not provided, Stripe will use the default configuration (if set up in dashboard)
        billing_portal_config = os.getenv('STRIPE_BILLING_PORTAL_CONFIG')
        if billing_portal_config:
            portal_params['configuration'] = billing_portal_config

        # Create portal session
        portal_session = stripe.billing_portal.Session.create(**portal_params)

        logger.info(f"Created portal session for user {user_id}")

        return jsonify({'url': portal_session.url})

    except stripe.error.StripeError as e:
        logger.error(f"Stripe error creating portal session: {str(e)}")
        return jsonify({'error': f'Stripe error: {str(e)}'}), 400
    except Exception as e:
        logger.error(f"Error creating portal session: {str(e)}")
        return jsonify({'error': 'Failed to create portal session'}), 500


def update_existing_subscription(db: Session):
    """Update an existing subscription to a new tier/billing period (proper Stripe way)"""
    try:
        data = request.json
        new_tier = data.get('tier')
        new_billing_period = data.get('billing_period')

        if not new_tier or not new_billing_period:
            return jsonify({'error': 'Missing tier or billing_period'}), 400

        from flask_login import current_user
        if not current_user or not current_user.is_authenticated:
            return jsonify({'error': 'Not authenticated'}), 401

        user_id = current_user.id

        # Get current subscription
        subscription = db.query(Subscription).filter_by(user_id=user_id).first()

        if not subscription or not subscription.stripe_subscription_id:
            # No existing subscription - they should use checkout instead
            return jsonify({'error': 'No active subscription found. Please use checkout.'}), 404

        # Validate new tier
        if new_tier not in SUBSCRIPTION_TIERS or new_tier == 'free':
            return jsonify({'error': 'Invalid tier'}), 400

        # Get new price ID
        tier_config = SUBSCRIPTION_TIERS[new_tier]
        new_price_id = tier_config.get(f'stripe_price_id_{new_billing_period}')

        if not new_price_id:
            return jsonify({'error': 'Price ID not configured'}), 400

        # Check if this is actually a change
        if subscription.stripe_price_id == new_price_id:
            return jsonify({'message': 'Already on this plan', 'success': True}), 200

        # Retrieve current subscription from Stripe to verify status
        stripe_sub = stripe.Subscription.retrieve(subscription.stripe_subscription_id)

        if stripe_sub.status not in ['active', 'trialing']:
            return jsonify({'error': f'Subscription is not active (status: {stripe_sub.status})'}), 400

        # Get the subscription item ID (use stored or fetch from Stripe)
        subscription_item_id = subscription.stripe_subscription_item_id
        if not subscription_item_id:
            # Fallback: get it from Stripe if we don't have it stored
            subscription_item_id = stripe_sub['items']['data'][0]['id']

        # Store old values for comparison
        old_tier = subscription.tier
        old_price_id = subscription.stripe_price_id

        logger.info(f"Updating subscription for user {user_id} from {subscription.tier}/{subscription.stripe_price_id} to {new_tier}/{new_price_id}")

        # Update the subscription using Stripe's proper update method
        updated_sub = stripe.Subscription.modify(
            subscription.stripe_subscription_id,
            items=[{
                'id': subscription_item_id,
                'price': new_price_id,
            }],
            proration_behavior='always_invoice',  # Immediate proration charge/credit
            metadata={
                'user_id': str(user_id),
                'tier': new_tier,
                'billing_period': new_billing_period,
            }
        )

        logger.info(f"✓ Successfully updated subscription {updated_sub.id} for user {user_id}")

        # Determine what changed
        tier_changed = old_tier != new_tier
        period_changed = old_price_id != new_price_id and old_tier == new_tier

        # Get the proration amount from the latest invoice
        # Use amount_paid instead of amount_due because with proration_behavior='always_invoice',
        # the invoice is immediately charged and paid
        proration_amount = 0
        try:
            if updated_sub.latest_invoice:
                latest_invoice = stripe.Invoice.retrieve(updated_sub.latest_invoice)
                proration_amount = latest_invoice.amount_paid / 100  # Convert from cents to dollars
                logger.info(f"Proration calculation: invoice_id={latest_invoice.id}, amount_paid={latest_invoice.amount_paid} cents, proration_amount=${proration_amount}")
        except Exception as e:
            logger.warning(f"Could not fetch invoice for proration amount: {e}")

        # Get tier config for feature info
        tier_config = SUBSCRIPTION_TIERS.get(new_tier, {})
        autocreate_enabled = tier_config.get('autocreate_enabled', False)

        # The customer.subscription.updated webhook will update our database automatically

        return jsonify({
            'success': True,
            'message': 'Subscription updated successfully',
            'subscription_id': updated_sub.id,
            'details': {
                'old_tier': old_tier,
                'new_tier': new_tier,
                'tier_changed': tier_changed,
                'period_changed': period_changed,
                'billing_period': new_billing_period,
                'proration_amount': proration_amount,
                'autocreate_enabled': autocreate_enabled,
            }
        })

    except stripe.error.InvalidRequestError as e:
        logger.error(f"Invalid request updating subscription: {str(e)}")
        return jsonify({'error': f'Invalid request: {str(e)}'}), 400
    except stripe.error.StripeError as e:
        logger.error(f"Stripe error updating subscription: {str(e)}")
        return jsonify({'error': f'Stripe error: {str(e)}'}), 400
    except Exception as e:
        logger.error(f"Error updating subscription: {str(e)}")
        return jsonify({'error': 'Failed to update subscription'}), 500


def handle_stripe_webhook(db: Session):
    """Handle Stripe webhook events"""
    payload = request.get_data(as_text=True)
    sig_header = request.headers.get('Stripe-Signature')
    webhook_secret = os.getenv('STRIPE_WEBHOOK_SECRET')

    if not webhook_secret:
        logger.error("STRIPE_WEBHOOK_SECRET not configured")
        return jsonify({'error': 'Webhook secret not configured'}), 500

    try:
        # Verify webhook signature
        event = stripe.Webhook.construct_event(
            payload, sig_header, webhook_secret
        )
    except ValueError:
        logger.error("Invalid webhook payload")
        return jsonify({'error': 'Invalid payload'}), 400
    except stripe.error.SignatureVerificationError:
        logger.error("Invalid webhook signature")
        return jsonify({'error': 'Invalid signature'}), 400

    # Handle the event
    event_type = event['type']
    logger.info(f"Received Stripe webhook: {event_type}")

    try:
        if event_type == 'checkout.session.completed':
            handle_checkout_completed(db, event['data']['object'])
        elif event_type == 'customer.subscription.created':
            handle_subscription_created(db, event['data']['object'])
        elif event_type == 'customer.subscription.updated':
            handle_subscription_updated(db, event['data']['object'])
        elif event_type == 'customer.subscription.deleted':
            handle_subscription_deleted(db, event['data']['object'])
        elif event_type == 'invoice.payment_succeeded':
            handle_payment_succeeded(db, event['data']['object'])
        elif event_type == 'invoice.payment_failed':
            handle_payment_failed(db, event['data']['object'])
        else:
            logger.info(f"Unhandled event type: {event_type}")

        return jsonify({'status': 'success'}), 200

    except Exception as e:
        logger.error(f"Error handling webhook {event_type}: {str(e)}")
        # Return 200 to acknowledge receipt even if processing failed
        # Stripe will retry if we return an error
        return jsonify({'status': 'error', 'message': str(e)}), 200


def handle_checkout_completed(db: Session, session):
    """Handle successful checkout session completion"""
    logger.info(f"Checkout completed: {session['id']}")

    # Extract metadata
    user_id = session.get('metadata', {}).get('user_id')
    if not user_id:
        logger.error("No user_id in checkout session metadata")
        return

    user_id = int(user_id)
    customer_id = session.get('customer')
    subscription_id = session.get('subscription')

    # Update subscription record with Stripe customer ID
    subscription = db.query(Subscription).filter_by(user_id=user_id).first()
    if subscription:
        subscription.stripe_customer_id = customer_id
        subscription.stripe_subscription_id = subscription_id
        db.commit()
        logger.info(f"Updated subscription for user {user_id} with Stripe IDs")
    else:
        logger.warning(f"No subscription found for user {user_id}")


def handle_subscription_created(db: Session, stripe_subscription):
    """Handle subscription creation"""
    logger.info(f"Subscription created: {stripe_subscription['id']}")

    # Extract metadata to find user
    user_id = stripe_subscription.get('metadata', {}).get('user_id')
    if not user_id:
        logger.error("No user_id in subscription metadata")
        return

    user_id = int(user_id)
    tier = stripe_subscription.get('metadata', {}).get('tier', 'basic')

    # Get subscription record
    subscription = db.query(Subscription).filter_by(user_id=user_id).first()
    if not subscription:
        logger.error(f"No subscription record found for user {user_id}")
        return

    # Check if user has an existing active Stripe subscription that needs to be canceled
    old_subscription_id = subscription.stripe_subscription_id
    new_subscription_id = stripe_subscription['id']

    if old_subscription_id and old_subscription_id != new_subscription_id:
        # User has an existing subscription and this is a new one (upgrade/downgrade)
        if subscription.status in ['active', 'trialing', 'past_due']:
            logger.info(f"User {user_id} upgrading/changing subscription from {old_subscription_id} to {new_subscription_id}")

            try:
                # Cancel the old subscription immediately since they have a new one
                # Using immediate cancellation because they're getting the new tier right away
                old_stripe_subscription = stripe.Subscription.cancel(old_subscription_id)
                logger.info(f"Canceled old subscription {old_subscription_id} for user {user_id}, status: {old_stripe_subscription.get('status')}")
            except stripe.error.InvalidRequestError as e:
                # Subscription might already be canceled or doesn't exist
                logger.warning(f"Could not cancel old subscription {old_subscription_id}: {str(e)}")
            except stripe.error.StripeError as e:
                logger.error(f"Stripe error canceling old subscription {old_subscription_id}: {str(e)}")

    # Update subscription with new information
    subscription.stripe_subscription_id = stripe_subscription['id']
    subscription.stripe_customer_id = stripe_subscription['customer']
    subscription.stripe_price_id = stripe_subscription['items']['data'][0]['price']['id']
    subscription.stripe_subscription_item_id = stripe_subscription['items']['data'][0]['id']  # Store item ID for updates
    subscription.tier = tier
    subscription.status = stripe_subscription['status']
    subscription.current_period_start = timestamp_to_datetime(stripe_subscription.get('current_period_start'))
    subscription.current_period_end = timestamp_to_datetime(stripe_subscription.get('current_period_end'))
    subscription.cancel_at_period_end = stripe_subscription['cancel_at_period_end']

    # Calculate MRR (convert from cents, normalize to monthly)
    amount = stripe_subscription['items']['data'][0]['price']['unit_amount'] / 100
    interval = stripe_subscription['items']['data'][0]['price']['recurring']['interval']
    if interval == 'year':
        subscription.mrr = amount / 12
    else:
        subscription.mrr = amount

    # Clear lapsed subscription fields when subscription becomes active
    if stripe_subscription['status'] in ['active', 'trialing']:
        subscription.unplugged_mode = False
        subscription.lapse_date = None
        subscription.data_deletion_date = None
        subscription.last_active_routine_id = None
        logger.info(f"Cleared lapse fields for renewed user {user_id}")

    db.commit()
    logger.info(f"Updated subscription for user {user_id}: tier={tier}, status={subscription.status}")


def handle_subscription_updated(db: Session, stripe_subscription):
    """Handle subscription updates (upgrades, downgrades, renewals)"""
    logger.info(f"Subscription updated: {stripe_subscription['id']}")

    # Find subscription by Stripe subscription ID
    subscription = db.query(Subscription).filter_by(
        stripe_subscription_id=stripe_subscription['id']
    ).first()

    if not subscription:
        logger.warning(f"No subscription found for Stripe subscription {stripe_subscription['id']}")
        return

    # Determine tier from price ID
    price_id = stripe_subscription['items']['data'][0]['price']['id']
    tier = 'free'  # Default fallback
    for tier_key, tier_config in SUBSCRIPTION_TIERS.items():
        if price_id in [tier_config.get('stripe_price_id_monthly'), tier_config.get('stripe_price_id_yearly')]:
            tier = tier_key
            break

    # Update subscription
    subscription.stripe_price_id = price_id
    subscription.stripe_subscription_item_id = stripe_subscription['items']['data'][0]['id']  # Store item ID for updates
    subscription.tier = tier
    subscription.status = stripe_subscription['status']
    subscription.current_period_start = timestamp_to_datetime(stripe_subscription.get('current_period_start'))
    subscription.current_period_end = timestamp_to_datetime(stripe_subscription.get('current_period_end'))
    subscription.cancel_at_period_end = stripe_subscription['cancel_at_period_end']

    # Update MRR
    amount = stripe_subscription['items']['data'][0]['price']['unit_amount'] / 100
    interval = stripe_subscription['items']['data'][0]['price']['recurring']['interval']
    if interval == 'year':
        subscription.mrr = amount / 12
    else:
        subscription.mrr = amount

    # Check if user canceled subscription - activate unplugged mode
    # Handle both old API (cancel_at_period_end=True) and new API (cancel_at is set to future timestamp)
    is_canceled = stripe_subscription['cancel_at_period_end'] or stripe_subscription.get('cancel_at') is not None

    if is_canceled:
        from app.models import Routine
        from datetime import timedelta

        cancel_reason = "cancel_at_period_end=True" if stripe_subscription['cancel_at_period_end'] else f"cancel_at={stripe_subscription.get('cancel_at')}"
        logger.info(f"User {subscription.user_id} canceled subscription ({cancel_reason}) - activating unplugged mode")

        # SET UNPLUGGED MODE (90-day countdown starts now)
        subscription.unplugged_mode = True
        subscription.lapse_date = datetime.now()
        subscription.data_deletion_date = datetime.now() + timedelta(days=90)

        # Store the routine that was active when they canceled
        active_routine_id = subscription.last_active_routine_id
        if not active_routine_id:
            # If not set, get newest routine
            newest = db.query(Routine).filter_by(user_id=subscription.user_id).order_by(Routine.created_at.desc()).first()
            if newest:
                active_routine_id = newest.id
                logger.info(f"Storing routine {active_routine_id} as last active for unplugged user {subscription.user_id}")

        subscription.last_active_routine_id = active_routine_id

        logger.info(f"User {subscription.user_id} in unplugged mode - 90 days until data deletion")

    # Clear lapsed subscription fields when subscription becomes active
    # BUT ONLY if not scheduled for cancellation
    elif stripe_subscription['status'] in ['active', 'trialing']:
        subscription.unplugged_mode = False
        subscription.lapse_date = None
        subscription.data_deletion_date = None
        subscription.last_active_routine_id = None
        logger.info(f"Cleared lapse fields for renewed user {subscription.user_id}")

    db.commit()
    logger.info(f"Updated subscription for user {subscription.user_id}: tier={tier}, status={subscription.status}, cancel_at_period_end={stripe_subscription['cancel_at_period_end']}, cancel_at={stripe_subscription.get('cancel_at')}")


def handle_subscription_deleted(db: Session, stripe_subscription):
    """Handle subscription cancellation/deletion

    For user-initiated cancellations (portal, API, dashboard):
    - Puts user in unplugged mode (90-day grace period)
    - Preserves last active routine
    - Allows resume without re-subscribing

    For automated cancellations (payment failure, disputes):
    - Immediate downgrade to free tier
    - No unplugged mode
    """
    logger.info(f"Subscription deleted: {stripe_subscription['id']}")

    subscription = db.query(Subscription).filter_by(
        stripe_subscription_id=stripe_subscription['id']
    ).first()

    if not subscription:
        logger.warning(f"No subscription found for Stripe subscription {stripe_subscription['id']}")
        return

    # Check cancellation reason to determine if user-initiated
    cancellation_details = stripe_subscription.get('cancellation_details', {})
    cancellation_reason = cancellation_details.get('reason') if cancellation_details else None

    # Common Stripe cancellation reasons:
    # - 'cancellation_requested' = User canceled (portal, API, dashboard)
    # - 'payment_failed' = Auto-canceled after failed payments
    # - 'payment_disputed' = Chargeback/dispute

    if cancellation_reason == 'cancellation_requested':
        # User-initiated cancellation (portal/API) - put in unplugged mode
        from app.models import Routine
        from datetime import timedelta

        logger.info(f"User {subscription.user_id} canceled subscription (reason: {cancellation_reason}) - activating unplugged mode")

        # Downgrade to free tier
        subscription.tier = 'free'
        subscription.status = 'canceled'
        subscription.mrr = 0
        subscription.stripe_subscription_id = None
        subscription.stripe_price_id = None
        subscription.cancel_at_period_end = False

        # SET UNPLUGGED MODE (90-day countdown, like GPRA "Pause" button)
        subscription.unplugged_mode = True
        subscription.lapse_date = datetime.now()
        subscription.data_deletion_date = datetime.now() + timedelta(days=90)

        # Store the routine that was active when they canceled
        active_routine_id = subscription.last_active_routine_id
        if not active_routine_id:
            # If not set, get newest routine
            newest = db.query(Routine).filter_by(user_id=subscription.user_id).order_by(Routine.created_at.desc()).first()
            if newest:
                active_routine_id = newest.id
                logger.info(f"Storing routine {active_routine_id} as last active for unplugged user {subscription.user_id}")

        subscription.last_active_routine_id = active_routine_id

        logger.info(f"User {subscription.user_id} in unplugged mode - 90 days until data deletion")
    else:
        # Automated cancellation (payment failure, etc.) - just downgrade to free
        subscription.tier = 'free'
        subscription.status = 'canceled'
        subscription.mrr = 0
        subscription.stripe_subscription_id = None
        subscription.stripe_price_id = None
        subscription.cancel_at_period_end = False

        logger.info(f"Subscription auto-canceled (reason: {cancellation_reason or 'unknown'}) for user {subscription.user_id} - downgraded to free tier")

    db.commit()


def handle_payment_succeeded(db: Session, invoice):
    """Handle successful payment"""
    logger.info(f"Payment succeeded: {invoice['id']}")

    # Update subscription status if needed
    subscription_id = invoice.get('subscription')
    if subscription_id:
        subscription = db.query(Subscription).filter_by(
            stripe_subscription_id=subscription_id
        ).first()

        if subscription and subscription.status != 'active':
            subscription.status = 'active'
            # Clear lapsed subscription fields when payment succeeds
            subscription.unplugged_mode = False
            subscription.lapse_date = None
            subscription.data_deletion_date = None
            subscription.last_active_routine_id = None
            db.commit()
            logger.info(f"Reactivated subscription for user {subscription.user_id}, cleared lapse fields")


def handle_payment_failed(db: Session, invoice):
    """Handle failed payment"""
    logger.info(f"Payment failed: {invoice['id']}")

    subscription_id = invoice.get('subscription')
    if subscription_id:
        subscription = db.query(Subscription).filter_by(
            stripe_subscription_id=subscription_id
        ).first()

        if subscription:
            subscription.status = 'past_due'
            db.commit()
            logger.warning(f"Subscription for user {subscription.user_id} is past due")


def resume_subscription(db: Session):
    """Resume lapsed subscription by creating NEW subscription (Stripe requirement)

    Per Stripe docs (2025): Canceled subscriptions cannot be resumed.
    You must create a new subscription instead via checkout session.

    This creates a checkout session for the user's previous tier/billing period.
    """
    from flask_login import current_user
    if not current_user or not current_user.is_authenticated:
        return jsonify({'error': 'Not authenticated'}), 401

    user_id = current_user.id
    subscription = db.query(Subscription).filter_by(user_id=user_id).first()

    if not subscription or not subscription.stripe_customer_id:
        return jsonify({'error': 'No subscription found'}), 404

    try:
        # Get the tier they were on before cancellation
        previous_tier = subscription.tier if subscription.tier != 'free' else 'basic'

        # Determine billing period from last price ID (default to monthly)
        billing_period = 'monthly'
        if subscription.stripe_price_id:
            for tier_key, tier_config in SUBSCRIPTION_TIERS.items():
                if subscription.stripe_price_id == tier_config.get('stripe_price_id_yearly'):
                    billing_period = 'yearly'
                    break

        # Get price ID for their previous tier
        tier_config = SUBSCRIPTION_TIERS.get(previous_tier, SUBSCRIPTION_TIERS['basic'])
        price_id = tier_config.get(f'stripe_price_id_{billing_period}')

        if not price_id:
            return jsonify({'error': 'Price configuration error'}), 500

        # Create NEW checkout session (not portal session)
        # Canceled subscriptions require creating a new subscription, not resuming old one
        checkout_session = stripe.checkout.Session.create(
            customer=subscription.stripe_customer_id,
            line_items=[{
                'price': price_id,
                'quantity': 1,
            }],
            mode='subscription',
            success_url=f"{request.host_url}#Practice?renewal=success",
            cancel_url=f"{request.host_url}#Practice?renewal=cancelled",
            metadata={
                'user_id': str(user_id),
                'tier': previous_tier,
            },
            subscription_data={
                'metadata': {
                    'user_id': str(user_id),
                    'tier': previous_tier,
                    'billing_period': billing_period,
                },
            },
            # Custom branding to match GPRA's dark theme
            branding_settings={
                'display_name': 'Guitar Practice Routine App',
                'font_family': 'roboto',
                'border_style': 'rounded',
                'background_color': '#1f2937',  # gray-800 - matches GPRA dark background
                'button_color': '#ea580c',      # orange-600 - matches GPRA primary buttons
            }
        )

        logger.info(f"Created renewal checkout session for user {user_id}, tier {previous_tier}/{billing_period}")
        return jsonify({'url': checkout_session.url})

    except stripe.error.StripeError as e:
        logger.error(f"Stripe error creating renewal checkout: {str(e)}")
        return jsonify({'error': f'Stripe error: {str(e)}'}), 400
    except Exception as e:
        logger.error(f"Error creating renewal checkout: {str(e)}")
        return jsonify({'error': 'Failed to create checkout session'}), 500


def set_unplugged_mode(db: Session):
    """Set user to unplugged mode (free tier with ads, limited to active routine)"""
    from flask_login import current_user
    if not current_user or not current_user.is_authenticated:
        return jsonify({'error': 'Not authenticated'}), 401

    user_id = current_user.id
    subscription = db.query(Subscription).filter_by(user_id=user_id).first()

    if not subscription:
        return jsonify({'error': 'No subscription found'}), 404

    try:
        from app.models import Routine
        from datetime import timedelta

        # Check rate limiting (once per billing period)
        # If user paused/unpause within current billing period, don't allow another pause
        if subscription.last_pause_action and subscription.current_period_start:
            # Check if last pause was within current billing period
            period_start = subscription.current_period_start.replace(tzinfo=None) if hasattr(subscription.current_period_start, 'replace') else subscription.current_period_start
            last_pause = subscription.last_pause_action.replace(tzinfo=None) if hasattr(subscription.last_pause_action, 'replace') else subscription.last_pause_action

            if last_pause >= period_start:
                # Last pause was in current billing period - don't allow another pause
                # Keep user in plugged-in state
                period_end = subscription.current_period_end.replace(tzinfo=None) if subscription.current_period_end else None
                if period_end:
                    days_until_next_period = (period_end - datetime.now()).days
                    return jsonify({'error': f'You can only pause/unpause once per billing period. Please try again in {days_until_next_period} days when your next billing period starts.'}), 429
                else:
                    return jsonify({'error': 'You can only pause/unpause once per billing period.'}), 429

        # Set unplugged mode
        subscription.unplugged_mode = True
        subscription.last_pause_action = datetime.now()

        # Set lapse_date to NOW (when they clicked "Unplugged")
        # This is the start of their 90-day window
        subscription.lapse_date = datetime.now()

        # Set data_deletion_date to 90 days from now
        # (removing the secret 30-day buffer - user sees 90 days, gets 90 days)
        subscription.data_deletion_date = datetime.now() + timedelta(days=90)

        # Store the routine that was active when they went unplugged
        # Check subscriptions table first (per-user active routine)
        active_routine_id = subscription.last_active_routine_id

        # If not set, get newest routine
        if not active_routine_id:
            newest = db.query(Routine).filter_by(user_id=user_id).order_by(Routine.created_at.desc()).first()
            if newest:
                active_routine_id = newest.id
                logger.info(f"User {user_id} set to unplugged mode with newest routine {active_routine_id}")
            else:
                logger.warning(f"User {user_id} set to unplugged mode but has no routines")

        subscription.last_active_routine_id = active_routine_id

        # Update Stripe subscription to cancel at period end
        if subscription.stripe_subscription_id:
            try:
                stripe.Subscription.modify(
                    subscription.stripe_subscription_id,
                    cancel_at_period_end=True
                )
                logger.info(f"Stripe subscription {subscription.stripe_subscription_id} set to cancel at period end")
            except stripe.error.StripeError as stripe_err:
                db.rollback()
                logger.error(f"Stripe API error setting cancel_at_period_end: {stripe_err.user_message}")
                return jsonify({'error': f'Failed to update Stripe subscription: {stripe_err.user_message}'}), 500
            except Exception as stripe_ex:
                db.rollback()
                logger.error(f"Unexpected error updating Stripe subscription: {str(stripe_ex)}")
                return jsonify({'error': 'Failed to communicate with payment provider'}), 500
        else:
            logger.warning(f"User {user_id} has no Stripe subscription ID - skipping Stripe update")

        db.commit()
        logger.info(f"User {user_id} set to unplugged mode - 90 days until deletion (no secret buffer)")
        return jsonify({'success': True})

    except Exception as e:
        db.rollback()
        logger.error(f"Error setting unplugged mode: {str(e)}")
        return jsonify({'error': 'Failed to set unplugged mode'}), 500


def unpause_subscription(db: Session):
    """Unpause subscription and restore full access"""
    from flask_login import current_user
    if not current_user or not current_user.is_authenticated:
        return jsonify({'error': 'Not authenticated'}), 401

    user_id = current_user.id
    subscription = db.query(Subscription).filter_by(user_id=user_id).first()

    if not subscription:
        return jsonify({'error': 'No subscription found'}), 404

    if not subscription.unplugged_mode:
        return jsonify({'error': 'Subscription is not paused'}), 400

    try:
        from datetime import timedelta

        # Check rate limiting (once per billing period)
        if subscription.last_pause_action and subscription.current_period_start:
            # Check if last pause was within current billing period
            period_start = subscription.current_period_start.replace(tzinfo=None) if hasattr(subscription.current_period_start, 'replace') else subscription.current_period_start
            last_pause = subscription.last_pause_action.replace(tzinfo=None) if hasattr(subscription.last_pause_action, 'replace') else subscription.last_pause_action

            if last_pause >= period_start:
                # Last pause was in current billing period - don't allow unpause in same period
                period_end = subscription.current_period_end.replace(tzinfo=None) if subscription.current_period_end else None
                if period_end:
                    days_until_next_period = (period_end - datetime.now()).days
                    return jsonify({'error': f'You can only pause/unpause once per billing period. Please try again in {days_until_next_period} days when your next billing period starts.'}), 429
                else:
                    return jsonify({'error': 'You can only pause/unpause once per billing period.'}), 429

        # Remove unplugged mode
        subscription.unplugged_mode = False
        subscription.last_pause_action = datetime.now()

        # Clear lapse-related dates since they're back to active
        subscription.lapse_date = None
        subscription.data_deletion_date = None

        # Reactivate Stripe subscription (remove cancel_at_period_end)
        if subscription.stripe_subscription_id:
            try:
                stripe.Subscription.modify(
                    subscription.stripe_subscription_id,
                    cancel_at_period_end=False
                )
                logger.info(f"Stripe subscription {subscription.stripe_subscription_id} reactivated (cancel_at_period_end=False)")
            except stripe.error.StripeError as stripe_err:
                db.rollback()
                logger.error(f"Stripe API error reactivating subscription: {stripe_err.user_message}")
                return jsonify({'error': f'Failed to reactivate Stripe subscription: {stripe_err.user_message}'}), 500
            except Exception as stripe_ex:
                db.rollback()
                logger.error(f"Unexpected error reactivating Stripe subscription: {str(stripe_ex)}")
                return jsonify({'error': 'Failed to communicate with payment provider'}), 500
        else:
            logger.warning(f"User {user_id} has no Stripe subscription ID - skipping Stripe update")

        db.commit()
        logger.info(f"User {user_id} unpaused subscription - full access restored")
        return jsonify({'success': True})

    except Exception as e:
        db.rollback()
        logger.error(f"Error unpausing subscription: {str(e)}")
        return jsonify({'error': 'Failed to unpause subscription'}), 500


def get_last_payment(db: Session):
    """Get the last successful payment amount and date from Stripe (excluding $0 payments)"""
    from flask_login import current_user
    if not current_user or not current_user.is_authenticated:
        return jsonify({'error': 'Not authenticated'}), 401

    user_id = current_user.id
    subscription = db.query(Subscription).filter_by(user_id=user_id).first()

    if not subscription or not subscription.stripe_customer_id:
        return jsonify({'error': 'No subscription found'}), 404

    try:
        # Fetch paid invoices for this customer (get more to filter out $0 ones)
        invoices = stripe.Invoice.list(
            customer=subscription.stripe_customer_id,
            status='paid',
            limit=10  # Get more to filter for non-zero payments
        )

        if not invoices.data:
            return jsonify({'error': 'No payment history found'}), 404

        # Find the first invoice with amount > 0
        latest_real_payment = None
        for invoice in invoices.data:
            amount_cents = invoice.amount_paid
            if amount_cents > 0:  # Only consider actual payments, not $0 invoices
                latest_real_payment = invoice
                break

        if not latest_real_payment:
            # User has invoices but all are $0 (promos, tests, etc.)
            return jsonify({'error': 'No payment history found'}), 404

        # Amount is in cents, convert to dollars
        amount = latest_real_payment.amount_paid / 100
        # Stripe timestamps are Unix timestamps
        payment_date = datetime.utcfromtimestamp(latest_real_payment.status_transitions.paid_at)

        logger.info(f"Retrieved last payment for user {user_id}: ${amount} on {payment_date.isoformat()}")

        return jsonify({
            'amount': f"{amount:.2f}",
            'date': payment_date.isoformat()
        })

    except stripe.error.StripeError as e:
        logger.error(f"Stripe error fetching last payment: {str(e)}")
        return jsonify({'error': f'Stripe error: {str(e)}'}), 400
    except Exception as e:
        logger.error(f"Error fetching last payment: {str(e)}")
        return jsonify({'error': 'Failed to fetch payment history'}), 500
