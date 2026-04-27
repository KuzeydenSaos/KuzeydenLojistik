require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const compression = require('compression');
const path = require('path');

const { pool, initDb } = require('./db');
const { requireAuth } = require('./middleware/auth');

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    store: new PgSession({ pool, tableName: 'user_session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'lojistik-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 gün
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
    }
}));

// Tüm view'lara session.user erişimi
app.use((req, res, next) => {
    res.locals.user = req.session?.user || null;
    next();
});

// ── Routes ──
app.use(require('./routes/auth'));
app.use(require('./routes/tms'));
app.use(require('./routes/kullanicilar'));

// Anasayfa — dashboard
app.get('/', requireAuth, async (req, res) => {
    try {
        const [sevkiyatlar, araclar, soforler, musteriler, sonSevkiyat] = await Promise.all([
            pool.query('SELECT COUNT(*)::int AS n FROM tms_sevkiyat'),
            pool.query('SELECT COUNT(*)::int AS n FROM tms_arac'),
            pool.query('SELECT COUNT(*)::int AS n FROM tms_sofor'),
            pool.query('SELECT COUNT(*)::int AS n FROM tms_musteri'),
            pool.query(`
                SELECT s.id, s.kod, s.durum, s.yukleme_tarihi, s.tutar,
                       m.ad AS musteri_ad, a.plaka
                FROM tms_sevkiyat s
                LEFT JOIN tms_musteri m ON m.id = s.musteri_id
                LEFT JOIN tms_arac    a ON a.id = s.arac_id
                ORDER BY s.created_at DESC LIMIT 6
            `)
        ]);
        res.render('dashboard', {
            currentPage: '/',
            kpi: {
                sevkiyat: sevkiyatlar.rows[0].n,
                arac:     araclar.rows[0].n,
                sofor:    soforler.rows[0].n,
                musteri:  musteriler.rows[0].n
            },
            sonSevkiyat: sonSevkiyat.rows
        });
    } catch (err) {
        console.error('Dashboard hatası:', err);
        res.render('dashboard', {
            currentPage: '/',
            kpi: { sevkiyat: 0, arac: 0, sofor: 0, musteri: 0 },
            sonSevkiyat: []
        });
    }
});

// 404
app.use((req, res) => {
    if (req.session?.user) return res.status(404).render('404', { currentPage: req.path });
    res.redirect('/login');
});

const PORT = process.env.PORT || 3000;
initDb()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`✅ Lojistik sunucusu http://localhost:${PORT} adresinde çalışıyor`);
        });
    })
    .catch((err) => {
        console.error('❌ Sunucu başlatılamadı:', err);
        process.exit(1);
    });
