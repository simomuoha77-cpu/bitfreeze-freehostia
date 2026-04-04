require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const { Telegraf, Markup } = require('telegraf');
const cron = require('node-cron');
const axios = require('axios');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.BF_SECRET;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// ================= MONGODB =================
mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('MongoDB connected');
        try { await mongoose.connection.collection('withdrawals').dropIndexes(); console.log('Withdrawals indexes cleared'); } catch(e) {}
        try { await mongoose.connection.collection('payments').dropIndexes(); console.log('Payments indexes cleared'); } catch(e) {}
        await loadFridgeStates();
        await loadCommunityLinks();
    })
    .catch(err => {
        console.error('MongoDB error:', err);
        process.exit(1);
    });

// ================= SCHEMAS =================
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: String,
    phone: String,
    balance: { type: Number, default: 0 },
    earning: { type: Number, default: 0 },
    fridges: [{
        id: String,
        name: String,
        price: Number,
        dailyEarn: Number,
        boughtAt: Date,
        endTime: Date,
        earningAdded: Boolean,
        lastEarnedAt: Date
    }],
    createdAt: { type: Date, default: Date.now },
    lastDepositAttempt: Date,
    lastWithdrawalAttempt: Date,
    referredBy: { type: String, default: null },
    referralRewarded: { type: Boolean, default: false },
    banned: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

const offerCodeSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    amount: Number,
    usedBy: { type: Array, default: [] }
});
const OfferCode = mongoose.model('OfferCode', offerCodeSchema);

const paymentSchema = new mongoose.Schema({
    userEmail: String,
    fridgeId: String,
    fridgeName: String,
    fridgePrice: Number,
    fridgeDailyEarn: { type: Number, default: 0 },
    fridgeDurationHrs: { type: Number, default: 0 },
    phone: String,
    transactionCode: String,
    checkoutRequestId: String,   // STK Push CheckoutRequestID for callback matching
    stkStatus: { type: String, default: 'pending' }, // pending | success | failed | manual
    approved: { type: Boolean, default: false },
    revoked: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'payments' });
const Payment = mongoose.model('Payment', paymentSchema);

const withdrawalSchema = new mongoose.Schema({
    userEmail: String,
    phone: String,
    amount: Number,
    approved: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'withdrawals' });
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

const activityLogSchema = new mongoose.Schema({
    action: String,
    adminEmail: String,
    details: String,
    ip: String,
    createdAt: { type: Date, default: Date.now }
}, { collection: 'activitylogs' });
const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

const broadcastSchema = new mongoose.Schema({
    message: String,
    sentBy: String,
    sentAt: { type: Date, default: Date.now }
}, { collection: 'broadcasts' });
const Broadcast = mongoose.model('Broadcast', broadcastSchema);

const settingsSchema = new mongoose.Schema({
    key: { type: String, unique: true },
    value: { type: String, default: '' }
}, { collection: 'settings' });
const Settings = mongoose.model('Settings', settingsSchema);

const fridgeStateSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    locked: { type: Boolean, default: true },
    price: { type: Number, default: 0 },
    dailyEarn: { type: Number, default: 0 },
    durationHrs: { type: Number, default: 0 },
    startTime: { type: Date, default: null }
}, { collection: 'fridgestates' });
const FridgeState = mongoose.model('FridgeState', fridgeStateSchema);

// ================= FRIDGES =================
let FRIDGES = [
    { id: '100', name: 'low Earning Fridge 100', price: 100, dailyEarn: 5, img: 'images/fridge100.jpg', locked: false },
    { id: '200', name: 'low Earning Fridge 200', price: 200, dailyEarn: 10, img: 'images/fridge200.jpg', locked: false },
    { id: '300', name: 'low Earning Fridge 300', price: 300, dailyEarn: 15, img: 'images/fridge300.jpg', locked: false },
    { id: '400', name: 'low Earning Fridge 400', price: 400, dailyEarn: 20, img: 'images/fridge400.jpg', locked: false },
    { id: '2ft', name: '2 ft Fridge', price: 500, dailyEarn: 25, img: 'images/fridge2ft.jpg', locked: false },
    { id: '4ft', name: '4 ft Fridge', price: 1000, dailyEarn: 55, img: 'images/fridge4ft.jpg', locked: false },
    { id: '6ft', name: '6 ft Fridge', price: 2000, dailyEarn: 100, img: 'images/fridge6ft.jpg', locked: false },
    { id: '8ft', name: '8 ft Fridge', price: 4000, dailyEarn: 150, img: 'images/fridge8ft.jpg', locked: false },
    { id: '10ft', name: '10 ft Fridge', price: 6000, dailyEarn: 250, img: 'images/fridge10ft.jpg', locked: false },
    { id: '12ft', name: '12 ft Fridge', price: 8000, dailyEarn: 350, img: 'images/fridge12ft.jpg', locked: false },
    { id: 'offer1', name: 'Offer Fridge 1', price: 0, dailyEarn: 0, durationHrs: 0, startTime: null, img: 'images/offer1.jpg', locked: true },
    { id: 'offer2', name: 'Offer Fridge 2', price: 0, dailyEarn: 0, durationHrs: 0, startTime: null, img: 'images/offer2.jpg', locked: true },
    { id: 'offer3', name: 'Offer Fridge 3', price: 0, dailyEarn: 0, durationHrs: 0, startTime: null, img: 'images/offer3.jpg', locked: true },
    { id: 'offer4', name: 'Offer Fridge 4', price: 0, dailyEarn: 0, durationHrs: 0, startTime: null, img: 'images/offer4.jpg', locked: true },
    { id: 'offer5', name: 'Offer Fridge 5', price: 0, dailyEarn: 0, durationHrs: 0, startTime: null, img: 'images/offer5.jpg', locked: true },
    { id: 'offer6', name: 'Offer Fridge 6', price: 0, dailyEarn: 0, durationHrs: 0, startTime: null, img: 'images/offer6.jpg', locked: true },
    { id: 'offer7', name: 'Offer Fridge 7', price: 0, dailyEarn: 0, durationHrs: 0, startTime: null, img: 'images/offer7.jpg', locked: true },
    { id: 'offer8', name: 'Offer Fridge 8', price: 0, dailyEarn: 0, durationHrs: 0, startTime: null, img: 'images/offer8.jpg', locked: true },
];

// ================= FRIDGE STATE PERSISTENCE =================
async function loadFridgeStates() {
    try {
        const states = await FridgeState.find();
        for (const state of states) {
            const fridge = FRIDGES.find(f => f.id === state.id);
            if (fridge) {
                fridge.locked     = state.locked;
                fridge.price      = state.price;
                fridge.dailyEarn  = state.dailyEarn;
                fridge.durationHrs = state.durationHrs;
                fridge.startTime  = state.startTime;
            }
        }
        console.log(`✅ Loaded ${states.length} fridge states from MongoDB`);
    } catch(err) {
        console.error('loadFridgeStates error:', err);
    }
}

