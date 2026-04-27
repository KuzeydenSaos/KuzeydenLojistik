const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const audit = require('../lib/audit');

// GET /login
router.get('/login', (req, res) => {
    if (req.session?.user) return res.redirect('/');
    res.render('login', { message: null });
});

// POST /login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Hatalı e-posta veya şifre.' });
        }
        const user = rows[0];
        const isHashed = user.password && user.password.startsWith('$2');
        const valid = isHashed
            ? await bcrypt.compare(password, user.password)
            : (user.password === password);
        if (!valid) return res.status(401).json({ success: false, message: 'Hatalı e-posta veya şifre.' });

        // İşten çıkış yapılan personel girişini engelle
        const { rows: pRows } = await pool.query(
            'SELECT account_enabled FROM personel WHERE LOWER(email) = LOWER($1) LIMIT 1',
            [email]
        );
        if (pRows.length > 0 && pRows[0].account_enabled === false) {
            return res.status(403).json({ success: false, message: 'Hesabınız devre dışı bırakılmış.' });
        }

        req.session.user = { id: user.id, name: user.name, email: user.email };
        await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
        audit.log(req, { eylem: 'login', modul: '/auth', nesneId: user.id, aciklama: 'Sisteme giriş yapıldı' });
        res.json({ success: true });
    } catch (err) {
        console.error('Login hatası:', err);
        res.status(500).json({ success: false, message: 'Sunucu hatası.' });
    }
});

// POST /logout
router.post('/logout', (req, res) => {
    const email = req.session?.user?.email;
    req.session.destroy(() => {
        if (email) audit.log({ session: { user: { email } } }, { eylem: 'logout', modul: '/auth' });
        res.redirect('/login');
    });
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
