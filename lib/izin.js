const { pool } = require('../db');

// Kullanıcının verilen modülde sahip olduğu izinleri döner
async function getIzin(email, modul) {
    if (!email || !modul) return { goruntule: false, duzenle: false, ekle: false, sil: false };
    const { rows } = await pool.query(
        `SELECT mi.goruntule, mi.duzenle, mi.ekle, mi.sil
         FROM personel p
         JOIN modul_izin mi ON mi.rol = p.rol
         WHERE LOWER(p.email) = LOWER($1) AND mi.modul = $2
         LIMIT 1`,
        [email, modul]
    );
    return rows[0] || { goruntule: false, duzenle: false, ekle: false, sil: false };
}

// Belirli bir aksiyon için izin gerektir — middleware
function requireIzin(modul, aksiyon) {
    return async (req, res, next) => {
        if (!req.session?.user) return res.redirect('/login');
        const izin = await getIzin(req.session.user.email, modul);
        if (izin[aksiyon]) {
            req.izin = izin;
            return next();
        }
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(403).json({ success: false, message: 'Yetkiniz yok.' });
        }
        return res.status(403).send('Bu işlem için yetkiniz yok.');
    };
}

// Menü açık mı?
async function getMenuYetki(email) {
    if (!email) return {};
    const { rows } = await pool.query(
        `SELECT my.menu_key, my.acik
         FROM personel p
         JOIN menu_yetki my ON my.rol = p.rol
         WHERE LOWER(p.email) = LOWER($1)`,
        [email]
    );
    const map = {};
    for (const r of rows) map[r.menu_key] = !!r.acik;
    return map;
}

module.exports = { getIzin, requireIzin, getMenuYetki };
