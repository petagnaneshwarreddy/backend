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

const Credential = mongoose.model(
  "Credential",
  new mongoose.Schema({
    username: String,
    email: { type: String, unique: true },
    password: String,
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
    });

    // OTP is used — remove it so it can't be replayed
    await Otp.deleteOne({ email });

    const token = jwt.sign(
      { id: newUser._id, email: newUser.email, username: newUser.username },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "1h" }
    );

    console.log(`✅ New user registered: ${email}`);
    res.status(201).json({ message: "Registered successfully.", token });
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

// -------------------- ENROLLMENT ROUTES --------------------

// COURSE ENROLLMENT
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

// GET ALL ENROLLMENTS
app.get("/api/admin/enrollments", async (req, res) => {
  try {
    const enrollments = await Enrollment.find().sort({ createdAt: -1 });
    res.json(enrollments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Failed to fetch enrollments" });
  }
});

// UPDATE ENROLLMENT
app.put("/api/admin/enrollments/:id", async (req, res) => {
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

// DELETE ENROLLMENT
app.delete("/api/admin/enrollments/:id", async (req, res) => {
  try {
    await Enrollment.findByIdAndDelete(req.params.id);
    res.json({ msg: "Enrollment deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Delete failed" });
  }
});

// -------------------- CERTIFICATE ROUTES --------------------

// SAVE CERTIFICATE FOR APPROVAL (from Certificate page)
// Accepts: multipart/form-data with "certificate" PDF file + metadata fields
app.post("/api/admin/certificates/save", upload.single("certificate"), async (req, res) => {
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
});

// GET ALL PENDING CERTIFICATE REQUESTS (Admin Approvals page)
app.get("/api/admin/certificates/pending", async (req, res) => {
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

// UPDATE CERTIFICATE STATUS — approve or decline
app.put("/api/admin/certificates/:id/status", async (req, res) => {
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

// DOWNLOAD CERTIFICATE PDF by certificateId
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

// VERIFY CERTIFICATE
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

// -------------------- CONTACT ROUTE --------------------

// ── SEND EMAIL (from Template page) ──
app.post("/api/admin/send-email", async (req, res) => {
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

// -------------------- CONTACT ROUTE --------------------
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