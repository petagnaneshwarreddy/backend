// index.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
app.use(express.json());

// CORS setup
app.use(cors({
  origin: ["https://skillfull-technologies.vercel.app"],
  methods: ["GET", "POST"],
  credentials: true
}));

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
transporter.verify((err) => {
  if (err) console.error("❌ Nodemailer error:", err);
  else console.log("✅ Nodemailer transporter ready");
});

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("✅ MongoDB connected ✅"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// -------------------- MODELS --------------------

// Credentials model
const CredentialSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt:{ type: Date, default: Date.now }
});
const Credential = mongoose.model("Credential", CredentialSchema);

// OTP model
const OtpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 } // 5 minutes
});
const Otp = mongoose.model("Otp", OtpSchema);

// Enrollment model (optional)
const EnrollmentSchema = new mongoose.Schema({
  courseTitle: String,
  certificateId: String,
  fullName: String,
  email: String,
  phone: String,
  collegeName: String,
  state: String,
  duration: String,
  createdAt: { type: Date, default: Date.now }
});
const Enrollment = mongoose.model("Enrollment", EnrollmentSchema);

// -------------------- ROUTES --------------------

// Send OTP
app.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    await Otp.findOneAndUpdate(
      { email },
      { otp: otpCode, createdAt: new Date() },
      { upsert: true, new: true }
    );

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your OTP Code",
      html: `<p>Your OTP code is <strong>${otpCode}</strong>. It will expire in 5 minutes.</p>`
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ OTP sent to ${email}: ${otpCode}`);
    res.status(200).json({ message: "OTP sent successfully!" });

  } catch (err) {
    console.error("❌ OTP error:", err);
    res.status(500).json({ message: "Failed to send OTP" });
  }
});

// Register new user with OTP verification
app.post("/register", async (req, res) => {
  try {
    const { username, email, password, otp } = req.body;

    const otpRecord = await Otp.findOne({ email, otp });
    if (!otpRecord) return res.status(400).json({ message: "Invalid or expired OTP" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const cred = new Credential({
      username,
      email,
      password: hashedPassword
    });
    await cred.save();

    await Otp.deleteOne({ _id: otpRecord._id });

    res.status(201).json({ message: "Registered successfully!" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Registration failed" });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password required" });

    const user = await Credential.findOne({ email });
    if (!user) return res.status(400).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: user._id, email: user.email, username: user.username },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "1h" }
    );

    res.status(200).json({ message: "Login successful", token });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

// Reset password with OTP
app.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword)
      return res.status(400).json({ message: "Email, OTP, and new password are required" });

    const otpRecord = await Otp.findOne({ email, otp: otp.toString() });
    if (!otpRecord) return res.status(400).json({ message: "Invalid or expired OTP" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updated = await Credential.findOneAndUpdate(
      { email },
      { password: hashedPassword },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "User not found" });

    await Otp.deleteOne({ _id: otpRecord._id });

    res.status(200).json({ message: "Password reset successful!" });
  } catch (err) {
    console.error("❌ Reset password error:", err);
    res.status(500).json({ message: "Server error while resetting password" });
  }
});

// Enrollment route (optional)
app.post("/api/enroll", async (req, res) => {
  try {
    const enrollment = new Enrollment(req.body);
    await enrollment.save();

    res.status(201).json({ msg: "Enrollment saved successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error while saving enrollment" });
  }
});

// Root
app.get("/", (req, res) => {
  res.json({ message: "Backend is running 🚀" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
