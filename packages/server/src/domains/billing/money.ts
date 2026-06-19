export const MICROCREDITS_PER_CREDIT = 10000

export function toInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

export function creditToMicro(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n * MICROCREDITS_PER_CREDIT) : 0
}

export function nonNegativeCreditToMicro(value: any): number {
  return Math.max(0, creditToMicro(value))
}

export function microToCredit(value: any): number {
  return toInt(value) / MICROCREDITS_PER_CREDIT
}

export function ceilMicro(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0
}
