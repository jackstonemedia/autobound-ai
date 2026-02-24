import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('leads.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

export function initDB() {
  // Leads table
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_name TEXT NOT NULL,
      website TEXT,
      industry TEXT,
      location TEXT,
      rating REAL,
      review_count INTEGER,
      phone TEXT,
      email TEXT,
      status TEXT DEFAULT 'new',
      lead_score REAL DEFAULT 0,
      follow_up_count INTEGER DEFAULT 0,
      next_follow_up TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      direction TEXT NOT NULL,
      content TEXT NOT NULL,
      intent TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE
    )
  `);

  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_website ON leads(website)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(lead_score)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_lead_id ON messages(lead_id)`);

  // Add columns if they don't exist (for existing DBs)
  try { db.exec(`ALTER TABLE leads ADD COLUMN follow_up_count INTEGER DEFAULT 0`); } catch { }
  try { db.exec(`ALTER TABLE leads ADD COLUMN next_follow_up TEXT`); } catch { }

  console.log('Database initialized at', dbPath);
}

export default db;
