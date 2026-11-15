// Requested fees include the lesson and canonical rental facts; source cells stay intact.
export const FINANCIAL_VERSION = 3;
export const BOOKING_PAYMENT_SOURCES = Object.freeze(['네이버쇼핑', '계좌이체', '키인카드결제']);

/** Empty cells mean zero; amounts are whole, nonnegative won within JS's exact range. */
export function parseBookingAmount(value, label = '금액') {
  if (value === null || value === undefined) return 0;
  let amount;
  if (typeof value === 'number') {
    amount = value;
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return 0;
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) {
      throw new RangeError(`${label}을 0원 이상의 정수로 입력해 주세요.`);
    }
    amount = Number(text.replaceAll(',', ''));
  }
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`${label}을 0원 이상의 정수로 입력해 주세요.`);
  }
  return amount === 0 ? 0 : amount;
}

/** A staff correction changes the requested total, never the recorded payment. */
export function bookingRequestedAmountOverride(row={}){
  const pending=row?.paymentRequestCorrection;
  const value=pending&&Object.prototype.hasOwnProperty.call(pending,'correctedRequestedAmount')?pending.correctedRequestedAmount
    :Object.prototype.hasOwnProperty.call(row,'currentAmountOverride')?row.currentAmountOverride:row?.current_amount_override;
  if(value===undefined||value===null||value==='')return null;
  const amount=parseBookingAmount(value,'정정할 요청 총액');
  if(amount>1_000_000_000)throw new RangeError('정정할 요청 총액은 10억원 이하로 입력해 주세요.');
  return amount;
}

/** Use an explicit correction or T + rental; patch U and legacy cells stay excluded. */
export function bookingFinancialSummary(rawOrRow = {}) {
  const raw = rawOrRow?.raw ?? rawOrRow?.raw_data ?? rawOrRow ?? {};
  const lesson = parseBookingAmount(raw.T, '강습요금');
  const own = key => Object.prototype.hasOwnProperty.call(rawOrRow || {}, key);
  const status = own('rentalPaymentStatus') ? rawOrRow.rentalPaymentStatus : rawOrRow?.rental_payment_status;
  const rentalValue = own('rentalAmount') ? rawOrRow.rentalAmount : rawOrRow?.rental_amount;
  const rental = ['paid', 'onsite_unpaid'].includes(status) ? parseBookingAmount(rentalValue, '장비금액') : 0;
  const paid = parseBookingAmount(raw.Y, '입금금액');
  const requested = bookingRequestedAmountOverride(rawOrRow) ?? lesson + rental;
  if (!Number.isSafeInteger(requested)) throw new RangeError('요청금액이 처리 가능한 범위를 초과했습니다.');
  return {
    requested,
    paid,
    balance: Math.max(requested - paid, 0),
    overpaid: Math.max(paid - requested, 0),
  };
}

/** Apply on explicit save/review, leaving every source cell except computed X/Z intact. */
export function applyFinancialV3(rawOrRow = {}) {
  const raw = rawOrRow?.raw ?? rawOrRow?.raw_data ?? rawOrRow ?? {};
  const { requested, balance } = bookingFinancialSummary(rawOrRow);
  return { ...raw, X: String(requested), Z: String(balance) };
}

/** A legacy source remains selectable until the operator explicitly changes it. */
export function bookingPaymentSourceOptions(current = '') {
  const options = BOOKING_PAYMENT_SOURCES.map(value => ({ value, label: value }));
  const legacy = current === null || current === undefined ? '' : String(current);
  if (legacy && !BOOKING_PAYMENT_SOURCES.includes(legacy)) {
    options.push({ value: legacy, label: `${legacy} (기존 값)` });
  }
  return options;
}
