import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { initDB } from "./src/db/index.js";
import db from "./src/db/index.js";
import { GoogleGenAI } from "@google/genai";
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

function getGenAIClient() {
  const rawApiKey = process.env.GEMINI_API_KEY;
  if (!rawApiKey || rawApiKey === "MY_GEMINI_API_KEY") {
    throw new Error("Invalid API Key: Please set GEMINI_API_KEY in your environment variables or secrets.");
  }
  const apiKey = rawApiKey.trim();
  return new GoogleGenAI({ apiKey });
}

// Helper: get all settings as object
function getAllSettings(): Record<string, string> {
  const rows = stmtGetAllSettings.all() as any[];
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
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
      const ai = getGenAIClient();
      let totalAdded = 0;
      const allRaw: any[] = [];

      for (let batch = 0; batch < batches; batch++) {
        const batchNum = batch + 1;
        const serviceContext = serviceDescription
          ? `\nIMPORTANT CONTEXT: I sell "${serviceDescription}". Find businesses that would most likely NEED this service — look for signs they could benefit from it.`
          : '';

        const prompt = `Find ${batchSize} ${industry} businesses in ${location} (batch ${batchNum} of ${batches} — return DIFFERENT businesses than previous batches).${serviceContext}
        
Return ONLY a JSON array of objects with these fields:
- business_name (string)
- website (valid URL, required — skip businesses without websites)
- location (string)
- rating (number 1-5)
- review_count (number)

Only include real businesses with real websites. No duplicates.`;

        const result = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }]
          }
        });

        const text = result.text;
        if (!text) continue;

        const jsonMatch = text.match(/\[.*\]/s);
        if (!jsonMatch) continue;

        try {
          const leads = JSON.parse(jsonMatch[0]);
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

      const ai = getGenAIClient();
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

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });

      const analysisText = result.text;
      const jsonMatch = analysisText?.match(/\{.*\}/s);

      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
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

        const ai = getGenAIClient();
        const prompt = `Analyze this website for ${lead.business_name} (${lead.industry}): "${textContent}"
Extract JSON: { "services": [], "tone": "string", "pain_points": [], "strengths": [], "contact_email": "or null", "contact_phone": "or null", "company_size": "small|medium|large", "tech_savviness": "low|medium|high" }`;

        const result = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt
        });

        const jsonMatch = result.text?.match(/\{.*\}/s);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
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
      const ai = getGenAIClient();

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

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });

      const jsonMatch = result.text?.match(/\{.*\}/s);
      if (jsonMatch) {
        const emailContent = JSON.parse(jsonMatch[0]);
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

      const ai = getGenAIClient();
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

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });

      const jsonMatch = result.text?.match(/\{.*\}/s);
      if (jsonMatch) {
        const emailContent = JSON.parse(jsonMatch[0]);
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
    const ai = getGenAIClient();

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

        const prompt = `Write a short cold email to ${lead.business_name} (${lead.industry}).
Services: ${JSON.stringify(meta.services || [])}. Pain points: ${JSON.stringify(meta.pain_points || [])}.
Sender: ${senderName} from ${companyName}, selling ${serviceDesc}.
Tone: ${emailTone}. Under 150 words. ${bookingLink ? `CTA: Book call at ${bookingLink}` : 'Soft CTA.'}
Sign off: ${senderName}
Return JSON: { "subject": "...", "body": "..." }`;

        const result = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt
        });

        const jsonMatch = result.text?.match(/\{.*\}/s);
        if (jsonMatch) {
          const emailContent = JSON.parse(jsonMatch[0]);
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
