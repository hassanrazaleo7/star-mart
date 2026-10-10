// Amounts are integer paisa. Keep reward liability within 10% of known gross profit.
export const REWARD_POINTS = 100;
export const REWARD_PAISA = 5000;
export const MIN_REDEMPTION_BILL_PAISA = 300000;
export function eligiblePoints(totalPaisa, grossProfitPaisa, costsKnown) {
  if (!costsKnown || grossProfitPaisa <= 0) return 0;
  return Math.max(0, Math.min(Math.floor(totalPaisa / 10000), Math.floor(grossProfitPaisa / 500)));
}
export function rewardAllowed({
  subtotal,
  grossProfit,
  manualDiscount,
  points,
  balance,
  costsKnown,
}) {
  if (!points) return null;
  if (points !== REWARD_POINTS) return 'Only 100 points may be redeemed per bill';
  if (balance < points) return 'Not enough loyalty points';
  if (subtotal < MIN_REDEMPTION_BILL_PAISA)
    return 'Points reward requires a bill of at least Rs 3,000';
  if (manualDiscount) return 'Points reward cannot be combined with another discount';
  if (!costsKnown) return 'Add product purchase costs before offering points rewards';
  if (grossProfit - REWARD_PAISA < Math.ceil(subtotal * 0.08))
    return 'This basket does not meet the points reward margin requirement';
  return null;
}
