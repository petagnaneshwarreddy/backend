// -------------------- IMPORTS --------------------
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
require("dotenv").config();

const nodemailer = require("nodemailer");
const { Resend } = require("resend");
const app = express();

// ── Resend (primary) ──
const resend = new Resend(process.env.RESEND_API_KEY);

// ── Nodemailer Gmail (fallback) ──
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,           // 587 STARTTLS — Render allows this (465 SSL is blocked)
  secure: false,       // false for STARTTLS
  auth: {
    user: process.env.EMAIL_USER,  // skillfulltec@gmail.com
    pass: process.env.EMAIL_PASS,  // Gmail App Password (16-char, no spaces)
  },
  tls: {
    rejectUnauthorized: false,
    ciphers: "SSLv3",
  },
  connectionTimeout: 10000,  // 10s timeout
  greetingTimeout:   10000,
  socketTimeout:     15000,
});

transporter.verify((err) => {
  if (err) {
    console.warn("⚠️  Gmail SMTP not ready:", err.message);
    console.warn("   → Render may block port 587 on free tier. Resend will be used as fallback.");
  } else {
    console.log("✅ Gmail SMTP ready on port 587 — " + process.env.EMAIL_USER);
  }
});

// ── Smart sendMail: Resend first → Nodemailer (Gmail SMTP) fallback ──
async function sendMail({ to, subject, html, text }) {
  const plainText = text || html.replace(/<[^>]+>/g, "");

  // 1️⃣ Try Resend first
  if (process.env.RESEND_API_KEY) {
    try {
      await resend.emails.send({
        from: "Skillfull Technologies <onboarding@resend.dev>",
        to, subject, html,
        text: plainText,
      });
      console.log(`✅ [Resend] Email sent to ${to}`);
      return;
    } catch (err) {
      console.warn(`⚠️  Resend failed (${err.message}) — falling back to Gmail SMTP…`);
    }
  }

  // 2️⃣ Fallback: Gmail SMTP via Nodemailer
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
      const info = await transporter.sendMail({
        from: `"Skillfull Technologies" <${process.env.EMAIL_USER}>`,
        to, subject, html,
        text: plainText,
      });
      console.log(`✅ [Gmail SMTP] Email sent to ${to} — messageId: ${info.messageId}`);
      return;
    } catch (err) {
      console.error(`❌ [Gmail SMTP] Failed to send to ${to}:`, err.message);
      if (err.message.includes("Invalid login") || err.message.includes("Username and Password")) {
        console.error("   → Wrong App Password. Go to myaccount.google.com/apppasswords and regenerate.");
      }
      if (err.message.includes("Less secure")) {
        console.error("   → Enable App Passwords: myaccount.google.com/apppasswords");
      }
      throw err;
    }
  }

  throw new Error("No email provider configured. Set RESEND_API_KEY or EMAIL_USER+EMAIL_PASS.");
}

// -------------------- MIDDLEWARE --------------------
app.use(express.json());

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://skillfulltechnologies.netlify.app"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true
  })
);

// -------------------- MULTER (for file uploads) --------------------
// Stores PDF in memory as Buffer (no disk needed)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
});

// -------------------- DATABASE --------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// -------------------- MODELS --------------------

// ── Credential now carries role + optional profile fields so the
//    same collection covers both students and admins. ──
const Credential = mongoose.model(
  "Credential",
  new mongoose.Schema({
    username: String,
    email: { type: String, unique: true },
    password: String,
    phone: { type: String, default: "" },
    role: { type: String, enum: ["student", "admin"], default: "student" },
    // Set true when an admin invites a student with a temp password —
    // lets the frontend force a password-change screen on first login.
    mustResetPassword: { type: Boolean, default: false },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Credential", default: null },
    createdAt: { type: Date, default: Date.now }
  })
);

// ── NEW: OTP model for email verification during registration ──
// TTL index on expiresAt means MongoDB automatically deletes expired
// OTP documents — no manual cleanup needed.
const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  otp: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Otp = mongoose.model("Otp", otpSchema);

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
    createdAt: { type: Date, default: Date.now },

    // ── Admin dashboard fields ──
    paymentStatus: { type: String, enum: ["paid", "unpaid"], default: "unpaid" },
    amountPaid:    { type: Number, default: 0 },
    advancePaid:   { type: Number, default: 0 },
    certIssued:    { type: Boolean, default: false },
    offerSent:     { type: Boolean, default: false }
  })
);

