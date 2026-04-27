const { pool } = require('../db');

function requireAuth(req, res, next) {
    res.set('Cache-Control', 'no-store');
    if (req.session?.user) return next();
    return res.redirect('/login');
}

async function requireAdmin(req, res, next) {
    if (!req.session?.user) return res.redirect('/login');
    try {
        const { rows } = await pool.query(
            'SELECT rol FROM personel WHERE LOWER(email) = LOWER($1) LIMIT 1',
            [req.session.user.email]
        );
        const rol = rows[0]?.rol;
        if (rol === 'Admin' || rol === 'Süper Admin') {
            req.userRol = rol;
            return next();
        }
        return res.status(403).send('Bu alana erişim yetkiniz yok.');
    } catch {
        return res.status(500).send('Yetki kontrolü başarısız.');
    }
}

module.exports = { requireAuth, requireAdmin };
