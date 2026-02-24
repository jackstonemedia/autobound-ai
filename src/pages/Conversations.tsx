import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api, Conversation } from "../lib/api";
import { MessageSquare, ArrowRight, Loader2 } from "lucide-react";

export default function Conversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getConversations()
      .then(setConversations)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200">
          Failed to load conversations: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-slate-900 mb-8">Conversations</h1>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        {conversations.map(({ lead, lastMessage }) => (
          <Link
            key={lead.id}
            to={`/leads/${lead.id}`}
            className="block p-6 hover:bg-slate-50 transition-colors"
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="font-semibold text-slate-900">{lead.business_name}</h3>
                <p className="text-sm text-slate-500">{lead.industry}</p>
              </div>
              <span className="text-xs text-slate-400">
                {new Date(lastMessage.timestamp).toLocaleDateString()}
              </span>
            </div>

            <div className="flex items-start gap-3 mt-3">
              <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${lastMessage.direction === 'inbound' ? 'bg-green-500' : 'bg-slate-300'}`} />
              <p className="text-sm text-slate-600 line-clamp-2 flex-1">
                <span className="font-medium text-slate-700 mr-1">
                  {lastMessage.direction === 'outbound' ? 'You:' : 'Them:'}
                </span>
                {lastMessage.content}
              </p>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </div>
          </Link>
        ))}

        {conversations.length === 0 && (
          <div className="p-12 text-center text-slate-500">
            <MessageSquare className="w-12 h-12 mx-auto mb-4 text-slate-300" />
            <p>No active conversations yet.</p>
            <p className="text-sm mt-2">Send emails to leads to start conversations.</p>
          </div>
        )}
      </div>
    </div>
  );
}
