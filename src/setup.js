#!/usr/bin/env node

import { Logger } from './utils/Logger.js';
import { generateChatTokens } from './utils/TokenManager.js';
import { User } from './models/schemas.js';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const logger = Logger.getInstance();

/**
 * Setup script - Initialize database with admin user
 */
async function setup() {
  try {
    const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017/beras-xcorps';
    await mongoose.connect(mongoUrl);
    logger.success('✅ MongoDB connected');

    // Check if admin exists
    const adminExists = await User.findOne({ role: 'admin' });
    if (adminExists) {
      logger.info('ℹ️ Admin user already exists');
      return;
    }

    // Create default admin
    const hashedPassword = await bcrypt.hash('admin123', 10);
    const admin = new User({
      username: 'admin',
      email: 'admin@berasxcorps.com',
      password: hashedPassword,
      phoneNumber: '628123456789',
      role: 'admin',
      isActive: true,
      credits: 99999,
      maxRequests: 1000,
      permissions: [
        'web_scraper',
        'whatsapp_report',
        'pairing_code',
        'user_management',
        'analytics',
        'proxy_management',
        'token_generation'
      ]
    });

    await admin.save();
    logger.success(`✅ Admin user created`);
    logger.info(`   Username: admin`);
    logger.info(`   Password: admin123`);
    logger.info(`   Email: admin@berasxcorps.com`);

    // Create default user
    const userPassword = await bcrypt.hash('user123', 10);
    const defaultUser = new User({
      username: 'user',
      email: 'user@berasxcorps.com',
      password: userPassword,
      phoneNumber: '628999999999',
      role: 'user',
      isActive: true,
      credits: 1000,
      maxRequests: 100,
      permissions: ['search', 'proxy', 'analytics']
    });

    await defaultUser.save();
    logger.success(`✅ Default user created`);
    logger.info(`   Username: user`);
    logger.info(`   Password: user123`);
    logger.info(`   Email: user@berasxcorps.com`);

    // Generate and display tokens
    await generateChatTokens();

    logger.success('\n✅ Setup complete!');
    process.exit(0);
  } catch (error) {
    logger.error(`Setup error: ${error.message}`);
    process.exit(1);
  }
}

setup();
