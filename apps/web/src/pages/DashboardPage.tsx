import { useQuery } from '@tanstack/react-query';
import { employeesApi, attendanceApi, payrollApi } from '../api/client';
import { Users, CalendarClock, Wallet, Activity, TrendingUp, Clock } from 'lucide-react';

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  delay,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  color: string;
  delay: string;
}) {
  return (
    <div className={`glass-card p-6 animate-fade-in ${delay}`}>
      <div className="flex items-center justify-between mb-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ background: `${color}15`, border: `1px solid ${color}30` }}
        >
          <Icon className="w-6 h-6" style={{ color }} />
        </div>
        <TrendingUp className="w-4 h-4 text-emerald-400" />
      </div>
      <p className="text-2xl font-bold text-slate-100">{value}</p>
      <p className="text-sm text-slate-400 mt-1">{label}</p>
    </div>
  );
}

export default function DashboardPage() {
  const employees = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const leaves = useQuery({ queryKey: ['leaves'], queryFn: attendanceApi.listLeaves });
  const payRuns = useQuery({ queryKey: ['payRuns'], queryFn: payrollApi.listRuns });

  const pendingLeaves = leaves.data?.filter((l) => l.state !== 'Approved' && l.state !== 'Rejected').length ?? 0;
  const completedRuns = payRuns.data?.filter((r) => r.status === 'COMPLETED').length ?? 0;

  return (
    <div className="space-y-8">
      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <StatCard
          icon={Users}
          label="Total Employees"
          value={employees.data?.length ?? '—'}
          color="#6366f1"
          delay="animate-fade-in-delay-1"
        />
        <StatCard
          icon={CalendarClock}
          label="Pending Leaves"
          value={pendingLeaves}
          color="#f59e0b"
          delay="animate-fade-in-delay-2"
        />
        <StatCard
          icon={Wallet}
          label="Pay Runs Completed"
          value={completedRuns}
          color="#22c55e"
          delay="animate-fade-in-delay-3"
        />
        <StatCard
          icon={Activity}
          label="Services Online"
          value="6/6"
          color="#8b5cf6"
          delay="animate-fade-in-delay-4"
        />
      </div>

      {/* Architecture highlights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-6 animate-fade-in animate-fade-in-delay-2">
          <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" />
            Recent Leave Requests
          </h3>
          {leaves.isLoading ? (
            <p className="text-slate-500 text-sm">Loading...</p>
          ) : leaves.data?.length ? (
            <div className="space-y-3">
              {leaves.data.slice(0, 5).map((leave) => (
                <div
                  key={leave.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-800/30 border border-slate-700/20"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-200">
                      {leave.leaveType} Leave — {leave.days} day{leave.days > 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      {leave.startsOn} → {leave.endsOn}
                    </p>
                  </div>
                  <span className={`badge badge-${
                    leave.state === 'Approved' ? 'approved' :
                    leave.state === 'Rejected' ? 'rejected' :
                    leave.state === 'Pending' ? 'pending' : 'review'
                  }`}>
                    {leave.state}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-sm">No leave requests yet</p>
          )}
        </div>

        <div className="glass-card p-6 animate-fade-in animate-fade-in-delay-3">
          <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-400" />
            System Architecture
          </h3>
          <div className="space-y-3 text-sm">
            {[
              { label: 'Message Broker', value: 'RabbitMQ (topic exchange + DLQ)', color: '#f59e0b' },
              { label: 'Auth Pattern', value: 'JWT + Refresh Token Rotation', color: '#6366f1' },
              { label: 'Data Pattern', value: 'Transactional Outbox + Inbox', color: '#22c55e' },
              { label: 'Consistency', value: 'Eventual (projection polling)', color: '#8b5cf6' },
              { label: 'Resilience', value: 'Circuit Breaker (opossum)', color: '#ef4444' },
              { label: 'Org Queries', value: 'PostgreSQL ltree + GiST', color: '#06b6d4' },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-800/30 border border-slate-700/20"
              >
                <span className="text-slate-400">{item.label}</span>
                <span className="font-medium" style={{ color: item.color }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
