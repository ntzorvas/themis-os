#!/usr/bin/env node
// Generates an argon2id hash matching the API's ARGON2_OPTIONS.
// Usage: node 02-hash-password.mjs 'DemoSunday2026!'
import argon2 from 'argon2';

const password = process.argv[2];
if (!password) {
  console.error('Usage: node 02-hash-password.mjs <password>');
  process.exit(1);
}

const hash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
});
process.stdout.write(hash);
