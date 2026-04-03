import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'backend', 'fra_atlas.db');
const db = new Database(dbPath);

try {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('admin@fra.gov.in');
  if (user) {
    console.log('User found:', JSON.stringify({ ...user, password: '[REDACTED]' }, null, 2));
  } else {
    console.log('User admin@fra.gov.in not found in the database.');
    
    // List all users to see what's there
    const allUsers = db.prepare('SELECT id, email, role FROM users LIMIT 10').all();
    console.log('Sample users:', JSON.stringify(allUsers, null, 2));
  }
} catch (err) {
  console.error('Error querying database:', err);
} finally {
  db.close();
}
