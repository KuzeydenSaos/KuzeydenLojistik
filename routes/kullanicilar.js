const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireIzin, getIzin } = require('../lib/izin');
const audit = require('../lib/audit');

const MODUL = '/kullanicilar';

// Kullanıcı listesi
router.get('/kullanicilar', requireAuth, requireIzin(MODUL, 'goruntule'), async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM personel ORDER BY ad_soyad ASC');
        const izin = await getIzin(req.session.user.email, MODUL);
        res.render('kullanicilar', { currentPage: '/kullanicilar', personeller: rows, izin });
    } catch (err) {
        console.error('Kullanicilar hatasi:', err);
        res.status(500).send('Liste yüklenemedi.');
    }
});

// Yeni personel ekle
router.post('/kullanicilar/ekle', requireAuth, requireIzin(MODUL, 'ekle'), async (req, res) => {
    const { ad_soyad, email, telefon, departman, unvan, rol, password } = req.body;
    try {
        await pool.query(
            `INSERT INTO personel (ad_soyad, email, telefon, departman, unvan, rol)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [ad_soyad, email, telefon, departman, unvan, rol || 'Kullanıcı']
        );
        if (email && password) {
            const hash = await bcrypt.hash(password, 10);
            await pool.query(
                `INSERT INTO users (name, email, password) VALUES ($1,$2,$3)
                 ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, name = EXCLUDED.name`,
                [ad_soyad, email, hash]
            );
        }
        audit.log(req, { eylem: 'ekle', modul: MODUL, aciklama: `Personel eklendi: ${ad_soyad}` });
        res.json({ success: true });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ success: false, message: 'Bu e-posta zaten kayıtlı.' });
        console.error('Personel ekleme hatasi:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
