export function bidKey(bid) {
  return `${Number(bid.paddle)}-${Number(bid.amountLunas ?? bid.amount_lunas)}-${Number(bid.ts ?? bid.createdAt ?? bid.created_at)}`;
}

export function highestActiveBid(bids) {
  return bids.reduce((highest, bid) => !bid.removal && (!highest || bid.amountLunas > highest.amountLunas) ? bid : highest, null);
}
