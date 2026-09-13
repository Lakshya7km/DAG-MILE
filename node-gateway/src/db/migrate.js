import pool from './index.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');

console.log('🔄 Running database migrations on Neon PostgreSQL...');

async function runMigration() {
  try {
    // 1. Run main schema
    await pool.query(sql);

    // 2. Ensure cloud_url column exists in project_files
    await pool.query(`
      ALTER TABLE project_files 
      ADD COLUMN IF NOT EXISTS cloud_url TEXT;
    `);

    console.log('✅ All tables and cloud storage columns verified in PostgreSQL!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
}

runMigration();