import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api, Lead, Message } from "../lib/api";
import { Loader2, Wand2, Send, AlertCircle, MessageSquare, ArrowLeft, RefreshCw, Calendar, ThumbsUp, XCircle } from "lucide-react";

export default function LeadDetail() {
  const { id } = useParams();
  const [lead, setLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedEmail, setGeneratedEmail] = useState<{ subject: string, body: string } | null>(null);
  const [isFollowUp, setIsFollowUp] = useState(false);

  useEffect(() => { if (id) fetchLead(); }, [id]);

  const fetchLead = async () => {
    try {
      const data = await api.getLead(Number(id));
      setLead(data);
      setMessages(data.messages || []);
    } catch (err: any) { setError(err.message); }
  };

  const handleEnrich = async () => {
    if (!lead) return;
    setLoading(true); setError(null);
    try {
      await api.enrich(lead.id);
      await fetchLead();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleGenerateEmail = async () => {
    if (!lead) return;
    setLoading(true); setError(null); setIsFollowUp(false);
    try {
      const data = await api.generateEmail(lead.id);
      setGeneratedEmail(data);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleGenerateFollowUp = async () => {
    if (!lead) return;
    setLoading(true); setError(null); setIsFollowUp(true);
    try {
      const data = await api.generateFollowup(lead.id);
      setGeneratedEmail({ subject: data.subject, body: data.body });
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleSendEmail = async () => {
    if (!generatedEmail || !lead) return;
    setLoading(true); setError(null);
    try {
      await api.sendEmail(lead.id, generatedEmail.subject, generatedEmail.body, isFollowUp);
      setGeneratedEmail(null);
      await fetchLead();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleStatusChange = async (status: string) => {
    if (!lead) return;
    try {
      await api.updateLead(lead.id, { status: status as any });
      await fetchLead();
    } catch (err: any) { setError(err.message); }
  };

  if (!lead && !error) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
    </div>
  );

  if (!lead && error) return (
    <div className="p-8">
      <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200">
        Failed to load lead: {error}
      </div>
    </div>
  );

  if (!lead) return null;
  const metadata = JSON.parse(lead.metadata || '{}');
  const hasBeenEmailed = ['emailed', 'replied', 'interested', 'booked'].includes(lead.status);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-4">
      {/* Back Link */}
      <Link to="/leads" className="text-sm text-slate-500 hover:text-indigo-600 flex items-center gap-1 -mb-2">
        <ArrowLeft className="w-4 h-4" /> Back to Leads
      </Link>

      {error && (
        <div className="flex items-start gap-3 bg-red-50 text-red-700 p-4 rounded-xl border border-red-200 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Lead Info */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{lead.business_name}</h1>
                {lead.website && (
                  <a href={lead.website} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline text-sm">
                    {lead.website}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                {lead.lead_score > 0 && <ScoreBadge score={lead.lead_score} />}
                <StatusBadge status={lead.status} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm text-slate-600">
              <div>
                <span className="block text-xs font-semibold text-slate-400 uppercase">Industry</span>
                {lead.industry}
              </div>
              <div>
                <span className="block text-xs font-semibold text-slate-400 uppercase">Location</span>
                {lead.location}
              </div>
              <div>
                <span className="block text-xs font-semibold text-slate-400 uppercase">Rating</span>
                {lead.rating} ({lead.review_count} reviews)
              </div>
              <div>
                <span className="block text-xs font-semibold text-slate-400 uppercase">Follow-ups</span>
                {lead.follow_up_count || 0} sent
              </div>
            </div>

            {/* Quick Status Buttons */}
            <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
              <button onClick={() => handleStatusChange('interested')} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center gap-1 border border-emerald-200">
                <ThumbsUp className="w-3 h-3" /> Interested
              </button>
              <button onClick={() => handleStatusChange('booked')} className="text-xs px-3 py-1.5 rounded-lg bg-cyan-50 text-cyan-700 hover:bg-cyan-100 flex items-center gap-1 border border-cyan-200">
                <Calendar className="w-3 h-3" /> Booked
              </button>
              <button onClick={() => handleStatusChange('lost')} className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 flex items-center gap-1 border border-red-200">
                <XCircle className="w-3 h-3" /> Lost
              </button>
            </div>
          </div>

          {/* Enrichment Data */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold text-slate-900">Enriched Intelligence</h2>
              {lead.status === 'new' && (
                <button onClick={handleEnrich} disabled={loading}
                  className="text-xs bg-purple-600 text-white px-3 py-1 rounded-md hover:bg-purple-700 flex items-center gap-1 disabled:opacity-60">
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  Run Enrichment
                </button>
              )}
            </div>

            {lead.status === 'new' ? (
              <div className="text-slate-500 text-sm italic bg-slate-50 p-4 rounded-lg border border-dashed border-slate-300">
                Run enrichment to extract services, pain points, and contact info.
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                {metadata.services?.length > 0 && (
                  <div>
                    <span className="font-medium text-slate-900">Services:</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {metadata.services.map((s: string, i: number) => (
                        <span key={i} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs">{s}</span>
                      ))}
                    </div>
                  </div>
                )}
                {metadata.pain_points?.length > 0 && (
                  <div>
                    <span className="font-medium text-slate-900">Pain Points:</span>
                    <ul className="list-disc list-inside text-slate-600 mt-1">
                      {metadata.pain_points.map((p: string, i: number) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {metadata.tone && <div><span className="font-medium text-slate-900">Tone:</span> <span className="capitalize text-slate-600">{metadata.tone}</span></div>}
                  {metadata.company_size && <div><span className="font-medium text-slate-900">Size:</span> <span className="capitalize text-slate-600">{metadata.company_size}</span></div>}
                  {metadata.tech_savviness && <div><span className="font-medium text-slate-900">Tech Level:</span> <span className="capitalize text-slate-600">{metadata.tech_savviness}</span></div>}
                </div>
                <div>
                  <span className="font-medium text-slate-900">Contact:</span>
                  <div className="text-slate-600 mt-1">
                    {lead.email && <div>📧 {lead.email}</div>}
                    {lead.phone && <div>📱 {lead.phone}</div>}
                    {!lead.email && !lead.phone && <div className="text-slate-400 italic">No contact info found</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Actions & History */}
        <div className="space-y-6">
          {/* Email Generator */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="font-semibold text-slate-900 mb-4">Outbound Agent</h2>

            {!generatedEmail ? (
              <div className="space-y-3">
                <button
                  onClick={handleGenerateEmail}
                  disabled={loading || lead.status === 'new'}
                  className="w-full py-3 border-2 border-dashed border-indigo-200 rounded-xl text-indigo-600 font-medium hover:bg-indigo-50 transition-colors flex flex-col items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-6 h-6" />}
                  Generate Personalized Email
                  {lead.status === 'new' && <span className="text-xs font-normal text-slate-400">(Enrich lead first)</span>}
                </button>

                {hasBeenEmailed && (
                  <button
                    onClick={handleGenerateFollowUp}
                    disabled={loading}
                    className="w-full py-3 border-2 border-dashed border-orange-200 rounded-xl text-orange-600 font-medium hover:bg-orange-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                    Generate Follow-Up #{(lead.follow_up_count || 0) + 1}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {isFollowUp && (
                  <div className="text-xs bg-orange-50 text-orange-700 px-3 py-1.5 rounded-lg font-medium">
                    Follow-Up Email #{(lead.follow_up_count || 0) + 1}
                  </div>
                )}
                <div className="space-y-2">
                  <input
                    value={generatedEmail.subject}
                    onChange={e => setGeneratedEmail({ ...generatedEmail, subject: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium text-slate-900 text-sm"
                  />
                  <textarea
                    value={generatedEmail.body}
                    onChange={e => setGeneratedEmail({ ...generatedEmail, body: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg h-56 text-sm text-slate-700 resize-none"
                  />
                </div>
                <div className="flex gap-3">
                  <button onClick={handleSendEmail} disabled={loading}
                    className="flex-1 bg-indigo-600 text-white py-2 rounded-lg font-medium hover:bg-indigo-700 flex items-center justify-center gap-2 disabled:opacity-60">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send
                  </button>
                  <button onClick={() => setGeneratedEmail(null)}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Activity Log */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="font-semibold text-slate-900 mb-4">Activity Log</h2>
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.direction === 'outbound' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0
                    ${msg.direction === 'outbound' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-600'}`}>
                    {msg.direction === 'outbound' ? <Send className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                  </div>
                  <div className={`flex-1 p-3 rounded-lg text-sm
                    ${msg.direction === 'outbound' ? 'bg-indigo-50 text-indigo-900' : 'bg-slate-50 text-slate-900'}`}>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    <div className="mt-1 text-xs opacity-60">
                      {new Date(msg.timestamp).toLocaleString()} • {msg.intent}
                    </div>
                  </div>
                </div>
              ))}
              {messages.length === 0 && (
                <div className="text-center text-slate-400 text-sm py-8">No activity yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-green-100 text-green-700 border-green-200' : score >= 40 ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 'bg-slate-100 text-slate-600 border-slate-200';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${color}`}>{score}</span>;
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
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${styles[status] || styles.new}`}>{status}</span>;
}
