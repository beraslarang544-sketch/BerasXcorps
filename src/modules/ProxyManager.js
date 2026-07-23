import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Logger } from '../utils/Logger.js';

const logger = Logger.getInstance();

export class ProxyManager {
  constructor() {
    this.proxies = [];
    this.agents = new Map();
  }

  async getProxies() {
    try {
      // Initialize with local proxy setup or external proxy list
      const localProxies = await this.setupLocalProxies();
      this.proxies = localProxies;
      return this.proxies;
    } catch (error) {
      logger.error(`Failed to get proxies: ${error.message}`);
      return [];
    }
  }

  async setupLocalProxies() {
    // Setup local proxy using tinyproxy or similar
    // For now, return mock proxies
    const proxyList = [];
    for (let i = 0; i < 5; i++) {
      proxyList.push(`127.0.0.1:${8888 + i}`);
    }
    return proxyList;
  }

  getAgent(proxy) {
    if (!this.agents.has(proxy)) {
      const httpAgent = new HttpProxyAgent(`http://${proxy}`);
      const httpsAgent = new HttpsProxyAgent(`http://${proxy}`);
      this.agents.set(proxy, { httpAgent, httpsAgent });
    }
    return this.agents.get(proxy);
  }

  async validateProxy(proxy) {
    try {
      const response = await axios.get('http://httpbin.org/ip', {
        timeout: 5000,
        httpAgent: this.getAgent(proxy).httpAgent,
        httpsAgent: this.getAgent(proxy).httpsAgent
      });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }
}
