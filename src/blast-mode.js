#!/usr/bin/env node

import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { createReadStream } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { createInterface } from 'readline';
import axios from 'axios';
import Queue from 'bull';
import Redis from 'redis';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 🔥 BLAST MODE - Mass WhatsApp Automation
 * 
 * Features:
 * - Pairing code generation (batch)
 * - WhatsApp reports (mass submission)
 * - Proxy rotation with validation
 * - Rate limiting with smart delays
 * - Progress tracking & analytics
 * - Error recovery & retry logic
 */

class BlastMode {
  constructor() {
    this.config = {
      mode: null,
      batchSize: 10,
      delay: 1000,
      maxRetries: 3,
      timeout: 15000,
      proxyRotation: true,
      enableAnalytics: true,
      maxConcurrent: 5,
    };
    
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      retried: 0,
      startTime: null,
      endTime: null,
      proxiesUsed: new Set(),
      errors: [],
    };

    this.proxies = [];
    this.phoneNumbers = [];
  }

  async init() {
    console.clear();
    console.log(chalk.bold.cyan(`
    ╔════════════════════════════════════════════╗
    ║     🔥 BLAST MODE v3.2.0 - BerasXcorps    ║
    ║   Mass WhatsApp Automation Platform        ║
    ╚════════════════════════════════════════════╝
    `));

    await this.selectMode();
  }

  async selectMode() {
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: chalk.cyan('Select Blast Mode:'),
        choices: [
          { name: '📱 Pairing Code Generator (Batch)', value: 'pairing' },
          { name: '📨 WhatsApp Report Blaster', value: 'report' },
          { name: '🔄 Proxy Validator', value: 'proxy' },
          { name: '📊 Analytics & Stats', value: 'stats' },
          { name: '⚙️ Configuration', value: 'config' },
        ],
      },
    ]);

    this.config.mode = answers.mode;

    switch (answers.mode) {
      case 'pairing':
        await this.pairingCodeBlast();
        break;
      case 'report':
        await this.reportBlast();
        break;
      case 'proxy':
        await this.proxyValidator();
        break;
      case 'stats':
        await this.showStats();
        break;
      case 'config':
        await this.configureSettings();
        break;
    }
  }

  async pairingCodeBlast() {
    console.log(chalk.bold.yellow('\n📱 PAIRING CODE GENERATOR - BLAST MODE\n'));

    const config = await inquirer.prompt([
      {
        type: 'input',
        name: 'inputFile',
        message: 'Phone list file (e.g., phones.txt):',
        default: 'phones.txt',
        validate: (input) => input.trim().length > 0 ? true : 'File name required',
      },
      {
        type: 'number',
        name: 'batchSize',
        message: 'Batch size (concurrent requests):',
        default: 10,
        validate: (input) => input >= 1 && input <= 100 ? true : 'Must be 1-100',
      },
      {
        type: 'number',
        name: 'delay',
        message: 'Delay between requests (ms):',
        default: 1000,
      },
      {
        type: 'confirm',
        name: 'proxyRotation',
        message: 'Enable proxy rotation?',
        default: true,
      },
      {
        type: 'number',
        name: 'maxRetries',
        message: 'Max retries per request:',
        default: 3,
      },
    ]);

    Object.assign(this.config, config);

    try {
      // Load phone numbers
      const spinner = ora('Loading phone numbers...').start();
      this.phoneNumbers = await this.loadPhoneList(config.inputFile);
      spinner.succeed(`✅ Loaded ${this.phoneNumbers.length} phone numbers`);

      // Load proxies if enabled
      if (this.config.proxyRotation) {
        const proxySpinner = ora('Loading proxies...').start();
        this.proxies = await this.loadProxyList();
        proxySpinner.succeed(`✅ Loaded ${this.proxies.length} proxies`);
      }

      // Start blast
      await this.executePairingBlast();
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      process.exit(1);
    }
  }

  async executePairingBlast() {
    this.stats.total = this.phoneNumbers.length;
    this.stats.startTime = new Date();

    console.log(chalk.bold.green(`\n🚀 Starting Pairing Code Blast...`));
    console.log(chalk.gray(`   Total: ${this.stats.total} numbers`));
    console.log(chalk.gray(`   Batch Size: ${this.config.batchSize}`));
    console.log(chalk.gray(`   Delay: ${this.config.delay}ms`));
    console.log();

    const batches = this.chunkArray(this.phoneNumbers, this.config.batchSize);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(chalk.cyan(`\n📦 Batch ${i + 1}/${batches.length}`));

      const promises = batch.map((phone, idx) =>
        this.sendPairingCode(phone, i * this.config.batchSize + idx)
      );

      await Promise.allSettled(promises);
      
      if (i < batches.length - 1) {
        await this.sleep(this.config.delay);
      }
    }

    await this.finishBlast();
  }

  async sendPairingCode(phoneNumber, index) {
    const spinner = ora(`[${index + 1}/${this.stats.total}] Sending pairing code to +${phoneNumber}`).start();
    let lastError;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const proxy = this.config.proxyRotation 
          ? this.proxies[Math.floor(Math.random() * this.proxies.length)]
          : null;

        const payload = {
          phoneNumber: phoneNumber,
          timestamp: new Date().toISOString(),
          requestId: uuidv4(),
        };

        // Simulate API call with retry logic
        const response = await this.callPairingCodeAPI(payload, proxy);

        if (response.success) {
          spinner.succeed(chalk.green(`✅ +${phoneNumber} → Code: ${response.pairingCode}`));
          this.stats.success++;
          this.stats.proxiesUsed.add(proxy);
          return { success: true, phoneNumber, pairingCode: response.pairingCode };
        }
      } catch (error) {
        lastError = error;
        if (attempt < this.config.maxRetries) {
          this.stats.retried++;
          spinner.text = `[${index + 1}/${this.stats.total}] Retrying +${phoneNumber} (attempt ${attempt + 2}/${this.config.maxRetries + 1})`;
          await this.sleep(500 * (attempt + 1));
        }
      }
    }

    spinner.fail(chalk.red(`❌ +${phoneNumber} → Failed: ${lastError?.message}`));
    this.stats.failed++;
    this.stats.errors.push({ phoneNumber, error: lastError?.message });
    return { success: false, phoneNumber, error: lastError?.message };
  }

  async reportBlast() {
    console.log(chalk.bold.yellow('\n📨 WHATSAPP REPORT BLASTER - BLAST MODE\n'));

    const config = await inquirer.prompt([
      {
        type: 'input',
        name: 'inputFile',
        message: 'Target phone list file (e.g., targets.txt):',
        default: 'targets.txt',
      },
      {
        type: 'list',
        name: 'category',
        message: 'Report category:',
        choices: [
          { name: '🚫 Spam', value: 'spam' },
          { name: '🔞 Inappropriate Content', value: 'inappropriate' },
          { name: '🐛 Scam/Phishing', value: 'scam' },
          { name: '💬 Harassment', value: 'harassment' },
        ],
      },
      {
        type: 'number',
        name: 'reportsPerNumber',
        message: 'Reports per number:',
        default: 5,
        validate: (input) => input >= 1 && input <= 50 ? true : 'Must be 1-50',
      },
      {
        type: 'number',
        name: 'batchSize',
        message: 'Concurrent requests:',
        default: 5,
      },
      {
        type: 'confirm',
        name: 'proxyRotation',
        message: 'Use proxy rotation?',
        default: true,
      },
    ]);

    Object.assign(this.config, config);

    try {
      const spinner = ora('Loading target numbers...').start();
      this.phoneNumbers = await this.loadPhoneList(config.inputFile);
      spinner.succeed(`✅ Loaded ${this.phoneNumbers.length} targets`);

      if (this.config.proxyRotation) {
        const proxySpinner = ora('Loading proxies...').start();
        this.proxies = await this.loadProxyList();
        proxySpinner.succeed(`✅ Loaded ${this.proxies.length} proxies`);
      }

      await this.executeReportBlast(config);
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      process.exit(1);
    }
  }

  async executeReportBlast(config) {
    this.stats.total = this.phoneNumbers.length * config.reportsPerNumber;
    this.stats.startTime = new Date();

    console.log(chalk.bold.green(`\n🚀 Starting Report Blast...`));
    console.log(chalk.gray(`   Targets: ${this.phoneNumbers.length}`));
    console.log(chalk.gray(`   Reports/Target: ${config.reportsPerNumber}`));
    console.log(chalk.gray(`   Total Reports: ${this.stats.total}`));
    console.log(chalk.gray(`   Category: ${config.category}`));
    console.log();

    let count = 0;
    for (const phoneNumber of this.phoneNumbers) {
      for (let i = 0; i < config.reportsPerNumber; i++) {
        count++;
        await this.submitReport(phoneNumber, config.category, count);
        await this.sleep(this.config.delay);
      }
    }

    await this.finishBlast();
  }

  async submitReport(phoneNumber, category, index) {
    const spinner = ora(`[${index}/${this.stats.total}] Submitting report for +${phoneNumber}`).start();

    try {
      const proxy = this.config.proxyRotation
        ? this.proxies[Math.floor(Math.random() * this.proxies.length)]
        : null;

      const payload = {
        phoneNumber,
        category,
        reason: this.generateReason(category),
        timestamp: new Date().toISOString(),
        requestId: uuidv4(),
      };

      const response = await this.callReportAPI(payload, proxy);

      if (response.success) {
        spinner.succeed(chalk.green(`✅ Report #${index} submitted → Ref: ${response.referenceId}`));
        this.stats.success++;
        this.stats.proxiesUsed.add(proxy);
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      if (this.config.maxRetries > 0) {
        this.stats.retried++;
        spinner.text = `[${index}/${this.stats.total}] Retrying +${phoneNumber}...`;
        await this.sleep(500);
        // Retry logic
      } else {
        spinner.fail(chalk.red(`❌ Report #${index} failed: ${error.message}`));
        this.stats.failed++;
        this.stats.errors.push({ phoneNumber, error: error.message });
      }
    }
  }

  async proxyValidator() {
    console.log(chalk.bold.yellow('\n🔄 PROXY VALIDATOR\n'));

    const config = await inquirer.prompt([
      {
        type: 'input',
        name: 'proxyFile',
        message: 'Proxy list file (e.g., proxies.txt):',
        default: 'proxies.txt',
      },
      {
        type: 'number',
        name: 'testTimeout',
        message: 'Test timeout (ms):',
        default: 5000,
      },
      {
        type: 'number',
        name: 'concurrent',
        message: 'Concurrent tests:',
        default: 20,
      },
    ]);

    this.stats.startTime = new Date();

    try {
      const spinner = ora('Loading proxies...').start();
      this.proxies = await this.loadProxyList(config.proxyFile);
      spinner.succeed(`✅ Loaded ${this.proxies.length} proxies`);

      console.log(chalk.bold.green(`\n🧪 Testing proxies...\n`));

      const batches = this.chunkArray(this.proxies, config.concurrent);
      let validProxies = [];

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const promises = batch.map((proxy, idx) =>
          this.testProxy(proxy, i * config.concurrent + idx, config.testTimeout)
        );

        const results = await Promise.allSettled(promises);
        validProxies = validProxies.concat(
          results
            .filter(r => r.status === 'fulfilled' && r.value.valid)
            .map(r => r.value.proxy)
        );
      }

      this.stats.success = validProxies.length;
      this.stats.failed = this.proxies.length - validProxies.length;

      console.log(chalk.bold.cyan(`\n📊 Results:`));
      console.log(chalk.green(`✅ Valid: ${validProxies.length}`));
      console.log(chalk.red(`❌ Invalid: ${this.stats.failed}`));
      console.log(chalk.blue(`📈 Success Rate: ${((validProxies.length / this.proxies.length) * 100).toFixed(2)}%`));

      // Save valid proxies
      await writeFile('proxies_valid.txt', validProxies.join('\n'));
      console.log(chalk.yellow(`\n💾 Valid proxies saved to: proxies_valid.txt`));
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
    }
  }

  async testProxy(proxy, index, timeout) {
    const spinner = ora(`[${index}] Testing ${proxy}...`).start();

    try {
      const testUrl = 'http://httpbin.org/ip';
      const response = await axios.get(testUrl, {
        httpAgent: new (await import('http')).Agent({ 
          timeout,
          setHost: false,
          host: proxy.split(':')[0],
          port: proxy.split(':')[1],
        }),
        timeout,
      });

      if (response.status === 200) {
        spinner.succeed(chalk.green(`✅ ${proxy} → Working`));
        return { valid: true, proxy };
      }
    } catch (error) {
      spinner.fail(chalk.red(`❌ ${proxy} → Failed`));
    }

    return { valid: false, proxy };
  }

  async configureSettings() {
    console.log(chalk.bold.yellow('\n⚙️ BLAST MODE CONFIGURATION\n'));

    const answers = await inquirer.prompt([
      {
        type: 'number',
        name: 'batchSize',
        message: 'Default batch size:',
        default: this.config.batchSize,
      },
      {
        type: 'number',
        name: 'delay',
        message: 'Default delay (ms):',
        default: this.config.delay,
      },
      {
        type: 'number',
        name: 'maxRetries',
        message: 'Max retries:',
        default: this.config.maxRetries,
      },
      {
        type: 'number',
        name: 'timeout',
        message: 'Request timeout (ms):',
        default: this.config.timeout,
      },
      {
        type: 'confirm',
        name: 'enableAnalytics',
        message: 'Enable analytics?',
        default: this.config.enableAnalytics,
      },
    ]);

    Object.assign(this.config, answers);

    console.log(chalk.bold.green('\n✅ Configuration updated!'));
    console.log(chalk.gray(JSON.stringify(this.config, null, 2)));

    const continueChoice = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continue',
        message: 'Return to main menu?',
        default: true,
      },
    ]);

    if (continueChoice.continue) {
      await this.init();
    }
  }

  async showStats() {
    console.log(chalk.bold.cyan(`\n📊 BLAST MODE STATISTICS\n`));
    
    if (!this.stats.startTime) {
      console.log(chalk.yellow('No blast has been executed yet.'));
      return;
    }

    const duration = this.stats.endTime - this.stats.startTime;
    const durationSeconds = (duration / 1000).toFixed(2);
    const successRate = ((this.stats.success / this.stats.total) * 100).toFixed(2);

    console.log(chalk.cyan('═══════════════════════════════════════'));
    console.log(chalk.white(`Total Requests:     ${this.stats.total}`));
    console.log(chalk.green(`✅ Successful:       ${this.stats.success}`));
    console.log(chalk.red(`❌ Failed:           ${this.stats.failed}`));
    console.log(chalk.yellow(`🔄 Retried:         ${this.stats.retried}`));
    console.log(chalk.blue(`Success Rate:       ${successRate}%`));
    console.log(chalk.magenta(`Duration:           ${durationSeconds}s`));
    console.log(chalk.cyan(`Avg Speed:          ${(this.stats.total / parseFloat(durationSeconds)).toFixed(2)} req/s`));
    console.log(chalk.cyan(`Proxies Used:       ${this.stats.proxiesUsed.size}`));
    console.log(chalk.cyan('═══════════════════════════════════════\n'));

    if (this.stats.errors.length > 0) {
      console.log(chalk.red(`\nErrors encountered (${this.stats.errors.length}):`));
      this.stats.errors.slice(0, 5).forEach((err, idx) => {
        console.log(chalk.gray(`  ${idx + 1}. ${err.phoneNumber}: ${err.error}`));
      });
      if (this.stats.errors.length > 5) {
        console.log(chalk.gray(`  ... and ${this.stats.errors.length - 5} more`));
      }
    }
  }

  async finishBlast() {
    this.stats.endTime = new Date();
    
    console.log(chalk.bold.green('\n\n✅ BLAST COMPLETED!\n'));
    await this.showStats();

    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'saveReport',
        message: 'Save report to file?',
        default: true,
      },
    ]);

    if (answers.saveReport) {
      await this.saveReport();
    }

    const continueChoice = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continue',
        message: 'Return to main menu?',
        default: true,
      },
    ]);

    if (continueChoice.continue) {
      await this.init();
    }
  }

  async saveReport() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `blast_report_${timestamp}.json`;

    const report = {
      timestamp: new Date().toISOString(),
      mode: this.config.mode,
      statistics: this.stats,
      configuration: this.config,
    };

    await writeFile(filename, JSON.stringify(report, null, 2));
    console.log(chalk.green(`\n📄 Report saved: ${filename}`));
  }

  // ==================== HELPER METHODS ====================

  async loadPhoneList(filename) {
    return new Promise((resolve, reject) => {
      const phones = [];
      const rl = createInterface({
        input: createReadStream(filename),
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        const cleaned = line.trim().replace(/[^\d]/g, '');
        if (cleaned.length >= 9) {
          phones.push(cleaned);
        }
      });

      rl.on('close', () => {
        if (phones.length === 0) {
          reject(new Error(`No valid phone numbers found in ${filename}`));
        }
        resolve(phones);
      });

      rl.on('error', reject);
    });
  }

  async loadProxyList(filename = 'proxies.txt') {
    try {
      const content = await readFile(filename, 'utf-8');
      return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && line.includes(':'));
    } catch {
      return [];
    }
  }

  async callPairingCodeAPI(payload, proxy) {
    // Mock API call - replace with actual endpoint
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: Math.random() > 0.1, // 90% success rate
          pairingCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
        });
      }, 500);
    });
  }

  async callReportAPI(payload, proxy) {
    // Mock API call - replace with actual endpoint
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: Math.random() > 0.15, // 85% success rate
          referenceId: `REP-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        });
      }, 800);
    });
  }

  generateReason(category) {
    const reasons = {
      spam: 'Excessive spam and unwanted messages',
      inappropriate: 'Sharing inappropriate content',
      scam: 'Phishing and scam attempts',
      harassment: 'Harassment and bullying',
    };
    return reasons[category] || 'Violation of terms of service';
  }

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main execution
const blast = new BlastMode();
blast.init().catch(error => {
  console.error(chalk.red(`\n❌ Fatal Error: ${error.message}`));
  process.exit(1);
});
