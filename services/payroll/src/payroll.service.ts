import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { createDomainEvent } from '@atlas/contracts';
import { DatabaseService, OutboxService, StructuredLogger, getTraceContext } from '@atlas/platform';
import { PayrollRepository } from './payroll.repository';

@Injectable()
export class PayrollService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: PayrollRepository,
    private readonly outbox: OutboxService,
    private readonly logger: StructuredLogger
  ) {}

  async listPayRuns(employeeId?: string) {
    return this.repository.findPayRuns(employeeId ? { employeeId } : undefined);
  }

  async getPayRun(id: string) {
    const run = await this.repository.findPayRunById(id);
    if (!run) {
      throw new NotFoundException(`Pay run ${id} not found`);
    }
    return run;
  }

  async getProjection(leaveRequestId: string) {
    const projection = await this.repository.findLeaveProjection(leaveRequestId);
    if (!projection) {
      return { leaveRequestId, status: 'pending' as const, message: 'Event has not yet been consumed by Payroll' };
    }
    return {
      leaveRequestId: projection.leave_request_id,
      status: projection.status,
      employeeId: projection.employee_id,
      leaveDaysApplied: projection.days,
      lastEventId: projection.source_event_id,
      updatedAt: projection.applied_at.toISOString()
    };
  }

  /**
   * Idempotent pay-run initiation.
   *
   * Safety layers:
   * 1. Idempotency-Key header → same key returns cached response (no DB mutation)
   * 2. UNIQUE(employee_id, period_start, period_end) → prevents duplicate at DB level
   * 3. Business validation → checks compensation record exists
   *
   * Even if a worker retries this operation, the employee cannot be double-paid.
   */
  async triggerPayRun(input: {
    employeeId: string;
    periodStart: string;
    periodEnd: string;
    idempotencyKey?: string;
  }) {
    // Layer 1: Check idempotency key
    if (input.idempotencyKey) {
      const existing = await this.repository.checkIdempotencyKey('pay-run', input.idempotencyKey);
      if (existing) {
        this.logger.log(`Idempotency key hit: ${input.idempotencyKey}`, 'PayrollService');
        return existing.response_body;
      }
    }

    // Layer 2: Check for existing pay run for this period
    const existingRun = await this.repository.findPayRunByPeriod(
      input.employeeId,
      input.periodStart,
      input.periodEnd
    );
    if (existingRun) {
      throw new ConflictException(
        `Pay run already exists for employee ${input.employeeId} period ${input.periodStart} → ${input.periodEnd}`
      );
    }

    // Validate compensation exists
    const compensation = await this.repository.findCompensation(input.employeeId);
    if (!compensation) {
      throw new BadRequestException(`No compensation record for employee ${input.employeeId}`);
    }

    const payRunId = randomUUID();
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ employeeId: input.employeeId, periodStart: input.periodStart, periodEnd: input.periodEnd }))
      .digest('hex');

    return this.database.transaction(async (client) => {
      const payRun = await this.repository.insertPayRun(client, {
        id: payRunId,
        employee_id: input.employeeId,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        idempotency_key: input.idempotencyKey ?? null
      });

      // Calculate pay (simplified: monthly proration)
      const periodDays = this.daysBetween(input.periodStart, input.periodEnd);
      const dailyRate = Math.round(compensation.annual_salary_cents / 365);
      const grossCents = dailyRate * periodDays;
      const deductionsCents = Math.round(grossCents * 0.22); // ~22% tax/deductions
      const netCents = grossCents - deductionsCents;

      const completedRun = await this.repository.completePayRun(
        client, payRunId, grossCents, deductionsCents, netCents
      );

      // Generate PDF payslip
      const payslipId = randomUUID();
      const storageKey = `payslips/${input.employeeId}/${payRunId}.pdf`;

      // In production, this would upload to S3/GCS. Here we just record the reference.
      await this.repository.insertPayslip(client, {
        id: payslipId,
        pay_run_id: payRunId,
        employee_id: input.employeeId,
        storage_key: storageKey
      });

      // Emit events
      await this.outbox.enqueue(
        client,
        createDomainEvent({
          type: 'payroll.run.processed.v1',
          producer: 'payroll-service',
          aggregate: { type: 'payRun', id: payRunId },
          traceId: getTraceContext().traceId,
          data: {
            payRunId,
            employeeId: input.employeeId,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            grossCents,
            deductionsCents,
            netCents,
            status: 'COMPLETED',
            idempotencyKey: input.idempotencyKey ?? null
          }
        })
      );

      await this.outbox.enqueue(
        client,
        createDomainEvent({
          type: 'payslip.generated.v1',
          producer: 'payroll-service',
          aggregate: { type: 'payslip', id: payslipId },
          traceId: getTraceContext().traceId,
          data: {
            payslipId,
            payRunId,
            employeeId: input.employeeId,
            storageKey
          }
        })
      );

      const response = {
        ...completedRun,
        grossCents,
        deductionsCents,
        netCents,
        payslipId,
        storageKey
      };

      // Save idempotency record
      if (input.idempotencyKey) {
        await this.repository.saveIdempotencyRecord(
          client, 'pay-run', input.idempotencyKey, requestHash, 201, response
        );
      }

      return response;
    });
  }

  /**
   * Generate a PDF payslip document.
   * Returns a Buffer containing the PDF.
   */
  generatePayslipPdf(data: {
    employeeId: string;
    periodStart: string;
    periodEnd: string;
    grossCents: number;
    deductionsCents: number;
    netCents: number;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(24).text('Atlas EMS', { align: 'center' });
      doc.fontSize(14).text('Payslip', { align: 'center' });
      doc.moveDown(2);

      // Details
      doc.fontSize(12);
      doc.text(`Employee ID: ${data.employeeId}`);
      doc.text(`Pay Period: ${data.periodStart} — ${data.periodEnd}`);
      doc.moveDown();

      doc.text(`Gross Pay: $${(data.grossCents / 100).toFixed(2)}`);
      doc.text(`Deductions: -$${(data.deductionsCents / 100).toFixed(2)}`);
      doc.moveDown();

      doc.fontSize(16).text(`Net Pay: $${(data.netCents / 100).toFixed(2)}`, { underline: true });
      doc.moveDown(2);

      doc.fontSize(10)
        .fillColor('#888')
        .text(`Generated at ${new Date().toISOString()}`, { align: 'center' });

      doc.end();
    });
  }

  private daysBetween(start: string, end: string): number {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffMs = endDate.getTime() - startDate.getTime();
    return Math.max(1, Math.ceil(diffMs / 86400000));
  }
}
