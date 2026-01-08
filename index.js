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
const SECRET = process.env.BF_SECRET || 'bitfreeze_secret';

// ===== MIDDLEWARE =====
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ===== MONGODB =====
if (process.env.MONGO_URI) {
  mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log('MongoDB skipped:', err.message));
} else {
  console.log('MongoDB not configured (safe mode)');
}

// ===== SCHEMAS =====
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  phone: String,
  password: String,
  earning: { type: Number, default: 0 },
  fridges: { type: Array, default: [] },
  offerFridges: { type: Array, default: [] },
  transactions: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});

const offerCodeSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  amount: Number,
  usedBy: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});

const withdrawalSchema = new mongoose.Schema({
  id: String,
  email: String,
  phone: String,
  amount: Number,
  status: String,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const OfferCode = mongoose.models.OfferCode || mongoose.model('OfferCode', offerCodeSchema);
const Withdrawal = mongoose.models.Withdrawal || mongoose.model('Withdrawal', withdrawalSchema);

// ===== AUTH =====
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(h.split(' ')[1], SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ===== FRIDGES =====
const NORMAL_FRIDGES = [
  { id:'btc100', name:'Bitcoin 100 KES Fridge', price:100, dailyEarn:5, img:'/images/btc100.jpg' },
  { id:'btc200', name:'Bitcoin 200 KES Fridge', price:200, dailyEarn:10, img:'/images/btc200.jpg' },
  { id:'btc300', name:'Bitcoin 300 KES Fridge', price:300, dailyEarn:15, img:'/images/btc300.jpg' },
  { id:'btc400', name:'Bitcoin 400 KES Fridge', price:400, dailyEarn:20, img:'/images/btc400.jpg' },
  { id:'1ft', name:'Bitcoin 1ft Fridge', price:500, dailyEarn:25, img:'/images/fridge1ft.jpg' },
  { id:'2ft', name:'Bitcoin 2ft Fridge', price:1000, dailyEarn:55, img:'/images/fridge2ft.jpg' },
  { id:'3ft', name:'Bitcoin 3ft Fridge', price:2000, dailyEarn:100, img:'/images/fridge3ft.jpg' },
  { id:'4ft', name:'Bitcoin 4ft Fridge', price:4000, dailyEarn:150, img:'/images/fridge4ft.jpg' },
  { id:'5ft', name:'Bitcoin 5ft Fridge', price:6000, dailyEarn:250, img:'/images/fridge5ft.jpg' }
];

const OFFER_FRIDGES = [
  { id:'offer1', name:'🎁 Offer 1', price:0, dailyEarn:0, img:'/images/offer1.jpg', locked:true },
  { id:'offer2', name:'🎁 Offer 2', price:0, dailyEarn:0, img:'/images/offer2.jpg', locked:true },
  { id:'offer3', name:'🎁 Offer 3', price:0, dailyEarn:0, img:'/images/offer3.jpg', locked:true },
  { id:'offer4', name:'🎁 Offer 4', price:0, dailyEarn:0, img:'/images/offer4.jpg', locked:true },
  { id:'offer5', name:'🎁 Offer 5', price:0, dailyEarn:0, img:'/images/offer5.jpg', locked:true },
  { id:'offer6', name:'🎁 Offer 6', price:0, dailyEarn:0, img:'/images/offer6.jpg', locked:true },
  { id:'offer7', name:'🎁 Offer 7', price:0, dailyEarn:0, img:'/images/offer7.jpg', locked:true },
  { id:'offer8', name:'🎁 Offer 8', price:0, dailyEarn:0, img:'/images/offer8.jpg', locked:true }
];

// ===== ROUTES =====
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'public/dashboard.html')));
app.get('/dashboard',(req,res)=>res.sendFile(path.join(__dirname,'public/dashboard.html')));
app.get('/login',(req,res)=>res.sendFile(path.join(__dirname,'public/login.html')));
app.get('/register',(req,res)=>res.sendFile(path.join(__dirname,'public/register.html')));

// ===== AUTH =====
app.post('/api/register', async (req,res)=>{
  const {name,email,phone,password} = req.body;
  if(await User.findOne({email})) return res.status(400).json({error:'Email exists'});
  const user = new User({
    name,email,phone,
    password: await bcrypt.hash(password,10),
    earning: 0,
    fridges: [],
    offerFridges: [],
    transactions: []
  });
  await user.save();
  const token = jwt.sign({email},SECRET,{expiresIn:'7d'});
  res.json({token});
});

app.post('/api/login', async (req,res)=>{
  const u = await User.findOne({email:req.body.email});
  if(!u || !await bcrypt.compare(req.body.password,u.password))
    return res.status(400).json({error:'Invalid'});
  const token = jwt.sign({email:u.email},SECRET,{expiresIn:'7d'});
  res.json({token});
});

// ===== USER =====
app.get('/api/me', auth, async (req,res)=>{
  const u = await User.findOne({email:req.user.email});
  res.json({user:u});
});

// ===== FRIDGES =====
app.get('/api/fridges', auth, (req,res)=>res.json({fridges:NORMAL_FRIDGES, offers:OFFER_FRIDGES}));

app.post('/api/buy', auth, async (req,res)=>{
  const fridge = NORMAL_FRIDGES.find(f=>f.id===req.body.fridgeId);
  if(!fridge) return res.status(400).json({error:'Invalid fridge'});
  const u = await User.findOne({email:req.user.email});
  u.fridges.push(fridge);
  u.transactions.push({type:'BUY',amount:fridge.price,date:new Date(),status:'MPESA'});
  await u.save();
  res.json({message:`MPESA request sent for ${fridge.name}`});
});

// ===== OFFER CODE =====
app.post('/api/offercode', auth, async (req,res)=>{
  const code = await OfferCode.findOne({code:req.body.code});
  if(!code) return res.status(400).json({error:'Invalid code'});
  if(code.usedBy.includes(req.user.email))
    return res.status(400).json({error:'Code already used'});

  const u = await User.findOne({email:req.user.email});
  const amount = Number(code.amount) || 0;
  u.earning = (u.earning || 0) + amount;
  u.transactions.push({type:'OFFER',amount,date:new Date(),status:'CREDIT'});
  await u.save();

  code.usedBy.push(req.user.email);
  await code.save();
  res.json({message:`KES ${amount} added`});
});

// ===== WITHDRAW =====
app.post('/api/withdraw', auth, async (req,res)=>{
  const u = await User.findOne({email:req.user.email});
  const amount = Number(req.body.amount) || 0;
  if(u.earning < amount) return res.status(400).json({error:'Low balance'});
  u.earning = (u.earning || 0) - amount;
  await u.save();
  await new Withdrawal({
    id:crypto.randomUUID(),
    email:u.email,
    phone:req.body.phone,
    amount,
    status:'PENDING'
  }).save();
  res.json({message:'Withdrawal submitted'});
});

app.listen(PORT,()=>console.log(`✅ Bitfreeze running on http://localhost:${PORT}`));
