import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { initDB } from "./src/db/index.js";
import db from "./src/db/index.js";

import * as cheerio from "cheerio";
import nodemailer from "nodemailer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize DB
initDB();

// --- Pre-compiled Prepared Statements ---
const stmtGetAllLeads = db.prepare("SELECT * FROM leads ORDER BY lead_score DESC, created_at DESC");
const stmtGetLeadById = db.prepare("SELECT * FROM leads WHERE id = ?");
const stmtGetMessagesByLead = db.prepare("SELECT * FROM messages WHERE lead_id = ? ORDER BY timestamp ASC");
const stmtInsertLead = db.prepare(`
  INSERT INTO leads (business_name, website, industry, location, status, metadata)
  VALUES (?, ?, ?, ?, 'new', '{}')
`);
const stmtUpdateLeadStatus = db.prepare("UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const stmtInsertDiscoveredLead = db.prepare(`
  INSERT INTO leads (business_name, website, industry, location, rating, review_count, status, metadata)
  VALUES (?, ?, ?, ?, ?, ?, 'new', '{}')
`);
const stmtCheckDuplicateWebsite = db.prepare("SELECT id FROM leads WHERE website = ?");
const stmtUpdateEnrichment = db.prepare(`
  UPDATE leads 
  SET email = COALESCE(?, email), 
      phone = COALESCE(?, phone),
      metadata = ?,
      lead_score = ?,
      status = 'enriched',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);
const stmtInsertMessage = db.prepare(`
  INSERT INTO messages (lead_id, direction, content, intent)
  VALUES (?, ?, ?, ?)
`);
const stmtDeleteLead = db.prepare("DELETE FROM leads WHERE id = ?");
const stmtDeleteLeadMessages = db.prepare("DELETE FROM messages WHERE lead_id = ?");
const stmtGetSetting = db.prepare("SELECT value FROM settings WHERE key = ?");
const stmtUpsertSetting = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
const stmtGetAllSettings = db.prepare("SELECT key, value FROM settings");
const stmtGetConversations = db.prepare(`
  SELECT l.*, m.id as msg_id, m.direction, m.content as msg_content, m.intent, m.timestamp as msg_timestamp
  FROM leads l
  INNER JOIN messages m ON m.lead_id = l.id
  WHERE l.status IN ('emailed', 'replied', 'interested')
  AND m.id = (SELECT MAX(m2.id) FROM messages m2 WHERE m2.lead_id = l.id)
  ORDER BY m.timestamp DESC
`);
const stmtUpdateLeadScore = db.prepare("UPDATE leads SET lead_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const stmtUpdateFollowUp = db.prepare(`
  UPDATE leads SET follow_up_count = follow_up_count + 1, next_follow_up = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);
