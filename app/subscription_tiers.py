"""Subscription tier configuration and limits"""

SUBSCRIPTION_TIERS = {
    'free': {
        'name': 'Free',
        'display_name': 'Free',
        'items_limit': 15,
        'routines_limit': 1,
        'autocreate_enabled': False,
        'price_monthly': 0,
        'price_yearly': 0,
        'stripe_price_id_monthly': None,
        'stripe_price_id_yearly': None,
    },
    'basic': {
        'name': 'Basic',
        'display_name': 'Basic',
        'items_limit': 80,
        'routines_limit': 5,
        'autocreate_enabled': False,
        'price_monthly': 3.00,
        'price_yearly': 27.00,  # 25% savings
        'stripe_price_id_monthly': 'price_1SOC2mJTZIlESiBEIHJBDZii',
        'stripe_price_id_yearly': 'price_1SOC3BJTZIlESiBEnRpLW9nQ',
    },
    'thegoods': {
        'name': 'The Goods',
        'display_name': 'The Goods',
        'items_limit': 200,
        'routines_limit': 10,
        'autocreate_enabled': True,  # Autocreate/Claude included starting at $6/mo
        'price_monthly': 6.00,
        'price_yearly': 54.00,  # 25% savings
        'stripe_price_id_monthly': 'price_1SOC3eJTZIlESiBEIblnPSdf',
        'stripe_price_id_yearly': 'price_1SOC3mJTZIlESiBEeKndWeZk',
    },
    'moregoods': {
        'name': 'More Goods',
        'display_name': 'More Goods',
        'items_limit': 600,
        'routines_limit': 25,
        'autocreate_enabled': True,
        'price_monthly': 12.00,
        'price_yearly': 100.80,  # 30% savings
        'stripe_price_id_monthly': 'price_1SOC4NJTZIlESiBElUo2Xx5D',
        'stripe_price_id_yearly': 'price_1SOC4pJTZIlESiBEBt3Vowp8',
    },
    'themost': {
        'name': 'The Most',
        'display_name': 'The Most',
        'items_limit': 1500,
        'routines_limit': 50,
        'autocreate_enabled': True,
        'price_monthly': 20.00,
        'price_yearly': 168.00,  # 30% savings
        'stripe_price_id_monthly': 'price_1SOC5WJTZIlESiBEsfcyxKWa',
        'stripe_price_id_yearly': 'price_1SOC5fJTZIlESiBEvaMXyyXP',
    },
    'complimentary': {
        'name': 'complimentary',
        'display_name': 'Complimentary',
        'items_limit': 999999,  # Effectively unlimited
        'routines_limit': 999999,  # Effectively unlimited
        'autocreate_enabled': True,
        'price_monthly': 0,
        'price_yearly': 0,
        'stripe_price_id_monthly': None,
        'stripe_price_id_yearly': None,
    },
}

def get_tier_limits(tier: str = None, is_complimentary: bool = False) -> dict:
    """Get limits for a subscription tier

    Args:
        tier: Subscription tier name (e.g., 'free', 'basic', 'thegoods')
        is_complimentary: Whether this is a complimentary account (overrides tier limits)

    Returns:
        Dictionary with tier configuration including limits and features
    """
    # Complimentary accounts get unlimited access
    if is_complimentary:
        return SUBSCRIPTION_TIERS['complimentary']

    # Default to free tier if no tier specified
    if tier is None:
        tier = 'free'

    return SUBSCRIPTION_TIERS.get(tier, SUBSCRIPTION_TIERS['free'])

def is_feature_enabled(tier: str = None, feature: str = None, is_complimentary: bool = False) -> bool:
    """Check if a feature is enabled for a tier

    Args:
        tier: Subscription tier name
        feature: Feature name to check (e.g., 'autocreate')
        is_complimentary: Whether this is a complimentary account

    Returns:
        True if feature is enabled, False otherwise
    """
    if feature is None:
        return False

    tier_config = get_tier_limits(tier, is_complimentary)
    return tier_config.get(f'{feature}_enabled', False)
