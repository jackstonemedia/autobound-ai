import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { Loader2, CheckCircle, AlertCircle, Settings2, User, Mail, Link2, MessageSquare, Plug } from "lucide-react";

interface AppSettings {
  // Your Business
  sender_name: string;
  company_name: string;
  service_description: string;
  booking_link: string;
  // Email Config
  smtp_host: string;
  smtp_port: string;
  smtp_secure: string;
  smtp_user: string;
  smtp_pass: string;
  // Outreach Customization
  email_tone: string;
  custom_email_prompt: string;
}

const defaultSettings: AppSettings = {
  sender_name: '',
  company_name: '',
  service_description: '',
  booking_link: '',
  smtp_host: '',
  smtp_port: '587',
  smtp_secure: 'TLS',
  smtp_user: '',
  smtp_pass: '',
  email_tone: 'friendly and professional',
  custom_email_prompt: '',
};

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [zohoKey, setZohoKey] = useState('');
  const [zohoFrom, setZohoFrom] = useState('');
  const [zohoConnected, setZohoConnected] = useState(false);
  const [zohoSaving, setZohoSaving] = useState(false);

  useEffect(() => {
    api.getSettings()
      .then(data => {
        setSettings({
          sender_name: data.sender_name || '',
          company_name: data.company_name || '',
          service_description: data.service_description || '',
          booking_link: data.booking_link || '',
          smtp_host: data.smtp_host || '',
          smtp_port: data.smtp_port || '587',
          smtp_secure: data.smtp_secure || 'TLS',
          smtp_user: data.smtp_user || '',
          smtp_pass: data.smtp_pass || '',
          email_tone: data.email_tone || 'friendly and professional',
          custom_email_prompt: data.custom_email_prompt || '',
        });
      })
      .catch(() => { })
      .finally(() => setLoading(false));
    api.getZohoStatus().then(s => {
      setZohoConnected(s.connected);
      if (s.fromEmail) setZohoFrom(s.fromEmail);
    }).catch(() => { });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await api.saveSettings(settings as any);
      setFeedback({ type: 'success', message: 'Settings saved! Your outreach is now personalized.' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save.' });
    } finally { setSaving(false); }
  };

  const update = (field: keyof AppSettings, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
    setFeedback(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Settings2 className="w-6 h-6 text-indigo-600" />
        <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
      </div>

      {feedback && (
        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${feedback.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
          {feedback.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {feedback.message}
        </div>
      )}

      {/* YOUR BUSINESS */}
      <Section icon={<User className="w-4 h-4" />} title="Your Business" description="This info is injected into every AI-generated email.">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Your Name" placeholder="John Smith" value={settings.sender_name} onChange={v => update('sender_name', v)} />
          <Input label="Company Name" placeholder="Smith Digital Agency" value={settings.company_name} onChange={v => update('company_name', v)} />
        </div>
        <Input label="Service Description" placeholder="AI chatbots for customer service, website design, marketing automation..."
          value={settings.service_description} onChange={v => update('service_description', v)}
          hint="What do you sell? This shapes every email the AI generates."
        />
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
            <Link2 className="w-3 h-3" /> Booking Link
          </label>
          <input
            type="url"
            placeholder="https://calendly.com/your-link"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            value={settings.booking_link}
            onChange={e => update('booking_link', e.target.value)}
          />
          <p className="text-xs text-slate-400 mt-1">Calendly, Cal.com, or any booking page. Added as CTA in every email.</p>
        </div>
      </Section>

      {/* OUTREACH CUSTOMIZATION */}
      <Section icon={<MessageSquare className="w-4 h-4" />} title="Outreach Style" description="Control how AI writes your emails.">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email Tone</label>
          <select
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            value={settings.email_tone}
            onChange={e => update('email_tone', e.target.value)}
          >
            <option value="friendly and professional">Friendly & Professional</option>
            <option value="casual and conversational">Casual & Conversational</option>
            <option value="direct and no-nonsense">Direct & No-Nonsense</option>
            <option value="enthusiastic and high-energy">Enthusiastic & High-Energy</option>
            <option value="consultative and authority-driven">Consultative & Authority</option>
            <option value="humorous and witty">Humorous & Witty</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Custom Instructions <span className="text-slate-400 font-normal">(optional)</span></label>
          <textarea
            placeholder="e.g. Always mention our free audit. Never use exclamation marks. Reference a recent case study where we helped a dental clinic 3x their bookings..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg h-24 resize-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
            value={settings.custom_email_prompt}
            onChange={e => update('custom_email_prompt', e.target.value)}
          />
          <p className="text-xs text-slate-400 mt-1">Add any custom rules for the AI. These are appended to every email prompt.</p>
        </div>
      </Section>

      {/* EMAIL CONFIG */}
      <Section icon={<Mail className="w-4 h-4" />} title="Email Configuration (SMTP)" description="Connect your email to send real outreach. Leave blank to preview emails without sending.">
        <Input label="SMTP Host" placeholder="smtp.gmail.com" value={settings.smtp_host} onChange={v => update('smtp_host', v)} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Port" placeholder="587" value={settings.smtp_port} onChange={v => update('smtp_port', v)} type="number" />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Security</label>
            <select className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              value={settings.smtp_secure} onChange={e => update('smtp_secure', e.target.value)}>
              <option>TLS</option>
              <option>SSL</option>
            </select>
          </div>
        </div>
        <Input label="Username" placeholder="you@company.com" value={settings.smtp_user} onChange={v => update('smtp_user', v)} />
        <Input label="Password" placeholder="••••••••" value={settings.smtp_pass} onChange={v => update('smtp_pass', v)} type="password" />
      </Section>

      {/* ZOHO INTEGRATION */}
      <Section icon={<Plug className="w-4 h-4" />} title="Zoho Integration" description="Connect Zoho ZeptoMail to send campaign emails via Zoho.">
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2.5 h-2.5 rounded-full ${zohoConnected ? 'bg-green-500' : 'bg-slate-300'}`} />
            <span className={`text-sm font-medium ${zohoConnected ? 'text-green-700' : 'text-slate-500'}`}>
              {zohoConnected ? 'Connected' : 'Not Connected'}
            </span>
          </div>
          <Input label="Zoho API Key" placeholder="Zoho-encrtoken ..." value={zohoKey} onChange={v => setZohoKey(v)} />
          <Input label="From Email" placeholder="hello@yourdomain.com" value={zohoFrom} onChange={v => setZohoFrom(v)} />
          <button onClick={async () => {
            if (!zohoKey.trim()) return;
            setZohoSaving(true);
            try {
              await api.connectZoho(zohoKey, zohoFrom);
              setZohoConnected(true);
              setFeedback({ type: 'success', message: 'Zoho connected!' });
            } catch (err: any) {
              setFeedback({ type: 'error', message: err.message });
            } finally { setZohoSaving(false); }
          }} disabled={zohoSaving || !zohoKey.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 flex items-center gap-2">
            {zohoSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            {zohoConnected ? 'Update Connection' : 'Connect Zoho'}
          </button>
        </div>
      </Section>

      {/* Save */}
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-60 shadow-sm">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save All Settings
        </button>
      </div>

      {/* System Status */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4">System Status</h2>
        <div className="space-y-2 text-sm">
          <StatusRow label="Database" value="Connected (SQLite + WAL)" ok />
          <StatusRow label="AI Model" value="Groq (Llama 3.3 70B)" ok />
          <StatusRow label="Email" value={settings.smtp_host ? `Configured (${settings.smtp_host})` : 'Preview Mode'} ok={!!settings.smtp_host} />
          <StatusRow label="Booking Link" value={settings.booking_link ? 'Configured' : 'Not set'} ok={!!settings.booking_link} />
          <StatusRow label="Business Info" value={settings.sender_name && settings.service_description ? 'Complete' : 'Incomplete'} ok={!!(settings.sender_name && settings.service_description)} />
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function Section({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
      <div className="border-b border-slate-100 pb-3">
        <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">{icon} {title}</h2>
        <p className="text-xs text-slate-500 mt-1">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Input({ label, placeholder, value, onChange, type = 'text', hint }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void; type?: string; hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-600">{label}</span>
      <span className={`font-medium ${ok ? 'text-green-600' : 'text-yellow-600'}`}>{value}</span>
    </div>
  );
}
