import express from 'express';
import { Logger } from '../utils/Logger.js';
import { User, Analytics, Cookie } from '../models/schemas.js';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const logger = Logger.getInstance();
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

/**
 * Middleware: Verify JWT Token
 */
const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '🔐 Token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user || !user.isActive) {
      return res.status(403).json({ error: '❌ User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error(`Token verification error: ${error.message}`);
    res.status(401).json({ error: '🔐 Invalid token' });
  }
};

/**
 * Middleware: Admin only access
 */
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner') {
    return res.status(403).json({ error: '🚫 Admin access required' });
  }
  next();
};

/**
 * Generate Script Access Token (Admin Only)
 */
router.post('/generate-script-token', verifyToken, adminOnly, async (req, res) => {
  try {
    const { targetUserId, features = [], expiryDays = 30 } = req.body;
    
    if (!targetUserId) {
      return res.status(400).json({ error: '❌ targetUserId required' });
    }

    // Verify target user exists
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: '❌ Target user not found' });
    }

    const scriptToken = uuidv4();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiryDays);

    // Store token in user document
    targetUser.apiKey = scriptToken;
    targetUser.permissions = features.length > 0 ? features : ['search', 'proxy'];
    targetUser.lastLogin = new Date();
    await targetUser.save();

    logger.success(`✅ Script token generated for ${targetUser.username}`);
    
    res.json({
      success: true,
      message: '🔑 Script token generated',
      scriptToken,
      targetUser: targetUser.username,
      targetUserId: targetUserId,
      expiryDate,
      features: targetUser.permissions,
      instruction: `User must use this token in Authorization header: Bearer ${scriptToken}`
    });

    // Record analytics
    await Analytics.create({
      userId: req.user._id,
      type: 'admin_action',
      action: 'generate_script_token',
      status: 'success',
      metadata: { targetUser: targetUser.username, features }
    });
  } catch (error) {
    logger.error(`Generate token error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * List all Script Tokens (Admin Only)
 */
router.get('/script-tokens', verifyToken, adminOnly, async (req, res) => {
  try {
    const users = await User.find({ apiKey: { $exists: true, $ne: null } })
      .select('username email role apiKey permissions createdAt')
      .sort({ createdAt: -1 });

    const tokens = users.map(user => ({
      userId: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      token: user.apiKey?.substring(0, 8) + '***' + user.apiKey?.substring(user.apiKey.length - 4),
      permissions: user.permissions,
      createdAt: user.createdAt
    }));

    res.json({
      count: tokens.length,
      tokens
    });
  } catch (error) {
    logger.error(`List tokens error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Revoke Script Token (Admin Only)
 */
router.post('/revoke-token', verifyToken, adminOnly, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: '❌ userId required' });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { apiKey: null, permissions: [] },
      { new: true }
    );

    logger.success(`✅ Token revoked for ${user.username}`);
    
    res.json({
      success: true,
      message: '🗑️ Script token revoked',
      username: user.username
    });

    await Analytics.create({
      userId: req.user._id,
      type: 'admin_action',
      action: 'revoke_script_token',
      status: 'success',
      metadata: { targetUser: user.username }
    });
  } catch (error) {
    logger.error(`Revoke token error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * WhatsApp Report - Admin/Premium Only
 */
router.post('/whatsapp-report', verifyToken, async (req, res) => {
  try {
    // Check permission
    if (req.user.role !== 'admin' && req.user.role !== 'owner' && !req.user.isPremium) {
      return res.status(403).json({ error: '🔐 Premium or Admin access required' });
    }

    if (!req.user.permissions?.includes('whatsapp_report') && req.user.role === 'user') {
      return res.status(403).json({ error: '🚫 WhatsApp report permission denied' });
    }

    const { targetPhone, reason, category } = req.body;
    if (!targetPhone || !reason) {
      return res.status(400).json({ error: '❌ Missing required fields' });
    }

    // Check credits (for non-admin)
    if (req.user.role !== 'admin' && req.user.role !== 'owner') {
      if (req.user.credits < 10) {
        return res.status(400).json({ error: '💳 Insufficient credits (10 required)' });
      }
      req.user.credits -= 10;
      await req.user.save();
    }

    // Simulate WhatsApp report
    const report = {
      id: uuidv4(),
      targetPhone,
      reason,
      category: category || 'spam',
      status: 'submitted',
      timestamp: new Date(),
      submittedBy: req.user.username,
      referenceId: `WR-${Date.now()}`
    };

    // Save report
    await Analytics.create({
      userId: req.user._id,
      type: 'whatsapp_report',
      action: `reported_${targetPhone}`,
      status: 'success',
      metadata: { 
        targetPhone, 
        reason, 
        category,
        referenceId: report.referenceId 
      }
    });

    logger.success(`✅ WhatsApp report submitted: ${report.referenceId}`);

    res.json({
      success: true,
      message: '📋 WhatsApp report submitted',
      report
    });
  } catch (error) {
    logger.error(`WhatsApp report error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Web Scraper - Admin Only
 */
router.post('/web-scraper', verifyToken, adminOnly, async (req, res) => {
  try {
    const { url, selector } = req.body;
    if (!url || !selector) {
      return res.status(400).json({ error: '❌ URL and selector required' });
    }

    const axios = await import('axios');
    const cheerio = await import('cheerio');

    try {
      const response = await axios.default.get(url, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      const elements = $(selector);
      const data = [];

      elements.each((i, el) => {
        data.push($(el).text());
      });

      // Save scraping activity
      await Analytics.create({
        userId: req.user._id,
        type: 'web_scrape',
        action: `scraped_${new URL(url).hostname}`,
        status: 'success',
        dataSize: data.length,
        metadata: { url, selector, recordsFound: data.length }
      });

      logger.success(`✅ Scraped ${data.length} records from ${url}`);

      res.json({
        success: true,
        url,
        selector,
        recordsFound: data.length,
        data: data.slice(0, 100) // Return first 100
      });
    } catch (axiosError) {
      throw new Error(`Failed to fetch URL: ${axiosError.message}`);
    }
  } catch (error) {
    logger.error(`Web scraper error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Pairing Code Sender - Admin Only
 */
router.post('/pairing-code-admin', verifyToken, adminOnly, async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: '❌ Phone number required' });
    }

    // Generate mock pairing code
    const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const referenceId = `PC-${Date.now()}`;

    await Analytics.create({
      userId: req.user._id,
      type: 'pairing_code',
      action: `generated_pairing_code_${phoneNumber}`,
      status: 'success',
      metadata: { phoneNumber, pairingCode, referenceId }
    });

    logger.success(`✅ Pairing code generated: ${referenceId}`);

    res.json({
      success: true,
      message: '📱 Pairing code generated (Admin)',
      referenceId,
      phoneNumber,
      pairingCode,
      expiresIn: '60 seconds',
      instruction: 'Scan this code on your WhatsApp before expiry'
    });
  } catch (error) {
    logger.error(`Pairing code error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Verify Script Token
 */
router.post('/verify-script-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: '🔐 Token required' });
    }

    const user = await User.findOne({ apiKey: token });
    if (!user) {
      return res.status(401).json({ error: '❌ Invalid token' });
    }

    res.json({
      valid: true,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      credits: user.credits,
      isPremium: user.isPremium
    });
  } catch (error) {
    logger.error(`Verify token error: ${error.message}`);
    res.status(401).json({ error: error.message });
  }
});

/**
 * Get Admin Dashboard
 */
router.get('/admin-dashboard', verifyToken, adminOnly, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const premiumUsers = await User.countDocuments({ isPremium: true });
    const totalEvents = await Analytics.countDocuments();
    const todayEvents = await Analytics.countDocuments({ 
      timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } 
    });

    const recentReports = await Analytics.find()
      .sort({ timestamp: -1 })
      .limit(20)
      .populate('userId', 'username email');

    logger.success('✅ Admin dashboard accessed');

    res.json({
      summary: {
        totalUsers,
        premiumUsers,
        totalEvents,
        todayEvents,
        freeUsers: totalUsers - premiumUsers
      },
      recentActivity: recentReports,
      generatedAt: new Date()
    });
  } catch (error) {
    logger.error(`Admin dashboard error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export const adminRoutes = router;