const stmtGetLeadsByStatus = db.prepare("SELECT * FROM leads WHERE status = ? ORDER BY lead_score DESC");
const stmtGetLeadsByIds = db.prepare("SELECT * FROM leads WHERE id IN (SELECT value FROM json_each(?))");
const stmtUpdateLead = db.prepare(`
  UPDATE leads SET business_name = COALESCE(?, business_name), email = COALESCE(?, email), 
  phone = COALESCE(?, phone), status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);

async function callGroq(prompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === "YOUR_GROQ_API_KEY") {
    throw new Error("Invalid API Key: Please set GROQ_API_KEY in your environment variables.");
  }
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error (${response.status}): ${err}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// Strip markdown code fences from AI responses before JSON parsing
function extractJSON(text: string, type: 'object' | 'array' = 'object'): string | null {
  // Remove markdown code fences like ```json ... ```
  let cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const pattern = type === 'array' ? /\[.*\]/s : /\{.*\}/s;
  const match = cleaned.match(pattern);
  if (!match) return null;

  let jsonStr = match[0];
  // Sanitize literal control characters that break JSON.parse
  // This replaces real newlines/tabs with escaped versions (\n, \t)
  return jsonStr
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\f/g, '\\f')
    .replace(/\b/g, '\\b');
}

// Helper: get all settings as object
function getAllSettings(): Record<string, string> {
  const rows = stmtGetAllSettings.all() as any[];
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

// Helper: interpolate variables in templates {{var}}
function interpolateTemplate(template: string, lead: any, settings: Record<string, string>): string {
  if (!template) return '';
  const meta = JSON.parse(lead.metadata || '{}');
  const vars: Record<string, string> = {
    '{{business_name}}': lead.business_name || '',
    '{{industry}}': lead.industry || '',
    '{{location}}': lead.location || '',
    '{{sender_name}}': settings.sender_name || 'Our Team',
    '{{company_name}}': settings.company_name || 'AutoBound',
    '{{service}}': settings.service_description || 'our AI services',
    '{{booking_link}}': settings.booking_link || '',
    '{{pain_points}}': (meta.pain_points || []).join(', ') || 'inefficiencies',
    '{{services}}': (meta.services || []).join(', ') || 'operations',
  };
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
  }
  return result;
}

// Helper: calculate lead score (0-100)
function calculateLeadScore(lead: any, enrichmentData: any): number {
  let score = 0;
  if (lead.email || enrichmentData.contact_email) score += 25;
  if (lead.phone || enrichmentData.contact_phone) score += 10;
  if (lead.website) score += 10;
  if (lead.rating >= 4) score += 15;
  else if (lead.rating >= 3) score += 5;
  const painPoints = enrichmentData.pain_points?.length || 0;
  score += Math.min(painPoints * 10, 25);
  const services = enrichmentData.services?.length || 0;
  score += Math.min(services * 5, 15);
  return Math.min(score, 100);
}

// Helper: build email transporter if SMTP is configured
function getMailTransporter() {
  const settings = getAllSettings();
  if (!settings.smtp_host || !settings.smtp_user) return null;
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: parseInt(settings.smtp_port || '587'),
    secure: settings.smtp_secure === 'SSL',
    auth: {
      user: settings.smtp_user,
      pass: settings.smtp_pass,
    },
  });
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000');

  app.use(express.json());

  // --- API Routes ---

  // Get all leads (optional status filter)
  app.get("/api/leads", (req, res) => {
    try {
      const status = req.query.status as string;
      let leads;
      if (status && status !== 'all') {
        leads = stmtGetLeadsByStatus.all(status);
      } else {
        leads = stmtGetAllLeads.all();
      }
      res.json(leads);
    } catch (error: any) {
      console.error("Error fetching leads:", error);
      res.status(500).json({ error: "Failed to fetch leads" });
    }
  });

  // Get single lead
  app.get("/api/leads/:id", (req, res) => {
    try {
      const lead = stmtGetLeadById.get(req.params.id) as any;
      if (!lead) return res.status(404).json({ error: "Lead not found" });
      const messages = stmtGetMessagesByLead.all(req.params.id);
      res.json({ ...lead, messages });
    } catch (error: any) {
      console.error("Error fetching lead:", error);
      res.status(500).json({ error: "Failed to fetch lead" });
    }
  });

  // Create lead (manual)
  app.post("/api/leads", (req, res) => {
    try {
      const { business_name, website, industry, location } = req.body;
      if (!business_name) return res.status(400).json({ error: "business_name is required" });
      const info = stmtInsertLead.run(business_name, website || null, industry || null, location || null);
      res.json({ id: info.lastInsertRowid });
    } catch (error: any) {
      console.error("Error creating lead:", error);
      res.status(500).json({ error: "Failed to create lead" });
    }
  });

  // Update lead
  app.patch("/api/leads/:id", (req, res) => {
    try {
      const lead = stmtGetLeadById.get(req.params.id) as any;
      if (!lead) return res.status(404).json({ error: "Lead not found" });
      const { business_name, email, phone, status } = req.body;
      if (status) {
        const validStatuses = ['new', 'enriched', 'emailed', 'replied', 'interested', 'booked', 'lost'];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }
      }
      stmtUpdateLead.run(business_name || null, email || null, phone || null, status || null, req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating lead:", error);
      res.status(500).json({ error: "Failed to update lead" });
    }
  });

  // Update lead status
  app.patch("/api/leads/:id/status", (req, res) => {
    try {
      const { status } = req.body;
      const validStatuses = ['new', 'enriched', 'emailed', 'replied', 'interested', 'booked', 'lost'];
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      }
      stmtUpdateLeadStatus.run(status, req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating lead status:", error);
      res.status(500).json({ error: "Failed to update lead status" });
    }
  });

  // Delete lead
  app.delete("/api/leads/:id", (req, res) => {
    try {
      const lead = stmtGetLeadById.get(req.params.id) as any;
      if (!lead) return res.status(404).json({ error: "Lead not found" });
      stmtDeleteLeadMessages.run(req.params.id);
      stmtDeleteLead.run(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting lead:", error);
      res.status(500).json({ error: "Failed to delete lead" });
    }
  });

  // Conversations endpoint
  app.get("/api/conversations", (_req, res) => {
    try {
      const rows = stmtGetConversations.all() as any[];
      const conversations = rows.map(row => ({
        lead: {
          id: row.id, business_name: row.business_name, website: row.website,
          industry: row.industry, location: row.location, rating: row.rating,
          review_count: row.review_count, phone: row.phone, email: row.email,
          status: row.status, lead_score: row.lead_score, metadata: row.metadata,
          created_at: row.created_at,
        },
        lastMessage: {
          id: row.msg_id, lead_id: row.id, direction: row.direction,
          content: row.msg_content, intent: row.intent, timestamp: row.msg_timestamp,
        }
      }));
      res.json(conversations);
    } catch (error: any) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Settings endpoints
  app.get("/api/settings", (_req, res) => {
    try {
      res.json(getAllSettings());
    } catch (error: any) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", (req, res) => {
    try {
      const settings = req.body;
      if (typeof settings !== 'object' || settings === null) {
        return res.status(400).json({ error: "Request body must be an object" });
      }
      const upsertMany = db.transaction((entries: [string, string][]) => {
        for (const [key, value] of entries) {
          stmtUpsertSetting.run(key, String(value));
        }
      });
      upsertMany(Object.entries(settings));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error saving settings:", error);
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  // ===== DISCOVERY AGENT (supports 100+ leads via batching) =====
  app.post("/api/agents/discovery", async (req, res) => {
    const { industry, location, count = 10, serviceDescription } = req.body;

    if (!industry || !location) {
      return res.status(400).json({ error: "industry and location are required" });
    }

    const totalCount = Math.min(Math.max(parseInt(count) || 10, 5), 200);
    const batchSize = 10; // AI returns 10 per call
    const batches = Math.ceil(totalCount / batchSize);

    try {
      let totalAdded = 0;
      const allRaw: any[] = [];

      for (let batch = 0; batch < batches; batch++) {
        const batchNum = batch + 1;
        const serviceContext = serviceDescription
          ? `\nIMPORTANT CONTEXT: I sell "${serviceDescription}". Find businesses that would most likely NEED this service — look for signs they could benefit from it.`
          : '';

        const prompt = `Find ${batchSize} ${industry} businesses in ${location} and surrounding cities/metro area (batch ${batchNum} of ${batches} — return DIFFERENT businesses than previous batches, expand to nearby cities if needed).${serviceContext}
        
Return ONLY a JSON array of objects with these fields:
- business_name (string)
- website (valid URL, required — skip businesses without websites)
- location (string, include the actual city name)
- rating (number 1-5)
- review_count (number)

IMPORTANT: If you can't find enough in ${location} itself, expand to nearby cities, suburbs, and the greater metro area. Only include real businesses with real websites. No duplicates.`;

        const text = await callGroq(prompt);
        if (!text) continue;

        const jsonStr = extractJSON(text, 'array');
        if (!jsonStr) continue;

        try {
          const leads = JSON.parse(jsonStr);
          allRaw.push(...leads);

          for (const lead of leads) {
            if (!lead.website || !lead.business_name) continue;
            const check = stmtCheckDuplicateWebsite.get(lead.website) as any;
            if (!check) {
              stmtInsertDiscoveredLead.run(
                lead.business_name, lead.website, industry,
                lead.location || location, lead.rating || 0, lead.review_count || 0
              );
              totalAdded++;
            }
          }
        } catch { /* skip unparseable batch */ }
      }

      res.json({ success: true, added: totalAdded, total: allRaw.length, batches });
    } catch (error: any) {
      console.error("Discovery Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== ENRICHMENT AGENT =====
  app.post("/api/agents/enrich", async (req, res) => {
    const { leadId } = req.body;
    if (!leadId) return res.status(400).json({ error: "leadId is required" });

    const lead = stmtGetLeadById.get(leadId) as any;
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    try {
      if (!lead.website) throw new Error("No website URL");

      const response = await fetch(lead.website);
      const html = await response.text();
      const $ = cheerio.load(html);
      const textContent = $('body').text().replace(/\s+/g, ' ').substring(0, 10000);

      const prompt = `Analyze this website content for a ${lead.industry} business called "${lead.business_name}":
"${textContent}"

Extract the following as JSON:
{
  "services": ["list of services they offer"],
  "tone": "formal|casual|luxury|technical|aggressive",
  "pain_points": ["business pain points you can identify — things they struggle with or could improve"],
  "strengths": ["what they do well"],
  "contact_email": "email found on the site or null",
  "contact_phone": "phone found on the site or null",
  "company_size": "small|medium|large",
  "tech_savviness": "low|medium|high"
}`;

      const analysisText = await callGroq(prompt);
      const jsonStr = extractJSON(analysisText || '');

      if (jsonStr) {
        const data = JSON.parse(jsonStr);
        const existingMeta = JSON.parse(lead.metadata || '{}');
        const newMeta = { ...existingMeta, ...data };
        const score = calculateLeadScore(lead, data);

        stmtUpdateEnrichment.run(
          data.contact_email || null, data.contact_phone || null,
          JSON.stringify(newMeta), score, leadId
        );

        res.json({ success: true, data, lead_score: score });
      } else {
        throw new Error("Failed to parse enrichment data");
      }
    } catch (error: any) {
      console.error("Enrichment Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== BULK ENRICH =====
  app.post("/api/agents/bulk-enrich", async (req, res) => {
    const { leadIds } = req.body;
    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: "leadIds array is required" });
    }

    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const id of leadIds) {
      try {
        const lead = stmtGetLeadById.get(id) as any;
        if (!lead || !lead.website) { results.failed++; continue; }

        const response = await fetch(lead.website);
        const html = await response.text();
        const $ = cheerio.load(html);
        const textContent = $('body').text().replace(/\s+/g, ' ').substring(0, 10000);

        const prompt = `Analyze this website for ${lead.business_name} (${lead.industry}): "${textContent}"
Extract JSON: { "services": [], "tone": "string", "pain_points": [], "strengths": [], "contact_email": "or null", "contact_phone": "or null", "company_size": "small|medium|large", "tech_savviness": "low|medium|high" }`;

        const resultText = await callGroq(prompt);
        const jsonStr = extractJSON(resultText || '');
        if (jsonStr) {
          const data = JSON.parse(jsonStr);
          const existingMeta = JSON.parse(lead.metadata || '{}');
          const newMeta = { ...existingMeta, ...data };
          const score = calculateLeadScore(lead, data);
          stmtUpdateEnrichment.run(
            data.contact_email || null, data.contact_phone || null,
            JSON.stringify(newMeta), score, id
          );
          results.success++;
        } else {
          results.failed++;
        }
      } catch (err: any) {
        results.failed++;
        results.errors.push(`Lead ${id}: ${err.message}`);
      }
    }

    res.json(results);
  });

  // ===== EMAIL GENERATION (with booking link + customization) =====
  app.post("/api/agents/generate-email", async (req, res) => {
    const { leadId } = req.body;
    if (!leadId) return res.status(400).json({ error: "leadId is required" });

    const lead = stmtGetLeadById.get(leadId) as any;
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    try {
      const meta = JSON.parse(lead.metadata || '{}');
      const settings = getAllSettings();


      const senderName = settings.sender_name || 'there';
      const companyName = settings.company_name || 'our team';
      const serviceDesc = settings.service_description || 'AI automation services';
      const bookingLink = settings.booking_link || '';
      const emailTone = settings.email_tone || 'friendly and professional';
      const customInstructions = settings.custom_email_prompt || '';

      const prompt = `Write a high-converting cold email to ${lead.business_name} (${lead.industry} in ${lead.location}).

ABOUT THE LEAD:
- Services they offer: ${JSON.stringify(meta.services || [])}
- Their pain points: ${JSON.stringify(meta.pain_points || [])}
- Their strengths: ${JSON.stringify(meta.strengths || [])}
- Their tone: ${meta.tone || 'unknown'}
- Company size: ${meta.company_size || 'unknown'}
- Tech savviness: ${meta.tech_savviness || 'unknown'}

ABOUT ME (the sender):
- My name: ${senderName}
- My company: ${companyName}
- What I sell: ${serviceDesc}
${bookingLink ? `- My booking link: ${bookingLink}` : ''}

EMAIL TONE: ${emailTone}

${customInstructions ? `CUSTOM INSTRUCTIONS: ${customInstructions}` : ''}

RULES:
1. Subject line must be short, curiosity-driven, personalized to THEIR business (no generic subjects)
2. Opening line must reference something specific about THEIR business
3. Body must connect their pain points to my service as the solution
4. Keep it under 150 words — SHORT and punchy
5. ${bookingLink ? `End with a clear CTA: "Book a quick 15-min call: ${bookingLink}"` : 'End with a soft CTA asking if they are open to chat'}
6. Do NOT use generic filler. Every sentence should earn its place.
7. Sign off with my name: ${senderName}

Return ONLY JSON: { "subject": "...", "body": "..." }`;

      const resultText = await callGroq(prompt);
      const jsonStr = extractJSON(resultText || '');
      if (jsonStr) {
        const emailContent = JSON.parse(jsonStr);
        res.json(emailContent);
      } else {
        throw new Error("Failed to generate email");
      }
    } catch (error: any) {
      console.error("Email Generation Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== FOLLOW-UP EMAIL GENERATION =====
  app.post("/api/agents/generate-followup", async (req, res) => {
    const { leadId } = req.body;
    if (!leadId) return res.status(400).json({ error: "leadId is required" });

    const lead = stmtGetLeadById.get(leadId) as any;
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    try {
      const meta = JSON.parse(lead.metadata || '{}');
      const settings = getAllSettings();
      const messages = stmtGetMessagesByLead.all(leadId) as any[];
      const lastEmail = messages.filter((m: any) => m.direction === 'outbound').pop();
      const followUpNum = (lead.follow_up_count || 0) + 1;

      const bookingLink = settings.booking_link || '';
      const senderName = settings.sender_name || 'there';

      const prompt = `Write follow-up email #${followUpNum} to ${lead.business_name} (${lead.industry}).

Previous email sent:
"${lastEmail?.content || 'No previous email found'}"

RULES:
1. Keep it VERY short (under 80 words)
2. Reference the previous email casually ("Just following up on my note...")
3. Add ONE new angle or value prop
4. ${followUpNum >= 3 ? 'This is a breakup email — politely say this is your last outreach' : 'Create gentle urgency'}
5. ${bookingLink ? `CTA: "Grab 15 min here: ${bookingLink}"` : 'CTA: ask if they are open to a quick chat'}
6. Sign off: ${senderName}

Return ONLY JSON: { "subject": "...", "body": "..." }`;

      const resultText = await callGroq(prompt);
      const jsonStr = extractJSON(resultText || '');
      if (jsonStr) {
        const emailContent = JSON.parse(jsonStr);
        res.json({ ...emailContent, followUpNumber: followUpNum });
      } else {
        throw new Error("Failed to generate follow-up");
      }
    } catch (error: any) {
      console.error("Follow-up Generation Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== SEND EMAIL (with real SMTP support) =====
  app.post("/api/agents/send-email", async (req, res) => {
    try {
      const { leadId, subject, body, isFollowUp } = req.body;
      if (!leadId || !subject || !body) {
        return res.status(400).json({ error: "leadId, subject, and body are required" });
      }

      const lead = stmtGetLeadById.get(leadId) as any;
      if (!lead) return res.status(404).json({ error: "Lead not found" });

      const fullContent = `Subject: ${subject}\n\n${body}`;
      const intent = isFollowUp ? 'follow-up' : 'pitch';
      stmtInsertMessage.run(leadId, 'outbound', fullContent, intent);

      // Try real email if SMTP is configured and lead has email
      const transporter = getMailTransporter();
      const settings = getAllSettings();
      let emailSent = false;

      if (transporter && lead.email) {
        try {
          await transporter.sendMail({
            from: settings.smtp_user,
            to: lead.email,
            subject: subject,
            text: body,
          });
          emailSent = true;
          console.log(`[EMAIL SENT] To: ${lead.email} | Subject: ${subject}`);
        } catch (emailErr: any) {
          console.error(`[EMAIL FAILED] To: ${lead.email} | Error: ${emailErr.message}`);
        }
      } else {
        console.log(`[MOCK EMAIL] To: ${lead.email || 'Unknown'} | Subject: ${subject}`);
      }

      // Update status and follow-up count
      if (isFollowUp) {
        stmtUpdateFollowUp.run(null, leadId);
      } else {
        stmtUpdateLeadStatus.run('emailed', leadId);
      }

      res.json({ success: true, emailSent });
    } catch (error: any) {
      console.error("Send Email Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== BULK EMAIL (generate + send to multiple leads) =====
  app.post("/api/agents/bulk-email", async (req, res) => {
    const { leadIds } = req.body;
    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: "leadIds array is required" });
    }

    const results = { success: 0, failed: 0, errors: [] as string[] };
    const settings = getAllSettings();


    for (const id of leadIds) {
      try {
        const lead = stmtGetLeadById.get(id) as any;
        if (!lead) { results.failed++; continue; }

        const meta = JSON.parse(lead.metadata || '{}');
        const senderName = settings.sender_name || 'there';
        const companyName = settings.company_name || 'our team';
        const serviceDesc = settings.service_description || 'AI automation services';
        const bookingLink = settings.booking_link || '';
        const emailTone = settings.email_tone || 'friendly and professional';

        const prompt = `Write a high-converting cold email to ${lead.business_name} (${lead.industry}).
Use the PAS (Problem-Agitate-Solve) framework:
1. Hook: Mention a detail about their business.
2. Problem: Identify a specific pain point from their industry or metadata.
3. Agitate: Explain why this problem hurts their growth.
4. Solve: Connect how ${serviceDesc} solves it.
5. Low-Friction CTA: Ask if they are open to an exchange of ideas (e.g. "Worth a quick chat?").

Services: ${JSON.stringify(meta.services || [])}. Pain points: ${JSON.stringify(meta.pain_points || [])}.
Sender: ${senderName} from ${companyName}, Tone: ${emailTone}.
Length: Under 120 words. Use \n for newlines.
IMPORTANT: Return ONLY valid JSON. Format: { "subject": "...", "body": "..." }`;

        const resultText = await callGroq(prompt);
        const jsonStr = extractJSON(resultText || '');
        if (jsonStr) {
          const emailContent = JSON.parse(jsonStr);
          const fullContent = `Subject: ${emailContent.subject}\n\n${emailContent.body}`;
          stmtInsertMessage.run(id, 'outbound', fullContent, 'pitch');
          stmtUpdateLeadStatus.run('emailed', id);

          // Try real email
          const transporter = getMailTransporter();
          if (transporter && lead.email) {
            try {
              await transporter.sendMail({
                from: settings.smtp_user,
                to: lead.email,
                subject: emailContent.subject,
                text: emailContent.body,
              });
            } catch { }
          }

          results.success++;
        } else {
          results.failed++;
        }
      } catch (err: any) {
        results.failed++;
        results.errors.push(`Lead ${id}: ${err.message}`);
      }
    }

    res.json(results);
  });

  // Pipeline stats
  app.get("/api/stats", (_req, res) => {
    try {
      const counts = db.prepare(`
        SELECT status, COUNT(*) as count FROM leads GROUP BY status
      `).all() as any[];
      const total = db.prepare("SELECT COUNT(*) as count FROM leads").get() as any;
      const hotLeads = db.prepare(`
        SELECT * FROM leads WHERE lead_score >= 60 AND status IN ('enriched', 'new') 
        ORDER BY lead_score DESC LIMIT 10
      `).all();

      const pipeline: Record<string, number> = {};
      for (const row of counts) pipeline[row.status] = row.count;

      res.json({ pipeline, total: total.count, hotLeads });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // ===== CAMPAIGNS =====

  // List campaigns
  app.get("/api/campaigns", (_req, res) => {
    try {
      const campaigns = db.prepare(`
        SELECT c.*, 
          (SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = c.id) as lead_count,
          (SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = c.id AND status = 'sent') as sent_count,
          (SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = c.id AND status = 'opened') as opened_count,
          (SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = c.id AND status = 'replied') as replied_count
        FROM campaigns c ORDER BY c.created_at DESC
      `).all();
      res.json(campaigns);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch campaigns" });
    }
  });

  // Create campaign
  app.post("/api/campaigns", (req, res) => {
    const { name, subject_template, body_template, send_mode, drip_delay_minutes } = req.body;
    if (!name) return res.status(400).json({ error: "Campaign name is required" });
    try {
      const result = db.prepare(`
        INSERT INTO campaigns (name, subject_template, body_template, send_mode, drip_delay_minutes)
        VALUES (?, ?, ?, ?, ?)
      `).run(name, subject_template || '', body_template || '', send_mode || 'bulk', drip_delay_minutes || 5);
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get campaign detail
  app.get("/api/campaigns/:id", (req, res) => {
    try {
      const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id) as any;
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      const leads = db.prepare(`
        SELECT cl.*, l.business_name, l.email, l.industry, l.location, l.lead_score, l.status as lead_status
        FROM campaign_leads cl
        JOIN leads l ON l.id = cl.lead_id
        WHERE cl.campaign_id = ?
        ORDER BY l.lead_score DESC
      `).all(req.params.id);
      res.json({ ...campaign, leads });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update campaign
  app.patch("/api/campaigns/:id", (req, res) => {
    const { name, subject_template, body_template, status, send_mode, drip_delay_minutes } = req.body;
    try {
      db.prepare(`
        UPDATE campaigns SET 
          name = COALESCE(?, name), subject_template = COALESCE(?, subject_template),
          body_template = COALESCE(?, body_template), status = COALESCE(?, status),
          send_mode = COALESCE(?, send_mode), drip_delay_minutes = COALESCE(?, drip_delay_minutes),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, subject_template, body_template, status, send_mode, drip_delay_minutes, req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete campaign
  app.delete("/api/campaigns/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM campaign_leads WHERE campaign_id = ?").run(req.params.id);
      db.prepare("DELETE FROM campaigns WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Assign leads to campaign
  app.post("/api/campaigns/:id/leads", (req, res) => {
    const { leadIds } = req.body;
    if (!leadIds || !Array.isArray(leadIds)) return res.status(400).json({ error: "leadIds array required" });
    try {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO campaign_leads (campaign_id, lead_id) VALUES (?, ?)
      `);
      const insertMany = db.transaction((ids: number[]) => {
        let added = 0;
        for (const lid of ids) {
          const r = insert.run(req.params.id, lid);
          if (r.changes > 0) added++;
        }
        return added;
      });
      const added = insertMany(leadIds);
      res.json({ success: true, added });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove lead from campaign
  app.delete("/api/campaigns/:id/leads/:leadId", (req, res) => {
    try {
      db.prepare("DELETE FROM campaign_leads WHERE campaign_id = ? AND lead_id = ?").run(req.params.id, req.params.leadId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Helper: interpolate template variables
  function interpolateTemplate(template: string, lead: any, settings: Record<string, string>): string {
    const meta = JSON.parse(lead.metadata || '{}');
    return template
      .replace(/\{\{business_name\}\}/g, lead.business_name || '')
      .replace(/\{\{industry\}\}/g, lead.industry || '')
      .replace(/\{\{location\}\}/g, lead.location || '')
      .replace(/\{\{sender_name\}\}/g, settings.sender_name || '')
      .replace(/\{\{company_name\}\}/g, settings.company_name || '')
      .replace(/\{\{service\}\}/g, settings.service_description || '')
      .replace(/\{\{booking_link\}\}/g, settings.booking_link || '')
      .replace(/\{\{pain_points\}\}/g, (meta.pain_points || []).join(', '))
      .replace(/\{\{services\}\}/g, (meta.services || []).join(', '));
  }

  // Send campaign (bulk or drip)
  app.post("/api/campaigns/:id/send", async (req, res) => {
    const campaignId = req.params.id;
    try {
      const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(campaignId) as any;
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const pendingLeads = db.prepare(`
        SELECT cl.*, l.* FROM campaign_leads cl
        JOIN leads l ON l.id = cl.lead_id
        WHERE cl.campaign_id = ? AND cl.status = 'pending'
        ORDER BY l.lead_score DESC
      `).all(campaignId) as any[];

      if (pendingLeads.length === 0) return res.json({ success: true, sent: 0, message: "No pending leads" });

      const settings = getAllSettings();
      const transporter = getMailTransporter();
      const zohoKey = settings.zoho_api_key;
      const results = { sent: 0, failed: 0, errors: [] as string[] };

      // Update campaign to active
      db.prepare("UPDATE campaigns SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(campaignId);

      for (let i = 0; i < pendingLeads.length; i++) {
        const cl = pendingLeads[i];
        try {
          let subject = campaign.subject_template;
          let body = campaign.body_template;

          // If templates have content, interpolate. Otherwise generate with AI.
          if (subject && body) {
            subject = interpolateTemplate(subject, cl, settings);
            body = interpolateTemplate(body, cl, settings);
          } else {
            // Auto-generate with AI
            const meta = JSON.parse(cl.metadata || '{}');
            const prompt = `Write a high-converting cold email to ${cl.business_name} (${cl.industry}).
Use the PAS (Problem-Agitate-Solve) framework:
1. Hook: Mention a detail about their business.
2. Problem: Identify a specific pain point.
3. Agitate: Explain why it's a bottleneck.
4. Solve: Connect how ${settings.service_description || 'our services'} solves it.
5. Low-Friction CTA: Interest-based question.

Services: ${JSON.stringify(meta.services || [])}. Pain points: ${JSON.stringify(meta.pain_points || [])}.
Sender: ${settings.sender_name || 'Our Team'} from ${settings.company_name || 'AutoBound'}, Tone: ${settings.email_tone || 'friendly'}.
Length: Max 120 words. Use \n for newlines.
IMPORTANT: Return ONLY valid JSON. Format: { "subject": "...", "body": "..." }`;
            const resultText = await callGroq(prompt);
            const jsonStr = extractJSON(resultText || '');
            if (jsonStr) {
              const parsed = JSON.parse(jsonStr);
              subject = parsed.subject;
              body = parsed.body;
            } else {
              throw new Error("AI failed to generate email");
            }
          }

          // Send via Zoho if connected
          let emailSent = false;
          if (zohoKey && cl.email) {
            try {
              const zohoRes = await fetch("https://api.zeptomail.com/v1.1/email", {
                method: "POST",
                headers: {
                  "Authorization": `Zoho-encrtoken ${zohoKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  from: { address: settings.smtp_user || settings.zoho_from_email || "noreply@example.com" },
                  to: [{ email_address: { address: cl.email } }],
                  subject: subject,
                  textbody: body,
                }),
              });
              emailSent = zohoRes.ok;
              if (!zohoRes.ok) {
                const errText = await zohoRes.text();
                console.error(`[ZOHO ERROR] ${errText}`);
              }
            } catch (zohoErr: any) {
              console.error(`[ZOHO SEND FAILED] ${zohoErr.message}`);
            }
          }
          // Fallback to SMTP
          else if (transporter && cl.email) {
            try {
              await transporter.sendMail({
                from: settings.smtp_user,
                to: cl.email,
                subject: subject,
                text: body,
              });
              emailSent = true;
            } catch (smtpErr: any) {
              console.error(`[SMTP FAILED] ${smtpErr.message}`);
            }
          }

          // Record message
          const fullContent = `Subject: ${subject}\n\n${body}`;
          stmtInsertMessage.run(cl.lead_id, 'outbound', fullContent, 'campaign');

          // Update campaign_lead status
          db.prepare("UPDATE campaign_leads SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE campaign_id = ? AND lead_id = ?")
            .run(campaignId, cl.lead_id);

          // Update lead status
          stmtUpdateLeadStatus.run('emailed', cl.lead_id);
          results.sent++;

          // Drip feed delay
          if (campaign.send_mode === 'drip' && i < pendingLeads.length - 1) {
            const delayMs = (campaign.drip_delay_minutes || 5) * 60 * 1000;
            await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, 300000))); // max 5 min per email
          }
        } catch (err: any) {
          results.failed++;
          results.errors.push(`${cl.business_name}: ${err.message}`);
          db.prepare("UPDATE campaign_leads SET status = 'failed' WHERE campaign_id = ? AND lead_id = ?")
            .run(campaignId, cl.lead_id);
        }
      }

      // Update campaign stats
      db.prepare(`
        UPDATE campaigns SET 
          total_sent = (SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = ? AND status = 'sent'),
          status = CASE WHEN (SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = ? AND status = 'pending') = 0 THEN 'completed' ELSE status END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(campaignId, campaignId, campaignId);

      res.json({ success: true, ...results });
    } catch (error: any) {
      console.error("Campaign Send Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== ZOHO INTEGRATION =====
  app.post("/api/zoho/connect", (req, res) => {
    const { apiKey, fromEmail } = req.body;
    if (!apiKey) return res.status(400).json({ error: "API key required" });
    try {
      stmtUpsertSetting.run('zoho_api_key', apiKey);
      if (fromEmail) stmtUpsertSetting.run('zoho_from_email', fromEmail);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/zoho/status", (_req, res) => {
    const settings = getAllSettings();
    res.json({
      connected: !!settings.zoho_api_key,
      fromEmail: settings.zoho_from_email || null
    });
  });

  // ===== CAMPAIGN PREVIEW =====
  app.post("/api/campaigns/:id/preview", async (req, res) => {
    const campaignId = req.params.id;
    try {
      const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(campaignId) as any;
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const pendingLeads = db.prepare(`
        SELECT cl.*, l.* FROM campaign_leads cl
        JOIN leads l ON l.id = cl.lead_id
        WHERE cl.campaign_id = ? AND cl.status = 'pending'
        ORDER BY l.lead_score DESC
      `).all(campaignId) as any[];

      if (pendingLeads.length === 0) return res.json({ previews: [], message: "No pending leads" });

      const settings = getAllSettings();
      const previews = [];

      for (const cl of pendingLeads) {
        try {
          let subject = campaign.subject_template;
          let body = campaign.body_template;

          if (subject && body) {
            subject = interpolateTemplate(subject, cl, settings);
            body = interpolateTemplate(body, cl, settings);
          } else {
            const meta = JSON.parse(cl.metadata || '{}');
            const prompt = `Write a high-converting cold email to ${cl.business_name} (${cl.industry}).
Use the PAS (Problem-Agitate-Solve) framework:
1. Hook: Specific mention of their company.
2. Problem: Relevant pain point.
3. Agitate: Detail the impact of the problem.
4. Solve: How ${settings.service_description || 'our services'} fixes it.
5. Low-Friction CTA: Interest-based question.

Services: ${JSON.stringify(meta.services || [])}. Pain points: ${JSON.stringify(meta.pain_points || [])}.
Sender: ${settings.sender_name || 'Our Team'} from ${settings.company_name || 'AutoBound'}, Tone: ${settings.email_tone || 'friendly'}.
Length: Under 120 words. Use \n for newlines.
IMPORTANT: Return ONLY valid JSON. Use \\n for newlines in the body text. No markdown, no code fences.
Format: { "subject": "...", "body": "..." }`;
            const resultText = await callGroq(prompt);
            const jsonStr = extractJSON(resultText || '');
            if (jsonStr) {
              const parsed = JSON.parse(jsonStr);
              subject = parsed.subject;
              body = parsed.body;
            } else {
              subject = `Quick question for ${cl.business_name}`;
              body = "(AI generation failed — edit this manually)";
            }
          }

          previews.push({
            lead_id: cl.lead_id,
            business_name: cl.business_name,
            email: cl.email,
            industry: cl.industry,
            lead_score: cl.lead_score,
            subject,
            body,
            selected: true,
          });
        } catch (err: any) {
          previews.push({
            lead_id: cl.lead_id,
            business_name: cl.business_name,
            email: cl.email,
            industry: cl.industry,
            lead_score: cl.lead_score,
            subject: `Follow up with ${cl.business_name}`,
            body: `(Error generating: ${err.message})`,
            selected: true,
          });
        }
      }

      res.json({ previews });
    } catch (error: any) {
      console.error("Preview Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Send campaign with pre-edited previews
  app.post("/api/campaigns/:id/send-previews", async (req, res) => {
    const campaignId = req.params.id;
    const { previews } = req.body as { previews: { lead_id: number; subject: string; body: string; selected: boolean }[] };
    if (!previews || !Array.isArray(previews)) return res.status(400).json({ error: "Previews array required" });

    try {
      const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(campaignId) as any;
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const settings = getAllSettings();
      const transporter = getMailTransporter();
      const zohoKey = settings.zoho_api_key;
      const results = { sent: 0, failed: 0, errors: [] as string[] };
      const selectedPreviews = previews.filter(p => p.selected);

      db.prepare("UPDATE campaigns SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(campaignId);

      for (let i = 0; i < selectedPreviews.length; i++) {
        const p = selectedPreviews[i];
        const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(p.lead_id) as any;
        if (!lead) continue;

        try {
          let emailSent = false;
          if (zohoKey && lead.email) {
            try {
              const zohoRes = await fetch("https://api.zeptomail.com/v1.1/email", {
                method: "POST",
                headers: {
                  "Authorization": `Zoho-encrtoken ${zohoKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  from: { address: settings.smtp_user || settings.zoho_from_email || "noreply@example.com" },
                  to: [{ email_address: { address: lead.email } }],
                  subject: p.subject,
                  textbody: p.body,
                }),
              });
              emailSent = zohoRes.ok;
            } catch { }
          } else if (transporter && lead.email) {
            try {
              await transporter.sendMail({ from: settings.smtp_user, to: lead.email, subject: p.subject, text: p.body });
              emailSent = true;
            } catch { }
          }

          const fullContent = `Subject: ${p.subject}\n\n${p.body}`;
          stmtInsertMessage.run(p.lead_id, 'outbound', fullContent, 'campaign');
          db.prepare("UPDATE campaign_leads SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE campaign_id = ? AND lead_id = ?")
            .run(campaignId, p.lead_id);
          stmtUpdateLeadStatus.run('emailed', p.lead_id);
          results.sent++;

          // SAFETY DELAY:
          // Drip mode: user-defined delay
          // Bulk mode: mandatory 2s delay to prevent spam flagging
          if (i < selectedPreviews.length - 1) {
            const delayMs = campaign.send_mode === 'drip'
              ? (campaign.drip_delay_minutes || 5) * 60 * 1000
              : 2000; // 2s safety for bulk

            // Cap drip delay at 5 mins for this session's testing if needed, but keep logic
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        } catch (err: any) {
          results.failed++;
          results.errors.push(`${lead.business_name}: ${err.message}`);
          db.prepare("UPDATE campaign_leads SET status = 'failed' WHERE campaign_id = ? AND lead_id = ?")
            .run(campaignId, p.lead_id);
        }
      }

      db.prepare(`
        UPDATE campaigns SET
          total_sent = (SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = ? AND status = 'sent'),
          status = CASE WHEN (SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = ? AND status = 'pending') = 0 THEN 'completed' ELSE status END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(campaignId, campaignId, campaignId);

      res.json({ success: true, ...results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });


  // Vite middleware (dev) or static serving (production)
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