// ── NEW: Certificate requests (save for approval) ──
const CertificateRequest = mongoose.model(
  "CertificateRequest",
  new mongoose.Schema({
    studentName:   { type: String, required: true },
    certificateId: { type: String, required: true },
    courseTitle:   { type: String, default: "" },
    collegeName:   { type: String, default: "" },
    issueDate:     { type: String, default: "" },
    status:        { type: String, enum: ["pending", "approved", "declined"], default: "pending" },
    pdfData:       { type: Buffer },        // stores PDF binary
    pdfMimeType:   { type: String, default: "application/pdf" },
    pdfFileName:   { type: String, default: "certificate.pdf" },
    createdAt:     { type: Date, default: Date.now },
    reviewedAt:    { type: Date },
    reviewNote:    { type: String, default: "" },
  })
);

// -------------------- HELPERS --------------------
function generateCertificateId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "SFT-";
  for (let i = 0; i < 4; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function generateOtp() {
  // 6-digit numeric OTP, always zero-padded
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateTempPassword(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function signToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email, username: user.username, role: user.role },
    process.env.JWT_SECRET || "secretkey",
    { expiresIn: "1h" }
  );
}

// -------------------- AUTH MIDDLEWARE --------------------

// Verifies the Bearer token and attaches the decoded payload to req.user.
// Every route that needs "who is logged in" should use this first.
function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secretkey");
    req.user = decoded; // { id, email, username, role }
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// Must run AFTER verifyToken. Blocks anyone whose token role isn't "admin".
// This is the real access control — never rely on what the frontend
// shows/hides, since localStorage and UI state are trivially editable.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

// -------------------- AUTH ROUTES --------------------

// SEND OTP (Step 1 of registration)
app.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const existingUser = await Credential.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "This email is already registered" });
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // valid 10 minutes

    // Upsert so re-requesting an OTP for the same email overwrites the old one
    await Otp.findOneAndUpdate(
      { email },
      { email, otp, attempts: 0, createdAt: new Date(), expiresAt },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await sendMail({
      to: email,
      subject: "Skillfull Technologies - Email Verification OTP",
      html: `
        <div style="font-family:Arial,sans-serif">
          <h2>Email Verification</h2>

          <p>Hello,</p>

          <p>Your verification code is:</p>

          <h1 style="
            background:#2563eb;
            color:white;
            padding:15px;
            display:inline-block;
            border-radius:8px;
            letter-spacing:4px;
          ">
            ${otp}
          </h1>

          <p>This OTP is valid for <b>10 minutes</b>.</p>

          <p>If you didn't request this OTP, please ignore this email.</p>

          <br>

          <b>Skillfull Technologies</b>
        </div>
      `,
      text: `Your OTP is ${otp}. It expires in 10 minutes.`,
    });

    console.log(`✅ OTP sent to ${email}`);
    res.json({ message: "OTP sent to your email." });
  } catch (err) {
    console.error("Send OTP error:", err);
    res.status(500).json({ message: "Failed to send OTP. Please try again." });
  }
});

// REGISTER (Step 2 — verifies OTP, creates account)
// Public self-registration ALWAYS creates a "student" account — admins
// are never created through this route. See /api/admin/students and
// /api/admin/bootstrap below for how admin/student accounts get made.
app.post("/register", async (req, res) => {
  try {
    const { username, email, password, otp } = req.body;

    if (!username || !email || !password || !otp) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingUser = await Credential.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "This email is already registered" });
    }

    const otpRecord = await Otp.findOne({ email });
    if (!otpRecord) {
      return res.status(400).json({ message: "No OTP request found for this email. Please request a new OTP." });
    }

    if (otpRecord.expiresAt < new Date()) {
      await Otp.deleteOne({ email });
      return res.status(400).json({ message: "OTP has expired. Please request a new one." });
    }

    if (otpRecord.otp !== String(otp).trim()) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      // Lock out after too many wrong attempts to slow down brute-forcing
      if (otpRecord.attempts >= 5) {
        await Otp.deleteOne({ email });
        return res.status(400).json({ message: "Too many incorrect attempts. Please request a new OTP." });
      }
      return res.status(400).json({ message: "Invalid OTP" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await Credential.create({
      username,
      email,
      password: hashedPassword,
      role: "student",
    });

    // OTP is used — remove it so it can't be replayed
    await Otp.deleteOne({ email });

    const token = signToken(newUser);

    console.log(`✅ New user registered: ${email}`);
    res.status(201).json({ message: "Registered successfully.", token, role: newUser.role });
  } catch (err) {
    console.error("Register error:", err);
    // Duplicate key error (race condition on unique email index)
    if (err.code === 11000) {
      return res.status(400).json({ message: "This email is already registered" });
    }
    res.status(500).json({ message: "Registration failed." });
  }
});

