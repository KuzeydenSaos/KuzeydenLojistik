# Kuzeyden Lojistik

TMS (Transport Management System) ve yönetim paneli.

## Tech stack
- Express 4 + EJS
- PostgreSQL (Railway)
- bcryptjs + express-session (Postgres backed)
- Tailwind CDN + Font Awesome

## Geliştirme

```bash
cp .env.example .env
# DATABASE_URL ve SESSION_SECRET'ı doldur

npm install
npm start
# http://localhost:3000
```

İlk açılışta `admin@kuzeydenlojistik.com / admin` kullanıcısı otomatik oluşturulur.

## Deploy (Railway)

1. Railway projesinde Postgres servisi ekle
2. GitHub repo'yu Railway'e bağla
3. Service → Variables:
   - `DATABASE_URL` → `${{Postgres.DATABASE_URL}}` (referans)
   - `SESSION_SECRET` → uzun rastgele string
   - `NODE_ENV` → `production`
4. Settings → Networking → Generate Domain
