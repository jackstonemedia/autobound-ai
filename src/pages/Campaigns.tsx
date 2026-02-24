import { useState, useEffect, useCallback } from "react";
import { api, Campaign, CampaignDetail, Lead, EmailPreview } from "../lib/api";
import {
    Megaphone, Plus, Send, Clock, Users, Check, X, Trash2,
    ChevronLeft, AlertCircle, Zap, Timer, Eye, Edit3, CheckSquare, Square
} from "lucide-react";

type View = 'list' | 'create' | 'detail';

export default function Campaigns() {
    const [view, setView] = useState<View>('list');
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [selectedCampaign, setSelectedCampaign] = useState<CampaignDetail | null>(null);
    const [allLeads, setAllLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Create form
    const [name, setName] = useState('');
    const [subjectTemplate, setSubjectTemplate] = useState('');
    const [bodyTemplate, setBodyTemplate] = useState('');
    const [sendMode, setSendMode] = useState<'bulk' | 'drip'>('bulk');
    const [dripDelay, setDripDelay] = useState(5);

    // Lead picker
    const [showLeadPicker, setShowLeadPicker] = useState(false);
    const [selectedLeadIds, setSelectedLeadIds] = useState<number[]>([]);

    // Preview
    const [showPreview, setShowPreview] = useState(false);
    const [previews, setPreviews] = useState<EmailPreview[]>([]);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [editingIdx, setEditingIdx] = useState<number | null>(null);

    const fetchCampaigns = useCallback(async () => {
        try { setCampaigns(await api.getCampaigns()); } catch { }
    }, []);

    const fetchCampaignDetail = useCallback(async (id: number) => {
        try {
            const detail = await api.getCampaign(id);
            setSelectedCampaign(detail);
        } catch (err: any) { setError(err.message); }
    }, []);

    useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

    const handleCreate = async () => {
        if (!name.trim()) return setError("Campaign name required");
        setLoading(true); setError(null);
        try {
            const res = await api.createCampaign({
                name, subject_template: subjectTemplate, body_template: bodyTemplate,
                send_mode: sendMode, drip_delay_minutes: dripDelay
            });
            setName(''); setSubjectTemplate(''); setBodyTemplate('');
            await fetchCampaigns();
            await fetchCampaignDetail(res.id);
            setView('detail');
            setSuccess("Campaign created!");
        } catch (err: any) { setError(err.message); }
        finally { setLoading(false); }
    };

    const handleDelete = async (id: number) => {
        if (!confirm("Delete this campaign?")) return;
        try {
            await api.deleteCampaign(id);
            setView('list');
            await fetchCampaigns();
        } catch (err: any) { setError(err.message); }
    };

    const handleAddLeads = async () => {
        if (!selectedCampaign || selectedLeadIds.length === 0) return;
        setLoading(true);
        try {
            const res = await api.addLeadsToCampaign(selectedCampaign.id, selectedLeadIds);
            setSuccess(`Added ${res.added} leads`);
            setShowLeadPicker(false);
            setSelectedLeadIds([]);
            await fetchCampaignDetail(selectedCampaign.id);
        } catch (err: any) { setError(err.message); }
        finally { setLoading(false); }
    };

    const handleRemoveLead = async (leadId: number) => {
        if (!selectedCampaign) return;
        try {
            await api.removeLeadFromCampaign(selectedCampaign.id, leadId);
            await fetchCampaignDetail(selectedCampaign.id);
        } catch (err: any) { setError(err.message); }
    };

    // ===== PREVIEW =====
    const handlePreview = async () => {
        if (!selectedCampaign) return;
        const pending = selectedCampaign.leads.filter(l => l.status === 'pending').length;
        if (pending === 0) return setError("No pending leads to preview");
        setPreviewLoading(true); setError(null);
        try {
            const res = await api.previewCampaign(selectedCampaign.id);
            setPreviews(res.previews);
            setShowPreview(true);
            setEditingIdx(null);
        } catch (err: any) { setError(err.message); }
        finally { setPreviewLoading(false); }
    };

    const handleSendPreviews = async () => {
        if (!selectedCampaign) return;
        const selected = previews.filter(p => p.selected);
        if (selected.length === 0) return setError("No emails selected to send");
        if (!confirm(`Send ${selected.length} email${selected.length > 1 ? 's' : ''}? ${selectedCampaign.send_mode === 'drip' ? `(Drip: ${selectedCampaign.drip_delay_minutes} min delay)` : '(Bulk)'}`)) return;

        setSending(true); setError(null);
        try {
            const res = await api.sendCampaignPreviews(selectedCampaign.id, previews);
            setSuccess(`Sent: ${res.sent}, Failed: ${res.failed}${res.errors.length > 0 ? ` | ${res.errors.join(', ')}` : ''}`);
            setShowPreview(false);
            setPreviews([]);
            await fetchCampaignDetail(selectedCampaign.id);
            await fetchCampaigns();
        } catch (err: any) { setError(err.message); }
        finally { setSending(false); }
    };

    const togglePreviewSelect = (idx: number) => {
        setPreviews(prev => prev.map((p, i) => i === idx ? { ...p, selected: !p.selected } : p));
    };

    const toggleAllPreviews = () => {
        const allSelected = previews.every(p => p.selected);
        setPreviews(prev => prev.map(p => ({ ...p, selected: !allSelected })));
    };

    const updatePreview = (idx: number, field: 'subject' | 'body', value: string) => {
        setPreviews(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
    };

    const handleOpenLeadPicker = async () => {
        try {
            setAllLeads(await api.getLeads());
            setShowLeadPicker(true);
        } catch { }
    };

    const statusColor = (s: string) => {
        switch (s) {
            case 'draft': return 'bg-slate-100 text-slate-700';
            case 'active': return 'bg-blue-100 text-blue-700';
            case 'completed': return 'bg-green-100 text-green-700';
            case 'paused': return 'bg-amber-100 text-amber-700';
            default: return 'bg-slate-100 text-slate-700';
        }
    };

    const leadStatusColor = (s: string) => {
        switch (s) {
            case 'pending': return 'bg-slate-100 text-slate-600';
            case 'sent': return 'bg-blue-100 text-blue-700';
            case 'opened': return 'bg-indigo-100 text-indigo-700';
            case 'replied': return 'bg-green-100 text-green-700';
            case 'failed': return 'bg-red-100 text-red-700';
            default: return 'bg-slate-100 text-slate-600';
        }
    };

    const templateVars = [
        { var: '{{business_name}}', desc: 'Lead business name' },
        { var: '{{industry}}', desc: 'Lead industry' },
        { var: '{{location}}', desc: 'Lead location' },
        { var: '{{sender_name}}', desc: 'Your name (from Settings)' },
        { var: '{{company_name}}', desc: 'Your company' },
        { var: '{{service}}', desc: 'Your service description' },
        { var: '{{booking_link}}', desc: 'Your booking link' },
        { var: '{{pain_points}}', desc: 'Lead pain points' },
        { var: '{{services}}', desc: 'Lead services' },
    ];

    useEffect(() => {
        if (success) { const t = setTimeout(() => setSuccess(null), 5000); return () => clearTimeout(t); }
    }, [success]);
    useEffect(() => {
        if (error) { const t = setTimeout(() => setError(null), 8000); return () => clearTimeout(t); }
    }, [error]);

    return (
        <div className="p-8 max-w-6xl mx-auto">
            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
                </div>
            )}
            {success && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 text-sm">
                    <Check className="w-4 h-4 flex-shrink-0" /> {success}
                </div>
            )}

            {/* ======= LIST VIEW ======= */}
            {view === 'list' && (
                <>
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                                <Megaphone className="w-7 h-7 text-indigo-600" /> Campaigns
                            </h1>
                            <p className="text-slate-500 text-sm mt-1">Create and manage email outreach campaigns</p>
                        </div>
                        <button onClick={() => setView('create')}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center gap-2 text-sm font-medium">
                            <Plus className="w-4 h-4" /> New Campaign
                        </button>
                    </div>

                    {campaigns.length === 0 ? (
                        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                            <Megaphone className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                            <h3 className="text-lg font-medium text-slate-700 mb-1">No campaigns yet</h3>
                            <p className="text-slate-500 text-sm mb-4">Create your first campaign to start outreach</p>
                            <button onClick={() => setView('create')}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm">
                                Create Campaign
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {campaigns.map(c => (
                                <div key={c.id} onClick={() => { fetchCampaignDetail(c.id); setView('detail'); }}
                                    className="bg-white rounded-xl border border-slate-200 p-5 hover:border-indigo-300 hover:shadow-sm transition cursor-pointer">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className="font-semibold text-slate-900">{c.name}</h3>
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(c.status)}`}>{c.status}</span>
                                                {c.send_mode === 'drip' && (
                                                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 flex items-center gap-1">
                                                        <Timer className="w-3 h-3" /> Drip ({c.drip_delay_minutes}m)
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-500">Created {new Date(c.created_at).toLocaleDateString()}</p>
                                        </div>
                                        <div className="flex items-center gap-6 text-sm">
                                            <div className="text-center">
                                                <p className="font-semibold text-slate-900">{c.lead_count || 0}</p>
                                                <p className="text-xs text-slate-500">Leads</p>
                                            </div>
                                            <div className="text-center">
                                                <p className="font-semibold text-blue-600">{c.sent_count || 0}</p>
                                                <p className="text-xs text-slate-500">Sent</p>
                                            </div>
                                            <div className="text-center">
                                                <p className="font-semibold text-green-600">{c.replied_count || 0}</p>
                                                <p className="text-xs text-slate-500">Replied</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* ======= CREATE VIEW ======= */}
            {view === 'create' && (
                <>
                    <button onClick={() => setView('list')} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4">
                        <ChevronLeft className="w-4 h-4" /> Back to Campaigns
                    </button>
                    <h1 className="text-2xl font-bold text-slate-900 mb-6">Create Campaign</h1>

                    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Campaign Name *</label>
                            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Q1 Cold Outreach"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Send Mode</label>
                                <div className="flex gap-2">
                                    <button onClick={() => setSendMode('bulk')}
                                        className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition flex items-center justify-center gap-2
                    ${sendMode === 'bulk' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                                        <Zap className="w-4 h-4" /> Bulk
                                    </button>
                                    <button onClick={() => setSendMode('drip')}
                                        className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition flex items-center justify-center gap-2
                    ${sendMode === 'drip' ? 'bg-purple-50 border-purple-300 text-purple-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                                        <Timer className="w-4 h-4" /> Drip Feed
                                    </button>
                                </div>
                            </div>
                            {sendMode === 'drip' && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Delay (minutes)</label>
                                    <input type="number" value={dripDelay} onChange={e => setDripDelay(parseInt(e.target.value) || 5)} min={1} max={60}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Subject Template</label>
                            <input value={subjectTemplate} onChange={e => setSubjectTemplate(e.target.value)}
                                placeholder="e.g. Quick question about {{business_name}}"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                            <p className="text-xs text-slate-400 mt-1">Leave blank to auto-generate with AI</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Body Template</label>
                            <textarea value={bodyTemplate} onChange={e => setBodyTemplate(e.target.value)} rows={6}
                                placeholder="Hi {{business_name}},&#10;&#10;I noticed you're in the {{industry}} space..."
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none" />
                            <p className="text-xs text-slate-400 mt-1">Leave blank to auto-generate with AI</p>
                        </div>

                        <div className="bg-slate-50 rounded-lg p-4">
                            <p className="text-xs font-medium text-slate-600 mb-2">Available Template Variables:</p>
                            <div className="grid grid-cols-3 gap-1">
                                {templateVars.map(v => (
                                    <div key={v.var} className="text-xs">
                                        <code className="text-indigo-600 bg-indigo-50 px-1 rounded">{v.var}</code>
                                        <span className="text-slate-500 ml-1">{v.desc}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <button onClick={handleCreate} disabled={loading}
                            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium text-sm disabled:opacity-50">
                            {loading ? 'Creating...' : 'Create Campaign'}
                        </button>
                    </div>
                </>
            )}

            {/* ======= DETAIL VIEW ======= */}
            {view === 'detail' && selectedCampaign && (
                <>
                    <button onClick={() => { setView('list'); setSelectedCampaign(null); }} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4">
                        <ChevronLeft className="w-4 h-4" /> Back to Campaigns
                    </button>

                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-2xl font-bold text-slate-900">{selectedCampaign.name}</h1>
                                <span className={`px-2.5 py-0.5 rounded text-xs font-medium ${statusColor(selectedCampaign.status)}`}>{selectedCampaign.status}</span>
                                {selectedCampaign.send_mode === 'drip' && (
                                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 flex items-center gap-1">
                                        <Timer className="w-3 h-3" /> Drip ({selectedCampaign.drip_delay_minutes}m)
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleOpenLeadPicker}
                                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition text-sm font-medium flex items-center gap-2">
                                <Users className="w-4 h-4" /> Add Leads
                            </button>
                            <button onClick={handlePreview} disabled={previewLoading || selectedCampaign.leads.filter(l => l.status === 'pending').length === 0}
                                className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                                {previewLoading ? <><Clock className="w-4 h-4 animate-spin" /> Generating...</> : <><Eye className="w-4 h-4" /> Preview Emails</>}
                            </button>
                            <button onClick={() => handleDelete(selectedCampaign.id)}
                                className="px-3 py-2 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition text-sm">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Stats cards */}
                    <div className="grid grid-cols-4 gap-4 mb-6">
                        {[
                            { label: 'Total Leads', value: selectedCampaign.leads.length, color: 'text-slate-900' },
                            { label: 'Pending', value: selectedCampaign.leads.filter(l => l.status === 'pending').length, color: 'text-amber-600' },
                            { label: 'Sent', value: selectedCampaign.leads.filter(l => l.status === 'sent').length, color: 'text-blue-600' },
                            { label: 'Replied', value: selectedCampaign.leads.filter(l => l.status === 'replied').length, color: 'text-green-600' },
                        ].map(s => (
                            <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4 text-center">
                                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                                <p className="text-xs text-slate-500 mt-1">{s.label}</p>
                            </div>
                        ))}
                    </div>

                    {/* Template preview */}
                    {(selectedCampaign.subject_template || selectedCampaign.body_template) && (
                        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
                            <h3 className="text-sm font-semibold text-slate-700 mb-2">Email Template</h3>
                            {selectedCampaign.subject_template && (
                                <p className="text-sm text-slate-600 mb-2"><span className="font-medium">Subject:</span> {selectedCampaign.subject_template}</p>
                            )}
                            {selectedCampaign.body_template && (
                                <pre className="text-sm text-slate-600 whitespace-pre-wrap bg-slate-50 p-3 rounded-lg">{selectedCampaign.body_template}</pre>
                            )}
                        </div>
                    )}
                    {!selectedCampaign.subject_template && !selectedCampaign.body_template && (
                        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100 p-4 mb-6 flex items-center gap-3">
                            <Zap className="w-5 h-5 text-indigo-500" />
                            <p className="text-sm text-indigo-700">No template set — emails will be <strong>AI-generated</strong> uniquely for each lead. Click "Preview Emails" to see them before sending.</p>
                        </div>
                    )}

                    {/* Leads table */}
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="px-5 py-3 border-b border-slate-200">
                            <h3 className="text-sm font-semibold text-slate-700">Campaign Leads ({selectedCampaign.leads.length})</h3>
                        </div>
                        {selectedCampaign.leads.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 text-sm">
                                No leads assigned. Click "Add Leads" to get started.
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                                    <tr>
                                        <th className="text-left px-5 py-2">Business</th>
                                        <th className="text-left px-5 py-2">Email</th>
                                        <th className="text-left px-5 py-2">Score</th>
                                        <th className="text-left px-5 py-2">Status</th>
                                        <th className="text-left px-5 py-2">Sent At</th>
                                        <th className="px-5 py-2"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {selectedCampaign.leads.map(cl => (
                                        <tr key={cl.id} className="hover:bg-slate-50">
                                            <td className="px-5 py-3 font-medium text-slate-900">{cl.business_name}</td>
                                            <td className="px-5 py-3 text-slate-600 text-xs">{cl.email || <span className="text-slate-400 italic">no email</span>}</td>
                                            <td className="px-5 py-3">
                                                <span className={`font-medium ${cl.lead_score >= 60 ? 'text-green-600' : cl.lead_score >= 30 ? 'text-amber-600' : 'text-slate-500'}`}>
                                                    {cl.lead_score}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${leadStatusColor(cl.status)}`}>{cl.status}</span>
                                            </td>
                                            <td className="px-5 py-3 text-slate-500 text-xs">
                                                {cl.sent_at ? new Date(cl.sent_at).toLocaleString() : '—'}
                                            </td>
                                            <td className="px-5 py-3">
                                                {cl.status === 'pending' && (
                                                    <button onClick={() => handleRemoveLead(cl.lead_id)} className="text-red-400 hover:text-red-600">
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </>
            )}

            {/* ======= LEAD PICKER MODAL ======= */}
            {showLeadPicker && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl w-[600px] max-h-[70vh] flex flex-col">
                        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
                            <h3 className="font-semibold text-slate-900">Select Leads to Add</h3>
                            <button onClick={() => { setShowLeadPicker(false); setSelectedLeadIds([]); }} className="text-slate-400 hover:text-slate-600">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto p-4">
                            {allLeads.filter(l => !selectedCampaign?.leads.some(cl => cl.lead_id === l.id)).map(lead => (
                                <label key={lead.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                                    <input type="checkbox" checked={selectedLeadIds.includes(lead.id)}
                                        onChange={e => {
                                            if (e.target.checked) setSelectedLeadIds(prev => [...prev, lead.id]);
                                            else setSelectedLeadIds(prev => prev.filter(id => id !== lead.id));
                                        }}
                                        className="w-4 h-4 text-indigo-600 rounded border-slate-300" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-900 truncate">{lead.business_name}</p>
                                        <p className="text-xs text-slate-500">{lead.email || 'No email'} · {lead.industry} · Score: {lead.lead_score}</p>
                                    </div>
                                </label>
                            ))}
                        </div>
                        <div className="p-4 border-t border-slate-200 flex items-center justify-between">
                            <p className="text-sm text-slate-500">{selectedLeadIds.length} selected</p>
                            <div className="flex gap-2">
                                <button onClick={() => {
                                    const availableIds = allLeads.filter(l => !selectedCampaign?.leads.some(cl => cl.lead_id === l.id)).map(l => l.id);
                                    setSelectedLeadIds(prev => prev.length === availableIds.length ? [] : availableIds);
                                }} className="px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">
                                    {selectedLeadIds.length === allLeads.filter(l => !selectedCampaign?.leads.some(cl => cl.lead_id === l.id)).length ? 'Deselect All' : 'Select All'}
                                </button>
                                <button onClick={handleAddLeads} disabled={loading || selectedLeadIds.length === 0}
                                    className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50">
                                    {loading ? 'Adding...' : `Add ${selectedLeadIds.length} Leads`}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ======= EMAIL PREVIEW MODAL ======= */}
            {showPreview && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[85vh] flex flex-col">
                        {/* Header */}
                        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                                    <Eye className="w-5 h-5 text-amber-500" /> Email Preview
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">{previews.filter(p => p.selected).length} of {previews.length} selected to send</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <button onClick={toggleAllPreviews} className="text-sm text-slate-600 hover:text-indigo-600 flex items-center gap-1">
                                    {previews.every(p => p.selected) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                    {previews.every(p => p.selected) ? 'Deselect All' : 'Select All'}
                                </button>
                                <button onClick={() => { setShowPreview(false); setPreviews([]); }} className="text-slate-400 hover:text-slate-600">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Email cards */}
                        <div className="flex-1 overflow-auto p-5 space-y-4">
                            {previews.map((preview, idx) => (
                                <div key={preview.lead_id} className={`border rounded-xl transition ${preview.selected ? 'border-indigo-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-60'}`}>
                                    {/* Card header */}
                                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                                        <div className="flex items-center gap-3">
                                            <button onClick={() => togglePreviewSelect(idx)}>
                                                {preview.selected
                                                    ? <CheckSquare className="w-4 h-4 text-indigo-600" />
                                                    : <Square className="w-4 h-4 text-slate-400" />
                                                }
                                            </button>
                                            <div>
                                                <p className="font-semibold text-sm text-slate-900">{preview.business_name}</p>
                                                <p className="text-xs text-slate-500">{preview.email || 'No email'} · {preview.industry} · Score: {preview.lead_score}</p>
                                            </div>
                                        </div>
                                        <button onClick={() => setEditingIdx(editingIdx === idx ? null : idx)}
                                            className={`text-xs px-2.5 py-1 rounded-lg border flex items-center gap-1 transition ${editingIdx === idx ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-300 text-slate-500 hover:bg-slate-50'}`}>
                                            <Edit3 className="w-3 h-3" /> {editingIdx === idx ? 'Done' : 'Edit'}
                                        </button>
                                    </div>

                                    {/* Email content */}
                                    <div className="p-4">
                                        {editingIdx === idx ? (
                                            <div className="space-y-2">
                                                <div>
                                                    <label className="text-xs font-medium text-slate-500">Subject</label>
                                                    <input value={preview.subject} onChange={e => updatePreview(idx, 'subject', e.target.value)}
                                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mt-1" />
                                                </div>
                                                <div>
                                                    <label className="text-xs font-medium text-slate-500">Body</label>
                                                    <textarea value={preview.body} onChange={e => updatePreview(idx, 'body', e.target.value)}
                                                        rows={6} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mt-1 resize-none" />
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <p className="text-sm font-medium text-slate-800 mb-2">
                                                    <span className="text-slate-400 text-xs mr-1">Subject:</span> {preview.subject}
                                                </p>
                                                <div className="text-sm text-slate-600 whitespace-pre-wrap bg-slate-50 p-3 rounded-lg max-h-32 overflow-auto">
                                                    {preview.body}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Footer */}
                        <div className="p-5 border-t border-slate-200 flex items-center justify-between bg-slate-50 rounded-b-xl">
                            <p className="text-sm text-slate-600">
                                <strong>{previews.filter(p => p.selected).length}</strong> emails ready to send
                                {selectedCampaign?.send_mode === 'drip' && (
                                    <span className="ml-2 text-purple-600">
                                        <Timer className="w-3 h-3 inline" /> {selectedCampaign.drip_delay_minutes}m delay between each
                                    </span>
                                )}
                            </p>
                            <div className="flex gap-2">
                                <button onClick={() => { setShowPreview(false); setPreviews([]); }}
                                    className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-white text-sm">
                                    Cancel
                                </button>
                                <button onClick={handleSendPreviews} disabled={sending || previews.filter(p => p.selected).length === 0}
                                    className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                                    {sending ? <><Clock className="w-4 h-4 animate-spin" /> Sending...</> : <><Send className="w-4 h-4" /> Send {previews.filter(p => p.selected).length} Emails</>}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
