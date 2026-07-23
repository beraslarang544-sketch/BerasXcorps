import fs from 'fs/promises';
import path from 'path';
import { Logger } from '../utils/Logger.js';

const logger = Logger.getInstance();

export class RateLimiter {
  constructor(limitHours = 10) {
    this.limitHours = limitHours;
    this.logFile = 'rate_limit.json';
    this.cache = {};
  }

  async canProcess(identifier) {
    try {
      await this.loadLogs();
      
      if (!this.cache[identifier]) {
        return true; // First time processing
      }

      const lastProcessed = new Date(this.cache[identifier]);
      const now = new Date();
      const diffMs = now - lastProcessed;
      const diffHours = diffMs / (1000 * 60 * 60);

      return diffHours >= this.limitHours;
    } catch (error) {
      logger.error(`Rate limiter error: ${error.message}`);
      return false;
    }
  }

  async getWaitTime(identifier) {
    if (!this.cache[identifier]) return 0;
    
    const lastProcessed = new Date(this.cache[identifier]);
    const now = new Date();
    const diffMs = now - lastProcessed;
    const diffMinutes = Math.ceil((this.limitHours * 60 * 60 * 1000 - diffMs) / (1000 * 60));
    
    return Math.max(0, diffMinutes);
  }

  async markProcessed(identifier) {
    this.cache[identifier] = new Date().toISOString();
    await this.saveLogs();
  }

  async loadLogs() {
    try {
      const data = await fs.readFile(this.logFile, 'utf-8');
      this.cache = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet
      this.cache = {};
    }
  }

  async saveLogs() {
    try {
      await fs.writeFile(this.logFile, JSON.stringify(this.cache, null, 2));
    } catch (error) {
      logger.error(`Failed to save logs: ${error.message}`);
    }
  }
}
