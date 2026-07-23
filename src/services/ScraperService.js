import axios from 'axios';
import { Logger } from '../utils/Logger.js';
import { ProxyManager } from '../modules/ProxyManager.js';
import { RequestBuilder } from '../modules/RequestBuilder.js';
import { RateLimiter } from '../modules/RateLimiter.js';

const logger = Logger.getInstance();

export class ScraperService {
  constructor() {
    this.proxyManager = new ProxyManager();
    this.requestBuilder = new RequestBuilder();
    this.rateLimiter = new RateLimiter(10); // 10 hours limit
  }

  async processTarget(phoneNumber) {
    try {
      logger.info(`Processing target: +62${phoneNumber}`);
      
      // Check rate limit
      const canProcess = await this.rateLimiter.canProcess(phoneNumber);
      if (!canProcess) {
        const waitTime = await this.rateLimiter.getWaitTime(phoneNumber);
        logger.warn(`Rate limited. Wait ${waitTime} more minutes.`);
        return;
      }

      // Get proxies
      const proxies = await this.proxyManager.getProxies();
      if (proxies.length === 0) {
        logger.error('No proxies available');
        return;
      }

      logger.info(`Using ${proxies.length} proxies`);
      
      // Execute requests with concurrency
      await this.executeRequests(phoneNumber, proxies);
      
      // Mark as processed
      await this.rateLimiter.markProcessed(phoneNumber);
    } catch (error) {
      logger.error(`Service error: ${error.message}`);
    }
  }

  async executeRequests(phoneNumber, proxies) {
    const requests = proxies.map(proxy => 
      this.sendRequest(phoneNumber, proxy)
    );
    
    const results = await Promise.allSettled(requests);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    logger.info(`Completed: ${successful}/${results.length} requests successful`);
  }

  async sendRequest(phoneNumber, proxy) {
    try {
      const request = this.requestBuilder.buildReport(phoneNumber);
      const response = await axios.post(request.url, request.data, {
        headers: request.headers,
        timeout: 10000,
        httpAgent: this.proxyManager.getAgent(proxy),
        httpsAgent: this.proxyManager.getAgent(proxy)
      });
      
      logger.info(`[${response.status}] Request for +62${phoneNumber} sent`);
      return response;
    } catch (error) {
      logger.error(`Request failed: ${error.message}`);
      throw error;
    }
  }
}