async function saveFridgeState(fridge) {
    try {
        await FridgeState.findOneAndUpdate(
            { id: fridge.id },
            {
                locked:      fridge.locked,
                price:       fridge.price,
                dailyEarn:   fridge.dailyEarn,
                durationHrs: fridge.durationHrs,
                startTime:   fridge.startTime
            },
            { upsert: true, new: true }
        );
    } catch(err) {
        console.error('saveFridgeState error:', err);
    }
}

// ================= REFERRAL RULES =================
const REFERRAL_RULES = [
    { min: 8000, reward: 500 },
    { min: 6000, reward: 350 },
    { min: 4000, reward: 250 },
    { min: 2000, reward: 150 },
    { min: 1000, reward: 100 },
    { min: 500,  reward: 50  },
    { min: 400,  reward: 40  },
    { min: 300,  reward: 30  },
    { min: 200,  reward: 20  },
    { min: 100,  reward: 10  },
];

function getReferralReward(depositAmount) {
    for (const rule of REFERRAL_RULES) {
        if (depositAmount >= rule.min) return rule.reward;
    }
    return 0;
}

// ================= IP BAN SYSTEM =================
// FIXED: was checking res.statusCode before response was sent (always 200 at that point)
const bannedIPs = new Set();
const suspiciousIPs = {};

app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;

    if (bannedIPs.has(ip)) {
        return res.status(403).send('Forbidden');
    }

    // Track 404s AFTER the response is actually sent
    res.on('finish', () => {
        if (res.statusCode === 404) {
            if (!suspiciousIPs[ip]) suspiciousIPs[ip] = { count: 0, firstSeen: Date.now() };
            suspiciousIPs[ip].count++;
            if (suspiciousIPs[ip].count > 20) {
                bannedIPs.add(ip);
                console.log(`🚨 Auto-banned IP ${ip} after suspicious activity`);
            }
        }
    });

    next();
});

// ================= COMMUNITY LINKS =================
let COMMUNITY_LINKS = { whatsapp: '', telegram: '' };

async function loadCommunityLinks() {
    try {
        const wa = await Settings.findOne({ key: 'whatsapp' });
        const tg = await Settings.findOne({ key: 'telegram' });
        if (wa) COMMUNITY_LINKS.whatsapp = wa.value;
        if (tg) COMMUNITY_LINKS.telegram = tg.value;
        console.log('✅ Community links loaded from MongoDB');
    } catch(err) { console.error('loadCommunityLinks error:', err); }
}

// ================= ADMIN SECURITY: LOGIN LOCKOUT =================
const adminLoginAttempts = {};
const ADMIN_MAX_ATTEMPTS = 3;
const ADMIN_LOCKOUT_MS = 30 * 60 * 1000;

function checkAdminLockout(ip) {
    const a = adminLoginAttempts[ip];
    if (!a) return { locked: false };
    if (a.lockedUntil && Date.now() < a.lockedUntil) {
        const mins = Math.ceil((a.lockedUntil - Date.now()) / 60000);
        return { locked: true, mins };
    }
    return { locked: false };
}

function recordFailedAdminLogin(ip) {
    if (!adminLoginAttempts[ip]) adminLoginAttempts[ip] = { count: 0, lockedUntil: null };
    adminLoginAttempts[ip].count++;
    if (adminLoginAttempts[ip].count >= ADMIN_MAX_ATTEMPTS) {
        adminLoginAttempts[ip].lockedUntil = Date.now() + ADMIN_LOCKOUT_MS;
        console.log(`🔒 Admin panel locked for IP ${ip}`);
    }
}

function clearAdminLockout(ip) {
    delete adminLoginAttempts[ip];
}

// ================= EXPRESS SETUP =================
app.set('trust proxy', 1);
app.use(cors());
app.use(bodyParser.json());

// ── SECURITY HEADERS ──
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.tradingview.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "frame-src https://www.tradingview.com; " +
        "img-src 'self' data: https:; " +
        "connect-src 'self' https://api.coingecko.com;"
    );
    res.removeHeader('X-Powered-By');
    next();
});

// ── BLOCK COMMON HACKING PATHS ──
const BLOCKED_PATHS = [
    '/wp-admin', '/wp-login', '/phpmyadmin', '/.env', '/.git',
    '/config', '/backup', '/shell', '/eval', '/cmd', '/exec',
    '/admin.php', '/login.php', '/wp-content', '/xmlrpc.php',
    '/.htaccess', '/server-status', '/actuator', '/api/v1/users',
    '/etc/passwd', '/proc/', '/cgi-bin', '/.well-known/security',
    '/telescope', '/laravel', '/debug', '/console', '/vendor'
];

app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    if (BLOCKED_PATHS.some(b => p.includes(b))) {
        console.log(`🚨 Blocked hacking attempt: ${req.ip} → ${req.path}`);
        bannedIPs.add(req.ip); // auto-ban immediately on known exploit paths
        return res.status(404).send('Not Found');
    }
    const query = req.url.toLowerCase();
    if (query.includes('select ') || query.includes('union ') ||
        query.includes('drop ') || query.includes('<script') ||
        query.includes('etc/passwd') || query.includes('cmd=') ||
        query.includes('../') || query.includes('eval(') ||
        query.includes('base64_decode') || query.includes('exec(')) {
        console.log(`🚨 Blocked SQL/XSS attempt: ${req.ip} → ${req.url}`);
        bannedIPs.add(req.ip);
        return res.status(403).send('Forbidden');
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── RATE LIMITERS ──
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

const adminLoginLimiter = rateLimit({
    windowMs: 30 * 60 * 1000,
    max: 5,
    message: { error: 'Too many admin login attempts. Try again later.' }
});

const paymentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    message: { error: 'Too many payment requests. Please wait a minute.' }
});

app.use('/api/', generalLimiter);
app.use('/api/login', loginLimiter);

// ── HIDE /admin ──
app.get('/admin', (req, res) => res.status(404).send('Not Found'));
app.get('/admin.html', (req, res) => res.status(404).send('Not Found'));

