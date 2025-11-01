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
                }
            }
        }

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

    db.commit()
    logger.info(f"Updated subscription for user {subscription.user_id}: tier={tier}, status={subscription.status}")


def handle_subscription_deleted(db: Session, stripe_subscription):
    """Handle subscription cancellation/deletion"""
    logger.info(f"Subscription deleted: {stripe_subscription['id']}")

    subscription = db.query(Subscription).filter_by(
        stripe_subscription_id=stripe_subscription['id']
    ).first()

    if not subscription:
        logger.warning(f"No subscription found for Stripe subscription {stripe_subscription['id']}")
        return

    # Downgrade to free tier
    subscription.tier = 'free'
    subscription.status = 'canceled'
    subscription.mrr = 0
    subscription.stripe_subscription_id = None
    subscription.stripe_price_id = None
    subscription.cancel_at_period_end = False

    db.commit()
    logger.info(f"Downgraded user {subscription.user_id} to free tier")


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
            db.commit()
            logger.info(f"Reactivated subscription for user {subscription.user_id}")


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
