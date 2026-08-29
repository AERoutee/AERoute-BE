<div align="center">
  <img src="https://raw.githubusercontent.com/AERoutee/AERoute-FE/main/src/assets/aeroute-logo.png" alt="AERoute" width="180" />

  # AERoute Backend
  ### Secure routing, environmental context, and community reports.

  [![GitHub](https://img.shields.io/badge/GitHub-AERoute--BE-181717?style=for-the-badge&logo=github)](https://github.com/AERoutee/AERoute-BE)

  **Submission for ITECHNO CUP 2026 - Web Development**

  **By AERoute Team**
</div>

---

## 📋 Daftar Isi

- [Tim Developer](#-tim-developer)
- [Tentang Proyek](#-tentang-proyek)
- [Fitur Unggulan](#-fitur-unggulan)
- [Demo & Screenshot](#-demo--screenshot)
- [Teknologi](#-teknologi)
- [Arsitektur Sistem](#-arsitektur-sistem)
- [Instalasi & Setup](#-instalasi--setup)
- [Penggunaan](#-penggunaan)
- [API Documentation](#-api-documentation)
- [Testing](#-testing)
- [Lisensi](#-lisensi)

---

## 👥 Tim Developer

| Nama | Peran | GitHub |
| --- | --- | --- |
| **Andrian Pratama** | Project Lead & Lead Full-Stack Developer | [@Yanzz231](https://github.com/Yanzz231) |
| **Jeremy Auriel Zhang** | Full-Stack Developer | [@jeremzhg](https://github.com/jeremzhg) |
| **Calvin Wu** | Product Manager | [@5calvinw](https://github.com/5calvinw) |

---

## 🎯 Tentang Proyek

### Latar Belakang

AERoute memerlukan backend yang menjaga provider key, session, ownership, route normalization, exposure calculation, password recovery, report persistence, dan image processing di luar browser.

### Solusi yang Ditawarkan

AERoute Backend menghubungkan Google Routes, Air Quality, dan Weather API; menghitung modeled exposure; mengurutkan route; mengelola Better Auth; menyimpan report; memproses gambar; dan menerbitkan kontrak OpenAPI 3.1.

### Tujuan Proyek

- 🎯 **Tujuan Utama**: menjadi sumber kebenaran untuk semua keputusan data dan keamanan AERoute.
- 📊 **Target Consumer**: AERoute Frontend dan integrasi internal yang mengikuti kontrak OpenAPI.
- 💡 **Value Proposition**: provider response yang kompleks dinormalisasi menjadi API yang konsisten, typed, dan aman.

---

## ✨ Fitur Unggulan

| Fitur | Deskripsi | Keunggulan |
| --- | --- | --- |
| **Route Comparison** | Walking/cycling alternatives dari Google Routes | Response provider dinormalisasi sebelum dikirim ke frontend |
| **PM2.5 Exposure Engine** | Sampling sepanjang polyline dan ranking route | Mendukung segment-level color dan route trade-off |
| **Weather Sampling** | Current weather pada 25%, 50%, dan 75% tiap route | Cuaca tampil di map tanpa mengubah exposure score |
| **Better Auth** | Email/password, Google OAuth, sessions, account linking | Cookie HTTP-only dan database-backed session |
| **Secure Recovery** | Opaque challenge ID + hashed six-digit OTP | Email/OTP tidak masuk URL dan password reset mencabut session lama |
| **Community Reports** | Viewport query, image upload, expiry, user rate limit | Data komunitas tidak mengekspos email/user ID |
| **Swagger UI** | OpenAPI 3.1 + Try it out | Kontrak endpoint, upload, schemas, security, dan errors dapat diuji interaktif |

---

## 📸 Demo & Screenshot

### Live Demo

API production belum dipublikasikan.

Target deployment:

- API: `https://api.aeroute.my.id`
- Swagger: `https://api.aeroute.my.id/api/docs`

### Screenshot dan Video

Screenshot Swagger dan video demo belum tersedia. Tambahkan setelah deployment final.

---

## 🛠️ Teknologi

### Tech Stack

```text
Runtime      : Node.js + TypeScript ESM
Framework    : Express 5
Database     : PostgreSQL
ORM          : Prisma 7 + PostgreSQL adapter
Auth         : Better Auth
Validation   : Zod
Images       : Multer + Sharp
Storage      : S3-compatible private bucket
Email        : Nodemailer SMTP
Docs         : OpenAPI 3.1 + Swagger UI
Security     : Helmet, CORS, redacting logger
```

### Dependencies Utama

```json
{
  "express": "^5.2.1",
  "better-auth": "^1.7.1",
  "@prisma/client": "^7.9.1",
  "zod": "^4.4.3",
  "sharp": "^0.35.3",
  "swagger-ui-express": "^5"
}
```

### Alasan Pemilihan Teknologi

| Teknologi | Alasan Pemilihan |
| --- | --- |
| **Express 5** | API composition sederhana dengan router/controller/service modules |
| **Better Auth** | Session cookie, OAuth, credential accounts, dan password management |
| **PostgreSQL + Prisma** | Relasi auth/routes/reports dengan migration dan generated client |
| **Zod** | Trust-boundary validation untuk JSON, query, params, dan multipart fields |
| **Sharp** | Decode dan re-encode gambar sebelum object storage |
| **Swagger UI** | Dokumentasi API interaktif untuk penilaian dan integrasi |

---

## 🏗️ Arsitektur Sistem

```text
HTTP request
-> Helmet / CORS / request logger
-> Better Auth atau /api/v1 router
-> auth/upload middleware
-> controller
-> service
-> repository/provider
-> PostgreSQL / Google APIs / object storage / SMTP
-> response envelope
-> error handler
```

### Folder Structure

```text
src/
├── app.ts
├── index.ts
├── config/              # Auth, DB, env, SMTP, storage, Swagger
├── middleware/          # Auth, logger, errors
├── modules/
│   ├── profile/
│   ├── recovery/
│   ├── road-report/
│   └── route-comparison/
└── utils/

prisma/
├── schema.prisma
├── migrations/
└── seed.ts
```

### Database Schema

```text
MsUser
├── MsAccount
├── TrSession
├── TrRouteComparison
│     └── TrRouteResult
└── TrRoadReport
      └── TrRoadReportImage

TrVerification
TrRateLimit
```

---

## ⚙️ Instalasi & Setup

### Prerequisites

- Node.js 24 atau versi LTS modern.
- npm.
- PostgreSQL.
- Google Routes, Air Quality, dan Weather API access.
- SMTP account.
- S3-compatible private bucket.

### Instalasi

```bash
git clone https://github.com/AERoutee/AERoute-BE.git
cd AERoute-BE
npm ci
copy .env.example .env
npm run db:migrate
npm run dev
```

API lokal berjalan pada `http://localhost:3000`.

### Environment Groups

```text
Application : NODE_ENV, PORT, FRONTEND_ORIGIN, TRUST_PROXY
Auth       : BETTER_AUTH_URL, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
Database   : DATABASE_URL
Providers  : GOOGLE_MAPS_SERVER_KEY, PROVIDER_TIMEOUT_MS
Email      : SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD
Storage    : S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_PUBLIC_BASE_URL, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
```

Jangan commit `.env` atau memindahkan server secrets ke frontend.

---

## 🚀 Penggunaan

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm start

npm run db:generate
npm run db:migrate
npm run db:studio
npm run db:seed
```

### Production

```bash
npm ci
npm run db:migrate
npm run build
npm start
```

Production wajib memakai HTTPS, production secrets, provider key restrictions, private object storage, dan configured frontend origin.

---

## 📚 API Documentation

### Base URL

```text
Development : http://localhost:3000
Production  : https://api.aeroute.my.id
Swagger UI : https://api.aeroute.my.id/api/docs
OpenAPI JSON: https://api.aeroute.my.id/api/openapi.json
```

Local documentation:

```text
http://localhost:3000/api/docs
http://localhost:3000/api/openapi.json
```

### Endpoint Groups

```text
/api/health
/api/auth/*
/api/v1/recovery-challenges/*
/api/v1/profile/avatar*
/api/v1/route-comparisons
/api/v1/road-reports*
/api/v1/road-report-images/:id
```

Swagger mendokumentasikan request/response schemas, cookie security scheme, multipart upload, validation errors, dan status codes. `Try it out` aktif.

---

## 🧪 Testing

Automated test suite belum tersedia.

```bash
npm run lint
npm run typecheck
npm run build
npx prisma validate
```

Integration QA tambahan:

- Google Routes/Air Quality/Weather provider.
- Better Auth email/password dan Google OAuth.
- SMTP `verify()` dan OTP delivery.
- S3 read/write/delete.
- Multipart avatar/report upload.
- CORS/cookie pada frontend production origin.

---

## 📄 Lisensi

Lisensi proyek belum ditetapkan. Tidak ada klaim lisensi MIT sampai file `LICENSE` resmi ditambahkan.

---

<div align="center">

  **Made by AERoute Team for ITECHNO CUP 2026**

</div>
