import express from 'express';
import { Logger } from '../utils/Logger.js';
import { User, Analytics, ApiUsage } from '../models/schemas.js';
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
 * Middleware: Check daily request limit
 */
const checkDailyLimit = async (req, res, next) => {
  try {
    const user = req.user;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get daily usage
    const dailyUsage = await ApiUsage.countDocuments({
      userId: user._id,
      timestamp: { $gte: today }
    });

    // Determine limit based on role
    let dailyLimit = 100; // Default user
    if (user.role === 'premium') dailyLimit = 500;
    if (user.role === 'admin') dailyLimit = 1000;
    if (user.role === 'owner') dailyLimit = Infinity;

    if (dailyUsage >= dailyLimit && dailyLimit !== Infinity) {
      return res.status(429).json({
        error: '⚠️ Daily limit reached',
        role: user.role,
        limit: dailyLimit,
        used: dailyUsage,
        resetAt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      });
    }

    // Store limit info for logging
    req.dailyUsage = dailyUsage;
    req.dailyLimit = dailyLimit;
    next();
  } catch (error) {
    logger.error(`Daily limit check error: ${error.message}`);
    next(); // Continue anyway, don't block
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
 * Generate User Token (Self-service for regular users)
 */
router.post('/generate-user-token', verifyToken, async (req, res) => {
  try {
    const user = req.user;
    const { expiryDays = 30 } = req.body;

    // Users can only generate for themselves
    // Premium users get more features
    let allowedFeatures = ['search', 'proxy'];
    if (user.isPremium || user.role === 'premium') {
      allowedFeatures = ['search', 'proxy', 'analytics', 'whatsapp_send'];
    }
    if (user.role === 'admin' || user.role === 'owner') {
      allowedFeatures = ['search', 'proxy', 'analytics', 'whatsapp_send', 'web_scraper', 'pairing_code'];
    }

    const userToken = uuidv4();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiryDays);

    // Update user with new token
    user.apiKey = userToken;
    user.permissions = allowedFeatures;
    await user.save();

    logger.success(`✅ User token generated for ${user.username}`);

    // Determine daily limit
    let dailyLimit = 100;
    if (user.role === 'premium') dailyLimit = 500;
    if (user.role === 'admin') dailyLimit = 1000;
    if (user.role === 'owner') dailyLimit = Infinity;

    res.json({
      success: true,
      message: '🔑 User token generated',
      userToken,
      username: user.username,
      role: user.role,
      expiryDate,
      expiryDays,
      features: allowedFeatures,
      dailyLimit,
      isPremium: user.isPremium,
      credits: user.credits,
      instruction: `Use this token for API calls: Bearer ${userToken}`,
      apiEndpoints: {
        search: 'GET /api/search?q=...',
        proxy: 'GET /api/proxy/list',
        analytics: 'GET /api/analytics/dashboard',
        whatsapp: 'POST /api/admin/whatsapp-report'
      }
    });

    await Analytics.create({
      userId: user._id,
      type: 'user_action',
      action: 'generate_user_token',
      status: 'success',
      metadata: { expiryDays, features: allowedFeatures }
    });
  } catch (error) {
    logger.error(`Generate user token error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get User Token Info
 */
router.get('/token-info', verifyToken, async (req, res) => {
  try {
    const user = req.user;

    // Determine daily limit
    let dailyLimit = 100;
    if (user.role === 'premium') dailyLimit = 500;
    if (user.role === 'admin') dailyLimit = 1000;
    if (user.role === 'owner') dailyLimit = Infinity;

    // Get today's usage
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyUsage = await ApiUsage.countDocuments({
      userId: user._id,
      timestamp: { $gte: today }
    });

    res.json({
      username: user.username,
      email: user.email,
      role: user.role,
      apiKey: user.apiKey?.substring(0, 8) + '***' + user.apiKey?.substring(user.apiKey?.length - 4),
      permissions: user.permissions,
      dailyLimit,
      dailyUsage,
      remainingRequests: dailyLimit - dailyUsage,
      credits: user.credits,
      isPremium: user.isPremium,
      premiumExpiry: user.premiumExpiry,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    });
  } catch (error) {
    logger.error(`Token info error: ${error.message}`);
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
router.post('/whatsapp-report', verifyToken, checkDailyLimit, async (req, res) => {
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

    // Log API usage
    await ApiUsage.create({
      userId: req.user._id,
      apiKey: req.user.apiKey,
      endpoint: '/admin/whatsapp-report',
      method: 'POST',
      statusCode: 200,
      responseTime: 100,
      requestSize: JSON.stringify(req.body).length,
      responseSize: JSON.stringify(report).length
    });

    logger.success(`✅ WhatsApp report submitted: ${report.referenceId}`);

    res.json({
      success: true,
      message: '📋 WhatsApp report submitted',
      report,
      remainingRequests: req.dailyLimit - (req.dailyUsage + 1),
      creditsRemaining: req.user.credits
    });
  } catch (error) {
    logger.error(`WhatsApp report error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Web Scraper - Admin Only
 */
router.post('/web-scraper', verifyToken, adminOnly, checkDailyLimit, async (req, res) => {
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

      // Log API usage
      await ApiUsage.create({
        userId: req.user._id,
        apiKey: req.user.apiKey,
        endpoint: '/admin/web-scraper',
        method: 'POST',
        statusCode: 200,
        responseTime: 100,
        requestSize: JSON.stringify(req.body).length,
        responseSize: JSON.stringify(data).length
      });

      logger.success(`✅ Scraped ${data.length} records from ${url}`);

      res.json({
        success: true,
        url,
        selector,
        recordsFound: data.length,
        data: data.slice(0, 100), // Return first 100
        remainingRequests: req.dailyLimit - (req.dailyUsage + 1)
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
router.post('/pairing-code-admin', verifyToken, adminOnly, checkDailyLimit, async (req, res) => {
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

    // Log API usage
    await ApiUsage.create({
      userId: req.user._id,
      apiKey: req.user.apiKey,
      endpoint: '/admin/pairing-code-admin',
      method: 'POST',
      statusCode: 200,
      responseTime: 50,
      requestSize: JSON.stringify(req.body).length,
      responseSize: 200
    });

    logger.success(`✅ Pairing code generated: ${referenceId}`);

    res.json({
      success: true,
      message: '📱 Pairing code generated (Admin)',
      referenceId,
      phoneNumber,
      pairingCode,
      expiresIn: '60 seconds',
      instruction: 'Scan this code on your WhatsApp before expiry',
      remainingRequests: req.dailyLimit - (req.dailyUsage + 1)
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

    // Get today's usage
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyUsage = await ApiUsage.countDocuments({
      userId: user._id,
      timestamp: { $gte: today }
    });

    // Determine daily limit
    let dailyLimit = 100;
    if (user.role === 'premium') dailyLimit = 500;
    if (user.role === 'admin') dailyLimit = 1000;
    if (user.role === 'owner') dailyLimit = Infinity;

    res.json({
      valid: true,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      credits: user.credits,
      isPremium: user.isPremium,
      dailyLimit,
      dailyUsage,
      remainingRequests: dailyLimit === Infinity ? 'unlimited' : (dailyLimit - dailyUsage)
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

/**
 * Get Usage Stats
 */
router.get('/usage-stats', verifyToken, async (req, res) => {
  try {
    const user = req.user;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get today's usage
    const dailyUsage = await ApiUsage.countDocuments({
      userId: user._id,
      timestamp: { $gte: today }
    });

    // Get this month's usage
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthlyUsage = await ApiUsage.countDocuments({
      userId: user._id,
      timestamp: { $gte: monthStart }
    });

    // Determine daily limit
    let dailyLimit = 100;
    if (user.role === 'premium') dailyLimit = 500;
    if (user.role === 'admin') dailyLimit = 1000;
    if (user.role === 'owner') dailyLimit = Infinity;

    // Get API usage by endpoint
    const endpointStats = await ApiUsage.aggregate([
      {
        $match: { userId: user._id, timestamp: { $gte: monthStart } }
      },
      {
        $group: {
          _id: '$endpoint',
          calls: { $sum: 1 },
          avgResponseTime: { $avg: '$responseTime' }
        }
      },
      { $sort: { calls: -1 } }
    ]);

    res.json({
      user: user.username,
      role: user.role,
      dailyLimit,
      stats: {
        today: dailyUsage,
        thisMonth: monthlyUsage,
        remainingToday: Math.max(0, dailyLimit - dailyUsage),
        percentageUsed: dailyLimit === Infinity ? 0 : ((dailyUsage / dailyLimit) * 100).toFixed(2)
      },
      byEndpoint: endpointStats,
      resetTime: new Date(today.getTime() + 24 * 60 * 60 * 1000)
    });
  } catch (error) {
    logger.error(`Usage stats error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export const adminRoutes = router;
