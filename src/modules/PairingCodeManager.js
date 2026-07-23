import fs from 'fs/promises';
import path from 'path';
import { Logger } from '../utils/Logger.js';

const logger = Logger.getInstance();

export class PairingCodeManager {
  constructor() {
    this.pairingCodesFile = 'pairing_codes.json';
    this.codesCache = {};
    this.initializeStorage();
  }

  async initializeStorage() {
    try {
      await fs.mkdir('data', { recursive: true });
      await fs.mkdir('auth_sessions', { recursive: true });
      
      const filePath = path.join('data', this.pairingCodesFile);
      try {
        const data = await fs.readFile(filePath, 'utf-8');
        this.codesCache = JSON.parse(data);
        logger.info('📂 Pairing codes loaded from storage');
      } catch (error) {
        this.codesCache = {};
      }
    } catch (error) {
      logger.error(`Storage initialization error: ${error.message}`);
    }
  }

  async savePairingCode(phoneNumber, pairingCode) {
    try {
      this.codesCache[phoneNumber] = {
        code: pairingCode,
        timestamp: new Date().toISOString(),
        status: 'pending'
      };

      const filePath = path.join('data', this.pairingCodesFile);
      await fs.writeFile(filePath, JSON.stringify(this.codesCache, null, 2));
      
      logger.success(`💾 Pairing code saved for ${phoneNumber}`);
      return true;
    } catch (error) {
      logger.error(`Save pairing code error: ${error.message}`);
      return false;
    }
  }

  async getPairingCode(phoneNumber) {
    try {
      if (this.codesCache[phoneNumber]) {
        return this.codesCache[phoneNumber];
      }

      const filePath = path.join('data', this.pairingCodesFile);
      const data = await fs.readFile(filePath, 'utf-8');
      const codes = JSON.parse(data);
      return codes[phoneNumber] || null;
    } catch (error) {
      logger.error(`Get pairing code error: ${error.message}`);
      return null;
    }
  }

  async updatePairingStatus(phoneNumber, status) {
    try {
      if (this.codesCache[phoneNumber]) {
        this.codesCache[phoneNumber].status = status;
        this.codesCache[phoneNumber].updated = new Date().toISOString();

        const filePath = path.join('data', this.pairingCodesFile);
        await fs.writeFile(filePath, JSON.stringify(this.codesCache, null, 2));
        
        logger.info(`🔄 Pairing status updated: ${phoneNumber} -> ${status}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Update status error: ${error.message}`);
      return false;
    }
  }

  async getAllPairingCodes() {
    try {
      return this.codesCache;
    } catch (error) {
      logger.error(`Get all codes error: ${error.message}`);
      return {};
    }
  }

  async deletePairingCode(phoneNumber) {
    try {
      delete this.codesCache[phoneNumber];
      
      const filePath = path.join('data', this.pairingCodesFile);
      await fs.writeFile(filePath, JSON.stringify(this.codesCache, null, 2));
      
      logger.info(`🗑️ Pairing code deleted for ${phoneNumber}`);
      return true;
    } catch (error) {
      logger.error(`Delete pairing code error: ${error.message}`);
      return false;
    }
  }

  async cleanExpiredCodes(expiryHours = 24) {
    try {
      const now = new Date();
      const expiredCodes = [];

      for (const [phone, data] of Object.entries(this.codesCache)) {
        const createdTime = new Date(data.timestamp);
        const diffHours = (now - createdTime) / (1000 * 60 * 60);

        if (diffHours > expiryHours && data.status !== 'completed') {
          delete this.codesCache[phone];
          expiredCodes.push(phone);
        }
      }

      if (expiredCodes.length > 0) {
        const filePath = path.join('data', this.pairingCodesFile);
        await fs.writeFile(filePath, JSON.stringify(this.codesCache, null, 2));
        logger.info(`🧹 Cleaned ${expiredCodes.length} expired codes`);
      }

      return expiredCodes;
    } catch (error) {
      logger.error(`Clean expired codes error: ${error.message}`);
      return [];
    }
  }
}
