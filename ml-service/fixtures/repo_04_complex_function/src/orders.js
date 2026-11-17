function priceOrder(order, user, coupons) {
  let total = 0
  if (!order) return 0
  for (const item of order.items) {
    if (item.quantity > 0) {
      if (item.discount) {
        if (user && user.vip) {
          total += item.price * item.quantity * 0.8
        } else if (coupons.length > 0) {
          total += item.price * item.quantity * 0.9
        } else {
          total += item.price * item.quantity
        }
      } else {
        if (item.bulk && item.quantity > 10) {
          total -= 5
        }
        total += item.price * item.quantity
      }
    } else if (item.quantity < 0) {
      throw new Error('bad quantity')
    }
  }
  switch (user.tier) {
    case 'gold':
      total *= 0.95
      break
    case 'silver':
      total *= 0.97
      break
    default:
      break
  }
  return total
}

module.exports = { priceOrder }
