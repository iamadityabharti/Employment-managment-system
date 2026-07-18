import { useQuery } from '@tanstack/react-query';
import { employeesApi } from '../api/client';
import { Users, Building2, GitBranch, Mail, UserPlus } from 'lucide-react';
import type { EmployeeSummary } from '../api/types';

function OrgNode({ employee, allEmployees, depth = 0 }: {
  employee: EmployeeSummary;
  allEmployees: EmployeeSummary[];
  depth?: number;
}) {
  const reports = allEmployees.filter((e) => e.managerId === employee.id);
  return (
    <div style={{ marginLeft: depth * 24 }} className="mb-2">
      <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/30 border border-slate-700/20 hover:border-indigo-500/30 transition-colors">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center text-indigo-400 text-sm font-bold">
          {employee.firstName?.[0]}{employee.lastName?.[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-200">
            {employee.firstName} {employee.lastName}
          </p>
          <p className="text-xs text-slate-500">{employee.title} • {employee.department}</p>
        </div>
        <span className="text-xs text-slate-500 font-mono">{employee.employeeNumber}</span>
        {reports.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            {reports.length} report{reports.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {reports.map((r) => (
        <OrgNode key={r.id} employee={r} allEmployees={allEmployees} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function EmployeesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['employees'],
    queryFn: employeesApi.list,
  });

  const rootEmployees = data?.filter((e) => !e.managerId) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Employee Directory</h2>
          <p className="text-sm text-slate-400 mt-1">
            Hierarchical org chart powered by PostgreSQL ltree
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="glass-card p-12 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500" />
        </div>
      ) : error ? (
        <div className="glass-card p-6 text-red-400 text-sm">
          Failed to load employees: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Org chart */}
          <div className="glass-card p-6 animate-fade-in">
            <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-indigo-400" />
              Org Chart
            </h3>
            <div className="space-y-1">
              {rootEmployees.map((emp) => (
                <OrgNode key={emp.id} employee={emp} allEmployees={data!} />
              ))}
            </div>
          </div>

          {/* Employee table */}
          <div className="glass-card p-6 animate-fade-in animate-fade-in-delay-1">
            <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-purple-400" />
              All Employees ({data?.length ?? 0})
            </h3>
            <div className="space-y-2">
              {data?.map((emp) => (
                <div
                  key={emp.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/20 border border-slate-700/10 hover:bg-slate-800/40 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                    {emp.firstName?.[0]}{emp.lastName?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200">
                      {emp.firstName} {emp.lastName}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> {emp.department}
                      </span>
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Mail className="w-3 h-3" /> {emp.email}
                      </span>
                    </div>
                  </div>
                  <span className={`badge ${emp.status === 'ACTIVE' ? 'badge-approved' : 'badge-rejected'}`}>
                    {emp.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