// ================= AUTH =================
function auth(req, res, next) {
    const a = req.headers.authorization;
    if (!a || !a.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = jwt.verify(a.slice(7), SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// ================= M-PESA CONFIG =================
// IMPORTANT: For Till number (Buy Goods), use:
//   M_PESA_SHORTCODE  = your Till number
//   M_PESA_PASSKEY    = Passkey from Daraja portal (not the Till PIN)
//   TransactionType   = "CustomerBuyGoodsOnline"
//   PartyB            = your Till number
const M_PESA_SHORTCODE       = process.env.M_PESA_SHORTCODE;       // Your Till number
const M_PESA_LIVE_URL        = process.env.M_PESA_LIVE_URL;         // https://api.safaricom.co.ke
const M_PESA_CONSUMER_KEY    = process.env.M_PESA_CONSUMER_KEY;
const M_PESA_CONSUMER_SECRET = process.env.M_PESA_CONSUMER_SECRET;
const M_PESA_PASSKEY         = process.env.M_PESA_PASSKEY;          // Daraja passkey (not PIN)
const CALLBACK_URL           = process.env.CALLBACK_URL;            // e.g. https://yoursite.com/api/payment/mpesa/callback

// Format phone to 254XXXXXXXXX
function formatPhone(phone) {
    const clean = String(phone).replace(/\s+/g, '').replace(/[^0-9+]/g, '');
    if (clean.startsWith('+254')) return clean.slice(1);         // +254XXXXXXXXX → 254XXXXXXXXX
    if (clean.startsWith('254'))  return clean;                  // already good
    if (clean.startsWith('0'))    return '254' + clean.slice(1); // 07XXXXXXXX → 2547XXXXXXXX
    return '254' + clean;
}

// ── STK Push (Till / Buy Goods) ──
async function initiateStkPush(phone, amount) {
    const formattedPhone = formatPhone(phone);

    // Step 1: Get access token
    const tokenAuth = Buffer.from(`${M_PESA_CONSUMER_KEY}:${M_PESA_CONSUMER_SECRET}`).toString('base64');
    const tokenResponse = await axios.get(
        `${M_PESA_LIVE_URL}/oauth/v1/generate?grant_type=client_credentials`,
        { headers: { Authorization: `Basic ${tokenAuth}` } }
    );
    const accessToken = tokenResponse.data.access_token;

    // Step 2: Build timestamp and password
    // Password = Base64(ShortCode + Passkey + Timestamp)
    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
    const password = Buffer.from(`${M_PESA_SHORTCODE}${M_PESA_PASSKEY}${timestamp}`).toString('base64');

    // Step 3: Build STK payload
    // CustomerBuyGoodsOnline = Till number (not Paybill)
    const payload = {
        BusinessShortCode: M_PESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerBuyGoodsOnline',  // ✅ CORRECT for Till number
        Amount: Math.ceil(amount),                  // must be integer
        PartyA: formattedPhone,
        PartyB: M_PESA_SHORTCODE,                   // Till number
        PhoneNumber: formattedPhone,
        CallBackURL: CALLBACK_URL,
        AccountReference: 'Bitfreeze',
        TransactionDesc: 'Fridge Purchase'
    };

    const stkResponse = await axios.post(
        `${M_PESA_LIVE_URL}/mpesa/stkpush/v1/processrequest`,
        payload,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    // Daraja returns ResponseCode "0" for success
    if (stkResponse.data.ResponseCode !== '0') {
        throw new Error(stkResponse.data.ResponseDescription || 'STK Push failed');
    }

    return stkResponse.data; // contains CheckoutRequestID, MerchantRequestID
}

// ================= ROUTES =================
app.get('/login',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manifest.json')));
app.get('/sw.js',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'sw.js')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/dashboard',(req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
// Secret admin URL
app.get('/manage-bf-2025', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ================= REGISTER / LOGIN =================
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;
        let { referrerEmail } = req.body;

        if (!name || !email || !password || !phone) return res.status(400).json({ error: 'Missing fields' });
        if (await User.findOne({ email })) return res.status(400).json({ error: 'Email exists' });

        const cleanPhone = phone.replace(/\s/g, '');
        if (!cleanPhone.match(/^(\+254|0)[17]\d{8}$/)) {
            return res.status(400).json({ error: 'Please enter a valid Kenyan M-Pesa number (e.g. 0712345678)' });
        }

        if (referrerEmail && referrerEmail.includes('ref=')) {
            const match = referrerEmail.match(/ref=([^&]+)/);
            if (match) referrerEmail = decodeURIComponent(match[1]);
        }
        if (referrerEmail && referrerEmail.includes('/')) referrerEmail = null;

        const hashed = await bcrypt.hash(password, 10);
        const user = new User({ name, email, password: hashed, phone });
        await user.save();

        if (referrerEmail && referrerEmail !== email) {
            const referrer = await User.findOne({ email: referrerEmail });
            if (referrer) {
                user.referredBy = referrerEmail;
                await user.save();
                console.log(`✅ User ${email} registered via referral from ${referrerEmail}`);
            }
        }

        const token = jwt.sign({ email: user.email }, SECRET, { expiresIn: '7d' });
        res.json({ token, email: user.email });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', adminLoginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const ip = req.ip || req.connection.remoteAddress;

        if (email === ADMIN_EMAIL) {
            const lockout = checkAdminLockout(ip);
            if (lockout.locked) {
                return res.status(429).json({ error: `Admin account locked. Try again in ${lockout.mins} minute(s).` });
            }
        }

        const user = await User.findOne({ email });
        if (!user) {
            if (email === ADMIN_EMAIL) recordFailedAdminLogin(ip);
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        if (!(await bcrypt.compare(password, user.password))) {
            if (email === ADMIN_EMAIL) recordFailedAdminLogin(ip);
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        if (user.banned && email !== ADMIN_EMAIL) {
            return res.status(403).json({ error: 'Your account has been suspended. Contact support.' });
        }

        if (email === ADMIN_EMAIL) {
            clearAdminLockout(ip);
            await ActivityLog.create({ action: 'ADMIN_LOGIN', adminEmail: email, details: 'Successful login', ip });
        }

        const token = jwt.sign({ email: user.email }, SECRET, { expiresIn: '7d' });
        res.json({ token, email: user.email });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= GET PROFILE =================
app.get('/api/me', auth, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ error: 'Not found' });
        res.json({ user, isAdmin: user.email === ADMIN_EMAIL });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: MANUALLY TRIGGER DAILY EARNINGS =================
app.post('/api/admin/run-earnings', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        await runDailyEarnings();
        const today = new Date();
        const todayKey = new Date(today.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
        await Settings.findOneAndUpdate({ key: 'last_earnings_date' }, { value: todayKey }, { upsert: true });
        res.json({ message: 'Daily earnings run successfully!' });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: FORCE CREDIT OFFER EARNINGS =================
app.post('/api/admin/force-credit', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        await checkAndCreditOfferEarnings();
        res.json({ message: 'Offer earnings check completed.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ONE-TIME FIX: Repair missing boughtAt and dailyEarn =================
app.post('/api/admin/fix-user-fridges', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const users = await User.find({ 'fridges.0': { $exists: true } });
        let fixed = 0, skipped = 0;

        for (const user of users) {
            let changed = false;
            for (let i = 0; i < user.fridges.length; i++) {
                const f = user.fridges[i];
                if (!f.boughtAt) {
                    user.fridges[i].boughtAt = new Date('2026-01-01T00:00:00Z');
                    changed = true;
                }
                if (!f.id.startsWith('offer') && (!f.dailyEarn || f.dailyEarn === 0)) {
                    const pmt = await Payment.findOne({
                        userEmail: user.email,
                        fridgeId: f.id,
                        approved: true
                    }).sort({ createdAt: -1 });

                    if (pmt && pmt.fridgeDailyEarn) {
                        user.fridges[i].dailyEarn = pmt.fridgeDailyEarn;
                        changed = true;
                    } else {
                        const gf = FRIDGES.find(fr => fr.id === f.id);
                        if (gf && gf.dailyEarn) {
                            user.fridges[i].dailyEarn = gf.dailyEarn;
                            changed = true;
                        }
                    }
                }
            }
            if (changed) {
                user.markModified('fridges');
                await user.save();
                fixed++;
            } else { skipped++; }
        }
        res.json({ message: `Fixed ${fixed} users, skipped ${skipped} users`, fixed, skipped });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================= DEBUG: CHECK ALL USER FRIDGES =================
app.get('/api/admin/debug/all-fridges', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const now = new Date();
        const users = await User.find({ 'fridges.0': { $exists: true } }, '-password');
        const report = users.map(u => ({
            email: u.email,
            earning: u.earning,
            fridges: u.fridges.map(f => ({
                id: f.id,
                name: f.name,
                dailyEarn: f.dailyEarn,
                boughtAt: f.boughtAt,
                hoursSinceBuy: f.boughtAt ? ((now - new Date(f.boughtAt)) / (1000*60*60)).toFixed(1) : 'NO boughtAt!',
                qualifies: f.boughtAt ? ((now - new Date(f.boughtAt)) / (1000*60*60)) >= 24 : false,
                isOffer: f.id.startsWith('offer'),
                earningAdded: f.earningAdded
            }))
        }));
        res.json({ now, report });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================= DEBUG: CHECK OFFER FRIDGE DATA =================
app.get('/api/admin/debug/offers', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const users = await User.find({ 'fridges.0': { $exists: true } }, '-password');
        const report = [];
        for (const u of users) {
            const offerFridges = u.fridges.filter(f => f.id && f.id.startsWith('offer'));
            if (offerFridges.length === 0) continue;
            report.push({
                email: u.email,
                earning: u.earning,
                offerFridges: offerFridges.map(f => ({
                    id: f.id,
                    dailyEarn: f.dailyEarn,
                    endTime: f.endTime,
                    earningAdded: f.earningAdded,
                    endTimePassed: f.endTime ? new Date() >= new Date(f.endTime) : null,
                    boughtAt: f.boughtAt
                }))
            });
        }
        res.json({ now: new Date(), report });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= GET FRIDGES =================
app.get('/api/fridges', auth, async (req, res) => {
    res.json({ fridges: FRIDGES });
});

// ================= PAYMENT: STK PUSH (PRIMARY METHOD) =================
app.post('/api/payment/submit', auth, paymentLimiter, async (req, res) => {
    try {
        const { fridgeId } = req.body;
        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const fridge = FRIDGES.find(f => f.id === fridgeId);
        if (!fridge) return res.status(400).json({ error: 'Invalid fridge' });
        if (fridge.locked) return res.status(400).json({ error: 'Fridge is locked' });

        // Block duplicate pending STK payments for same fridge
        const pendingPayment = await Payment.findOne({
            userEmail: user.email,
            fridgeId: fridge.id,
            approved: false,
            stkStatus: { $in: ['pending', 'success'] }
        });
        if (pendingPayment) {
            return res.status(400).json({
                error: 'You already have a pending payment for this fridge. Please wait for admin approval.'
            });
        }

        // Initiate STK Push
        let stkData;
        try {
            stkData = await initiateStkPush(user.phone, fridge.price);
        } catch (stkErr) {
            console.error('STK Push failed:', stkErr.message);
            return res.status(502).json({ error: 'M-Pesa prompt failed. Check your phone number or try again.' });
        }

        // Save payment with CheckoutRequestID so callback can match it
        const payment = new Payment({
            userEmail: user.email,
            fridgeId: fridge.id,
            fridgeName: fridge.name,
            fridgePrice: fridge.price,
            fridgeDailyEarn: fridge.dailyEarn || 0,
            fridgeDurationHrs: fridge.durationHrs || 0,
            phone: user.phone,
            checkoutRequestId: stkData.CheckoutRequestID,
            stkStatus: 'pending'
        });
        await payment.save();

        await bot.telegram.sendMessage(
            ADMIN_CHAT_ID,
            `📲 STK Push Sent\n━━━━━━━━━━━━━━━━━━\nUser: ${user.email}\nFridge: ${fridge.name}\nAmount: KES ${fridge.price}\nPhone: ${user.phone}\nCheckoutID: ${stkData.CheckoutRequestID}\n\nWaiting for M-Pesa callback...`
        );

        res.json({
            message: 'M-Pesa prompt sent to your phone. Enter your PIN to complete payment.',
            checkoutRequestId: stkData.CheckoutRequestID
        });
    } catch (err) {
        console.error('Payment submit error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ================= M-PESA STK CALLBACK (called by Safaricom) =================
// SECURITY: Only Safaricom IPs should hit this endpoint
const SAFARICOM_IPS = [
    '196.201.214.200', '196.201.214.206', '196.201.213.114',
    '196.201.214.207', '196.201.214.208', '196.201.213.44',
    '196.201.212.127', '196.201.212.138', '196.201.212.129',
    '196.201.212.136', '196.201.212.74', '196.201.212.69'
];

app.post('/api/payment/mpesa/callback', async (req, res) => {
    // Validate Safaricom IP (skip check in dev/test environments)
    if (process.env.NODE_ENV === 'production') {
        const callerIP = req.ip || req.connection.remoteAddress;
        const cleanIP = callerIP.replace('::ffff:', '');
        if (!SAFARICOM_IPS.includes(cleanIP)) {
            console.log(`🚨 Callback rejected from unknown IP: ${cleanIP}`);
            return res.status(403).json({ error: 'Forbidden' });
        }
    }

    // Always respond 200 immediately — Safaricom retries if you're slow
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

    try {
        const body = req.body;
        const stkCallback = body?.Body?.stkCallback;
        if (!stkCallback) return;

        const checkoutRequestId = stkCallback.CheckoutRequestID;
        const resultCode = stkCallback.ResultCode;

        const payment = await Payment.findOne({ checkoutRequestId });
        if (!payment) {
            console.log(`⚠️ Callback received for unknown CheckoutRequestID: ${checkoutRequestId}`);
            return;
        }

        if (resultCode === 0) {
            // Payment successful — extract M-Pesa transaction code
            const items = stkCallback.CallbackMetadata?.Item || [];
            const mpesaCode = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
            const amount    = items.find(i => i.Name === 'Amount')?.Value;
            const phone     = items.find(i => i.Name === 'PhoneNumber')?.Value;

            payment.transactionCode = mpesaCode || '';
            payment.stkStatus = 'success';
            await payment.save();

            console.log(`✅ M-Pesa payment confirmed: ${mpesaCode} | KES ${amount} | ${phone}`);

            await bot.telegram.sendMessage(
                ADMIN_CHAT_ID,
                `✅ M-Pesa Payment Confirmed!\n━━━━━━━━━━━━━━━━━━\nUser: ${payment.userEmail}\nFridge: ${payment.fridgeName}\nAmount: KES ${amount}\nM-Pesa Code: ${mpesaCode}\nPhone: ${phone}\n\n👉 Go to Admin Panel to approve`
            );
        } else {
            // Payment failed or cancelled
            payment.stkStatus = 'failed';
            await payment.save();

            const desc = stkCallback.ResultDesc || 'Payment failed';
            console.log(`❌ STK payment failed for ${payment.userEmail}: ${desc}`);

            try {
                await bot.telegram.sendMessage(
                    ADMIN_CHAT_ID,
                    `❌ STK Payment Failed\nUser: ${payment.userEmail}\nFridge: ${payment.fridgeName}\nReason: ${desc}`
                );
            } catch(e) {}
        }
    } catch (err) {
        console.error('Callback processing error:', err);
    }
});

// ================= PAYMENT: MANUAL (FALLBACK — enter code if STK fails) =================
app.post('/api/payment/manual', auth, async (req, res) => {
    try {
        const { fridgeId, txnCode } = req.body;
        if (!fridgeId || !txnCode || txnCode.length < 8)
            return res.status(400).json({ error: 'Missing fridge or invalid transaction code' });

        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const fridge = FRIDGES.find(f => f.id === fridgeId);
        if (!fridge) return res.status(400).json({ error: 'Invalid fridge' });
        if (fridge.locked) return res.status(400).json({ error: 'Fridge is locked' });

        const duplicate = await Payment.findOne({ transactionCode: txnCode.toUpperCase() });
        if (duplicate) return res.status(400).json({ error: 'Transaction code already used' });

        const pendingPayment = await Payment.findOne({
            userEmail: user.email,
            fridgeId: fridge.id,
            approved: false
        });
        if (pendingPayment) return res.status(400).json({
            error: 'You already have a pending payment for this fridge.'
        });

        const payment = new Payment({
            userEmail: user.email,
            fridgeId: fridge.id,
            fridgeName: fridge.name,
            fridgePrice: fridge.price,
            fridgeDailyEarn: fridge.dailyEarn || 0,
            fridgeDurationHrs: fridge.durationHrs || 0,
            phone: user.phone,
            transactionCode: txnCode.toUpperCase(),
            stkStatus: 'manual'
        });
        await payment.save();

        await bot.telegram.sendMessage(
            ADMIN_CHAT_ID,
            `💰 Manual Payment Submitted\n━━━━━━━━━━━━━━━━━━\nUser: ${user.email}\nPhone: ${user.phone}\nFridge: ${fridge.name}\nAmount: KES ${fridge.price}\nM-Pesa Code: ${txnCode.toUpperCase()}\n\n👉 Go to Admin Panel to approve`
        );

        res.json({ message: 'Payment submitted! Awaiting admin verification.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= ADMIN: GET ALL PAYMENTS =================
app.get('/api/admin/payments', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const payments = await Payment.find().sort({ createdAt: -1 });
        res.json({ payments });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: APPROVE PAYMENT =================
app.post('/api/admin/payment/approve', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { paymentId } = req.body;
        const payment = await Payment.findById(paymentId);
        if (!payment) return res.status(404).json({ error: 'Payment not found' });
        if (payment.approved) return res.status(400).json({ error: 'Already approved' });

        const user = await User.findOne({ email: payment.userEmail });
        const fridge = FRIDGES.find(f => f.id === payment.fridgeId);
        if (!user || !fridge) return res.status(404).json({ error: 'User or fridge not found' });

        if (fridge.id.startsWith('offer')) {
            const earnToSave = payment.fridgeDailyEarn || fridge.dailyEarn || 0;
            const durationHrs = payment.fridgeDurationHrs || fridge.durationHrs || 24;
            const endTime = new Date(Date.now() + durationHrs * 60 * 60 * 1000);
            user.fridges.push({
                id: fridge.id,
                name: fridge.name,
                price: payment.fridgePrice || fridge.price,
                dailyEarn: earnToSave,
                boughtAt: new Date(),
                endTime,
                earningAdded: false
            });
        } else {
            const earnToSave = payment.fridgeDailyEarn || fridge.dailyEarn || 0;
            user.fridges.push({
                id: fridge.id,
                name: fridge.name,
                price: payment.fridgePrice || fridge.price,
                dailyEarn: earnToSave,
                boughtAt: new Date()
            });
        }

        user.markModified('fridges');
        await user.save();
        payment.approved = true;
        await payment.save();

        if (user.referredBy && !user.referralRewarded) {
            const reward = getReferralReward(payment.fridgePrice || 0);
            if (reward > 0) {
                const referrer = await User.findOne({ email: user.referredBy });
                if (referrer) {
                    referrer.earning += reward;
                    await referrer.save();
                    user.referralRewarded = true;
                    await user.save();
                    console.log(`✅ Referral reward: KES ${reward} credited to ${user.referredBy}`);
                }
            }
        }

        res.json({ message: 'Payment approved and fridge assigned' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: REJECT PAYMENT =================
app.post('/api/admin/payment/reject', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { paymentId } = req.body;
        await Payment.findByIdAndDelete(paymentId);
        res.json({ message: 'Payment rejected and removed' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: GET ALL WITHDRAWALS =================
app.get('/api/admin/withdrawals', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const withdrawals = await Withdrawal.find().sort({ createdAt: -1 });
        res.json({ withdrawals });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: APPROVE WITHDRAWAL =================
app.post('/api/admin/withdrawal/approve', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { withdrawalId } = req.body;
        const wd = await Withdrawal.findById(withdrawalId);
        if (!wd) return res.status(404).json({ error: 'Withdrawal not found' });
        if (wd.approved) return res.status(400).json({ error: 'Already approved' });

        const user = await User.findOne({ email: wd.userEmail });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.earning < wd.amount) return res.status(400).json({ error: 'User has insufficient earnings' });

        user.earning -= wd.amount;
        await user.save();
        wd.approved = true;
        await wd.save();
        res.json({ message: 'Withdrawal approved' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: REJECT WITHDRAWAL =================
app.post('/api/admin/withdrawal/reject', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { withdrawalId } = req.body;
        await Withdrawal.findByIdAndDelete(withdrawalId);
        res.json({ message: 'Withdrawal rejected and removed' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: GET ALL USERS =================
app.get('/api/admin/users', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const users = await User.find({}, '-password').sort({ createdAt: -1 });
        res.json({ users });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: EDIT USER BALANCE =================
app.post('/api/admin/user/edit', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { email, balance, earning } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (balance !== undefined) user.balance = Number(balance);
        if (earning !== undefined) user.earning = Number(earning);
        await user.save();
        res.json({ message: 'User updated successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= REDEEM OFFER CODE =================
app.post('/api/offer/redeem', auth, async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'No code provided' });

        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const hasDeposit = await Payment.findOne({
            userEmail: user.email,
            approved: true,
            fridgeId: { $not: /^offer/ }
        });
        if (!hasDeposit) {
            return res.status(400).json({ error: 'You must deposit at least KES 100 (buy a normal fridge) before redeeming offer codes.' });
        }

        const offer = await OfferCode.findOne({ code });
        if (!offer) return res.status(404).json({ error: 'Invalid offer code' });

        user.earning += offer.amount;
        await user.save();
        await OfferCode.findOneAndDelete({ code });

        res.json({ message: `Successfully redeemed! KES ${offer.amount} added to your earnings.` });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ================= OFFER: FRONTEND PINGS THIS WHEN TIMER ENDS =================
app.post('/api/offer/expired/:fridgeId', auth, async (req, res) => {
    try {
        await checkAndCreditOfferEarnings();
        res.json({ message: 'Earnings checked and credited if due' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= ADMIN: OFFER CODE =================
app.post('/api/admin/offercode', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { code, amount } = req.body;
        if (!code || !amount) return res.status(400).json({ error: 'Missing fields' });

        const exists = await OfferCode.findOne({ code });
        if (exists) return res.status(400).json({ error: 'Offer code exists' });

        const oc = new OfferCode({ code, amount });
        await oc.save();
        res.json({ message: 'Offer code created', code, amount });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: UNLOCK / LOCK FRIDGE =================
app.post('/api/admin/unlock', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { fridgeId, price, dailyEarn, durationHrs } = req.body;

        const fridge = FRIDGES.find(f => f.id === fridgeId && fridgeId.startsWith('offer'));
        if (!fridge) return res.status(400).json({ error: 'Invalid fridge' });

        fridge.locked = false;
        fridge.price = price;
        fridge.dailyEarn = dailyEarn;
        fridge.durationHrs = durationHrs;
        fridge.startTime = new Date();
        await saveFridgeState(fridge);

        res.json({ message: `${fridge.name} unlocked for ${durationHrs} hours` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/lock', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { fridgeId } = req.body;

        const fridge = FRIDGES.find(f => f.id === fridgeId && fridgeId.startsWith('offer'));
        if (!fridge) return res.status(400).json({ error: 'Invalid fridge' });

        fridge.locked = true;
        fridge.price = 0;
        fridge.dailyEarn = 0;
        fridge.durationHrs = 0;
        fridge.startTime = null;
        await saveFridgeState(fridge);

        res.json({ message: `${fridge.name} locked` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= DAILY EARNINGS & AUTO-LOCK OFFERS =================
async function checkAndCreditOfferEarnings() {
    try {
        const now = new Date();
        const users = await User.find({ 'fridges.0': { $exists: true } });

        for (const user of users) {
            let credited = false;
            for (let i = 0; i < user.fridges.length; i++) {
                const f = user.fridges[i];
                if (!f.id || !f.id.startsWith('offer')) continue;
                if (f.earningAdded) continue;
                if (!f.endTime) continue;
                if (now < new Date(f.endTime)) continue;

                let amount = f.dailyEarn || 0;
                if (amount === 0) {
                    const pmt = await Payment.findOne({
                        userEmail: user.email,
                        fridgeId: f.id,
                        approved: true
                    }).sort({ createdAt: -1 });
                    if (pmt && pmt.fridgeDailyEarn) amount = pmt.fridgeDailyEarn;
                }

                user.earning += amount;
                user.fridges[i].earningAdded = true;
                user.markModified('fridges');
                credited = true;
                console.log(`✅ Credited KES ${amount} to ${user.email} for ${f.id}`);
            }
            if (credited) await user.save();
        }

        for (const fridge of FRIDGES) {
            if (!fridge.id.startsWith('offer') || fridge.locked) continue;
            if (fridge.startTime && fridge.durationHrs) {
                const endTime = new Date(fridge.startTime).getTime() + fridge.durationHrs * 3600 * 1000;
                if (now.getTime() >= endTime) {
                    fridge.locked = true;
                    fridge.price = 0;
                    fridge.dailyEarn = 0;
                    fridge.durationHrs = 0;
                    fridge.startTime = null;
                    await saveFridgeState(fridge);
                    console.log(`🔒 Auto-locked ${fridge.id}`);
                }
            }
        }
    } catch (err) {
        console.error('Offer earnings check error:', err);
    }
}

<<<<<<< HEAD
// ── Mutex flag to prevent concurrent runDailyEarnings calls ──
let earningsRunning = false;

// ── DAILY EARNINGS: 12:00 AM Kenya time (UTC+3 = 21:00 UTC) for normal fridges ──
async function runDailyEarnings() {
    // ✅ MUTEX: if already running (e.g. midnight cron + hourly cron fire at same second), skip
    if (earningsRunning) {
        console.log('⚠️ runDailyEarnings already in progress — skipping duplicate call');
=======
let earningsRunning = false;

async function runDailyEarnings() {
    if (earningsRunning) {
        console.log('⚠️ runDailyEarnings already in progress — skipping');
>>>>>>> f0e6183 (Backup 2026-04-04 18:41:46)
        return;
    }
    earningsRunning = true;
    try {
        const users = await User.find();
        const now = new Date();
<<<<<<< HEAD
        // Kenya date string e.g. "2026-03-27"
=======
>>>>>>> f0e6183 (Backup 2026-04-04 18:41:46)
        const todayKenya = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
        let totalCredited = 0;
        let usersUpdated = 0;

        for (const user of users) {
            let earnThisRun = 0;
            let changed = false;

            for (let i = 0; i < user.fridges.length; i++) {
                const f = user.fridges[i];
                if (!f.id || f.id.startsWith('offer')) continue;
                const dailyEarn = f.dailyEarn || 0;
                if (dailyEarn <= 0) continue;
                const boughtAt = f.boughtAt ? new Date(f.boughtAt) : null;
                if (!boughtAt) continue;
                const hoursSinceBuy = (now - boughtAt) / (1000 * 60 * 60);
                if (hoursSinceBuy < 24) continue;

<<<<<<< HEAD
                // ✅ DEDUP: skip if already credited today (Kenya date)
                const lastEarnedAt = f.lastEarnedAt ? new Date(f.lastEarnedAt) : null;
                if (lastEarnedAt) {
                    const lastEarnedKenya = new Date(lastEarnedAt.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
                    if (lastEarnedKenya === todayKenya) continue; // already credited today, skip
                }

                earnThisRun += dailyEarn;
                user.fridges[i].lastEarnedAt = now; // mark as credited today
=======
                const lastEarnedAt = f.lastEarnedAt ? new Date(f.lastEarnedAt) : null;
                if (lastEarnedAt) {
                    const lastEarnedKenya = new Date(lastEarnedAt.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
                    if (lastEarnedKenya === todayKenya) continue;
                }

                earnThisRun += dailyEarn;
                user.fridges[i].lastEarnedAt = now;
>>>>>>> f0e6183 (Backup 2026-04-04 18:41:46)
                changed = true;
            }

            if (earnThisRun > 0 && changed) {
                user.markModified('fridges');
                await User.updateOne(
                    { _id: user._id },
<<<<<<< HEAD
                    {
                        $inc: { earning: earnThisRun },
                        $set: { fridges: user.fridges }
                    }
=======
                    { $inc: { earning: earnThisRun }, $set: { fridges: user.fridges } }
>>>>>>> f0e6183 (Backup 2026-04-04 18:41:46)
                );
                totalCredited += earnThisRun;
                usersUpdated++;
                console.log(`✅ Credited KES ${earnThisRun} to ${user.email}`);
            }
        }

        console.log(`✅ Daily earnings DONE: KES ${totalCredited} to ${usersUpdated} users`);

        try {
            if (typeof bot !== 'undefined' && usersUpdated > 0) {
                await bot.telegram.sendMessage(
                    ADMIN_CHAT_ID,
                    `💰 Daily Earnings Credited\n━━━━━━━━━━━━━━━━━━\nUsers: ${usersUpdated}\nTotal: KES ${totalCredited}\nTime: ${now.toLocaleString('en-KE', {timeZone:'Africa/Nairobi'})}`
                );
            }
        } catch(e) {}
    } catch (err) {
        console.error('Daily earnings error:', err);
    } finally {
<<<<<<< HEAD
        earningsRunning = false; // always release the lock
=======
        earningsRunning = false;
>>>>>>> f0e6183 (Backup 2026-04-04 18:41:46)
    }
}

async function checkMissedEarnings() {
    try {
        const now = new Date();
        const kenyaHour = new Date(now.getTime() + 3 * 60 * 60 * 1000).getUTCHours();
        if (kenyaHour >= 0 && kenyaHour <= 2) {
            const todayKey = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
            const alreadyRan = await Settings.findOne({ key: 'last_earnings_date' });
            if (!alreadyRan || alreadyRan.value !== todayKey) {
                console.log('🔄 Running missed daily earnings for', todayKey);
                await runDailyEarnings();
                await Settings.findOneAndUpdate(
                    { key: 'last_earnings_date' },
                    { value: todayKey },
                    { upsert: true }
                );
            }
        }
    } catch(err) {
        console.error('checkMissedEarnings error:', err);
    }
}

// ================= TELEGRAM BOT =================
const bot = new Telegraf(TELEGRAM_TOKEN);

bot.launch().then(() => console.log('Telegram bot running'))
.catch(err => {
    if (err.message && err.message.includes('409')) {
        console.log('⚠️ Telegram bot already running elsewhere. Skipping local launch.');
    } else {
        console.error('Telegram bot error:', err.message);
    }
});

// ================= CRON JOBS =================
cron.schedule('* * * * *', checkAndCreditOfferEarnings);
cron.schedule('0 21 * * *', async () => {
    const now = new Date();
    const todayKey = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await runDailyEarnings();
    await Settings.findOneAndUpdate({ key: 'last_earnings_date' }, { value: todayKey }, { upsert: true });
}, { timezone: 'UTC' });
cron.schedule('0 * * * *', checkMissedEarnings);
console.log('✅ All cron jobs scheduled');

// ================= USER WITHDRAWAL REQUEST =================
app.post('/api/withdraw', auth, async (req, res) => {
    try {
        const { phone, amount } = req.body;
        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const kenyaDate = new Date(Date.now() + 3 * 60 * 60 * 1000);
        const dayOfWeek = kenyaDate.getUTCDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            return res.status(400).json({ error: 'Withdrawals are only available Monday to Friday.' });
        }

        const hasDeposit = await Payment.findOne({
            userEmail: user.email,
            approved: true,
            fridgeId: { $not: /^offer/ }
        });
        if (!hasDeposit) {
            return res.status(400).json({ error: 'You must first deposit (buy a normal fridge starting from KES 100) before withdrawing.' });
        }

        const pendingWd = await Withdrawal.findOne({ userEmail: user.email, approved: false });
        if (pendingWd) {
            return res.status(400).json({ error: 'You already have a pending withdrawal. Please wait before submitting again.' });
        }

        if (!phone || !amount || amount < 200) {
            return res.status(400).json({ error: 'Invalid phone or amount (min 200 KES)' });
        }

        if (user.phone !== phone) {
            return res.status(400).json({ error: 'Phone must match registered phone' });
        }

        if (user.earning < amount) {
            return res.status(400).json({ error: 'Insufficient earnings' });
        }

        const withdrawal = new Withdrawal({ userEmail: user.email, phone, amount });
        await withdrawal.save();
        user.lastWithdrawalAttempt = new Date();
        await user.save();

        await bot.telegram.sendMessage(
            ADMIN_CHAT_ID,
            `💸 Withdrawal Request\n━━━━━━━━━━━━━━━━━━\nUser: ${user.email}\nAmount: KES ${amount}\nPhone: ${phone}\n\n👉 Go to Admin Panel to approve`
        );

        res.json({ message: 'Withdrawal request submitted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= GET COMMUNITY LINKS =================
app.get('/api/links', (req, res) => {
    res.json(COMMUNITY_LINKS);
});

// ================= ADMIN: UPDATE COMMUNITY LINKS =================
app.post('/api/admin/links', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { whatsapp, telegram } = req.body;
        if (whatsapp !== undefined) {
            COMMUNITY_LINKS.whatsapp = whatsapp;
            await Settings.findOneAndUpdate({ key: 'whatsapp' }, { value: whatsapp }, { upsert: true });
        }
        if (telegram !== undefined) {
            COMMUNITY_LINKS.telegram = telegram;
            await Settings.findOneAndUpdate({ key: 'telegram' }, { value: telegram }, { upsert: true });
        }
        res.json({ message: 'Links updated', ...COMMUNITY_LINKS });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: STATS =================
app.get('/api/admin/stats', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const [users, payments, withdrawals] = await Promise.all([
            User.find({}, 'earning balance fridges createdAt'),
            Payment.find({ approved: true }),
            Withdrawal.find({ approved: true })
        ]);
        const totalRevenue = payments.reduce((s, p) => s + (p.fridgePrice || 0), 0);
        const totalWithdrawn = withdrawals.reduce((s, w) => s + (w.amount || 0), 0);
        const totalEarnings = users.reduce((s, u) => s + (u.earning || 0), 0);
        const totalFridgesBought = payments.length;
        const newUsersToday = users.filter(u => {
            const d = new Date(u.createdAt);
            return d.toDateString() === new Date().toDateString();
        }).length;
        res.json({
            totalUsers: users.length,
            newUsersToday,
            totalRevenue,
            totalWithdrawn,
            totalEarnings,
            totalFridgesBought,
            pendingPayments: await Payment.countDocuments({ approved: false }),
            pendingWithdrawals: await Withdrawal.countDocuments({ approved: false })
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: SEARCH USERS =================
app.get('/api/admin/users/search', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { q } = req.query;
        if (!q) return res.json({ users: [] });
        const users = await User.find({
            $or: [
                { email: { $regex: q, $options: 'i' } },
                { phone: { $regex: q, $options: 'i' } },
                { name:  { $regex: q, $options: 'i' } }
            ]
        }, '-password').limit(20);
        res.json({ users });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: ACTIVITY LOG =================
app.get('/api/admin/logs', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const logs = await ActivityLog.find().sort({ createdAt: -1 }).limit(100);
        res.json({ logs });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: BROADCAST MESSAGE =================
app.post('/api/admin/broadcast', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message required' });
        await Broadcast.create({ message, sentBy: req.user.email });
        await ActivityLog.create({ action: 'BROADCAST', adminEmail: req.user.email, details: message.slice(0, 100) });
        res.json({ message: 'Broadcast saved successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= GET LATEST BROADCAST =================
app.get('/api/broadcast/latest', auth, async (req, res) => {
    try {
        const b = await Broadcast.findOne().sort({ sentAt: -1 });
        res.json({ broadcast: b || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: LOG ACTIONS =================
async function logAction(adminEmail, action, details, ip = '') {
    try {
        await ActivityLog.create({ action, adminEmail, details, ip });
    } catch(e) {}
}

// ================= TRADING: DEPOSIT KES → USD =================
app.post('/api/trade/deposit', auth, async (req, res) => {
    try {
        const { amountKES } = req.body;
        if (!amountKES || amountKES < 130)
            return res.status(400).json({ error: 'Minimum deposit is KES 130' });

        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.earning < amountKES)
            return res.status(400).json({ error: 'Insufficient earnings balance' });

        user.earning -= amountKES;
        await user.save();

        const usd = (amountKES / 130).toFixed(2);
        res.json({ message: `Deposited $${usd} to trading balance`, usdAmount: parseFloat(usd) });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================= TRADING: WITHDRAW USD → KES =================
app.post('/api/trade/withdraw', auth, async (req, res) => {
    try {
        const { amountUSD } = req.body;
        if (!amountUSD || amountUSD < 1)
            return res.status(400).json({ error: 'Minimum withdrawal is $1.00' });

        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const kes = Math.floor(amountUSD * 125);
        user.earning += kes;
        await user.save();

        res.json({ message: `Withdrawn KES ${kes} from trading balance`, kesAmount: kes });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: REVOKE APPROVED PAYMENT =================
app.post('/api/admin/payment/revoke', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { paymentId } = req.body;
        const payment = await Payment.findById(paymentId);
        if (!payment) return res.status(404).json({ error: 'Payment not found' });
        if (!payment.approved) return res.status(400).json({ error: 'Payment not yet approved' });

        const user = await User.findOne({ email: payment.userEmail });
        if (user) {
            user.fridges = user.fridges.filter(f => f.id !== payment.fridgeId);
            user.markModified('fridges');
            await user.save();
        }

        payment.approved = false;
        payment.revoked = true;
        await payment.save();

        await ActivityLog.create({
            action: 'PAYMENT_REVOKED',
            adminEmail: req.user.email,
            details: `Payment ${paymentId} revoked for ${payment.userEmail}`
        });

        res.json({ message: 'Payment approval revoked successfully' });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: GET FULL USER DETAILS =================
app.get('/api/admin/user/:email', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const user = await User.findOne({ email: req.params.email }, '-password');
        if (!user) return res.status(404).json({ error: 'User not found' });
        const payments = await Payment.find({ userEmail: req.params.email }).sort({ createdAt: -1 });
        const withdrawals = await Withdrawal.find({ userEmail: req.params.email }).sort({ createdAt: -1 });
        res.json({ user, payments, withdrawals });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: REMOVE FRIDGE FROM USER =================
app.post('/api/admin/user/remove-fridge', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { email, fridgeIndex } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.fridges.splice(fridgeIndex, 1);
        user.markModified('fridges');
        await user.save();
        await ActivityLog.create({
            action: 'FRIDGE_REMOVED',
            adminEmail: req.user.email,
            details: `Fridge at index ${fridgeIndex} removed from ${email}`
        });
        res.json({ message: 'Fridge removed successfully' });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: RESET USER PASSWORD =================
app.post('/api/admin/user/reset-password', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { email, newPassword } = req.body;
        if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password too short' });
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ message: 'Password reset successfully' });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN: BAN/UNBAN USER =================
app.post('/api/admin/user/ban', auth, async (req, res) => {
    try {
        if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
        const { email, banned } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.banned = banned;
        await user.save();
        await ActivityLog.create({
            action: banned ? 'USER_BANNED' : 'USER_UNBANNED',
            adminEmail: req.user.email,
            details: email
        });
        res.json({ message: banned ? 'User banned' : 'User unbanned' });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================= GRACEFUL SHUTDOWN =================
process.on('SIGINT',  () => { bot.stop('SIGINT');  process.exit(); });
process.on('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(); });

// ================= START SERVER =================
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
