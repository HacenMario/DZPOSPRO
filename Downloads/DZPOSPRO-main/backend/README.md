# DZ POS PRO — Backend

REST + WebSocket API for the DZ POS PRO point-of-sale system.

- **Stack:** Node.js + Express 4, MongoDB via Mongoose 7, JWT auth (bcryptjs), Socket.io 4, Multer for uploads.
- **Languages:** trilingual i18n (`ar` / `en` / `fr`) — set the `Accept-Language` header (or `?lang=`).
- **No build step** — plain CommonJS (`require` / `module.exports`).

## Prerequisites
- Node.js ≥ 16
- MongoDB ≥ 4.4 (local or remote)

## Install
```bash
cd backend
npm install
cp .env.example .env
# Edit .env — generate a strong JWT_SECRET:
#   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## Configure `.env`
| Variable | Description |
| --- | --- |
| `NODE_ENV` | `development` or `production` |
| `PORT` | HTTP port (default `3001`) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | **Strong random hex string** — required |
| `JWT_EXPIRE` | Token expiry (default `7d`) |
| `CORS_ORIGINS` | Comma-separated list of allowed frontend origins |
| `EMAIL_USER` / `EMAIL_PASS` | Optional — leave empty to disable email features |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Used by `npm run seed` |

## Seed the database
```bash
npm run seed
```
This creates (idempotently):
1. The initial **admin** user — default `admin@dzpos.pro` / `Admin@123456` (override with `SEED_ADMIN_*` env vars). **Change this password after first login.**
2. A default `Setting` document with generic placeholders.
3. A few sample categories / products / customers / suppliers (only when the DB is empty).
4. An open cashier session for the admin.

## Run
```bash
npm start          # production
npm run dev        # nodemon (auto-restart)
```

The server serves the SPA from `../frontend` and the API under `/api`.

## API contract
All responses use a single envelope:
- Success: `{ success: true, data: <payload>, message?: <string> }`
- List: `{ success: true, data: [...], total, page, limit, totalPages }`
- Error: `{ success: false, message: <string>, errors?: [{ field, message }] }`

### Auth (`/api/auth`)
| Method | Route | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/login` | public | `{ token, user }` |
| POST | `/register` | admin | Used to create new users |
| GET | `/me` | bearer | Current user |
| PUT | `/profile` | bearer | Update name / phone / settings |
| PUT | `/change-password` | bearer | Min 8 chars + letter + number |
| POST | `/refresh` | bearer | Returns a new token |
| POST | `/logout` | bearer | Client-side token removal |

### Users (`/api/users`) — admin only
`GET /` `POST /` `GET /:id` `PUT /:id` `DELETE /:id`

### Products (`/api/products`)
`GET /?page&limit&search&category&status&lowStock` · `GET /:id` · `GET /barcode/:code` · `GET /low-stock` ·
`POST /` (multipart `images[]`) · `PUT /:id` (multipart) · `PATCH /:id/stock` `{ adjustment, reason }` · `DELETE /:id`

### Categories (`/api/categories`)
`GET /` (tree) · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id`

### Customers (`/api/customers`)
`GET /?page&limit&search` · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id`
Fields: `name{ar,en,fr}`, `phone`, `email`, `address{ar,en,fr}`, `rc`, `nif`, `nis`, `art`, `loyaltyPoints`, `totalSpent`, `notes`

### Sales (`/api/sales`)
`GET /?page&limit&status&from&to&customer&session` · `GET /:id` ·
`POST /` `{ customer, session, items[{product, quantity, price, discount}], discount, tax, couponCode, paymentMethod, splitPayment, notes }` ·
`PATCH /:id/status` `{ status }` · `DELETE /:id` (cancel — restores stock)

### Reports (`/api/reports`)
- `GET /summary?from&to` → `{ totalSales, totalRevenue, totalProfit, totalCustomers, totalProducts, lowStockCount, topProducts[], topCustomers[], salesByDay[], salesByCategory[], salesByPaymentMethod[] }`
- `GET /sales?from&to&group_by=day|month` → chart-friendly
- `GET /products?from&to&limit` → top products
- `GET /customers?from&to&limit` → top customers
- `GET /inventory` → `{ lowStock[], totalStockValue, totalItems }`

### Settings (`/api/settings`)
`GET /` (any auth) · `PUT /` (admin) — fields: `storeName, currency, taxRate, invoicePrefix, invoiceFooter, lowStockThreshold, defaultPaymentMethod, companyInfo{ rc, nif, nis, art, address, phone, email }`

### Coupons (`/api/coupons`)
`GET /?page&limit` · `GET /:id` · `POST /` (admin) · `PUT /:id` (admin) · `DELETE /:id` (admin) · `POST /validate` `{ code, cartTotal }` → `{ valid, discount, coupon, newTotal }`

### Suppliers (`/api/suppliers`)
`GET /?page&limit&search` · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id`
Fields: `name{ar,en,fr}`, `contactName`, `phone`, `email`, `address{ar,en,fr}`, `rc`, `nif`, `nis`, `art`, `notes`

### Returns (`/api/returns`)
`GET /?page&limit` · `GET /:id` · `POST /` `{ sale, items[{ saleItem, product, quantity, price, reason }], reason }`

### Inventory (`/api/inventory`)
- `GET /movements?page&limit&type&product&from&to`
- `POST /movements` `{ product, type: 'in'|'out'|'adjust', quantity, reason }`
- `GET /product/:productId?page&limit` — movement history for one product
- `GET /summary` → `{ lowStock[], totalStockValue, totalItems }`

### Sessions (`/api/sessions`)
`GET /?status=open|closed&page&limit` · `GET /current` · `GET /:id` ·
`POST /` `{ openingCash, notes }` · `PUT /:id/close` `{ closingCash, notes }`

### Health
`GET /api/health` → `{ status, uptime, timestamp, db }`

## Security notes
- **Registration is admin-only.** The first admin is created via `npm run seed`.
- JWT secret must be a strong random value (see install steps above).
- CORS allow-list is configured via `CORS_ORIGINS` (no `*` with credentials).
- `helmet`, `compression`, `express-mongo-sanitize`, `morgan`, and rate-limiting are loaded when installed.
- `loginLimiter` (5 attempts / 15 min) protects `/api/auth/login`.
- Passwords require ≥ 8 chars + at least one letter + at least one number.

## Logging
Console + `logs/combined.log` and `logs/error.log` (JSON-lines) via `utils/logger.js`.

## Folder layout
```
backend/
├── config/         # db, i18n
├── controllers/    # business logic (one per resource)
├── middleware/     # auth, role, upload, errorHandler, validator, rateLimiter, language
├── models/         # Mongoose schemas
├── routes/         # Express routers
├── scripts/        # seed.js
├── utils/          # logger, response, pagination, validators
├── server.js       # entry point
└── package.json
```

## License
Proprietary — internal use only.
