const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireIzin } = require('../lib/izin');
const audit = require('../lib/audit');

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

/* ════════════════════════════════════════════════════
   LOKASYONLAR (Depo / Şube / Müşteri lokasyonu / Diğer)
   ════════════════════════════════════════════════════ */
const LOKASYON_TIPLERI = ['Depo', 'Şube', 'Müşteri', 'Tedarikçi', 'Diğer'];

router.get('/tms/lokasyonlar', requireAuth, requireIzin(MODUL, 'goruntule'), async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM tms_lokasyon ORDER BY ad ASC`);
        res.render('tms/lokasyonlar', {
            currentPage: '/tms/lokasyonlar',
            lokasyonlar: rows,
            tipler: LOKASYON_TIPLERI,
            izin: req.izin
        });
    } catch (err) {
        console.error('Lokasyonlar hatası:', err);
        res.status(500).send('Lokasyonlar yüklenemedi.');
    }
});

router.post('/tms/lokasyonlar', requireAuth, requireIzin(MODUL, 'ekle'), async (req, res) => {
    try {
        const { ad, tip, kod, adres, sehir, ilce, telefon, iletisim_kisi } = req.body;
        if (!ad || !ad.trim()) return res.status(400).json({ success: false, message: 'Ad zorunlu.' });
        const tipVal = LOKASYON_TIPLERI.includes(tip) ? tip : 'Depo';
        const { rows } = await pool.query(
            `INSERT INTO tms_lokasyon (ad, tip, kod, adres, sehir, ilce, telefon, iletisim_kisi)
             VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8) RETURNING id`,
            [ad.trim(), tipVal, (kod || '').trim() || null, adres || null, sehir || null, ilce || null, telefon || null, iletisim_kisi || null]
        );
        audit.log(req, { eylem: 'ekle', modul: '/tms', nesneTip: 'lokasyon', nesneId: rows[0].id, aciklama: `Lokasyon: ${ad}` });
        res.json({ success: true, id: rows[0].id });
    } catch (err) {
        console.error('Lokasyon ekleme hatası:', err);
        if (err.code === '23505') return res.status(400).json({ success: false, message: 'Bu kod zaten kullanılıyor.' });
        res.status(500).json({ success: false, message: 'Eklenemedi.' });
    }
});

router.post('/tms/lokasyonlar/:id', requireAuth, requireIzin(MODUL, 'duzenle'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { ad, tip, kod, adres, sehir, ilce, telefon, iletisim_kisi, aktif } = req.body;
        if (!ad || !ad.trim()) return res.status(400).json({ success: false, message: 'Ad zorunlu.' });
        const tipVal = LOKASYON_TIPLERI.includes(tip) ? tip : 'Depo';
        await pool.query(
            `UPDATE tms_lokasyon
                SET ad=$1, tip=$2, kod=NULLIF($3,''), adres=$4, sehir=$5, ilce=$6,
                    telefon=$7, iletisim_kisi=$8, aktif=$9
              WHERE id=$10`,
            [ad.trim(), tipVal, (kod || '').trim() || null, adres || null, sehir || null, ilce || null,
             telefon || null, iletisim_kisi || null, aktif === false || aktif === 'false' ? false : true, id]
        );
        audit.log(req, { eylem: 'duzenle', modul: '/tms', nesneTip: 'lokasyon', nesneId: id, aciklama: `Lokasyon: ${ad}` });
        res.json({ success: true });
    } catch (err) {
        console.error('Lokasyon güncelleme hatası:', err);
        if (err.code === '23505') return res.status(400).json({ success: false, message: 'Bu kod zaten kullanılıyor.' });
        res.status(500).json({ success: false, message: 'Güncellenemedi.' });
    }
});

router.post('/tms/lokasyonlar/:id/sil', requireAuth, requireIzin(MODUL, 'sil'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        await pool.query(`DELETE FROM tms_lokasyon WHERE id=$1`, [id]);
        audit.log(req, { eylem: 'sil', modul: '/tms', nesneTip: 'lokasyon', nesneId: id });
        res.json({ success: true });
    } catch (err) {
        console.error('Lokasyon silme hatası:', err);
        if (err.code === '23503') return res.status(400).json({ success: false, message: 'Bu lokasyon sevkiyatlarda kullanılıyor, silinemez.' });
        res.status(500).json({ success: false, message: 'Silinemedi.' });
    }
});

/* ════════════════════════════════════════════════════
   ÜRÜN GRUPLARI
   ════════════════════════════════════════════════════ */
router.get('/tms/urun-gruplari', requireAuth, requireIzin(MODUL, 'goruntule'), async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM tms_urun_grubu ORDER BY ad ASC`);
        res.render('tms/urun-gruplari', {
            currentPage: '/tms/urun-gruplari',
            gruplar: rows,
            izin: req.izin
        });
    } catch (err) {
        console.error('Ürün grupları hatası:', err);
        res.status(500).send('Ürün grupları yüklenemedi.');
    }
});

