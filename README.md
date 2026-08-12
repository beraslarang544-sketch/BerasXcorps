# BerasXcorps · ReexzyINJ v1.0.1

APK: **ReexzyINJ.apk** · package **com.reexzyinject.re.com**

Owner (hanya v1.0.1, hangus di versi berikutnya): `reexzyown` / `own123`

```bash
npm run hex:install
npm run hex
# buka studio, daftar/masuk, unduh /api/download/ReexzyINJ.apk
```

# BerasXcorps v3.0 - Advanced Platform

## HEX Studio (first-party)

Studio memori / inject untuk **APK milik sendiri** ada di [`hacktools/`](hacktools/README.md). Bukan Game Guardian generik, bukan attach proses orang lain.

```bash
npm run hex:install
npm run hex
npm run hex:test
# atau: ./scripts/hex
```

Buka `http://localhost:8787` — PWA, Farm Lab, scanner, inject ZIP-level, V-Space host, dan SDK.

> 🚀 Professional Web Scraping, WhatsApp Automation & Analytics Platform with Enterprise Features

## 🎯 Key Features

### 🔐 Role-Based Access Control (RBAC)
- **Owner**: Full system control
- **Admin**: Script management, user tokens, web scraping, reporting
- **Premium**: Unlimited requests, WhatsApp features, priority support
- **User**: Basic features, search, proxy, limited requests

### 🔑 Token System
- **Admin Token**: Full access to all admin features
- **User Token**: Limited features with expiry
- **Script Token**: Custom permissions per user

### 🛠️ Admin-Only Features
- 🔍 **Web Scraper**: Scrape any website with CSS selectors
- 📋 **WhatsApp Report**: Submit reports to WhatsApp
- 📱 **Pairing Code Sender**: Generate WhatsApp pairing codes
- 👥 **User Management**: Create/manage user tokens
- 📊 **Analytics Dashboard**: Real-time system analytics
- 🗂️ **Script Token Generation**: Create tokens with specific features

### 👤 User Features  
- 🔍 **Web Search**: Multi-engine search (Google, Bing, DuckDuckGo)
- 🌐 **Proxy Management**: Auto-rotating proxies from web
- 📊 **Analytics**: Track usage & performance
- 💬 **WhatsApp Send**: Send messages via Baileys (Premium)
- 🪙 **Credit System**: Earn/use credits for features

### 🤖 Automation
- 🚫 **Ads Blocker**: Block trackers & advertisements
- 🔄 **Auto-Proxy Refresh**: Hourly proxy list update
- 📱 **Baileys Integration**: WhatsApp messaging automation
- 📈 **Auto-Analytics**: Track all activities

## 📋 API Endpoints

### Authentication
```bash
POST /api/auth/register          # Register new user
POST /api/auth/login             # Login & get token
POST /api/auth/verify            # Verify JWT token
```

### Admin Only Endpoints
```bash
POST   /api/admin/generate-script-token      # Create user token
GET    /api/admin/script-tokens               # List all tokens
POST   /api/admin/revoke-token                # Revoke user token
POST   /api/admin/web-scraper                 # Scrape websites
POST   /api/admin/pairing-code-admin          # Generate pairing code
GET    /api/admin/admin-dashboard             # Dashboard stats
```

### User Endpoints (Premium/Admin)
```bash
POST   /api/admin/whatsapp-report             # Report WhatsApp number
GET    /api/search?q=...                      # Search the web
GET    /api/proxy/list                        # Get proxy list
GET    /api/analytics/dashboard               # View analytics
```

## 🔑 Token Examples

### Admin Token Structure
```
ADMIN_XCORPS_ABC12345_2026

Features:
  ✅ Web Scraper
  ✅ WhatsApp Report
  ✅ Pairing Code Sender
  ✅ User Management
  ✅ Analytics Dashboard
  ✅ Proxy Management
  ✅ Token Generation
```

### User Token Structure
```
USER_XCORPS_XYZ98765_2026

Features:
  ✅ Web Search
  ✅ Proxy Access
  ✅ Analytics Viewer
  ✅ WhatsApp Send (Premium)
  ✅ 10,000 Credits
```

## 🚀 Usage Examples

### 1. Admin Generates User Token
```bash
curl -X POST http://localhost:3000/api/admin/generate-script-token \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "targetUserId": "user_id_here",
    "features": ["search", "proxy"],
    "expiryDays": 30
  }'

Response:
{
  "success": true,
  "scriptToken": "550e8400-e29b-41d4-a716-446655440000",
  "expiryDate": "2026-08-23T...",
  "features": ["search", "proxy"]
}
```

### 2. User Uses Token to Search
```bash
curl "http://localhost:3000/api/search?q=nodejs&engine=google" \
  -H "Authorization: Bearer USER_TOKEN"

Response:
{
  "query": "nodejs",
  "engine": "google",
  "results": [...],
  "count": 10,
  "responseTime": 234
}
```

