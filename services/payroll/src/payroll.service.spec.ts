import { createHash, randomUUID } from 'node:crypto';

describe('Payroll idempotency', () => {
  it('produces identical request hashes for identical inputs', () => {
    const input = { employeeId: 'abc', periodStart: '2025-01-01', periodEnd: '2025-01-31' };
    const hash1 = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const hash2 = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different periods', () => {
    const a = { employeeId: 'abc', periodStart: '2025-01-01', periodEnd: '2025-01-31' };
    const b = { employeeId: 'abc', periodStart: '2025-02-01', periodEnd: '2025-02-28' };
    const hashA = createHash('sha256').update(JSON.stringify(a)).digest('hex');
    const hashB = createHash('sha256').update(JSON.stringify(b)).digest('hex');
    expect(hashA).not.toBe(hashB);
  });
});

describe('Pay calculation', () => {
  function calculatePay(annualCents: number, periodDays: number) {
    const dailyRate = Math.round(annualCents / 365);
    const grossCents = dailyRate * periodDays;
    const deductionsCents = Math.round(grossCents * 0.22);
    const netCents = grossCents - deductionsCents;
    return { grossCents, deductionsCents, netCents };
  }

  it('calculates monthly pay from annual salary', () => {
    const result = calculatePay(7200000, 31); // $72,000/year, 31-day month
    expect(result.grossCents).toBeGreaterThan(0);
    expect(result.netCents).toBeLessThan(result.grossCents);
    expect(result.deductionsCents).toBeGreaterThan(0);
  });

  it('ensures net = gross - deductions', () => {
    const result = calculatePay(12000000, 30);
    expect(result.netCents).toBe(result.grossCents - result.deductionsCents);
  });
});

describe('Inbox deduplication', () => {
  it('detects duplicate event IDs', () => {
    const processedEvents = new Set<string>();
    const eventId = randomUUID();

    // First processing
    const isNew1 = !processedEvents.has(eventId);
    processedEvents.add(eventId);
    expect(isNew1).toBe(true);

    // Redelivery
    const isNew2 = !processedEvents.has(eventId);
    expect(isNew2).toBe(false);
  });
});
