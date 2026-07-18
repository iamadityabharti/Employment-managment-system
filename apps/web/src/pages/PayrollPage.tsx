import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '../api/client';
import { Wallet, TrendingUp, FileText, DollarSign } from 'lucide-react';

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'COMPLETED': return 'badge-approved';
    case 'PROCESSING': return 'badge-review';
    case 'REQUESTED': return 'badge-pending';
    case 'FAILED': return 'badge-rejected';
    default: return 'badge-pending';
  }
}

export default function PayrollPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['payRuns'],
    queryFn: payrollApi.listRuns,
  });

  const totalPaid = data
    ?.filter((r) => r.status === 'COMPLETED')
    .reduce((sum, r) => sum + (r.netCents ?? 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Payroll</h2>
          <p className="text-sm text-slate-400 mt-1">
            Idempotent pay-run processing with Idempotency-Key headers
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-5 animate-fade-in animate-fade-in-delay-1">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <span className="text-sm text-slate-400">Total Paid</span>
          </div>
          <p className="text-2xl font-bold text-emerald-400">{formatCents(totalPaid)}</p>
        </div>
        <div className="glass-card p-5 animate-fade-in animate-fade-in-delay-2">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <FileText className="w-5 h-5 text-indigo-400" />
            </div>
            <span className="text-sm text-slate-400">Pay Runs</span>
          </div>
          <p className="text-2xl font-bold text-slate-200">{data?.length ?? 0}</p>
        </div>
        <div className="glass-card p-5 animate-fade-in animate-fade-in-delay-3">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-purple-400" />
            </div>
            <span className="text-sm text-slate-400">Avg Net Pay</span>
          </div>
          <p className="text-2xl font-bold text-slate-200">
            {data?.length
              ? formatCents(Math.round(totalPaid / data.filter((r) => r.status === 'COMPLETED').length || 1))
              : '—'}
          </p>
        </div>
      </div>

      {/* Pay runs table */}
      {isLoading ? (
        <div className="glass-card p-12 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500" />
        </div>
      ) : error ? (
        <div className="glass-card p-6 text-red-400 text-sm">
          Failed to load pay runs: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      ) : data?.length ? (
        <div className="glass-card overflow-hidden animate-fade-in animate-fade-in-delay-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/30">
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Period</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Employee</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Gross</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Deductions</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Net</th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/20">
                {data.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-800/20 transition-colors">
                    <td className="px-6 py-4 text-slate-300">
                      {run.periodStart} → {run.periodEnd}
                    </td>
                    <td className="px-6 py-4 text-slate-400 font-mono text-xs">
                      {run.employeeId.slice(0, 8)}...
                    </td>
                    <td className="px-6 py-4 text-right text-slate-300">{formatCents(run.grossCents)}</td>
                    <td className="px-6 py-4 text-right text-red-400/70">{formatCents(run.deductionsCents)}</td>
                    <td className="px-6 py-4 text-right font-semibold text-emerald-400">{formatCents(run.netCents)}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`badge ${statusColor(run.status)}`}>{run.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <Wallet className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No pay runs yet</p>
          <p className="text-xs text-slate-600 mt-1">
            Trigger a pay run via the API with an Idempotency-Key header
          </p>
        </div>
      )}
    </div>
  );
}
