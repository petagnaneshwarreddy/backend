// -------------------- IMPORTS --------------------
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();

// -------------------- MIDDLEWARE --------------------
app.use(express.json());

app.use(
  cors({
    origin: [
      "https://skillfull-technologies.vercel.app",
      "http://localhost:3000"
    ],
    methods: ["GET", "POST"],
    credentials: true
  })
);

// -------------------- EMAIL SETUP --------------------
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

transporter.verify((err) => {
  if (err) console.error("❌ Email setup error:", err);
  else console.log("✅ Email server ready");
});

// -------------------- DATABASE --------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// -------------------- MODELS --------------------

const Credential = mongoose.model(
  "Credential",
  new mongoose.Schema({
    username: String,
    email: { type: String, unique: true },
    password: String,
    createdAt: { type: Date, default: Date.now }
  })
);

const Enrollment = mongoose.model(
  "Enrollment",
  new mongoose.Schema({
    courseTitle: String,
    certificateId: String,
    fullName: String,
    email: String,
    phone: String,
    collegeName: String,
    state: String,
    duration: String,
    createdAt: { type: Date, default: Date.now }
  })
);

const Otp = mongoose.model(
  "Otp",
  new mongoose.Schema({
    email: String,
    otp: String,
    createdAt: { type: Date, default: Date.now, expires: 300 }
  })
);

// -------------------- ROUTES --------------------

// OTP SEND
app.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    await Otp.findOneAndUpdate(
      { email },
      { otp: otpCode },
      { upsert: true, new: true }
    );

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your OTP Code",
      html: `<h3>Your OTP is: ${otpCode}</h3>
             <p>This OTP will expire in 5 minutes.</p>`
    });

    res.json({ message: "OTP sent successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "OTP failed" });
  }
});

// REGISTER
app.post("/register", async (req, res) => {
  try {
    const { username, email, password, otp } = req.body;

    const otpRecord = await Otp.findOne({ email, otp });

    if (!otpRecord) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await Credential.create({
      username,
      email,
      password: hashedPassword
    });

    await Otp.deleteOne({ _id: otpRecord._id });

    res.json({ message: "Registered successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Registration failed" });
  }
});

// LOGIN
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await Credential.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(400).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, username: user.username },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "1h" }
    );

    res.json({ message: "Login successful", token });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Login error" });
  }
});

// COURSE ENROLLMENT
app.post("/api/enroll", async (req, res) => {
  try {
    const enrollment = await Enrollment.create(req.body);

   await resend.emails.send({
  from: "Skillfull Technologies <onboarding@resend.dev>",
  to: enrollment.email,
  subject: `Enrollment Confirmation - ${enrollment.courseTitle}`,
  html: `
    <h2>Hello ${enrollment.fullName}</h2>

    <p>You have successfully enrolled in:</p>

    <h3>${enrollment.courseTitle}</h3>

    <p>Your Certificate ID:</p>
    <b>${enrollment.certificateId}</b>

    <p>Our team will contact you shortly.</p>

    <p>
    <a href="https://chat.whatsapp.com/CtzXvTddE0aGQ6vASHzs6e">
    Join WhatsApp Community
    </a>
    </p>

    <br>

    <b>Skillfull Technologies</b>
  `
});

    res.status(201).json({ msg: "Enrollment successful" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Enrollment failed" });
  }
});

// VERIFY CERTIFICATE
app.get("/api/verify/:certificateId", async (req, res) => {
  try {
    const data = await Enrollment.findOne({
      certificateId: req.params.certificateId
    });

    if (!data) {
      return res.json({ msg: "Certificate not found" });
    }

    res.json(data);

  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Verification error" });
  }
});

// CONTACT FORM
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, message } = req.body;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `Contact Message - ${name}`,
      html: `
        <h3>New Contact Message</h3>
        <p>Name: ${name}</p>
        <p>Email: ${email}</p>
        <p>${message}</p>
      `
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Thanks for contacting us",
      html: `
        <h3>Hello ${name}</h3>
        <p>We received your message and will respond shortly.</p>
        <p>Skillfull Technologies</p>
      `
    });

    res.json({ msg: "Message sent successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Contact failed" });
  }
});

// ROOT
app.get("/", (req, res) => {
  res.json({ message: "Backend running 🚀" });
});

// -------------------- SERVER --------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
