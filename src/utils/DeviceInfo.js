import axios from 'axios';
import os from 'os';

export async function getDeviceInfo() {
  try {
    const ipResponse = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    const ip = ipResponse.data.ip;
    
    return {
      ip: ip,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      ip: 'Unknown',
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      timestamp: new Date().toISOString()
    };
  }
}
