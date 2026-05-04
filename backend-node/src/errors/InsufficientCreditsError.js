class InsufficientCreditsError extends Error {
  constructor({ required, balance, scope, service_type, model }) {
    super('INSUFFICIENT_CREDITS');
    this.code = 'INSUFFICIENT_CREDITS';
    this.statusCode = 402;
    this.required = Number(required) || 0;
    this.balance = Number(balance) || 0;
    this.shortfall = this.required - this.balance;
    this.scope = scope || null;
    this.service_type = service_type || null;
    this.model = model || null;
  }
}

module.exports = { InsufficientCreditsError };
