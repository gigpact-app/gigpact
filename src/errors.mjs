export class SpendError extends Error { constructor(code, m) { super(`${code}: ${m}`); this.name = 'SpendError'; this.code = code; } }
