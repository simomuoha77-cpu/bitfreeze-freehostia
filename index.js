require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const { Telegraf, Markup } = require('telegraf');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.BF_SECRET;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// ================= MONGODB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
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
  fridges: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now },
  lastDepositAttempt: Date,
  lastWithdrawalAttempt: Date
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
  phone: String,
  transactionCode: String,
  approved: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Payment = mongoose.model('Payment', paymentSchema);

const withdrawalSchema = new mongoose.Schema({
  userEmail: String,
  phone: String,
  amount: Number,
  approved: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// ================= FRIDGES =================
let FRIDGES = [
  { id: '100', name: 'Earning Fridge 100', price: 100, dailyEarn: 5, img: 'images/fridge100.jpg', locked: false },
  { id: '200', name: 'Earning Fridge 200', price: 200, dailyEarn: 10, img: 'images/fridge200.jpg', locked: false },
  { id: '300', name: 'Earning Fridge 300', price: 300, dailyEarn: 15, img: 'images/fridge300.jpg', locked: false },
  { id: '400', name: 'Earning Fridge 400', price: 400, dailyEarn: 20, img: 'images/fridge400.jpg', locked: false },
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

// ================= EXPRESS SETUP =================
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// ================= ROUTES =================
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ================= REGISTER / LOGIN =================
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password || !phone) return res.status(400).json({ error: 'Missing fields' });
    if (await User.findOne({ email })) return res.status(400).json({ error: 'Email exists' });
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashed, phone });
    await user.save();
    const token = jwt.sign({ email: user.email }, SECRET, { expiresIn: '7d' });
    res.json({ token, email: user.email });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    if (!(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'Invalid credentials' });
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

// ================= GET FRIDGES =================
app.get('/api/fridges', auth, async (req, res) => {
  res.json({ fridges: FRIDGES });
});

