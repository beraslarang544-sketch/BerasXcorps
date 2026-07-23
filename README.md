# BerasXcorps v2.0 - Node.js Edition

> Modern web scraping and automation tool built with Node.js

## 🚀 Features

- **Web Scraping**: Advanced HTTP client with proxy support
- **Modular Architecture**: Clean separation of concerns
- **Rate Limiting**: Built-in request throttling
- **Proxy Management**: Automatic proxy rotation
- **Firebase Integration**: User authentication and data sync
- **Comprehensive Logging**: File and console logging
- **Error Handling**: Robust error management

## 📋 Requirements

- Node.js >= 18.0.0
- npm or yarn

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

## 🎯 Usage

```bash
# Run application
npm start

# Development mode with auto-reload
npm run dev

# Run tests
npm test

# Lint code
npm run lint
```

## 📁 Project Structure

```
src/
├── index.js                 # Entry point
├── controllers/
│   └── AppController.js     # Main application logic
├── services/
│   ├── AuthService.js       # Authentication
│   └── ScraperService.js    # Web scraping
├── modules/
│   ├── ProxyManager.js      # Proxy management
│   ├── RequestBuilder.js    # HTTP request building
│   └── RateLimiter.js       # Rate limiting
└── utils/
    ├── Logger.js            # Logging utility
    ├── UIManager.js         # UI/CLI management
    └── DeviceInfo.js        # Device information
```

## 🔌 Modules

### ProxyManager
Handles proxy rotation and validation

### RequestBuilder
Constructs HTTP requests with randomized headers and user agents

### RateLimiter
Implements time-based rate limiting

### AuthService
Manages user authentication via Firebase

### ScraperService
Coordinates web scraping operations

## 📝 Environment Variables

See `.env.example` for complete configuration

```env
FIREBASE_URL=your_firebase_url
RATE_LIMIT_HOURS=10
LOG_LEVEL=info
```

## 🧪 Testing

```bash
npm test
```

## 📄 License

Apache License 2.0

## 👤 Author

BerasXcorps Team

## ⚠️ Disclaimer

This tool is for educational purposes only. Users are responsible for compliance with applicable laws and terms of service.
