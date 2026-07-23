# BerasXcorps v2.0 - Node.js Edition

> Modern web scraping, automation, and WhatsApp integration tool built with Node.js + Baileys

## 🎯 Features

- **Web Scraping**: Advanced HTTP client with proxy support
- **WhatsApp Integration**: Baileys-based WhatsApp automation
- **Pairing Code Sender**: Modern pairing code-based WhatsApp connection
- **Bulk Messaging**: Send messages to multiple recipients
- **Modular Architecture**: Clean separation of concerns
- **Rate Limiting**: Built-in request throttling
- **Proxy Management**: Automatic proxy rotation
- **Firebase Integration**: User authentication and data sync
- **Comprehensive Logging**: File and console logging
- **REST API**: Full-featured API for external integration
- **Session Management**: Multiple WhatsApp session management
- **Error Handling**: Robust error management

## 📋 Requirements

- Node.js >= 18.0.0
- npm or yarn
- WhatsApp account for pairing

## 🔧 Installation

```bash
# Clone repository
git clone https://github.com/beraslarang544-sketch/BerasXcorps.git
cd BerasXcorps

# Install dependencies
npm install

# Setup environment
cp .env.example .env
```

## 🚀 Usage

### CLI Mode

```bash
# Run application
npm start

# Development mode with auto-reload
npm run dev
```

### WhatsApp Pairing

1. Select option "1. Get Pairing Code"
2. Enter your phone number
3. Scan the pairing code on your WhatsApp
4. Wait for connection confirmation

### Send Messages

1. Select option "2. Send Message"
2. Enter sender phone number
3. Enter recipient phone number
4. Type your message
5. Message will be sent via Baileys

### API Mode

```javascript
// Start API server
import { BaileysAPI } from './src/api/BaileysAPI.js';

const api = new BaileysAPI(3000);
api.start();
```

#### API Endpoints

**Get Pairing Code**
```bash
GET /api/pairing-code/6281234567890
```

**Send Single Message**
```bash
POST /api/send-message
Content-Type: application/json

{
  "sender": "6281234567890",
  "recipient": "6287654321098",
  "message": "Hello from Baileys!"
}
```

**Bulk Send Messages**
```bash
POST /api/bulk-send
Content-Type: application/json

{
  "sender": "6281234567890",
  "recipients": ["6287654321098", "6282222222222"],
  "message": "Hello everyone!"
}
```

**List Active Sessions**
```bash
GET /api/sessions
```

**Disconnect Session**
```bash
POST /api/disconnect
Content-Type: application/json

{
  "phone": "6281234567890"
}
```

## 📁 Project Structure

```
src/
├── index.js                    # Entry point
├── controllers/
│   ├── AppController.js        # Main app logic
│   └── WhatsAppController.js   # WhatsApp automation
├── services/
│   ├── AuthService.js          # Authentication
│   ├── ScraperService.js       # Web scraping
│   └── WhatsAppService.js      # WhatsApp service
├── modules/
│   ├── ProxyManager.js         # Proxy management
│   ├── RequestBuilder.js       # HTTP requests
│   ├── RateLimiter.js          # Rate limiting
│   ├── BaileysSender.js        # Baileys wrapper
│   ├── PairingCodeManager.js   # Pairing codes
│   └── WhatsAppBotHandler.js   # Bot handlers
├── api/
│   └── BaileysAPI.js           # REST API
└── utils/
    ├── Logger.js               # Logging
    ├── UIManager.js            # CLI UI
    └── DeviceInfo.js           # Device info

data/
├── pairing_codes.json          # Stored pairing codes
├── rate_limit.json             # Rate limit cache
└── auth_sessions/              # WhatsApp auth data

logs/
└── app.log                      # Application logs
```

## 🔐 Modules

### BaileysSender
Main wrapper for Baileys WhatsApp automation
- Get pairing codes
- Send messages
- Manage sessions
- Display pairing UI

### PairingCodeManager
Handles pairing code storage and management
- Save codes to JSON
- Track status (pending/completed)
- Auto-cleanup expired codes
- Persistent storage

### WhatsAppService
Low-level Baileys integration
- Socket initialization
- Message sending
- Event handling
- Connection management

### WhatsAppBotHandler
Bot automation framework
- Message handlers
- Group handling
- Event system
- Auto-reply

### ProxyManager
Proxy rotation and validation

### RequestBuilder
HTTP request construction with spoofing

### RateLimiter
Time-based rate limiting system

## 📝 Environment Variables

```env
# Firebase
FIREBASE_URL=your_firebase_url

# WhatsApp
WHATSAPP_USE_PAIRING_CODE=true
WHATSAPP_PAIRING_TIMEOUT=60
WHATSAPP_SESSION_DIR=./auth_sessions

# API
API_PORT=3000
API_HOST=localhost

# Logging
LOG_LEVEL=info
LOG_FILE=logs/app.log

# Rate Limiting
RATE_LIMIT_HOURS=10
```

## 🧪 Testing

```bash
npm test
```

## 📊 Features by Module

| Module | Feature | Status |
|--------|---------|--------|
| BaileysSender | Pairing codes | ✅ |
| BaileysSender | Send messages | ✅ |
| BaileysSender | Session management | ✅ |
| PairingCodeManager | Code storage | ✅ |
| PairingCodeManager | Status tracking | ✅ |
| PairingCodeManager | Auto-cleanup | ✅ |
| WhatsAppService | Socket init | ✅ |
| WhatsAppService | Bulk send | ✅ |
| WhatsAppBotHandler | Message routing | ✅ |
| WhatsAppBotHandler | Event system | ✅ |

## ⚙️ Configuration

### Pairing Code Timeout
```javascript
// Default: 60 seconds
// Modify in WhatsAppService.js
const PAIRING_TIMEOUT = 60000;
```

### Rate Limiting
```javascript
// Default: 10 hours
// Modify in RateLimiter constructor
const limiter = new RateLimiter(10);
```

### Proxy Settings
```javascript
// Enable/disable in .env
PROXY_ENABLED=true
PROXY_LIST=proxies.txt
```

## 🐛 Troubleshooting

### Pairing Code Not Showing
- Check WhatsApp app is updated
- Ensure phone number format is correct (62xxxxxxxxxx)
- Try disconnecting and reconnecting

### Connection Timeout
- Verify internet connection
- Check firewall settings
- Increase timeout in .env (WHATSAPP_PAIRING_TIMEOUT)

### Messages Not Sending
- Verify recipient number format
- Check session is still active
- View logs for detailed error

## 📚 Documentation

See [Baileys Documentation](https://github.com/WhiskeySockets/Baileys) for more info

## 📄 License

Apache License 2.0

## 👨‍💼 Author

BerasXcorps Team

## ⚠️ Disclaimer

This tool is for educational purposes only. Users are responsible for:
- Compliance with WhatsApp Terms of Service
- Local and international laws
- Proper use of automation features
- Not spamming or harassing others

## 🤝 Contributing

Contributions welcome! Please submit pull requests to the `develop` branch.

## 📞 Support

For issues and questions, please open a GitHub issue.
