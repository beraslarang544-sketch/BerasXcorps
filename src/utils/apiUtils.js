import axios from 'axios';
import { Logger } from '../utils/Logger.js';
import { ApiUsage } from '../models/schemas.js';

const logger = Logger.getInstance();

/**
 * Middleware: Check and log API usage
 */
export const apiUsageMiddleware = async (req, res, next) => {
  try {
    const startTime = Date.now();

    // Override res.json to log usage
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      const responseTime = Date.now() - startTime;
      const responseSize = JSON.stringify(data).length;

      // Log usage if user is authenticated
      if (req.user) {
        ApiUsage.create({
          userId: req.user._id,
          apiKey: req.user.apiKey,
          endpoint: req.path,
          method: req.method,
          statusCode: res.statusCode,
          responseTime,
          requestSize: req.body ? JSON.stringify(req.body).length : 0,
          responseSize
        }).catch(err => logger.warn(`Failed to log usage: ${err.message}`));
      }

      return originalJson(data);
    };

    next();
  } catch (error) {
    logger.error(`Usage middleware error: ${error.message}`);
    next();
  }
};

/**
 * Download token configuration file for users
 */
export const generateTokenConfig = (token, username, role) => {
  const config = `
# BerasXcorps - Token Configuration
# Generated for: ${username}
# Role: ${role}
# Generated at: ${new Date().toISOString()}

[API]
BASE_URL=http://localhost:3000
TOKEN=${token}
AUTHORIZATION_HEADER=Authorization: Bearer ${token}

[ENDPOINTS]
SEARCH=GET /api/search?q=query&engine=google
PROXY_LIST=GET /api/proxy/list
ANALYTICS=GET /api/analytics/dashboard?userId=YOUR_ID
WHATSAPP_REPORT=POST /api/admin/whatsapp-report
VERIFY_TOKEN=POST /api/admin/verify-script-token

[CURL_EXAMPLES]
SEARCH_EXAMPLE=curl -H "Authorization: Bearer ${token}" "http://localhost:3000/api/search?q=nodejs"
VERIFY_EXAMPLE=curl -X POST http://localhost:3000/api/admin/verify-script-token -H "Content-Type: application/json" -d '{"token": "${token}"}'

[JAVASCRIPT]
const token = '${token}';
const headers = {
  'Authorization': \`Bearer \${token}\`,
  'Content-Type': 'application/json'
};

fetch('http://localhost:3000/api/search?q=test', { headers })
  .then(r => r.json())
  .then(d => console.log(d));

[PYTHON]
import requests

headers = {'Authorization': f'Bearer ${token}'}
response = requests.get('http://localhost:3000/api/search', params={'q': 'test'}, headers=headers)
print(response.json())

[NOTES]
- Keep this token secret
- Token expires in 30 days
- Daily limit: Check your role
- For support: Visit semawur.com
  `;
  return config;
};

/**
 * Rate limiting checker
 */
export const checkRateLimit = async (userId) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailyUsage = await ApiUsage.countDocuments({
      userId,
      timestamp: { $gte: today }
    });

    return {
      dailyUsage,
      isLimited: false,
      remainingRequests: 0
    };
  } catch (error) {
    logger.error(`Rate limit check error: ${error.message}`);
    return { dailyUsage: 0, isLimited: false };
  }
};

/**
 * Validate email format
 */
export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate phone number
 */
export const validatePhoneNumber = (phone) => {
  // Indonesian phone number format
  const phoneRegex = /^(\+62|0)[0-9]{9,12}$/;
  return phoneRegex.test(phone);
};

/**
 * Format response with standard structure
 */
export const formatResponse = (success, message, data = {}) => {
  return {
    success,
    message,
    timestamp: new Date().toISOString(),
    data
  };
};

/**
 * Handle async errors
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