// LOGIN
// Accepts "identifier" (username OR email) to match the frontend's
// "Username or email" field, and falls back to "email" for backwards
// compatibility with any older callers that still send that key directly.
app.post("/login", async (req, res) => {
  try {
    const { identifier, email, password } = req.body;
    const loginValue = identifier || email;

    if (!loginValue || !password) {
      return res.status(400).json({ message: "Username/email and password are required" });
    }

    const user = await Credential.findOne({
      $or: [{ email: loginValue }, { username: loginValue }],
    });

    if (!user) return res.status(400).json({ message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Invalid password" });

    const token = signToken(user);

    // role + mustResetPassword go back to the frontend so Nav.js can
    // show the right links and the app can force a password change
    // for freshly invited students.
    res.json({
      message: "Login successful",
      token,
      role: user.role,
      mustResetPassword: user.mustResetPassword,
      name: user.username,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Login error" });
  }
});

// CHANGE PASSWORD (any logged-in user — used after an invited student's
// first login to replace the temp password admin shared with them)
app.post("/change-password", verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "currentPassword and newPassword are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const user = await Credential.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(400).json({ message: "Current password is incorrect" });

    user.password = await bcrypt.hash(newPassword, 10);
    user.mustResetPassword = false;
    await user.save();

    res.json({ message: "Password updated" });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ message: "Failed to update password" });
  }
});

// -------------------- ADMIN: STUDENT MANAGEMENT --------------------
// Every route below requires a valid token AND role === "admin".
// This is what actually stops a student from hitting these endpoints,
// regardless of what the sidebar shows them.

// LIST STUDENTS
app.get("/api/admin/students", verifyToken, requireAdmin, async (req, res) => {
  try {
    const students = await Credential.find({ role: "student" })
      .select("-password")
      .sort({ createdAt: -1 });
    res.json(students);
  } catch (err) {
    console.error("List students error:", err);
    res.status(500).json({ message: "Failed to fetch students" });
  }
});

// INVITE / CREATE STUDENT
// Matches the Admincreatestudent frontend form: { name, phone, email, password }
// Creates the account immediately with the given (or generated) password,
// and emails the student their login details. The admin's own "copy to
// share" button in the UI is a manual backup if email delivery fails.
app.post("/api/admin/students", verifyToken, requireAdmin, async (req, res) => {
  try {
    let { name, phone, email, password } = req.body;

    if (!name || !phone || !email) {
      return res.status(400).json({ message: "name, phone and email are required" });
    }

    const existing = await Credential.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "This email is already registered" });
    }

    if (!password) password = generateTempPassword();
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const student = await Credential.create({
      username: name,
      email,
      phone,
      password: hashedPassword,
      role: "student",
      mustResetPassword: true,
      invitedBy: req.user.id,
    });

    // Best-effort email — don't fail the whole request if delivery fails,
    // since the admin can still copy/share the credentials from the UI.
    try {
      await sendMail({
        to: email,
        subject: "You've been invited to Skillfull Technologies",
        html: `
          <div style="font-family:Arial,sans-serif">
            <h2>Welcome, ${name} 👋</h2>
            <p>An admin has created your student account at Skillfull Technologies.</p>
            <p><b>Email:</b> ${email}<br/>
               <b>Temporary password:</b> ${password}</p>
            <p>Please log in and change your password on first login.</p>
            <br/>
            <b>Skillfull Technologies</b>
          </div>
        `,
        text: `Welcome ${name}. Email: ${email}. Temporary password: ${password}. Please change it after logging in.`,
      });
    } catch (emailErr) {
      console.warn("Invite email failed (student still created):", emailErr.message);
    }

    console.log(`✅ Student invited by admin ${req.user.email}: ${email}`);
    res.status(201).json({
      message: "Student invited",
      student: {
        id: student._id,
        name: student.username,
        email: student.email,
        phone: student.phone,
        role: student.role,
      },
      // Returned once so the admin UI can still show/copy it even if
      // the email above failed to send.
      tempPassword: password,
    });
  } catch (err) {
    console.error("Invite student error:", err);
    if (err.code === 11000) {
      return res.status(400).json({ message: "This email is already registered" });
    }
    res.status(500).json({ message: "Failed to invite student" });
  }
});

