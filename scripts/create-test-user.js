#!/usr/bin/env node
/**
 * Creates a verified test user locally (bypasses email verification)
 * Usage: node scripts/create-test-user.js [email] [username] [password]
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db-wrapper');

async function createTestUser(email, username, password) {
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(password, 10);

  // Check if user already exists
  const existing = await db.prepare('SELECT id, email FROM users WHERE email = ? OR username = ?').get(email, username);
  if (existing) {
    console.log(`User already exists with email ${existing.email}`);
    // Just verify them if they exist
    await db.prepare(`
      UPDATE users
      SET account_status = 'active',
          email_verification_code_hash = NULL,
          email_verification_expires_at = NULL
      WHERE id = ?
    `).run(existing.id);
    console.log(`User ${existing.email} has been verified.`);
    await db.close();
    return;
  }

  // Create new verified user
  const result = await db.prepare(`
    INSERT INTO users (email, username, password_hash, created_at, account_status, is_admin)
    VALUES (?, ?, ?, ?, 'active', 0)
  `).run(email, username, passwordHash, now);

  console.log(`Created verified test user:`);
  console.log(`  ID: ${result.lastInsertRowid}`);
  console.log(`  Email: ${email}`);
  console.log(`  Username: ${username}`);
  console.log(`  Password: ${password}`);
  console.log(`  Status: active (verified)`);

  await db.close();
}

// Default test user credentials
const email = process.argv[2] || 'test@test.com';
const username = process.argv[3] || 'testuser';
const password = process.argv[4] || 'test123';

createTestUser(email, username, password).catch(err => {
  console.error('Error creating test user:', err);
  process.exit(1);
});
