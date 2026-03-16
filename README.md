# صيدلية د. حاتم عثمان — Pharmacy Web App

A full-stack pharmacy website with a **Node.js + Firebase Admin SDK** backend.  
All Firestore access happens server-side — no credentials or database URLs ever reach the browser.

---

## Project Structure

```
pharmacy-v2/
├── index.html              ← Storefront (hero, products preview, cart, orders)
├── products.html           ← Full catalogue with search & pagination
├── admin.html              ← JWT-protected admin dashboard
└── backend/
    ├── server.js           ← Secure Express server  ⬅  key file
    ├── .env                ← JWT secret + admin password (never commit)
    ├── serviceAccountKey.json  ← Firebase Service Account (never commit)
    └── package.json
```

---

## Quick Start

### Step 1 — Get your Service Account Key
1. Open [console.firebase.google.com](https://console.firebase.google.com)
2. Select project `hatem-pharmacy`
3. **Project Settings → Service Accounts → Generate new private key**
4. Move the downloaded JSON to `backend/serviceAccountKey.json`
5. Add it to `.gitignore` immediately:
   ```
   serviceAccountKey.json
   .env
   ```

### Step 2 — Configure `.env`
```env
PORT=3000
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
ADMIN_PASSWORD=<your-strong-password>
```

### Step 3 — Run
```bash
cd backend
npm install
npm start          # production
npm run dev        # dev with auto-restart (Node 18+)
```
Open `http://localhost:3000`

---

## Firebase Security Rules

Apply these in **Firestore → Rules** to lock down direct access:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /products/{id} {
      allow read:  if true;    // Public read (storefront needs it)
      allow write: if false;   // Server-only writes (Admin SDK bypasses this)
    }

    match /orders/{id} {
      allow create: if isValidOrder();
      allow read, update, delete: if false;
    }
  }

  function isValidOrder() {
    let d = request.resource.data;
    return d.keys().hasAll(['name', 'phone', 'total'])
        && d.name  is string && d.name.size()  > 1
        && d.phone is string && d.phone.size() > 6
        && d.total is number && d.total        > 0;
  }
}
```

> **Why `allow write: if false` doesn't break the backend:**  
> Firebase Admin SDK uses a Service Account with full privileges and **bypasses Security Rules entirely**. Only direct browser requests are blocked.

---

## Security Summary

| Before | After |
|---|---|
| `FIREBASE_API_KEY` in HTML source | Removed — Admin SDK uses Service Account |
| Firestore URL visible in DevTools | Never leaves the server |
| `PASS_HASH` SHA-256 in client JS | Server-side check → JWT issued |
| Stale JWT accepted forever | `GET /api/admin/verify` validates on every page load |
| No rate limiting | 10 login tries/15min; 120 API calls/min |
| No input validation | `sanitizeProduct()` + `validateOrder()` before every write |
| Anyone could write Firestore directly | Firestore Security Rules + Admin SDK = two lock layers |

---

## API Routes

### Public
| Method | Path | Auth |
|---|---|---|
| `GET` | `/api/products` | None |
| `POST` | `/api/orders` | None |

### Admin (JWT required)
| Method | Path | |
|---|---|---|
| `POST` | `/api/admin/login` | Get token |
| `GET` | `/api/admin/verify` | Validate token |
| `GET/POST/PATCH/DELETE` | `/api/admin/products[/:id]` | CRUD |
| `GET/PATCH/DELETE` | `/api/admin/orders[/:id]` | CRUD |
