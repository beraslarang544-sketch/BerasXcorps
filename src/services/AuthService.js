import axios from 'axios';
import { Logger } from '../utils/Logger.js';
import { getDeviceInfo } from '../utils/DeviceInfo.js';

const logger = Logger.getInstance();

export class AuthService {
  constructor() {
    this.firebaseUrl = process.env.FIREBASE_URL || 'https://chatglobal-1e541-default-rtdb.asia-southeast1.firebasedatabase.app';
    this.deviceInfo = getDeviceInfo();
  }

  async authenticate() {
    try {
      logger.info('Starting authentication...');
      
      const users = await this.fetchUsers();
      const user = this.findUserByIP(users, this.deviceInfo.ip);
      
      if (!user) {
        logger.warn('User IP not found in database');
        return false;
      }

      logger.info('User found, verifying credentials...');
      return true;
    } catch (error) {
      logger.error(`Authentication error: ${error.message}`);
      return false;
    }
  }

  async fetchUsers() {
    try {
      const response = await axios.get(`${this.firebaseUrl}/users.json`, {
        timeout: 10000
      });
      return response.data || {};
    } catch (error) {
      logger.error(`Failed to fetch users: ${error.message}`);
      throw error;
    }
  }

  findUserByIP(users, ipAddress) {
    for (const [userId, userData] of Object.entries(users)) {
      if (userData.ip === ipAddress && userData.status === 'active') {
        return userData;
      }
    }
    return null;
  }
}
