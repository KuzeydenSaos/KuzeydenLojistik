// Postgres bağlantı havuzu + tablo init
require('dotenv').config();
const { Pool } = require('pg');

const isProd = process.env.NODE_ENV === 'production' || /railway|render/.test(process.env.DATABASE_URL || '');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isProd ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000
});

pool.on('error', (err) => {
    console.error('[pg] havuz hatası:', err.message);
});

async function initDb() {
    const client = await pool.connect();
    try {
        // ── Personel ── (yönetim paneli ana tablosu)
        await client.query(`
            CREATE TABLE IF NOT EXISTS personel (
                id              SERIAL PRIMARY KEY,
                ad_soyad        VARCHAR(150) NOT NULL,
                email           VARCHAR(150) UNIQUE,
                telefon         VARCHAR(40),
                departman       VARCHAR(120),
                unvan           VARCHAR(150),
                rol             VARCHAR(40) DEFAULT 'Kullanıcı',
                yonetici_id     INTEGER,
                account_enabled BOOLEAN DEFAULT TRUE,
                created_at      TIMESTAMP DEFAULT NOW()
            );
        `);

        // ── Users (login) ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id          SERIAL PRIMARY KEY,
                name        VARCHAR(150),
                email       VARCHAR(150) UNIQUE NOT NULL,
                password    VARCHAR(255) NOT NULL,
                last_login  TIMESTAMP,
                created_at  TIMESTAMP DEFAULT NOW()
            );
        `);

        // ── Departmanlar ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS departmanlar (
                id         SERIAL PRIMARY KEY,
                ad         VARCHAR(120) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // ── Audit log ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id              SERIAL PRIMARY KEY,
                ts              TIMESTAMP DEFAULT NOW(),
                kullanici_email VARCHAR(150),
                kullanici_ad    VARCHAR(150),
                eylem           VARCHAR(60),
                modul           VARCHAR(60),
                nesne_tip       VARCHAR(60),
                nesne_id        INTEGER,
                aciklama        TEXT,
                detay           JSONB,
                ip              VARCHAR(60)
            );
        `);

        // ── Menü yetkisi ── (rol bazlı menü açma/kapama)
        await client.query(`
            CREATE TABLE IF NOT EXISTS menu_yetki (
                id        SERIAL PRIMARY KEY,
                rol       VARCHAR(40) NOT NULL,
                menu_key  VARCHAR(60) NOT NULL,
                acik      BOOLEAN DEFAULT TRUE,
                UNIQUE(rol, menu_key)
            );
        `);

        // ── Modül izinleri ── (görüntüle/duzenle/ekle/sil)
        await client.query(`
            CREATE TABLE IF NOT EXISTS modul_izin (
                id          SERIAL PRIMARY KEY,
                rol         VARCHAR(40) NOT NULL,
                modul       VARCHAR(60) NOT NULL,
                goruntule   BOOLEAN DEFAULT FALSE,
                duzenle     BOOLEAN DEFAULT FALSE,
                ekle        BOOLEAN DEFAULT FALSE,
                sil         BOOLEAN DEFAULT FALSE,
                UNIQUE(rol, modul)
            );
        `);

        // ── TMS: Müşteriler ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS tms_musteri (
                id          SERIAL PRIMARY KEY,
                ad          VARCHAR(200) NOT NULL,
                vergi_no    VARCHAR(40),
                telefon     VARCHAR(40),
                email       VARCHAR(150),
                adres       TEXT,
                created_at  TIMESTAMP DEFAULT NOW()
            );
        `);

        // ── TMS: Şoförler ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS tms_sofor (
                id            SERIAL PRIMARY KEY,
                ad_soyad      VARCHAR(150) NOT NULL,
                tc_no         VARCHAR(20),
                ehliyet_sinif VARCHAR(20),
                telefon       VARCHAR(40),
                durum         VARCHAR(30) DEFAULT 'Aktif',
                created_at    TIMESTAMP DEFAULT NOW()
            );
        `);

        // ── TMS: Araçlar ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS tms_arac (
                id           SERIAL PRIMARY KEY,
                plaka        VARCHAR(20) UNIQUE NOT NULL,
                marka        VARCHAR(60),
                model        VARCHAR(80),
                tip          VARCHAR(60),
                kapasite_kg  NUMERIC(10,2),
                durum        VARCHAR(30) DEFAULT 'Müsait',
                aktif_sofor  INTEGER REFERENCES tms_sofor(id) ON DELETE SET NULL,
                created_at   TIMESTAMP DEFAULT NOW()
            );
        `);

        // ── TMS: Sevkiyatlar ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS tms_sevkiyat (
                id              SERIAL PRIMARY KEY,
                kod             VARCHAR(40) UNIQUE,
                musteri_id      INTEGER REFERENCES tms_musteri(id) ON DELETE SET NULL,
                arac_id         INTEGER REFERENCES tms_arac(id) ON DELETE SET NULL,
                sofor_id        INTEGER REFERENCES tms_sofor(id) ON DELETE SET NULL,
                yukleme_yeri    VARCHAR(255),
                bosaltma_yeri   VARCHAR(255),
                yukleme_tarihi  DATE,
                teslim_tarihi   DATE,
                tutar           NUMERIC(12,2),
                durum           VARCHAR(40) DEFAULT 'Planlandı',
                aciklama        TEXT,
                created_at      TIMESTAMP DEFAULT NOW(),
                updated_at      TIMESTAMP DEFAULT NOW()
            );
        `);

        // ── İlk kullanıcı (yoksa) — Süper Admin ──
        const { rows: u } = await client.query('SELECT COUNT(*)::int AS n FROM users');
        if (u[0].n === 0) {
            const bcrypt = require('bcryptjs');
            const hash = await bcrypt.hash('admin', 10);
            await client.query(
                `INSERT INTO users (name, email, password) VALUES ($1,$2,$3)`,
                ['Sistem Yöneticisi', 'admin@kuzeydenlojistik.com', hash]
            );
            await client.query(
                `INSERT INTO personel (ad_soyad, email, rol) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING`,
                ['Sistem Yöneticisi', 'admin@kuzeydenlojistik.com', 'Süper Admin']
            );
            console.log('[init] İlk kullanıcı oluşturuldu: admin@kuzeydenlojistik.com / admin');
        }

        // ── Varsayılan menü yetkileri ──
        const menuKeys = ['/', '/tms', '/tms/sevkiyatlar', '/tms/araclar', '/tms/soforler', '/tms/musteriler', '/kullanicilar', '/yonetim', '/audit'];
        for (const key of menuKeys) {
            for (const rol of ['Süper Admin', 'Admin']) {
                await client.query(
                    `INSERT INTO menu_yetki (rol, menu_key, acik) VALUES ($1,$2,TRUE) ON CONFLICT DO NOTHING`,
                    [rol, key]
                );
            }
            await client.query(
                `INSERT INTO menu_yetki (rol, menu_key, acik) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
                ['Kullanıcı', key, key === '/' || key.startsWith('/tms')]
            );
        }

        // ── Varsayılan modül izinleri (Süper Admin tüm yetki) ──
        const moduller = ['/tms', '/kullanicilar', '/yonetim', '/audit'];
        for (const m of moduller) {
            await client.query(
                `INSERT INTO modul_izin (rol, modul, goruntule, duzenle, ekle, sil)
                 VALUES ($1,$2,TRUE,TRUE,TRUE,TRUE)
                 ON CONFLICT (rol, modul) DO NOTHING`,
                ['Süper Admin', m]
            );
            await client.query(
                `INSERT INTO modul_izin (rol, modul, goruntule, duzenle, ekle, sil)
                 VALUES ($1,$2,TRUE,TRUE,TRUE,FALSE)
                 ON CONFLICT (rol, modul) DO NOTHING`,
                ['Admin', m]
            );
            await client.query(
                `INSERT INTO modul_izin (rol, modul, goruntule, duzenle, ekle, sil)
                 VALUES ($1,$2,TRUE,FALSE,FALSE,FALSE)
                 ON CONFLICT (rol, modul) DO NOTHING`,
                ['Kullanıcı', m]
            );
        }

        console.log('[init] Tablolar hazır.');
    } catch (err) {
        console.error('[init] DB init hatası:', err);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, initDb };
