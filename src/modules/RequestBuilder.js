import { faker } from '@faker-js/faker';
import { Logger } from '../utils/Logger.js';

const logger = Logger.getInstance();

export class RequestBuilder {
  constructor() {
    this.messages = [
      (pn) => `Number [+62${pn}] is performing excessive SPAM using bot, please give warning immediately!`,
      (pn) => `Number [+62${pn}] is misusing WhatsApp with modified bot sending crash bugs to my number. Please check and take action!`,
      (pn) => `Number [+62${pn}] is performing unauthorized actions, sending messages that corrupted my WhatsApp. Please investigate!`
    ];
  }

  buildReport(phoneNumber) {
    const url = 'https://www.whatsapp.com/contact/noclient/async/new/';
    
    const headers = {
      'authority': 'www.whatsapp.com',
      'accept': '/',
      'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'content-type': 'application/x-www-form-urlencoded',
      'origin': 'https://www.whatsapp.com',
      'referer': 'https://www.whatsapp.com/contact/?subject=messenger',
      'user-agent': this.generateUserAgent(),
      'sec-ch-ua': this.generateSecChUA(),
      'sec-ch-ua-mobile': Math.random() > 0.5 ? '?0' : '?1',
      'sec-ch-ua-platform': this.randomPlatform()
    };

    const data = {
      'country_selector': 'ID',
      'email': this.generateEmail(),
      'email_confirm': this.generateEmail(),
      'phone_number': phoneNumber,
      'platform': this.randomPlatform(),
      'your_message': this.getRandomMessage(phoneNumber),
      'step': 'submit'
    };

    return { url, headers, data };
  }

  generateUserAgent() {
    const agents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15'
    ];
    return agents[Math.floor(Math.random() * agents.length)];
  }

  generateSecChUA() {
    const brands = ['Not-A.Brand', 'Chromium', 'Google Chrome'];
    const version = Math.floor(Math.random() * (124 - 90 + 1)) + 90;
    return `"${brands[Math.floor(Math.random() * brands.length)]}";v="${version}"`;
  }

  randomPlatform() {
    const platforms = ['WHATS_APP_WEB_DESKTOP', 'WHATS_APP_ANDROID', 'WHATS_APP_IOS'];
    return platforms[Math.floor(Math.random() * platforms.length)];
  }

  generateEmail() {
    const randomString = Math.random().toString(36).substring(2, 10);
    return `${randomString}@tempmail.com`;
  }

  getRandomMessage(phoneNumber) {
    const messageTemplate = this.messages[Math.floor(Math.random() * this.messages.length)];
    return messageTemplate(phoneNumber);
  }
}
