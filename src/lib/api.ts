export interface Lead {
  id: number;
  business_name: string;
  website: string;
  industry: string;
  location: string;
  rating: number;
  review_count: number;
  phone?: string;
  email?: string;
  status: 'new' | 'enriched' | 'emailed' | 'replied' | 'interested' | 'booked' | 'lost';
  lead_score: number;
  follow_up_count: number;
  next_follow_up?: string;
  metadata: string;
  created_at: string;
}

export interface Message {
  id: number;
  lead_id: number;
  direction: 'outbound' | 'inbound';
  content: string;
  intent: string;
  timestamp: string;
}

export interface Conversation {
  lead: Lead;
  lastMessage: Message;
}

export interface LeadWithMessages extends Lead {
  messages: Message[];
}

export interface PipelineStats {
  pipeline: Record<string, number>;
  total: number;
  hotLeads: Lead[];
}

export interface BulkResult {
  success: number;
  failed: number;
  errors: string[];
}

export interface Campaign {
  id: number;
  name: string;
  subject_template: string;
  body_template: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  send_mode: 'bulk' | 'drip';
  drip_delay_minutes: number;
  lead_count?: number;
  sent_count?: number;
  opened_count?: number;
  replied_count?: number;
  total_sent: number;
  total_opened: number;
  total_replied: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignLead {
  id: number;
  campaign_id: number;
  lead_id: number;
  status: 'pending' | 'sent' | 'opened' | 'replied' | 'failed';
  sent_at?: string;
  opened_at?: string;
  business_name: string;
  email?: string;
  industry: string;
  location: string;
  lead_score: number;
  lead_status: string;
}

export interface CampaignDetail extends Campaign {
  leads: CampaignLead[];
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

function post<T>(url: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const api = {
  // Leads
  getLeads: (status?: string): Promise<Lead[]> => {
    const query = status && status !== 'all' ? `?status=${status}` : '';
    return request<Lead[]>(`/api/leads${query}`);
  },
  getLead: (id: number): Promise<LeadWithMessages> => request<LeadWithMessages>(`/api/leads/${id}`),
  deleteLead: (id: number): Promise<{ success: boolean }> => request(`/api/leads/${id}`, { method: 'DELETE' }),
  updateLead: (id: number, data: Partial<Lead>): Promise<{ success: boolean }> => {
    return request(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  // Discovery
  discover: (industry: string, location: string, count?: number, serviceDescription?: string): Promise<{ success: boolean; added: number; total: number; batches: number }> => {
    return post('/api/agents/discovery', { industry, location, count, serviceDescription });
  },

  // Enrichment
  enrich: (leadId: number): Promise<{ success: boolean; data: any; lead_score: number }> => {
    return post('/api/agents/enrich', { leadId });
  },
  bulkEnrich: (leadIds: number[]): Promise<BulkResult> => {
    return post('/api/agents/bulk-enrich', { leadIds });
  },

  // Email
  generateEmail: (leadId: number): Promise<{ subject: string; body: string }> => {
    return post('/api/agents/generate-email', { leadId });
  },
  generateFollowup: (leadId: number): Promise<{ subject: string; body: string; followUpNumber: number }> => {
    return post('/api/agents/generate-followup', { leadId });
  },
  sendEmail: (leadId: number, subject: string, body: string, isFollowUp?: boolean): Promise<{ success: boolean; emailSent: boolean }> => {
    return post('/api/agents/send-email', { leadId, subject, body, isFollowUp });
  },
  bulkEmail: (leadIds: number[]): Promise<BulkResult> => {
    return post('/api/agents/bulk-email', { leadIds });
  },

  // Conversations
  getConversations: (): Promise<Conversation[]> => request<Conversation[]>('/api/conversations'),

  // Settings
  getSettings: (): Promise<Record<string, string>> => request<Record<string, string>>('/api/settings'),
  saveSettings: (settings: Record<string, string>): Promise<{ success: boolean }> => post('/api/settings', settings),

  // Stats
  getStats: (): Promise<PipelineStats> => request<PipelineStats>('/api/stats'),

  // Campaigns
  getCampaigns: (): Promise<Campaign[]> => request<Campaign[]>('/api/campaigns'),
  createCampaign: (data: { name: string; subject_template?: string; body_template?: string; send_mode?: string; drip_delay_minutes?: number }): Promise<{ success: boolean; id: number }> => {
    return post('/api/campaigns', data);
  },
  getCampaign: (id: number): Promise<CampaignDetail> => request<CampaignDetail>(`/api/campaigns/${id}`),
  updateCampaign: (id: number, data: Partial<Campaign>): Promise<{ success: boolean }> => {
    return request(`/api/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },
  deleteCampaign: (id: number): Promise<{ success: boolean }> => request(`/api/campaigns/${id}`, { method: 'DELETE' }),
  addLeadsToCampaign: (campaignId: number, leadIds: number[]): Promise<{ success: boolean; added: number }> => {
    return post(`/api/campaigns/${campaignId}/leads`, { leadIds });
  },
  removeLeadFromCampaign: (campaignId: number, leadId: number): Promise<{ success: boolean }> => {
    return request(`/api/campaigns/${campaignId}/leads/${leadId}`, { method: 'DELETE' });
  },
  sendCampaign: (campaignId: number): Promise<{ success: boolean; sent: number; failed: number; errors: string[] }> => {
    return post(`/api/campaigns/${campaignId}/send`, {});
  },

  // Zoho
  connectZoho: (apiKey: string, fromEmail?: string): Promise<{ success: boolean }> => {
    return post('/api/zoho/connect', { apiKey, fromEmail });
  },
  getZohoStatus: (): Promise<{ connected: boolean; fromEmail: string | null }> => {
    return request('/api/zoho/status');
  },
};