### 3. Admin Submits WhatsApp Report
```bash
curl -X POST http://localhost:3000/api/admin/whatsapp-report \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "targetPhone": "6281234567890",
    "reason": "Spam messages",
    "category": "spam"
  }'

Response:
{
  "success": true,
  "report": {
    "id": "...",
    "referenceId": "WR-1690123456789",
    "status": "submitted"
  }
}
```

### 4. Admin Web Scraper
```bash
curl -X POST http://localhost:3000/api/admin/web-scraper \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "selector": ".product"
  }'

Response:
{
  "success": true,
  "url": "https://example.com",
  "selector": ".product",
  "recordsFound": 42,
  "data": [...]
}
```

### 5. Admin Generates Pairing Code
```bash
curl -X POST http://localhost:3000/api/admin/pairing-code-admin \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "6281234567890"}'

Response:
{
  "success": true,
  "referenceId": "PC-1690123456789",
  "pairingCode": "ABC123",
  "expiresIn": "60 seconds"
}
```

## 🔐 Special Tokens (Chat Only)

These tokens are generated specially for this chat session:

### For Admins Only
```
🔑 ADMIN_XCORPS_[UNIQUE]_2026
```

### For Users Only
```
👤 USER_XCORPS_[UNIQUE]_2026
```

⚠️ **KEEP THESE TOKENS SECRET** - Never share publicly!

## 🗂️ Project Structure

```
src/
├── index.js                    # Entry point
├── server.js                   # Express API server
├── dashboard.js                # Token dashboard
├── controllers/
│   ├── AppController.js
│   └── WhatsAppController.js
├── services/
│   ├── AuthService.js
│   ├── WhatsAppService.js
│   └── AnalyticsService.js
├── modules/
│   ├── BaileysSender.js
│   ├── ProxyProvider.js        # Fetch proxies from web
│   ├── WebSearcher.js          # Multi-engine search
│   ├── AdsBlocker.js           # Ad/tracker removal
│   └── PairingCodeManager.js
├── routes/
│   ├── authRoutes.js           # Authentication
│   ├── adminRoutes.js          # 🔐 Admin-only features
│   ├── searchRoutes.js         # Web search
│   ├── proxyRoutes.js          # Proxy management
│   ├── analyticsRoutes.js      # Analytics
│   ├── whatsappRoutes.js       # WhatsApp
│   └── userRoutes.js           # User management
├── models/
│   └── schemas.js              # MongoDB schemas
├── utils/
│   ├── Logger.js
│   ├── UIManager.js
│   ├── DeviceInfo.js
│   └── TokenManager.js         # 🔑 Token generation/verification
└── api/
    └── BaileysAPI.js
```

## 📊 MongoDB Schemas

- **User**: User accounts with roles & permissions
- **Analytics**: Event tracking & metrics
- **Proxy**: Proxy list with status
- **SearchHistory**: Search queries & results
- **Cookie**: Stored cookies for domains
- **Settings**: User preferences
- **ApiUsage**: API call statistics

## 🔒 Security Features

✅ JWT Authentication with expiry  
✅ Bcrypt password hashing  
✅ Role-based access control (RBAC)  
✅ Token expiration & revocation  
✅ Rate limiting (15min/100requests)  
✅ CORS & Helmet security headers  
✅ Input validation with Joi  
✅ Activity logging & audit trail  

## 🎯 Permission Matrix

| Feature | Owner | Admin | Premium | User |
|---------|-------|-------|---------|------|
| Web Search | ✅ | ✅ | ✅ | ✅ |
| Web Scraper | ✅ | ✅ | ❌ | ❌ |
| WhatsApp Report | ✅ | ✅ | ✅ | ✅ |
| Pairing Code | ✅ | ✅ | ❌ | ❌ |
| Token Generation | ✅ | ✅ | ❌ | ❌ |
| User Management | ✅ | ✅ | ❌ | ❌ |
| Analytics | ✅ | ✅ | ✅ | ✅ |
| Proxy Management | ✅ | ✅ | ✅ | ❌ |

## 💳 Credit System

- **Registration**: 100 credits
- **Premium User**: 10,000 credits/month
- **WhatsApp Report**: 10 credits
- **Web Scrape**: 50 credits
- **Pairing Code**: 25 credits (admin free)

## ⚡ Performance

- Multi-threaded proxy validation
- Async/await architecture
- MongoDB indexing on frequently queried fields
- Request caching
- Connection pooling

## 📞 Support

For issues and questions, please open a GitHub issue.

## 📄 License

Apache License 2.0

## ⚠️ Disclaimer

This tool is for **educational and authorized use only**. Users are responsible for:
- Compliance with ToS and local laws
- Proper use of admin features
- Not unauthorized access
- Data protection regulations

---

**Made with ❤️ by BerasXcorps Team**