// UPDATE STUDENT (name/phone/email, or reset their password)
app.put("/api/admin/students/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, phone, email, newPassword } = req.body;
    const update = {};
    if (name) update.username = name;
    if (phone) update.phone = phone;
    if (email) update.email = email;
    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      update.password = await bcrypt.hash(newPassword, 10);
      update.mustResetPassword = true;
    }

    const student = await Credential.findOneAndUpdate(
      { _id: req.params.id, role: "student" },
      update,
      { new: true }
    ).select("-password");

    if (!student) return res.status(404).json({ message: "Student not found" });
    res.json({ message: "Student updated", student });
  } catch (err) {
    console.error("Update student error:", err);
    res.status(500).json({ message: "Failed to update student" });
  }
});

// DELETE STUDENT
app.delete("/api/admin/students/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    const deleted = await Credential.findOneAndDelete({ _id: req.params.id, role: "student" });
    if (!deleted) return res.status(404).json({ message: "Student not found" });
    res.json({ message: "Student deleted" });
  } catch (err) {
    console.error("Delete student error:", err);
    res.status(500).json({ message: "Failed to delete student" });
  }
});

// -------------------- ADMIN BOOTSTRAP --------------------
// Solves the chicken-and-egg problem: to create an admin via the API
// above you must already BE an admin. This route creates the very
// first admin (or promotes an existing account) using a one-time
// secret from your environment — NOT a JWT — so use it once, then
// treat that secret as compromised and rotate it.
//
// Set ADMIN_SETUP_SECRET in your .env before calling this, e.g.:
//   ADMIN_SETUP_SECRET=some-long-random-string
//
// Call once:
//   POST /api/admin/bootstrap
//   headers: { "x-setup-secret": "some-long-random-string" }
//   body: { "email": "you@example.com", "username": "Admin", "password": "..." }
app.post("/api/admin/bootstrap", async (req, res) => {
  try {
    const setupSecret = req.headers["x-setup-secret"];
    if (!process.env.ADMIN_SETUP_SECRET || setupSecret !== process.env.ADMIN_SETUP_SECRET) {
      return res.status(403).json({ message: "Invalid setup secret" });
    }

    const { email, username, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    let user = await Credential.findOne({ email });
    if (user) {
      user.role = "admin";
      if (username) user.username = username;
      await user.save();
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      user = await Credential.create({
        username: username || "Admin",
        email,
        password: hashedPassword,
        role: "admin",
      });
    }

    console.log(`✅ Admin bootstrapped: ${email}`);
    res.json({ message: "Admin account ready", email: user.email, role: user.role });
  } catch (err) {
    console.error("Bootstrap admin error:", err);
    res.status(500).json({ message: "Failed to bootstrap admin" });
  }
});

// -------------------- ENROLLMENT ROUTES --------------------

// COURSE ENROLLMENT (public — anyone can enroll)
app.post("/api/enroll", async (req, res) => {
  try {
    const certificateId = generateCertificateId();
    const enrollment = await Enrollment.create({ ...req.body, certificateId });

    await sendMail({
      to: enrollment.email,
      subject: `Enrollment Confirmation - ${enrollment.courseTitle}`,
      html: `
        <h2>Hello ${enrollment.fullName}</h2>
        <p>You have successfully enrolled in:</p>
        <h3>${enrollment.courseTitle}</h3>
        <p>Your Certificate ID:</p>
        <b>${certificateId}</b>
        <p>Our team will contact you shortly.</p>
        <p>
          <a href="https://chat.whatsapp.com/CtzXvTddE0aGQ6vASHzs6e">Join WhatsApp Community</a>
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

// GET ALL ENROLLMENTS — admin only
app.get("/api/admin/enrollments", verifyToken, requireAdmin, async (req, res) => {
  try {
    const enrollments = await Enrollment.find().sort({ createdAt: -1 });
    res.json(enrollments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Failed to fetch enrollments" });
  }
});

// UPDATE ENROLLMENT — admin only
app.put("/api/admin/enrollments/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    const updatedEnrollment = await Enrollment.findByIdAndUpdate(
      req.params.id, req.body, { new: true }
    );
    res.json(updatedEnrollment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Update failed" });
  }
});

// DELETE ENROLLMENT — admin only
app.delete("/api/admin/enrollments/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    await Enrollment.findByIdAndDelete(req.params.id);
    res.json({ msg: "Enrollment deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Delete failed" });
  }
});

// -------------------- CERTIFICATE ROUTES --------------------

// SAVE CERTIFICATE FOR APPROVAL — admin only
app.post(
  "/api/admin/certificates/save",
  verifyToken,
  requireAdmin,
  upload.single("certificate"),
  async (req, res) => {
    try {
      const { studentName, certificateId, courseTitle, collegeName, issueDate } = req.body;

      if (!studentName || !certificateId) {
        return res.status(400).json({ msg: "studentName and certificateId are required" });
      }

      // Check if a request for this cert already exists — update it
      const existing = await CertificateRequest.findOne({ certificateId });

      const certData = {
        studentName,
        certificateId,
        courseTitle:   courseTitle   || "",
        collegeName:   collegeName   || "",
        issueDate:     issueDate     || new Date().toLocaleDateString("en-IN"),
        status:        "pending",
        reviewedAt:    null,
        reviewNote:    "",
      };

      if (req.file) {
        certData.pdfData     = req.file.buffer;
        certData.pdfMimeType = req.file.mimetype || "application/pdf";
        certData.pdfFileName = req.file.originalname || `Certificate_${studentName}.pdf`;
      }

      let saved;
      if (existing) {
        saved = await CertificateRequest.findByIdAndUpdate(existing._id, certData, { new: true });
      } else {
        saved = await CertificateRequest.create(certData);
      }

      console.log(`✅ Certificate saved for approval: ${studentName} (${certificateId})`);
      res.status(201).json({ msg: "Certificate saved for approval", id: saved._id, status: "pending" });

    } catch (err) {
      console.error("Certificate save error:", err);
      res.status(500).json({ msg: "Failed to save certificate" });
    }
  }
);

// GET ALL PENDING CERTIFICATE REQUESTS — admin only
app.get("/api/admin/certificates/pending", verifyToken, requireAdmin, async (req, res) => {
  try {
    // Return all requests (pending + approved + declined), newest first
    // Exclude pdfData from list (too large) — use separate download endpoint
    const requests = await CertificateRequest
      .find({}, { pdfData: 0 })
      .sort({ createdAt: -1 });

    // Add pdfUrl for frontend to use
    const withUrls = requests.map(r => ({
      ...r.toObject(),
      pdfUrl: r.pdfData
        ? `https://backend-qtzh.onrender.com/api/certificates/${r.certificateId}/download`
        : null,
    }));

    res.json(withUrls);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Failed to fetch certificate requests" });
  }
});

