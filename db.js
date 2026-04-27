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

        // ── TMS: Lokasyonlar (Depo / Şube / Müşteri lokasyonu / Diğer) ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS tms_lokasyon (
                id              SERIAL PRIMARY KEY,
                ad              VARCHAR(200) NOT NULL,
                tip             VARCHAR(40)  DEFAULT 'Depo',
                kod             VARCHAR(40)  UNIQUE,
                adres           TEXT,
                sehir           VARCHAR(80),
                ilce            VARCHAR(80),
                telefon         VARCHAR(40),
                iletisim_kisi   VARCHAR(150),
                aktif           BOOLEAN DEFAULT TRUE,
                created_at      TIMESTAMP DEFAULT NOW()
            );
        `);

        // ── TMS: Ürün Grupları ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS tms_urun_grubu (
                id          SERIAL PRIMARY KEY,
                ad          VARCHAR(150) NOT NULL,
                kod         VARCHAR(40)  UNIQUE,
                aciklama    TEXT,
                aktif       BOOLEAN DEFAULT TRUE,
                created_at  TIMESTAMP DEFAULT NOW()
            );
        `);

        // ── TMS: Sevkiyatlar (ana kayıt) ──
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
                durum           VARCHAR(40) DEFAULT 'Plan Hazırlanıyor',
                aciklama        TEXT,
                created_at      TIMESTAMP DEFAULT NOW(),
                updated_at      TIMESTAMP DEFAULT NOW()
            );
        `);

        // ── TMS: Sevkiyat — yeni alanlar (idempotent) ──
        const sevkiyatExtraCols = [
            ['urun_grubu_id',     'INTEGER REFERENCES tms_urun_grubu(id) ON DELETE SET NULL'],
            ['sevkiyat_turu',     'VARCHAR(40)'],
            ['sevkiyat_kanali',   'VARCHAR(40)'],
            ['cikis_lokasyon_id', 'INTEGER REFERENCES tms_lokasyon(id) ON DELETE SET NULL'],
            ['varis_lokasyon_id', 'INTEGER REFERENCES tms_lokasyon(id) ON DELETE SET NULL'],
            ['planlamaci_id',     'INTEGER REFERENCES users(id) ON DELETE SET NULL'],
            ['lojistik_op_id',    'INTEGER REFERENCES users(id) ON DELETE SET NULL'],
            ['mal_kabul_id',      'INTEGER REFERENCES users(id) ON DELETE SET NULL'],
            ['planlanan_tarih',   'DATE'],
            ['cikis_tarihi',      'TIMESTAMP'],
            ['varis_tarihi',      'TIMESTAMP'],
            ['kapanis_tarihi',    'TIMESTAMP']
        ];
        for (const [name, type] of sevkiyatExtraCols) {
            await client.query(`ALTER TABLE tms_sevkiyat ADD COLUMN IF NOT EXISTS ${name} ${type};`);
        }

        // ── TMS: Sevkiyat kalemleri (yüklenecek ürünler) ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS tms_sevkiyat_kalem (
                id              SERIAL PRIMARY KEY,
                sevkiyat_id     INTEGER NOT NULL REFERENCES tms_sevkiyat(id) ON DELETE CASCADE,
                urun_kodu       VARCHAR(80),
                urun_adi        VARCHAR(255) NOT NULL,
                miktar          NUMERIC(12,3) NOT NULL DEFAULT 1,
                birim           VARCHAR(20) DEFAULT 'adet',
                aciklama        TEXT,
                created_at      TIMESTAMP DEFAULT NOW()
            );
        `);

        // ── TMS: Sevkiyat olayları (state geçişleri + log) ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS tms_sevkiyat_olay (
                id              SERIAL PRIMARY KEY,
                sevkiyat_id     INTEGER NOT NULL REFERENCES tms_sevkiyat(id) ON DELETE CASCADE,
                olay_tipi       VARCHAR(60) NOT NULL,
                onceki_durum    VARCHAR(40),
                yeni_durum      VARCHAR(40),
                kullanici_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
                kullanici_ad    VARCHAR(150),
                konum           VARCHAR(255),
                aciklama        TEXT,
                ts              TIMESTAMP DEFAULT NOW()
            );
        `);

        // ── TMS: İrsaliye (yükleme / teslim) ──
        await client.query(`
            CREATE TABLE IF NOT EXISTS tms_irsaliye (
                id              SERIAL PRIMARY KEY,
                sevkiyat_id     INTEGER NOT NULL REFERENCES tms_sevkiyat(id) ON DELETE CASCADE,
                tip             VARCHAR(20) NOT NULL,
                belge_no        VARCHAR(80),
                tarih           DATE,
                imzali          BOOLEAN DEFAULT FALSE,
                belge_url       TEXT,
                yukleyen_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
                aciklama        TEXT,
                created_at      TIMESTAMP DEFAULT NOW()
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
        const menuKeys = ['/', '/tms', '/tms/sevkiyatlar', '/tms/araclar', '/tms/soforler', '/tms/musteriler', '/tms/lokasyonlar', '/tms/urun-gruplari', '/tms/atama', '/kullanicilar', '/yonetim', '/audit'];
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
