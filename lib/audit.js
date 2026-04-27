const { pool } = require('../db');

// Async — fire and forget. Hata durumunda sadece console'a yaz.
function log(req, payload) {
    const data = payload || {};
    const ip = req?.ip || req?.headers?.['x-forwarded-for'] || null;
    const email = data.kullaniciEmail || req?.session?.user?.email || null;
    const ad    = data.kullaniciAd    || req?.session?.user?.name  || null;
    pool.query(
        `INSERT INTO audit_log (kullanici_email, kullanici_ad, eylem, modul, nesne_tip, nesne_id, aciklama, detay, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
            email,
            ad,
            data.eylem || null,
            data.modul || null,
            data.nesneTip || null,
            data.nesneId || null,
            data.aciklama || null,
            data.detay ? JSON.stringify(data.detay) : null,
            ip
        ]
    ).catch(err => console.error('[audit] hata:', err.message));
}

module.exports = { log };