// UPDATE CERTIFICATE STATUS — admin only
app.put("/api/admin/certificates/:id/status", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { status, reviewNote } = req.body;

    if (!["pending", "approved", "declined"].includes(status)) {
      return res.status(400).json({ msg: "Invalid status" });
    }

    const cert = await CertificateRequest.findByIdAndUpdate(
      req.params.id,
      {
        status,
        reviewedAt: status !== "pending" ? new Date() : null,
        reviewNote: reviewNote || "",
      },
      { new: true }
    );

    if (!cert) return res.status(404).json({ msg: "Certificate request not found" });

    // If approved → mark certIssued = true on Enrollment too
    if (status === "approved") {
      await Enrollment.findOneAndUpdate(
        { certificateId: cert.certificateId },
        { certIssued: true }
      );
      console.log(`✅ Certificate approved & enrollment updated: ${cert.certificateId}`);

      // Optionally send email to student
      const enrollment = await Enrollment.findOne({ certificateId: cert.certificateId });
      if (enrollment?.email) {
        try {
          await sendMail({
            to: enrollment.email,
            subject: "Your Certificate Has Been Approved! 🏅",
            html: `
              <h2>Congratulations, ${cert.studentName}! 🎉</h2>
              <p>Your internship certificate has been <strong>approved</strong> by Skillfull Technologies.</p>
              <p><strong>Certificate ID:</strong> ${cert.certificateId}</p>
              <p>You can download your certificate at:<br/>
                <a href="https://backend-qtzh.onrender.com/api/certificates/${cert.certificateId}/download">
                  Download Certificate PDF
                </a>
              </p>
              <p>You can also verify your certificate at:<br/>
                <a href="https://skillfull-technologies.vercel.app/verify?id=${cert.certificateId}">
                  Verify Certificate
                </a>
              </p>
              <br/>
              <b>Skillfull Technologies</b><br/>
              📧 skillfulltec@gmail.com | 📞 +1 (470) 929-4574
            `
          });
        } catch(emailErr) {
          console.log("Approval email skipped:", emailErr.message);
        }
      }
    }

    // If declined → send decline email
    if (status === "declined") {
      const enrollment = await Enrollment.findOne({ certificateId: cert.certificateId });
      if (enrollment?.email) {
        try {
          await sendMail({
            to: enrollment.email,
            subject: "Certificate Request Update — Skillfull Technologies",
            html: `
              <h2>Hello ${cert.studentName},</h2>
              <p>Your certificate request (ID: <strong>${cert.certificateId}</strong>) has been reviewed.</p>
              <p>Unfortunately, it could not be approved at this time.</p>
              ${reviewNote ? `<p><strong>Reason:</strong> ${reviewNote}</p>` : ""}
              <p>Please contact us for more information:</p>
              <p>📧 skillfulltec@gmail.com | 📞 +1 (470) 929-4574</p>
              <br/>
              <b>Skillfull Technologies</b>
            `
          });
        } catch(emailErr) {
          console.log("Decline email skipped:", emailErr.message);
        }
      }
    }

    res.json({ msg: `Certificate ${status}`, cert });

  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Failed to update certificate status" });
  }
});

