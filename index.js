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

// ✅ CORS setup for frontend
app.use(cors({
  origin: ["https://skillfull-technologies.vercel.app"],
  methods: ["GET", "POST"],
  credentials: true
}));

// ✅ Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
transporter.verify((err, success) => {
  if (err) console.error("❌ Nodemailer error:", err);
  else console.log("✅ Nodemailer transporter ready");
});

// ✅ MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ MongoDB connected ✅"))
.catch(err => console.error("❌ MongoDB connection error:", err));

/* -------------------- MODELS -------------------- */

// 1. Credentials = login credentials
const CredentialSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt:{ type: Date, default: Date.now }
});
const Credential = mongoose.model("Credential", CredentialSchema);

// 2. Enrollment = course enrollments (no passwords here)
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

// 3. OTP = temporary OTPs
const OtpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 } // expires in 5 min
});
const Otp = mongoose.model("Otp", OtpSchema);

/* -------------------- ROUTES -------------------- */

// ✅ Send OTP
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
    res.status(200).json({ message: "OTP sent successfully!" });

  } catch (err) {
    console.error("❌ OTP error:", err);
    res.status(500).json({ message: "Failed to send OTP" });
  }
});

// ✅ Register (credentials only)
app.post("/register", async (req, res) => {
  try {
    const { username, email, password, otp } = req.body;

    const otpRecord = await Otp.findOne({ email, otp });
    if (!otpRecord) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

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

// ✅ Login (credentials only)
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await Credential.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

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

// ✅ Save course enrollment (separate collection)
app.post("/api/enroll", async (req, res) => {
  try {
    const enrollment = new Enrollment(req.body);
    await enrollment.save();

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: enrollment.email,
      subject: `Enrollment Confirmation for ${enrollment.courseTitle}`,
      html: `
        <h1>Hello ${enrollment.fullName},</h1>
        <p>Thank you for enrolling in our course <strong>${enrollment.courseTitle}</strong>.</p>
        <p>Your enrollment has been successfully submitted. We will contact you shortly.</p>
        <p>Join our WhatsApp community:</p>
        <p><strong><a href="https://chat.whatsapp.com/CtzXvTddE0aGQ6vASHzs6e">Join WhatsApp Group</a></strong></p>
        <br>
        <p>Best regards,</p>
        <p>Skillfull Technologies Team</p>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`Email sent successfully to ${enrollment.email}`);
    } catch (emailError) {
      console.error("❌ Error sending email:", emailError);
    }

    res.status(201).json({ msg: "Enrollment saved successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error while saving enrollment" });
  }
});

// ✅ Verify certificate by ID
app.get("/api/verify/:certificateId", async (req, res) => {
  try {
    const { certificateId } = req.params;
    const enrollment = await Enrollment.findOne({ certificateId });

    if (!enrollment) {
      return res.status(200).json({ msg: "ID not present" });
    }

    res.status(200).json(enrollment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error while fetching certificate details." });
  }
});

// ✅ Contact form route
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ msg: "All fields are required" });
    }

    const adminMailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `New Contact Form Message from ${name}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong> ${message}</p>
      `,
    };

    const userMailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Thank you for contacting Skillfull Technologies",
      html: `
        <h3>Hello ${name},</h3>
        <p>We received your message:</p>
        <blockquote>${message}</blockquote>
        <p>Our team will get back to you shortly.</p>
        <br>
        <p>Best regards,</p>
        <p><strong>Skillfull Technologies Team</strong></p>
      `,
    };

    await transporter.sendMail(adminMailOptions);
    await transporter.sendMail(userMailOptions);

    res.status(200).json({ msg: "Message sent successfully!" });
  } catch (err) {
    console.error("❌ Contact form error:", err);
    res.status(500).json({ msg: "Failed to send message" });
  }
});

// ✅ Root route
app.get("/", (req, res) => {
  res.json({ message: "Backend is running 🚀" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(` Server running on port ${PORT}`);
});
