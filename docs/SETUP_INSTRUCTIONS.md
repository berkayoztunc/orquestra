# 🚀 orquestra Kurulum Rehberi

> Solana IDL → REST API Dönüştürücü

## 📋 Proje Özeti

orquestra, Solana geliştiricilerinin Anchor IDL dosyalarını yükleyip anında REST API'ler elde etmeyi sağlayan açık kaynaklı bir platformdur.

**Tech Stack:**
- **Frontend:** React 18 + TypeScript + Tailwind CSS (Cloudflare Pages)
- **Backend:** Hono + TypeScript (Cloudflare Workers)
- **Database:** Cloudflare D1 (SQLite)
- **Cache:** Cloudflare KV
- **Storage:** Cloudflare R2
- **Auth:** GitHub OAuth
- **Deployment:** Cloudflare Pages + Workers

---

## 🛠️ Kurulum Adımları

### 1. Proje Klasörüne Girin

```bash
cd /Users/berkay/Desktop/work/orquestra
```

### 2. Gerekli Kimlik Bilgilerini Hazırlayın

Aşağıdaki bilgileri hazırlamanız gerekecek:

1. **Cloudflare Credentials:**
   - API Token: https://dash.cloudflare.com/ → Settings → API Tokens
   - Account ID: https://dash.cloudflare.com/ → Sol üst köşede Account ID

2. **GitHub OAuth Credentials:**
   - https://github.com/settings/developers
   - `Client ID` ve `Client Secret` oluşturun
   - Authorization callback URL: `https://orquestra.dev/api/auth/callback` (local: `http://localhost:5173/api/auth/callback`)

3. **JWT Secret (opsiyonel, cli ile oluşturabilirsiniz):**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

### 3. Environment Dosyasını Oluşturun

```bash
cp .env.example .env.local
```

Ardından `.env.local` dosyasını düzenleyin:

```env
# Cloudflare
CLOUDFLARE_API_TOKEN=your_api_token_here
CLOUDFLARE_ACCOUNT_ID=your_account_id_here

# GitHub OAuth
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_OAUTH_REDIRECT_URI=http://localhost:5173/api/auth/callback

# JWT
JWT_SECRET=your_jwt_secret_here

# Solana RPC
SOLANA_RPC_URL=https://api.devnet.solana.com

# Environment
NODE_ENV=development
```

### 4. Dependencies İndir

```bash
npm run install:all
```

### 5. Database Migrationlarını Çalıştır

```bash
npm run db:migrate:dev
```

### 6. Development Sunucusu Başlat

**Seçenek 1: Her şeyi aynı anda başlat**
```bash
npm run dev
```

**Seçenek 2: Ayrı ayrı başlat**
```bash
# Terminal 1 - Frontend
npm run dev:frontend
# Frontend: http://localhost:5173

# Terminal 2 - Backend (Worker)
npm run dev:worker
# Backend: http://localhost:8787
```

---

## 📁 Proje Yapısı

```
orquestra/
├── packages/
│   ├── frontend/                 # React SPA (Cloudflare Pages)
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   ├── pages/           # Route pages
│   │   │   └── components/      # Reusable components
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   ├── worker/                   # Hono API (Cloudflare Workers)
│   │   ├── src/
│   │   │   ├── index.ts         # Entry point
│   │   │   └── routes/          # API routes
│   │   ├── wrangler.toml
│   │   └── package.json
│   │
│   └── shared/                   # Shared types & utils
│       ├── src/
│       │   ├── types.ts         # TypeScript interfaces
│       │   └── utils.ts         # Helper functions
│       └── package.json
│
├── migrations/                   # D1 Database schema
│   └── 001_initial_schema.sql
│
├── scripts/                      # Utility scripts
│   ├── seed-db.js
│   └── setup.js
│
├── .github/
│   └── workflows/               # GitHub Actions
│       ├── ci-cd.yml
│       ├── database.yml
│       ├── docker.yml
│       └── copilot-agent.yml    # ✨ Yeni: Copilot Agent Workflow
│
├── .env.example                 # Environment template
├── package.json                 # Root monorepo
├── tsconfig.json                # TypeScript config
├── wrangler.toml                # Cloudflare config
└── README.md
```

---

## 💻 Sık Kullanılan Komutlar

### Development

```bash
npm run dev                      # Dev sunucularını başlat
npm run dev:frontend             # Sadece frontend
npm run dev:worker               # Sadece backend
npm run type-check               # TypeScript kontrol
npm run lint                     # Linting
npm run lint:fix                 # Linting + auto-fix
npm run format                   # Code formatting
```

### Building & Deployment

```bash
npm run build                    # Tüm paketleri build et
npm run build:frontend           # Sadece frontend
npm run build:worker             # Sadece backend
npm run deploy                   # Cloudflare'a deploy et
npm run deploy:worker            # Sadece worker
npm run deploy:pages             # Sadece frontend
```

