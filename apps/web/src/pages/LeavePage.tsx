import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { attendanceApi, payrollApi } from '../api/client';
import type { LeaveRequest, LeaveState } from '../api/types';
import {
  CalendarClock,
  ChevronRight,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  Loader2
} from 'lucide-react';

function stateBadgeClass(state: LeaveState): string {
  switch (state) {
    case 'Approved': return 'badge-approved';
    case 'Rejected': return 'badge-rejected';
    case 'Pending': return 'badge-pending';
    default: return 'badge-review';
  }
}

/**
 * Eventual Consistency Indicator.
 *
 * After a leave is approved, Attendance returns payrollProjection.status = "pending".
 * The UI polls the Payroll projection endpoint until it shows "synchronized".
 * This makes the propagation lag visible and honest — we don't pretend a
 * distributed transaction exists.
 */
function ProjectionStatus({ leaveId }: { leaveId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['projection', leaveId],
    queryFn: () => payrollApi.projection(leaveId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'synchronized' || status === 'failed' ? false : 3000;
    },
  });

  if (isLoading) {
    return <span className="badge badge-sync-pending"><Loader2 className="w-3 h-3 animate-spin" /> Checking...</span>;
  }
  if (data?.status === 'synchronized') {
    return <span className="badge badge-synced"><CheckCircle2 className="w-3 h-3" /> Payroll Synced</span>;
  }
  if (data?.status === 'failed') {
    return <span className="badge badge-rejected"><XCircle className="w-3 h-3" /> Sync Failed</span>;
  }
  return <span className="badge badge-sync-pending"><RefreshCw className="w-3 h-3 animate-spin" /> Propagating...</span>;
}

function LeaveCard({ leave }: { leave: LeaveRequest }) {
  const queryClient = useQueryClient();
  const [transitioning, setTransitioning] = useState(false);

  const handleTransition = async (to: LeaveState) => {
    setTransitioning(true);
    try {
      const idempotencyKey = `transition-${leave.id}-${to}-${Date.now()}`;
      await attendanceApi.transition(leave.id, to, undefined, idempotencyKey);
      await queryClient.invalidateQueries({ queryKey: ['leaves'] });
    } catch (error) {
      console.error('Transition failed:', error);
    } finally {
      setTransitioning(false);
    }
  };

  const nextStates: Partial<Record<LeaveState, LeaveState[]>> = {
    Pending: ['ManagerReview', 'Rejected'],
    ManagerReview: ['HRReview', 'Rejected'],
    HRReview: ['Approved', 'Rejected'],
  };

  const availableTransitions = nextStates[leave.state] ?? [];
  const isTerminal = leave.state === 'Approved' || leave.state === 'Rejected';

  return (
    <div className="glass-card p-5 animate-fade-in">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-slate-200">
              {leave.leaveType} Leave
            </span>
            <span className={`badge ${stateBadgeClass(leave.state)}`}>
              {leave.state}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {leave.startsOn} → {leave.endsOn} • {leave.days} day{leave.days > 1 ? 's' : ''}
          </p>
        </div>
        <span className="text-xs text-slate-600 font-mono">{leave.id.slice(0, 8)}</span>
      </div>

      {/* State machine visualization */}
      <div className="flex items-center gap-1 mb-4 flex-wrap">
        {(['Pending', 'ManagerReview', 'HRReview', 'Approved'] as LeaveState[]).map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            {i > 0 && <ArrowRight className="w-3 h-3 text-slate-600" />}
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                s === leave.state
                  ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-semibold'
                  : leave.state === 'Rejected' || (
                      ['Pending', 'ManagerReview', 'HRReview', 'Approved'].indexOf(s) >
                      ['Pending', 'ManagerReview', 'HRReview', 'Approved'].indexOf(leave.state)
                    )
                    ? 'text-slate-600'
                    : 'text-slate-400'
              }`}
            >
              {s}
            </span>
          </div>
        ))}
      </div>

      {/* Eventual consistency indicator */}
      {leave.state === 'Approved' && (
        <div className="mb-4 p-3 rounded-xl bg-slate-800/30 border border-slate-700/20">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Payroll Projection:</span>
            <ProjectionStatus leaveId={leave.id} />
          </div>
        </div>
      )}

      {/* Transition buttons */}
      {!isTerminal && availableTransitions.length > 0 && (
        <div className="flex gap-2 pt-2 border-t border-slate-700/20">
          {availableTransitions.map((target) => (
            <button
              key={target}
              disabled={transitioning}
              onClick={() => void handleTransition(target)}
              className={
                target === 'Rejected'
                  ? 'btn-secondary text-xs flex items-center gap-1'
                  : 'btn-primary text-xs flex items-center gap-1'
              }
            >
              {transitioning ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : target === 'Approved' ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : target === 'Rejected' ? (
                <XCircle className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              {target}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LeavePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['leaves'],
    queryFn: attendanceApi.listLeaves,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-100">Leave Management</h2>
        <p className="text-sm text-slate-400 mt-1">
          State machine: Pending → ManagerReview → HRReview → Approved/Rejected
        </p>
      </div>

      {isLoading ? (
        <div className="glass-card p-12 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500" />
        </div>
      ) : error ? (
        <div className="glass-card p-6 text-red-400 text-sm">
          Failed to load leaves: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      ) : data?.length ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.map((leave) => (
            <LeaveCard key={leave.id} leave={leave} />
          ))}
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <CalendarClock className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No leave requests found</p>
          <p className="text-xs text-slate-600 mt-1">
            Create an employee and submit a leave request to see the state machine in action
          </p>
        </div>
      )}
    </div>
  );
}
