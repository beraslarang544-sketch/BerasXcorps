#!/usr/bin/env node

/**
 * CLI Tool for generating user tokens
 * Usage: node src/cli-token-generator.js --username user --role premium
 */

import { Logger } from './utils/Logger.js';
import { User } from './models/schemas.js';
import { generateTokenConfig } from './utils/apiUtils.js';
import mongoose from 'mongoose';
import fs from 'fs/promises';
import path from 'path';

const logger = Logger.getInstance();

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    params[key] = value;
  }

  return params;
}

/**
 * Generate token for user
 */
async function generateUserToken() {
  try {
    const params = parseArgs();
    const { username, role = 'user', expiryDays = 30 } = params;

    if (!username) {
      logger.error('❌ Usage: node src/cli-token-generator.js --username USERNAME [--role ROLE] [--expiryDays DAYS]');
      logger.info('Roles: user, premium, admin, owner');
      process.exit(1);
    }

    const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017/beras-xcorps';
    await mongoose.connect(mongoUrl);
    logger.success('✅ MongoDB connected');

    // Find or create user
    let user = await User.findOne({ username });
    if (!user) {
      logger.warn(`⚠️ User not found, creating: ${username}`);
      user = new User({
        username,
        email: `${username}@berasxcorps.com`,
        password: 'temp123', // Should be changed
        role,
        isActive: true,
        credits: role === 'premium' ? 10000 : role === 'admin' ? 99999 : 100,
        maxRequests: role === 'premium' ? 500 : role === 'admin' ? 1000 : 100
      });
    }

    // Generate token
    const { v4: uuidv4 } = await import('uuid');
    const token = uuidv4();

    user.apiKey = token;
    user.permissions = role === 'admin' ? [
      'web_scraper',
      'whatsapp_report',
      'pairing_code',
      'user_management',
      'analytics',
      'proxy_management'
    ] : role === 'premium' ? [
      'search',
      'proxy',
      'analytics',
      'whatsapp_send'
    ] : ['search', 'proxy'];

    await user.save();
    logger.success(`\n✅ Token generated for ${username}`);
    logger.info(`\nToken: ${token}`);
    logger.info(`Role: ${role}`);
    logger.info(`Daily Limit: ${role === 'owner' ? 'unlimited' : role === 'admin' ? 1000 : role === 'premium' ? 500 : 100}`);
    logger.info(`Features: ${user.permissions.join(', ')}`);

    // Save config file
    const config = generateTokenConfig(token, username, role);
    const filename = `${username}-token-config.txt`;
    await fs.writeFile(filename, config);
    logger.success(`\n📧 Config saved to: ${filename}`);

    process.exit(0);
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

generateUserToken();