// ================= PAYMENT SUBMISSION =================
app.post('/api/payment/submit', auth, async (req, res) => {
  try {
    const { fridgeId, phone, transactionCode } = req.body;
    const user = await User.findOne({ email: req.user.email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // ❌ Only allow one deposit until previous approved or 24h passed
    if (user.lastDepositAttempt) {
      const diff = Date.now() - new Date(user.lastDepositAttempt).getTime();
      if (diff < 24 * 60 * 60 * 1000) {
        const pending = await Payment.findOne({ userEmail: user.email, approved: false });
        if (pending) return res.status(400).json({ error: 'You already have a pending deposit. Wait for approval or 24h.' });
      }
    }

    const fridge = FRIDGES.find(f => f.id === fridgeId);
    if (!fridge) return res.status(400).json({ error: 'Invalid fridge' });
    if (fridge.locked) return res.status(400).json({ error: 'Fridge is locked' });

    const payment = new Payment({
      userEmail: user.email,
      fridgeId: fridge.id,
      fridgeName: fridge.name,
      fridgePrice: fridge.price,
      phone,
      transactionCode
    });
    await payment.save();

    user.lastDepositAttempt = new Date();
    await user.save();

    await bot.telegram.sendMessage(
      ADMIN_CHAT_ID,
      `💰 New Payment:\nUser: ${user.email}\nFridge: ${fridge.name}\nAmount: KES ${fridge.price}\nPhone: ${phone}\nTxn: ${transactionCode}`,
      Markup.inlineKeyboard([
        Markup.button.callback('✅ Approve', `approve_${payment._id}`),
        Markup.button.callback('❌ Reject', `reject_${payment._id}`)
      ])
    );

    res.json({ message: 'Payment submitted. Waiting for admin approval.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= REDEEM OFFER CODE =================
app.post('/api/offer/redeem', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'No code provided' });

    const user = await User.findOne({ email: req.user.email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const offer = await OfferCode.findOne({ code });
    if (!offer) return res.status(404).json({ error: 'Invalid offer code' });

    // ✅ Check if user has already redeemed
    if (offer.usedBy.includes(user.email)) {
      return res.status(400).json({ error: 'You have already redeemed this code' });
    }

    // ✅ Redeem the code
    user.earning += offer.amount;
    await user.save();

    // ✅ Mark code as used by this user
    offer.usedBy.push(user.email);
    await offer.save();

    res.json({ message: `Offer code redeemed! KES ${offer.amount} added to your earnings.` });
  } catch (err) {
    console.error('Redeem offer error:', err);
    res.status(500).json({ error: 'Server error while redeeming offer code' });
  }
});

// ================= ADMIN: OFFER CODE =================
app.post('/api/admin/offercode', auth, async (req, res) => {
  try {
    if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admin only' });
    const { code, amount } = req.body;
    if (!code || !amount) return res.status(400).json({ error: 'Missing fields' });

    const exists = await OfferCode.findOne({ code });
    if (exists) return res.status(400).json({ error: 'Offer code already exists' });

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

    res.json({ message: `${fridge.name} locked` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= DAILY EARNINGS =================
async function runDailyEarnings() {
  try {
    const users = await User.find();
    const now = Date.now();
    for (const u of users) {
      let earn = 0;
      for (const f of u.fridges) {
        const fridge = FRIDGES.find(fr => fr.id === f.id);
        if (!fridge) continue;
        if (!fridge.id.startsWith('offer')) earn += fridge.dailyEarn || 0;
        if (fridge.id.startsWith('offer') && fridge.startTime && fridge.durationHrs) {
          const endTime = new Date(fridge.startTime).getTime() + fridge.durationHrs * 3600 * 1000;
          if (now >= endTime) earn += fridge.price;
        }
      }
      u.earning += earn;
      await u.save();
    }
  } catch (err) { console.error('Daily earnings error:', err); }
}
setInterval(runDailyEarnings, 24 * 60 * 60 * 1000);

// ================= TELEGRAM BOT =================
const bot = new Telegraf(TELEGRAM_TOKEN);

bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data;

    if (data.startsWith('withdraw_')) {
      const [ , action, id ] = data.split('_');
      const wd = await Withdrawal.findById(id);
      if (!wd) return ctx.answerCbQuery('Withdrawal not found');
      const user = await User.findOne({ email: wd.userEmail });
      if (!user) return ctx.answerCbQuery('User not found');

      if (action === 'approve') {
        if (user.earning < wd.amount) return ctx.answerCbQuery('Insufficient earnings');
        user.earning -= wd.amount;
        await user.save();
        wd.approved = true;
        await wd.save();
        await ctx.editMessageText(`✅ Withdrawal Approved:\nUser: ${user.email}\nAmount: KES ${wd.amount}`);
      }
      if (action === 'reject') {
        await Withdrawal.findByIdAndDelete(id);
        await ctx.editMessageText(`❌ Withdrawal Rejected:\nUser: ${wd.userEmail}\nAmount: KES ${wd.amount}`);
      }
      return ctx.answerCbQuery();
    }

    const [actionType, paymentId] = data.split('_');
    if (actionType === 'approve' || actionType === 'reject') {
      const payment = await Payment.findById(paymentId);
      if (!payment) return ctx.answerCbQuery('Payment not found');
      const user = await User.findOne({ email: payment.userEmail });
      const fridge = FRIDGES.find(f => f.id === payment.fridgeId);
      if (!user || !fridge) return ctx.answerCbQuery('User or fridge not found');

      if (actionType === 'approve') {
        user.fridges.push({
          id: fridge.id,
          name: fridge.name,
          price: fridge.price,
          dailyEarn: fridge.dailyEarn,
          boughtAt: new Date()
        });
        await user.save();
        payment.approved = true;
        await payment.save();
        await ctx.editMessageText(`✅ Payment Approved: ${user.email} bought ${fridge.name}`);
      }
      if (actionType === 'reject') {
        await Payment.findByIdAndDelete(paymentId);
        await ctx.editMessageText(`❌ Payment Rejected: ${payment.userEmail} for ${fridge.name}`);
      }
      return ctx.answerCbQuery();
    }

  } catch (err) {
    console.error('Telegram callback error:', err);
    ctx.answerCbQuery('Error processing action');
  }
});

bot.launch().then(()=>console.log('Telegram bot running'));

// ================= USER WITHDRAWAL REQUEST =================
app.post('/api/withdraw', auth, async (req, res) => {
  try {
    const { phone, amount } = req.body;
    const user = await User.findOne({ email: req.user.email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // ❌ Only allow one withdrawal until approved or 24h passed
    if (user.lastWithdrawalAttempt) {
      const diff = Date.now() - new Date(user.lastWithdrawalAttempt).getTime();
      if (diff < 24 * 60 * 60 * 1000) {
        const pending = await Withdrawal.findOne({ userEmail: user.email, approved: false });
        if (pending) return res.status(400).json({ error: 'You already have a pending withdrawal. Wait for approval or 24h.' });
      }
    }

    // Minimum amount and phone check
    if (!phone || !amount || amount < 200) return res.status(400).json({ error: 'Invalid phone or amount (min 200 KES)' });
    if (user.phone !== phone) return res.status(400).json({ error: 'Withdrawal phone must match registered phone' });

    // Kenya time check
    const kenyaNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
    const day = kenyaNow.getDay();
    if (day === 0 || day === 6) return res.status(400).json({ error: 'Withdrawals are only allowed Monday to Friday' });

    if (user.earning < amount) return res.status(400).json({ error: 'Insufficient earnings' });

    const withdrawal = new Withdrawal({ userEmail: user.email, phone, amount });
    await withdrawal.save();

    user.lastWithdrawalAttempt = new Date();
    await user.save();

    await bot.telegram.sendMessage(
      ADMIN_CHAT_ID,
      `💸 New Withdrawal Request:\nUser: ${user.email}\nAmount: KES ${amount}\nPhone: ${phone}`,
      Markup.inlineKeyboard([
        Markup.button.callback('✅ Approve', `withdraw_approve_${withdrawal._id}`),
        Markup.button.callback('❌ Reject', `withdraw_reject_${withdrawal._id}`)
      ])
    );

    res.json({ message: 'Withdrawal request submitted. Waiting for admin approval.' });

  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= GRACEFUL SHUTDOWN =================
process.on('SIGINT', () => {
  console.log('Shutting down...');
  bot.stop('SIGINT');
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  bot.stop('SIGTERM');
  process.exit();
});

// ================= START SERVER =================
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
