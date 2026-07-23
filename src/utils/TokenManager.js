import { Logger } from '../utils/Logger.js';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../models/schemas.js';

const logger = Logger.getInstance();

/**
 * Token Manager for admin and user access
 */
export class TokenManager {
  constructor() {
    this.tokens = new Map();
  }

  /**
   * Generate admin token
   */
  generateAdminToken() {
    const token = `ADMIN_${uuidv4()}_${Date.now()}`;
    this.tokens.set(token, {
      type: 'admin',
      features: [
        'web_scraper',
        'whatsapp_report',
        'pairing_code',
        'user_management',
        'analytics',
        'proxy_management',
        'token_generation'
      ],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
    });
    logger.info(`🔑 Admin token generated`);
    return token;
  }

  /**
   * Generate user token with specific features
   */
  generateUserToken(features = []) {
    const allowedFeatures = ['search', 'proxy', 'analytics'];
    const grantedFeatures = features.filter(f => allowedFeatures.includes(f));

    const token = `USER_${uuidv4()}_${Date.now()}`;
    this.tokens.set(token, {
      type: 'user',
      features: grantedFeatures.length > 0 ? grantedFeatures : ['search'],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    });
    logger.info(`🔑 User token generated with features: ${grantedFeatures.join(', ')}`);
    return token;
  }

  /**
   * Verify token
   */
  verifyToken(token) {
    const tokenData = this.tokens.get(token);
    if (!tokenData) {
      return { valid: false, error: '❌ Token not found' };
    }

    if (new Date() > tokenData.expiresAt) {
      this.tokens.delete(token);
      return { valid: false, error: '⏰ Token expired' };
    }

    return { valid: true, data: tokenData };
  }

  /**
   * Revoke token
   */
  revokeToken(token) {
    const deleted = this.tokens.delete(token);
    if (deleted) {
      logger.info(`🗑️ Token revoked`);
    }
    return deleted;
  }

  /**
   * Check if user has permission for feature
   */
  hasPermission(token, feature) {
    const verification = this.verifyToken(token);
    if (!verification.valid) {
      return false;
    }
    return verification.data.features.includes(feature);
  }

  /**
   * Get token info
   */
  getTokenInfo(token) {
    return this.tokens.get(token);
  }
}

/**
 * Generate special tokens for chat
 */
export async function generateChatTokens() {
  const tokens = {
    admin: {
      token: `ADMIN_XCORPS_${uuidv4().substring(0, 8).toUpperCase()}_2026`,
      type: 'ADMIN',
      features: [
        '🔍 Web Scraper',
        '📋 WhatsApp Report',
        '📱 Pairing Code Sender',
        '👥 User Management',
        '📊 Analytics Dashboard',
        '🌐 Proxy Management',
        '🔑 Token Generation'
      ],
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      note: '⚠️ CONFIDENTIAL - Keep this token secret!'
    },
    user: {
      token: `USER_XCORPS_${uuidv4().substring(0, 8).toUpperCase()}_2026`,
      type: 'USER',
      features: [
        '🔍 Web Search',
        '🌐 Proxy Access',
        '📊 Analytics Viewer',
        '📱 WhatsApp Send (Premium)',
        '💳 10,000 Credits'
      ],
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      note: 'Share only with trusted users'
    }
  };

  logger.success('
╔═══════════════════════════════════════════════════════════════╗
║          🎯 BERAS XCORPS v3.0 - SPECIAL TOKENS              ║
╚═══════════════════════════════════════════════════════════════╝
  ');

  logger.info('
🔐 ADMIN TOKEN (استخدم هذا للمسؤولين فقط):
' + tokens.admin.token);
  logger.info('
Admin Features:');
  tokens.admin.features.forEach(f => logger.info(`  ✅ ${f}`));
  logger.info(`Valid Until: ${tokens.admin.validUntil}\n`);

  logger.info('
👤 USER TOKEN (للمستخدمين العاديين):
' + tokens.user.token);
  logger.info('
User Features:');
  tokens.user.features.forEach(f => logger.info(`  ✅ ${f}`));
  logger.info(`Valid Until: ${tokens.user.validUntil}\n`);

  return tokens;
}
