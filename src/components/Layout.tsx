import {
  LayoutDashboard,
  Search,
  Users,
  Settings,
  MessageSquare,
  Megaphone
} from "lucide-react";
import { SidebarItem } from "./SidebarItem";
import { Outlet } from "react-router-dom";

export default function Layout() {
  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
              AI
            </div>
            AutoBound
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <SidebarItem icon={LayoutDashboard} label="Dashboard" href="/" />
          <SidebarItem icon={Search} label="Discovery" href="/discovery" />
          <SidebarItem icon={Users} label="Leads" href="/leads" />
          <SidebarItem icon={Megaphone} label="Campaigns" href="/campaigns" />
          <SidebarItem icon={MessageSquare} label="Conversations" href="/conversations" />
          <SidebarItem icon={Settings} label="Settings" href="/settings" />
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-slate-200" />
            <div className="text-sm">
              <p className="font-medium text-slate-900">Admin User</p>
              <p className="text-slate-500">admin@autobound.ai</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