// DOWNLOAD CERTIFICATE PDF by certificateId — public (students/anyone
// verifying a certificate need this without logging in)
app.get("/api/certificates/:certificateId/download", async (req, res) => {
  try {
    const cert = await CertificateRequest.findOne({
      certificateId: req.params.certificateId,
      status: "approved"  // only approved certs can be downloaded
    });

    if (!cert || !cert.pdfData) {
      return res.status(404).json({ msg: "Certificate not found or not yet approved" });
    }

    res.set({
      "Content-Type": cert.pdfMimeType || "application/pdf",
      "Content-Disposition": `attachment; filename="${cert.pdfFileName || "certificate.pdf"}"`,
      "Content-Length": cert.pdfData.length,
    });

    res.send(cert.pdfData);

  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Download failed" });
  }
});

// VERIFY CERTIFICATE — public
app.get("/api/verify/:certificateId", async (req, res) => {
  try {
    const data = await Enrollment.findOne({ certificateId: req.params.certificateId });
    if (!data) return res.json({ msg: "Certificate not found" });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Verification error" });
  }
});

// -------------------- CONTACT / EMAIL ROUTES --------------------

// ── SEND EMAIL (from Template page) — admin only ──
app.post("/api/admin/send-email", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { to, subject, html, text } = req.body;
    if (!to || !subject || !html) {
      return res.status(400).json({ msg: "to, subject and html are required" });
    }
    await sendMail({
      to, subject, html,
      text: text || html.replace(/<[^>]+>/g, ""),
    });
    console.log(`✅ Email sent to ${to}: ${subject}`);
    res.json({ msg: "Email sent successfully" });
  } catch (err) {
    console.error("Send email error:", err);
    res.status(500).json({ msg: "Failed to send email", error: err.message });
  }
});

// -------------------- CONTACT ROUTE (public) --------------------
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, message } = req.body;

    await sendMail({
      to: "skillfulltec@gmail.com",
      subject: `New Contact Message from ${name}`,
      html: `
        <h3>New Contact Message</h3>
        <p><b>Name:</b> ${name}</p>
        <p><b>Email:</b> ${email}</p>
        <p>${message}</p>
      `
    });

    await sendMail({
      to: email,
      subject: "Thanks for contacting Skillfull Technologies",
      html: `
        <h3>Hello ${name}</h3>
        <p>We received your message.</p>
        <p>Our team will contact you soon.</p>
        <br/>
        <b>Skillfull Technologies</b>
      `
    });

    res.json({ msg: "Message sent successfully" });
  } catch (err) {
    console.error("Contact error:", err);
    res.status(500).json({ msg: "Contact failed" });
  }
});

// -------------------- ROOT --------------------
app.get("/", (req, res) => {
  res.json({ message: "Backend running 🚀" });
});

// ── TEST EMAIL — visit /api/test-email?to=yourmail@gmail.com
app.get("/api/test-email", async (req, res) => {
  const to = req.query.to || process.env.EMAIL_USER;
  try {
    await sendMail({
      to,
      subject: "Skillfull Backend — Email Test",
      html: `<h2>Email working!</h2><p>Sent at ${new Date().toLocaleString()}</p><b>Skillfull Technologies</b>`,
    });
    res.json({ msg: `Email sent to ${to}` });
  } catch (err) {
    res.status(500).json({ msg: "Email failed", error: err.message });
  }
});

// -------------------- SERVER --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});