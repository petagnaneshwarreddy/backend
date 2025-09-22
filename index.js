// index.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(express.json());

// -------------------- CORS --------------------
app.use(cors({
  origin: ["https://skillfull-technologies.vercel.app"],
  methods: ["GET", "POST", "PUT"],
  credentials: true
}));

// Serve profile images statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// -------------------- Multer Setup --------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./uploads");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});
const upload = multer({ storage });

// -------------------- Nodemailer --------------------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
transporter.verify(err => {
  if (err) console.error("❌ Nodemailer error:", err);
  else console.log("✅ Nodemailer transporter ready");
});

// -------------------- MongoDB --------------------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ MongoDB connected ✅"))
.catch(err => console.error("❌ MongoDB connection error:", err));

// -------------------- MODELS --------------------

// Credential Model
const CredentialSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  profilePic: { type: String, default: "" },
  createdAt:{ type: Date, default: Date.now }
});
const Credential = mongoose.model("Credential", CredentialSchema);

// OTP Model
const OtpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 } // 5 min
});
const Otp = mongoose.model("Otp", OtpSchema);

// Enrollment Model (optional)
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

// 🔹 Send OTP
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
      html: `<p>Your OTP code is <strong>${otpCode}</strong>. It expires in 5 minutes.</p>`
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ OTP sent to ${email}: ${otpCode}`);
    res.status(200).json({ message: "OTP sent successfully!" });

  } catch (err) {
    console.error("❌ OTP error:", err);
    res.status(500).json({ message: "Failed to send OTP" });
  }
});

// 🔹 Register (OTP verification)
app.post("/register", async (req, res) => {
  try {
    const { username, email, password, otp } = req.body;

    const otpRecord = await Otp.findOne({ email, otp });
    if (!otpRecord) return res.status(400).json({ message: "Invalid or expired OTP" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new Credential({ username, email, password: hashedPassword });
    await user.save();
    await Otp.deleteOne({ _id: otpRecord._id });

    res.status(201).json({ message: "Registered successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Registration failed" });
  }
});

// 🔹 Login (email or username)
app.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body; // email or username
    if (!identifier || !password) return res.status(400).json({ message: "Username/email and password required" });

    const user = await Credential.findOne({
      $or: [{ email: identifier }, { username: identifier }]
    });
    if (!user) return res.status(400).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: user._id, email: user.email, username: user.username, profilePic: user.profilePic },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "1h" }
    );

    res.status(200).json({ message: "Login successful", token });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

// 🔹 Reset Password
app.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) return res.status(400).json({ message: "Email, OTP, and new password required" });

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

// 🔹 Profile: upload/update profile picture
app.put("/profile/:userId", upload.single("profilePic"), async (req, res) => {
  try {
    const { userId } = req.params;
    const filePath = req.file ? `/uploads/${req.file.filename}` : null;

    if (!filePath) return res.status(400).json({ message: "No file uploaded" });

    const updatedUser = await Credential.findByIdAndUpdate(
      userId,
      { profilePic: filePath },
      { new: true }
    );

    if (!updatedUser) return res.status(404).json({ message: "User not found" });

    res.status(200).json({ message: "Profile updated successfully!", profilePic: filePath });
  } catch (err) {
    console.error("❌ Profile update error:", err);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

// 🔹 Enrollment (optional)
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

// 🔹 Root
app.get("/", (req, res) => {
  res.json({ message: "Backend is running 🚀" });
});

// -------------------- Start Server --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