router.post('/tms/urun-gruplari', requireAuth, requireIzin(MODUL, 'ekle'), async (req, res) => {
    try {
        const { ad, kod, aciklama } = req.body;
        if (!ad || !ad.trim()) return res.status(400).json({ success: false, message: 'Ad zorunlu.' });
        const { rows } = await pool.query(
            `INSERT INTO tms_urun_grubu (ad, kod, aciklama) VALUES ($1, NULLIF($2,''), $3) RETURNING id`,
            [ad.trim(), (kod || '').trim() || null, aciklama || null]
        );
        audit.log(req, { eylem: 'ekle', modul: '/tms', nesneTip: 'urun_grubu', nesneId: rows[0].id, aciklama: `Ürün grubu: ${ad}` });
        res.json({ success: true, id: rows[0].id });
    } catch (err) {
        console.error('Ürün grubu ekleme hatası:', err);
        if (err.code === '23505') return res.status(400).json({ success: false, message: 'Bu kod zaten kullanılıyor.' });
        res.status(500).json({ success: false, message: 'Eklenemedi.' });
    }
});

router.post('/tms/urun-gruplari/:id', requireAuth, requireIzin(MODUL, 'duzenle'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { ad, kod, aciklama, aktif } = req.body;
        if (!ad || !ad.trim()) return res.status(400).json({ success: false, message: 'Ad zorunlu.' });
        await pool.query(
            `UPDATE tms_urun_grubu SET ad=$1, kod=NULLIF($2,''), aciklama=$3, aktif=$4 WHERE id=$5`,
            [ad.trim(), (kod || '').trim() || null, aciklama || null,
             aktif === false || aktif === 'false' ? false : true, id]
        );
        audit.log(req, { eylem: 'duzenle', modul: '/tms', nesneTip: 'urun_grubu', nesneId: id, aciklama: `Ürün grubu: ${ad}` });
        res.json({ success: true });
    } catch (err) {
        console.error('Ürün grubu güncelleme hatası:', err);
        if (err.code === '23505') return res.status(400).json({ success: false, message: 'Bu kod zaten kullanılıyor.' });
        res.status(500).json({ success: false, message: 'Güncellenemedi.' });
    }
});

router.post('/tms/urun-gruplari/:id/sil', requireAuth, requireIzin(MODUL, 'sil'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        await pool.query(`DELETE FROM tms_urun_grubu WHERE id=$1`, [id]);
        audit.log(req, { eylem: 'sil', modul: '/tms', nesneTip: 'urun_grubu', nesneId: id });
        res.json({ success: true });
    } catch (err) {
        console.error('Ürün grubu silme hatası:', err);
        if (err.code === '23503') return res.status(400).json({ success: false, message: 'Bu grup sevkiyatlarda kullanılıyor, silinemez.' });
        res.status(500).json({ success: false, message: 'Silinemedi.' });
    }
});

module.exports = router;
