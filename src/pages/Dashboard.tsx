import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api, Lead, PipelineStats } from "../lib/api";
import { Loader2, ArrowRight, Wand2, Mail, TrendingUp, Target, Zap } from "lucide-react";

export default function Dashboard() {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getStats(), api.getLeads()])
      .then(([statsData, leadsData]) => { setStats(statsData); setLeads(leadsData); })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  const handleBulkEnrich = async () => {
    const newLeads = leads.filter(l => l.status === 'new' && l.website);
    if (newLeads.length === 0) return;
    setActionLoading('enrich');
    try {
      await api.bulkEnrich(newLeads.map(l => l.id));
      const [s, l] = await Promise.all([api.getStats(), api.getLeads()]);
      setStats(s); setLeads(l);
    } catch { } finally { setActionLoading(null); }
  };

  const handleBulkEmail = async () => {
    const enrichedLeads = leads.filter(l => l.status === 'enriched');
    if (enrichedLeads.length === 0) return;
    setActionLoading('email');
    try {
      await api.bulkEmail(enrichedLeads.map(l => l.id));
      const [s, l] = await Promise.all([api.getStats(), api.getLeads()]);
      setStats(s); setLeads(l);
    } catch { } finally { setActionLoading(null); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  const p = stats?.pipeline || {};
  const funnelSteps = [
    { label: 'New', count: p['new'] || 0, color: 'bg-slate-500' },
    { label: 'Enriched', count: p['enriched'] || 0, color: 'bg-purple-500' },
    { label: 'Emailed', count: p['emailed'] || 0, color: 'bg-orange-500' },
    { label: 'Replied', count: p['replied'] || 0, color: 'bg-green-500' },
    { label: 'Interested', count: p['interested'] || 0, color: 'bg-emerald-500' },
    { label: 'Booked', count: p['booked'] || 0, color: 'bg-cyan-500' },
  ];
  const maxCount = Math.max(...funnelSteps.map(s => s.count), 1);

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <div className="flex gap-3">
          <button
            onClick={handleBulkEnrich}
            disabled={actionLoading !== null}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors font-medium text-sm flex items-center gap-2 disabled:opacity-60"
          >
            {actionLoading === 'enrich' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            Enrich All New
          </button>
          <button
            onClick={handleBulkEmail}
            disabled={actionLoading !== null}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm flex items-center gap-2 disabled:opacity-60"
          >
            {actionLoading === 'email' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            Email All Enriched
          </button>
        </div>
      </div>

      {/* Pipeline Funnel */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <TrendingUp className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold">Pipeline ({stats?.total || 0} total leads)</h2>
        </div>
        <div className="space-y-3">
          {funnelSteps.map((step) => (
            <div key={step.label} className="flex items-center gap-4">
              <span className="text-sm font-medium text-slate-600 w-24">{step.label}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-8 overflow-hidden">
                <div
                  className={`h-full rounded-full ${step.color} flex items-center px-3 transition-all duration-500`}
                  style={{ width: `${Math.max((step.count / maxCount) * 100, step.count > 0 ? 8 : 0)}%` }}
                >
                  {step.count > 0 && <span className="text-white text-xs font-bold">{step.count}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hot Leads */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-orange-500" />
            <h2 className="text-lg font-semibold">Hot Leads</h2>
          </div>
          <div className="space-y-3">
            {(stats?.hotLeads || []).slice(0, 5).map(lead => (
              <Link key={lead.id} to={`/leads/${lead.id}`} className="flex items-center justify-between py-2 hover:bg-slate-50 px-2 rounded-lg transition-colors">
                <div className="flex-1">
                  <p className="font-medium text-slate-900 text-sm">{lead.business_name}</p>
                  <p className="text-xs text-slate-500">{lead.industry} • {lead.location}</p>
                </div>
                <div className="flex items-center gap-3">
                  <ScoreBadge score={lead.lead_score} />
                  <ArrowRight className="w-4 h-4 text-slate-400" />
                </div>
              </Link>
            ))}
            {(!stats?.hotLeads || stats.hotLeads.length === 0) && (
              <p className="text-slate-400 text-sm py-4 text-center">Enrich leads to see scores here.</p>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-yellow-500" />
            <h2 className="text-lg font-semibold">Quick Actions</h2>
          </div>
          <div className="space-y-3">
            <Link to="/discovery" className="flex items-center gap-3 p-4 bg-indigo-50 rounded-xl hover:bg-indigo-100 transition-colors">
              <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
                <Target className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold text-indigo-900">Find New Leads</p>
                <p className="text-xs text-indigo-600">Discover 10–200 leads in any niche</p>
              </div>
            </Link>
            <Link to="/leads" className="flex items-center gap-3 p-4 bg-purple-50 rounded-xl hover:bg-purple-100 transition-colors">
              <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center text-white">
                <Wand2 className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold text-purple-900">Manage Pipeline</p>
                <p className="text-xs text-purple-600">Enrich, email, and nurture your leads</p>
              </div>
            </Link>
            <Link to="/settings" className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">
              <div className="w-10 h-10 bg-slate-600 rounded-lg flex items-center justify-center text-white">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold text-slate-900">Setup Outreach</p>
                <p className="text-xs text-slate-600">Configure email, booking link & templates</p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-green-100 text-green-700' : score >= 40 ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-600';
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-bold ${color}`}>
      {score}
    </span>
  );
}
