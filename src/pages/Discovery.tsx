import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Search, Loader2, Target, AlertCircle, CheckCircle, Sliders } from "lucide-react";

export default function Discovery() {
  const navigate = useNavigate();
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [count, setCount] = useState(50);
  const [serviceDescription, setServiceDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; total: number } | null>(null);

  const handleDiscover = async () => {
    if (!industry || !location) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress(`Searching for ${count} ${industry} businesses in ${location}...`);

    try {
      const data = await api.discover(industry, location, count, serviceDescription || undefined);
      setResult({ added: data.added, total: data.total });
      setProgress("");
    } catch (err: any) {
      setError(err.message);
      setProgress("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
          <Target className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Lead Discovery</h1>
          <p className="text-slate-500 text-sm">Find businesses that need your services</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 bg-red-50 text-red-700 p-4 rounded-xl border border-red-200 text-sm mb-6">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div className="flex items-start gap-3 bg-green-50 text-green-700 p-4 rounded-xl border border-green-200 text-sm mb-6">
          <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Discovery complete!</p>
            <p>{result.added} new leads added ({result.total} found, duplicates skipped)</p>
            <button onClick={() => navigate('/leads')} className="mt-2 text-green-800 underline font-medium hover:text-green-900">
              → View your leads
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
        {/* Core fields */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Industry / Niche *</label>
            <input
              type="text"
              placeholder="e.g. dental clinics, HVAC, real estate..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              value={industry}
              onChange={e => setIndustry(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Location *</label>
            <input
              type="text"
              placeholder="e.g. Austin TX, London UK..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              value={location}
              onChange={e => setLocation(e.target.value)}
            />
          </div>
        </div>

        {/* Service description */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Your Service <span className="text-slate-400 font-normal">(optional — helps AI find better-fit leads)</span>
          </label>
          <input
            type="text"
            placeholder="e.g. AI chatbots for customer service, website design, marketing automation..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            value={serviceDescription}
            onChange={e => setServiceDescription(e.target.value)}
          />
        </div>

        {/* Lead count slider */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-slate-700 flex items-center gap-1">
              <Sliders className="w-4 h-4" /> Number of leads
            </label>
            <span className="text-lg font-bold text-indigo-600">{count}</span>
          </div>
          <input
            type="range"
            min="10"
            max="200"
            step="10"
            value={count}
            onChange={e => setCount(parseInt(e.target.value))}
            className="w-full accent-indigo-600"
          />
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>10</span>
            <span>50</span>
            <span>100</span>
            <span>150</span>
            <span>200</span>
          </div>
        </div>

        {/* Action */}
        <button
          onClick={handleDiscover}
          disabled={loading || !industry || !location}
          className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Discovering...
            </>
          ) : (
            <>
              <Search className="w-5 h-5" />
              Find {count} Leads
            </>
          )}
        </button>

        {progress && (
          <div className="text-center text-sm text-indigo-600 bg-indigo-50 p-3 rounded-lg animate-pulse">
            {progress}
          </div>
        )}

        <p className="text-xs text-slate-400 text-center">
          Searches {Math.ceil(count / 10)} batch{Math.ceil(count / 10) > 1 ? 'es' : ''} of 10 leads each. Duplicates are automatically skipped.
        </p>
      </div>
    </div>
  );
}
