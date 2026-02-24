import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api, Lead } from "../lib/api";
import { ArrowRight, Globe, MapPin, Star, Loader2, Trash2, Wand2, Mail, CheckSquare, Square, AlertCircle, Filter } from "lucide-react";

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export default function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchLeads = () => {
    setLoading(true);
    api.getLeads(statusFilter !== 'all' ? statusFilter : undefined)
      .then(setLeads)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchLeads(); }, [statusFilter]);

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === leads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map(l => l.id)));
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete lead "${name}"? This cannot be undone.`)) return;
    try {
      await api.deleteLead(id);
      setLeads(prev => prev.filter(l => l.id !== id));
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    } catch (err: any) { setError(err.message); }
  };

  const handleBulkEnrich = async () => {
    if (selected.size === 0) return;
    setActionLoading('enrich');
    try {
      const result = await api.bulkEnrich(Array.from(selected));
      setSelected(new Set());
      fetchLeads();
      if (result.failed > 0) setError(`Enriched ${result.success}, failed ${result.failed}`);
    } catch (err: any) { setError(err.message); }
    finally { setActionLoading(null); }
  };

  const handleBulkEmail = async () => {
    if (selected.size === 0) return;
    setActionLoading('email');
    try {
      const result = await api.bulkEmail(Array.from(selected));
      setSelected(new Set());
      fetchLeads();
      if (result.failed > 0) setError(`Emailed ${result.success}, failed ${result.failed}`);
    } catch (err: any) { setError(err.message); }
    finally { setActionLoading(null); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Leads ({leads.length})</h1>
        <Link to="/discovery" className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm">
          Find New Leads
        </Link>
      </div>

      {error && (
        <div className="flex items-start gap-3 bg-red-50 text-red-700 p-3 rounded-xl border border-red-200 text-sm mb-4">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Toolbar: Filter + Bulk Actions */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="new">New</option>
            <option value="enriched">Enriched</option>
            <option value="emailed">Emailed</option>
            <option value="replied">Replied</option>
            <option value="interested">Interested</option>
            <option value="booked">Booked</option>
            <option value="lost">Lost</option>
          </select>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-slate-500">{selected.size} selected</span>
            <button
              onClick={handleBulkEnrich}
              disabled={actionLoading !== null}
              className="bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 text-sm font-medium flex items-center gap-1.5 disabled:opacity-60"
            >
              {actionLoading === 'enrich' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              Enrich
            </button>
            <button
              onClick={handleBulkEmail}
              disabled={actionLoading !== null}
              className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 text-sm font-medium flex items-center gap-1.5 disabled:opacity-60"
            >
              {actionLoading === 'email' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
              Email
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 w-10">
                <button onClick={toggleAll} className="text-slate-400 hover:text-indigo-600">
                  {selected.size === leads.length && leads.length > 0
                    ? <CheckSquare className="w-4 h-4" />
                    : <Square className="w-4 h-4" />
                  }
                </button>
              </th>
              <th className="px-4 py-3 font-semibold text-slate-700 text-sm">Business</th>
              <th className="px-4 py-3 font-semibold text-slate-700 text-sm">Location</th>
              <th className="px-4 py-3 font-semibold text-slate-700 text-sm">Score</th>
              <th className="px-4 py-3 font-semibold text-slate-700 text-sm">Status</th>
              <th className="px-4 py-3 font-semibold text-slate-700 text-sm">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {leads.map((lead) => (
              <tr key={lead.id} className={`hover:bg-slate-50 transition-colors ${selected.has(lead.id) ? 'bg-indigo-50/50' : ''}`}>
                <td className="px-4 py-3">
                  <button onClick={() => toggleSelect(lead.id)} className="text-slate-400 hover:text-indigo-600">
                    {selected.has(lead.id)
                      ? <CheckSquare className="w-4 h-4 text-indigo-600" />
                      : <Square className="w-4 h-4" />
                    }
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900 text-sm">{lead.business_name}</div>
                  {lead.website && (
                    <a href={lead.website} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline flex items-center gap-1 mt-0.5">
                      <Globe className="w-3 h-3" /> {safeHostname(lead.website)}
                    </a>
                  )}
                  <p className="text-xs text-slate-400">{lead.industry}</p>
                </td>
                <td className="px-4 py-3 text-slate-600 text-sm">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {lead.location}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <ScoreBar score={lead.lead_score} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={lead.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Link to={`/leads/${lead.id}`} className="text-indigo-600 hover:text-indigo-800 font-medium text-xs flex items-center gap-1">
                      View <ArrowRight className="w-3 h-3" />
                    </Link>
                    <button onClick={() => handleDelete(lead.id, lead.business_name)} className="text-slate-400 hover:text-red-600 transition-colors" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 && (
          <div className="p-12 text-center text-slate-500">
            No leads found. <Link to="/discovery" className="text-indigo-600 hover:underline">Run Discovery</Link> to get started.
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-yellow-500' : 'bg-slate-300';
  const textColor = score >= 70 ? 'text-green-700' : score >= 40 ? 'text-yellow-700' : 'text-slate-400';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-bold ${textColor}`}>{score || '—'}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    new: 'bg-slate-50 text-slate-600 border-slate-200',
    enriched: 'bg-purple-50 text-purple-700 border-purple-200',
    emailed: 'bg-orange-50 text-orange-700 border-orange-200',
    replied: 'bg-green-50 text-green-700 border-green-200',
    interested: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    booked: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    lost: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${styles[status] || styles.new}`}>
      {status}
    </span>
  );
}
