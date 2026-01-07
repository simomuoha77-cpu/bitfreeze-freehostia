require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.BF_SECRET || 'bitfreeze_dev_secret';
const DOMAIN = process.env.DOMAIN || `http://localhost:${PORT}`;

// ================= MIDDLEWARE =================
app.use(bodyParser.json());
app.use(cors({ origin: DOMAIN }));
app.use(express.static(path.join(__dirname, 'public')));

// ================= MONGODB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// ================= SCHEMAS =================
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  phone: { type: String, unique: true },
  password: String,
  earning: { type: Number, default: 0 },
  fridges: { type: Array, default: [] },
  offerFridges: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});

const withdrawalSchema = new mongoose.Schema({
  id: String,
  email: String,
  phone: String,
  amount: Number,
  status: String,
  requestedAt: { type: Date, default: Date.now },
  processedAt: { type: Date, default: null }
});

const User = mongoose.model('User', userSchema);
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// ================= AUTH =================
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer '))
    return res.status(401).json({ error: 'Unauthorized' });

  try {
    req.user = jwt.verify(h.slice(7), SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ================= FRIDGES =================
const NORMAL_FRIDGES = [
  { id: 'btc100', name: 'Bitcoin 100 KES Fridge', price: 100, dailyEarn: 5, img: 'images/btc100.jpg' },
  { id: 'btc200', name: 'Bitcoin 200 KES Fridge', price: 200, dailyEarn: 10, img: 'images/btc200.jpg' },
  { id: 'btc300', name: 'Bitcoin 300 KES Fridge', price: 300, dailyEarn: 15, img: 'images/btc300.jpg' },
  { id: 'btc400', name: 'Bitcoin 400 KES Fridge', price: 400, dailyEarn: 20, img: 'images/btc400.jpg' },
  { id: '1ft', name: 'Bitcoin 1ft Fridge', price: 500, dailyEarn: 25, img: 'images/fridge1ft.jpg' },
  { id: '2ft', name: 'Bitcoin 2ft Fridge', price: 1000, dailyEarn: 55, img: 'images/fridge2ft.jpg' },
  { id: '3ft', name: 'Bitcoin 3ft Fridge', price: 2000, dailyEarn: 100, img: 'images/fridge3ft.jpg' },
  { id: '4ft', name: 'Bitcoin 4ft Fridge', price: 4000, dailyEarn: 150, img: 'images/fridge4ft.jpg' },
  { id: '5ft', name: 'Bitcoin 5ft Fridge', price: 6000, dailyEarn: 250, img: 'images/fridge5ft.jpg' }
];

const OFFER_FRIDGES = [
  { id: 'offer1', name: '🎁 Offer 1', price: 0, earning: 0, img: 'images/offer1.jpg', locked: true },
  { id: 'offer2', name: '🎁 Offer 2', price: 0, earning: 0, img: 'images/offer2.jpg', locked: true },
  { id: 'offer3', name: '🎁 Offer 3', price: 0, earning: 0, img: 'images/offer3.jpg', locked: true },
  { id: 'offer4', name: '🎁 Offer 4', price: 0, earning: 0, img: 'images/offer4.jpg', locked: true },
  { id: 'offer5', name: '🎁 Offer 5', price: 0, earning: 0, img: 'images/offer5.jpg', locked: true },
  { id: 'offer6', name: '🎁 Offer 6', price: 0, earning: 0, img: 'images/offer6.jpg', locked: true },
  { id: 'offer7', name: '🎁 Offer 7', price: 0, earning: 0, img: 'images/offer7.jpg', locked: true },
  { id: 'offer8', name: '🎁 Offer 8', price: 0, earning: 0, img: 'images/offer8.jpg', locked: true }
];

// ================= FRONTEND ROUTES =================
app.get('/login', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/login.html'))
);

app.get('/register', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/register.html'))
);

app.get('/dashboard', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/dashboard.html'))
);

app.get('/', (req, res) => res.redirect('/dashboard'));

// ================= AUTH APIs =================
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !phone || !password)
      return res.status(400).json({ error: 'All fields required' });

    if (await User.findOne({ email }))
      return res.status(400).json({ error: 'Email exists' });

    if (await User.findOne({ phone }))
      return res.status(400).json({ error: 'Phone exists' });

    const hash = await bcrypt.hash(password, 10);
    const user = new User({ name, email, phone, password: hash });
    await user.save();

    const token = jwt.sign({ email }, SECRET, { expiresIn: '7d' });
    res.json({ token });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const u = await User.findOne({ email });
    if (!u) return res.status(400).json({ error: 'Invalid credentials' });
    if (!await bcrypt.compare(password, u.password))
      return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ email }, SECRET, { expiresIn: '7d' });
    res.json({ token });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================= USER =================
app.get('/api/me', auth, async (req, res) => {
  const u = await User.findOne({ email: req.user.email });
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ user: u });
});

// ================= FRIDGES =================
app.get('/api/fridges', auth, (req, res) =>
  res.json({ fridges: NORMAL_FRIDGES })
);

app.get('/api/offers', auth, (req, res) =>
  res.json({ offers: OFFER_FRIDGES })
);

// ================= BUY (MPESA SIMULATION) =================
app.post('/api/buy', auth, async (req, res) => {
  const f = NORMAL_FRIDGES.find(x => x.id === req.body.fridgeId);
  if (!f) return res.status(400).json({ error: 'Invalid fridge' });

  const u = await User.findOne({ email: req.user.email });
  u.fridges.push({ id: f.id, name: f.name, date: Date.now() });
  await u.save();

  res.json({ message: `MPESA request sent for ${f.name}` });
});

app.post('/api/buy-offer', auth, async (req, res) => {
  const o = OFFER_FRIDGES.find(x => x.id === req.body.offerId);
  if (!o) return res.status(400).json({ error: 'Invalid offer' });
  if (o.locked) return res.status(400).json({ error: 'Offer locked' });

  const u = await User.findOne({ email: req.user.email });
  u.offerFridges.push({ id: o.id, name: o.name, earning: o.earning });
  await u.save();

  res.json({ message: `MPESA request sent for ${o.name}` });
});

// ================= WITHDRAW =================
app.post('/api/withdraw', auth, async (req, res) => {
  const { amount, phone } = req.body;
  const u = await User.findOne({ email: req.user.email });

  if (phone !== u.phone)
    return res.status(400).json({ error: 'Wrong phone number' });

  if (u.earning < amount)
    return res.status(400).json({ error: 'Insufficient balance' });

  await new Withdrawal({
    id: crypto.randomUUID(),
    email: u.email,
    phone,
    amount,
    status: 'PENDING'
  }).save();

  res.json({ message: 'Withdrawal request sent' });
});

// ================= WITHDRAWALS (TRANSACTIONS) =================
app.get('/api/withdrawals', auth, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ email: req.user.email }).sort({ requestedAt: -1 });
    res.json({ withdrawals });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================= APPLY OFFER CODE =================
app.post('/api/apply-offer', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (code.toUpperCase() === 'BITFREEZE') {
      const u = await User.findOne({ email: req.user.email });
      u.earning += 100; // Dummy: Add 100 KES for valid code
      await u.save();
      res.json({ message: 'Offer applied! Earned 100 KES' });
    } else {
      res.status(400).json({ error: 'Invalid code' });
    }
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================= START =================
app.listen(PORT, () =>
  console.log(`✅ Bitfreeze running on http://localhost:${PORT}`)
);
