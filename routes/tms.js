const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireIzin } = require('../lib/izin');

const MODUL = '/tms';

// TMS Dashboard
router.get('/tms', requireAuth, requireIzin(MODUL, 'goruntule'), async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT
                (SELECT COUNT(*)::int FROM tms_sevkiyat) AS toplam_sevkiyat,
                (SELECT COUNT(*)::int FROM tms_sevkiyat WHERE durum = 'Yolda') AS yoldaki,
                (SELECT COUNT(*)::int FROM tms_arac) AS toplam_arac,
                (SELECT COUNT(*)::int FROM tms_arac WHERE durum = 'Müsait') AS musait_arac,
                (SELECT COUNT(*)::int FROM tms_sofor) AS toplam_sofor,
                (SELECT COUNT(*)::int FROM tms_musteri) AS toplam_musteri
        `);
        res.render('tms/index', {
            currentPage: '/tms',
            stats: stats.rows[0],
            izin: req.izin
        });
    } catch (err) {
        console.error('TMS dashboard hatası:', err);
        res.status(500).send('TMS dashboard yüklenemedi.');
    }
});

// Sevkiyatlar
router.get('/tms/sevkiyatlar', requireAuth, requireIzin(MODUL, 'goruntule'), async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT s.*, m.ad AS musteri_ad, a.plaka, sf.ad_soyad AS sofor_ad
            FROM tms_sevkiyat s
            LEFT JOIN tms_musteri m ON m.id = s.musteri_id
            LEFT JOIN tms_arac a ON a.id = s.arac_id
            LEFT JOIN tms_sofor sf ON sf.id = s.sofor_id
            ORDER BY s.created_at DESC
        `);
        res.render('tms/sevkiyatlar', { currentPage: '/tms/sevkiyatlar', sevkiyatlar: rows, izin: req.izin });
    } catch (err) {
        console.error('Sevkiyatlar hatası:', err);
        res.status(500).send('Sevkiyatlar yüklenemedi.');
    }
});

// Araçlar
router.get('/tms/araclar', requireAuth, requireIzin(MODUL, 'goruntule'), async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT a.*, sf.ad_soyad AS sofor_ad
            FROM tms_arac a
            LEFT JOIN tms_sofor sf ON sf.id = a.aktif_sofor
            ORDER BY a.plaka ASC
        `);
        res.render('tms/araclar', { currentPage: '/tms/araclar', araclar: rows, izin: req.izin });
    } catch (err) {
        console.error('Araçlar hatası:', err);
        res.status(500).send('Araçlar yüklenemedi.');
    }
});

// Şoförler
router.get('/tms/soforler', requireAuth, requireIzin(MODUL, 'goruntule'), async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM tms_sofor ORDER BY ad_soyad ASC`);
        res.render('tms/soforler', { currentPage: '/tms/soforler', soforler: rows, izin: req.izin });
    } catch (err) {
        console.error('Şoförler hatası:', err);
        res.status(500).send('Şoförler yüklenemedi.');
    }
});

// Müşteriler
router.get('/tms/musteriler', requireAuth, requireIzin(MODUL, 'goruntule'), async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM tms_musteri ORDER BY ad ASC`);
        res.render('tms/musteriler', { currentPage: '/tms/musteriler', musteriler: rows, izin: req.izin });
    } catch (err) {
        console.error('Müşteriler hatası:', err);
        res.status(500).send('Müşteriler yüklenemedi.');
    }
});

module.exports = router;
