import { NavLink, useLocation } from 'react-router-dom';
import { useSession } from '../auth/session';
import {
  LayoutDashboard,
  Users,
  CalendarClock,
  Wallet,
  LogOut,
  Shield,
  ChevronRight
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/',          label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/employees', label: 'Employees',  icon: Users },
  { to: '/leave',     label: 'Leave',      icon: CalendarClock },
  { to: '/payroll',   label: 'Payroll',    icon: Wallet },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useSession();
  const location = useLocation();

  const pageTitle = NAV_ITEMS.find(
    (item) => item.to === location.pathname
  )?.label ?? 'Atlas EMS';

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-72 bg-slate-900/60 backdrop-blur-xl border-r border-slate-700/30 flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-slate-700/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold gradient-text">Atlas EMS</h1>
              <p className="text-xs text-slate-500">Employee Management</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              {item.label}
              <ChevronRight className="w-4 h-4 ml-auto opacity-0 group-[.active]:opacity-100" />
            </NavLink>
          ))}
        </nav>

        {/* User info */}
        <div className="p-4 border-t border-slate-700/30">
          <div className="glass-card p-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-sm font-bold">
                {user?.email?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">
                  {user?.email ?? 'Unknown'}
                </p>
                <div className="flex gap-1 mt-1">
                  {user?.roles?.map((role) => (
                    <span
                      key={role}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => void signOut()}
                className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-red-400 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col">
        <header className="h-16 border-b border-slate-700/30 flex items-center px-8 bg-slate-900/30 backdrop-blur-sm">
          <h2 className="text-lg font-semibold text-slate-200">{pageTitle}</h2>
        </header>
        <div className="flex-1 p-8 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
