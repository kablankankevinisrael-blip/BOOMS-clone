"""Shared helpers to compute social value deltas."""
from decimal import Decimal, ROUND_HALF_UP
from typing import Union

DECIMAL_2 = Decimal("0.01")
SOCIAL_PRECISION = Decimal("0.000001")
DEFAULT_MIN_SOCIAL_DELTA = Decimal("0.01")


NumberLike = Union[Decimal, float, int, str, None]


def _to_decimal(value: NumberLike) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def calculate_social_delta(amount: Decimal, rate: Decimal,
                           minimum: Decimal = DEFAULT_MIN_SOCIAL_DELTA) -> Decimal:
    """Return a rounded delta based on an amount and a rate."""
    amount_decimal = _to_decimal(amount)
    rate_decimal = _to_decimal(rate)
    delta = (amount_decimal * rate_decimal).quantize(DECIMAL_2, ROUND_HALF_UP)
    if delta < minimum:
        delta = minimum
    return delta


def apply_social_increase(current_value: Decimal, delta: Decimal) -> Decimal:
    """Increase the current social value by delta."""
    current_decimal = _to_decimal(current_value)
    return current_decimal + _to_decimal(delta)


def apply_social_decrease(current_value: Decimal, delta: Decimal) -> Decimal:
    """Decrease the social value by delta without going negative."""
    current_decimal = _to_decimal(current_value)
    delta_decimal = _to_decimal(delta)
    new_value = current_decimal - delta_decimal
    if new_value < Decimal("0"):
        new_value = Decimal("0")
    return new_value
