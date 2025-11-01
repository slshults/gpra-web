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
}

def get_tier_limits(tier: str) -> dict:
    """Get limits for a subscription tier"""
    return SUBSCRIPTION_TIERS.get(tier, SUBSCRIPTION_TIERS['free'])

def is_feature_enabled(tier: str, feature: str) -> bool:
    """Check if a feature is enabled for a tier"""
    tier_config = get_tier_limits(tier)
    return tier_config.get(f'{feature}_enabled', False)