### Database

```bash
npm run db:migrate:dev           # Migrationları çalıştır
npm run db:seed                  # Test datasını ekle
npm run db:reset                 # Tüm tabloları sil
```

### Cleanup

```bash
npm run clean                    # node_modules ve dist sil
```

---

## 🔄 GitHub Actions with Copilot Agent

### Copilot Agent Aktivasyon

Bir GitHub Issue'u Copilot Agent'e atamak için:

1. **Issue oluşturun** veya **açık bir issue'yu açın**

2. **`copilot-task` label'ını ekleyin**

3. **Otomatik olarak Copilot Agent:**
   - Issue'yu analiz eder
   - Kodlama yapar
   - Test ekler
   - Pull Request oluşturur

### Örnek Issue

```markdown
# Title: IDL Upload API Endpoint

## Description
Create the `/api/idl/upload` endpoint that:
- Accepts multipart/form-data with IDL JSON file
- Validates IDL structure
- Stores in R2 bucket
- Returns upload status

## Labels: copilot-task
```

### CI/CD Workflow'u

Her push veya PR'de otomatik olarak:
- ✅ Linting
- ✅ Type checking
- ✅ Building
- ✅ Testing
- ✅ Deployment (develop/main branches)

---

## 🌐 Frontend Rotaları

| Rota | Açıklama |
|---|---|
| `/` | Ana sayfa |
| `/dashboard` | Kullanıcı dashboard'u |
| `/projects/:slug` | Proje detayı |
| `/explore` | Tüm projeleri keşfet |
| `/docs/:slug` | Proje dokümantasyonu |
| `/api-explorer/:slug` | Interactive API explorer |

---

## 🔌 Backend API Endpoints (stubs mevcut)

| Method | Endpoint | Açıklama |
|---|---|---|
| `POST` | `/api/auth/github` | GitHub OAuth |
| `POST` | `/api/idl/upload` | IDL yükleme |
| `GET` | `/api/:slug/instructions` | Tüm instructions |
| `POST` | `/api/:slug/instructions/:name/build` | Transaction builder |
| `GET` | `/api/:slug/docs` | Markdown doklar |

---

## 📊 Database Schema

### users
```sql
- id (PK)
- github_id (UNIQUE)
- github_username
- avatar_url
- created_at, updated_at
```

### projects
```sql
- id (PK)
- user_id (FK → users)
- slug (UNIQUE)
- name
- description
- program_id
- is_public
- logo_url
- website
- created_at, updated_at
```

### idl_versions
```sql
- id (PK)
- project_id (FK → projects)
- version
- r2_key (S3 storage reference)
- uploaded_at
```

### api_keys
```sql
- id (PK)
- project_id (FK → projects)
- key_hash
- name
- created_at, last_used_at
```

### project_socials
```sql
- id (PK)
- project_id (FK → projects)
- platform (twitter/discord/telegram/github)
- url
```

---

## 🧪 Geliştirme İpuçları

### Frontend Development

```bash
# Tailwind CSS intellisense
# VSCode Extensions'tan "Tailwind CSS IntelliSense" yükleyin

# Hot reload otomatik
# Vite sayesinde dosyayı kaydedince anında görüntülenir
```

### Backend Development

```bash
# Worker lokal testte çalışıyor
npm run dev:worker

# Wrangler komutu doğrudan kullanabilirsiniz
cd packages/worker
wrangler dev
```

### Database Debugging

```bash
# Yerel D1 database'e erişim
cd packages/worker
wrangler d1 shell orquestra-dev
# SQL sorguları yazabilirsiniz
```

---

## 🚨 Troubleshooting

### Port zaten kullanılıyor

```bash
# Frontend (5173) veya Worker (8787) kullanan process'i bul:
lsof -i :5173
lsof -i :8787

# Process'i kapat:
kill -9 <PID>
```

### Dependencies hata

```bash
# Cache'i sil ve yeniden yükle
npm run clean
npm run install:all
```

### Build hatası

```bash
# Type check
npm run type-check

# Linting
npm run lint:fix
```

---

## 📚 Daha Fazla Okuma

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Sistem mimarisi
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Katatılım rehberi
- [ROADMAP.md](./ROADMAP.md) - İmplementasyon roadmap'i
- [brainstorm.md](./brainstorm.md) - Orijinal konsept

---

## 🎯 Next Steps

1. ✅ Dependencies'i kur: `npm run install:all`
2. ✅ Environment dosyasını hazırla: `.env.local`
3. ✅ Database'i setup et: `npm run db:migrate:dev`
4. ✅ Dev sunucusunu başlat: `npm run dev`
5. ✅ Frontend'e git: http://localhost:5173
6. ✅ Backend test et: http://localhost:8787/health

---

**İyi geliştirmeler!** 🚀
