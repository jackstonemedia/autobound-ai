import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api, Lead, PipelineStats, Campaign } from "../lib/api";
import { Loader2, ArrowRight, Wand2, Mail, TrendingUp, Target, Zap, Megaphone, Percent, Users } from "lucide-react";

export default function Dashboard() {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getStats(), api.getLeads(), api.getCampaigns()])
      .then(([statsData, leadsData, campaignData]) => { setStats(statsData); setLeads(leadsData); setCampaigns(campaignData); })
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

  const emailed = (p['emailed'] || 0) + (p['replied'] || 0) + (p['interested'] || 0) + (p['booked'] || 0);
  const responded = (p['replied'] || 0) + (p['interested'] || 0) + (p['booked'] || 0);
  const conversionRate = emailed > 0 ? Math.round((responded / emailed) * 100) : 0;

  const activeCampaigns = campaigns.filter(c => c.status === 'active' || c.status === 'draft');
  const totalCampaignsSent = campaigns.reduce((sum, c) => sum + (c.sent_count || c.total_sent || 0), 0);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
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

      {/* Key metrics */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs mb-1"><Users className="w-4 h-4" /> Total Leads</div>
          <p className="text-3xl font-bold text-slate-900">{stats?.total || 0}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs mb-1"><Mail className="w-4 h-4" /> Emailed</div>
          <p className="text-3xl font-bold text-orange-600">{emailed}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs mb-1"><Percent className="w-4 h-4" /> Response Rate</div>
          <p className="text-3xl font-bold text-green-600">{conversionRate}%</p>
          <p className="text-xs text-slate-400 mt-1">{responded} of {emailed} responded</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs mb-1"><Megaphone className="w-4 h-4" /> Campaigns</div>
          <p className="text-3xl font-bold text-indigo-600">{campaigns.length}</p>
          <p className="text-xs text-slate-400 mt-1">{totalCampaignsSent} emails sent</p>
        </div>
      </div>

      {/* Pipeline Funnel */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-5">
          <TrendingUp className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold">Pipeline</h2>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
                  <p className="text-xs text-slate-500">{lead.industry} · {lead.location}</p>
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

        {/* Active Campaigns */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Megaphone className="w-5 h-5 text-indigo-500" />
            <h2 className="text-lg font-semibold">Campaigns</h2>
          </div>
          <div className="space-y-3">
            {campaigns.slice(0, 5).map(c => (
              <Link key={c.id} to="/campaigns" className="flex items-center justify-between py-2 hover:bg-slate-50 px-2 rounded-lg transition-colors">
                <div>
                  <p className="font-medium text-slate-900 text-sm">{c.name}</p>
                  <p className="text-xs text-slate-500">
                    {c.status} · {c.sent_count || c.total_sent || 0} sent
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${c.status === 'active' ? 'bg-blue-100 text-blue-700' :
                    c.status === 'completed' ? 'bg-green-100 text-green-700' :
                      'bg-slate-100 text-slate-600'
                  }`}>{c.status}</span>
              </Link>
            ))}
            {campaigns.length === 0 && (
              <Link to="/campaigns" className="text-sm text-indigo-600 hover:underline block text-center py-4">
                Create your first campaign →
              </Link>
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
            <Link to="/campaigns" className="flex items-center gap-3 p-4 bg-amber-50 rounded-xl hover:bg-amber-100 transition-colors">
              <div className="w-10 h-10 bg-amber-500 rounded-lg flex items-center justify-center text-white">
                <Megaphone className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold text-amber-900">Launch Campaign</p>
                <p className="text-xs text-amber-600">Preview & send bulk or drip campaigns</p>
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
