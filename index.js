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
  connectionTimeout: 10000,
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
app.use(express.json({ limit: "15mb" }));

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
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// -------------------- DATABASE --------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// -------------------- MODELS --------------------

// ── Credential (auth + profile + role) ──
const Credential = mongoose.model(
  "Credential",
  new mongoose.Schema({
    name: { type: String, default: "" },
    username: String,
    email: { type: String, unique: true },
    phone: { type: String, default: "" },
    password: String,
    role: { type: String, enum: ["student", "admin"], default: "student" },
    bio: { type: String, default: "" },
    status: { type: String, enum: ["Active", "Inactive", "Suspended"], default: "Active" },
    lastLogin: { type: Date, default: Date.now },
    settings: {
      emailNotifications: { type: Boolean, default: true },
      courseUpdates: { type: Boolean, default: true },
      promotionalEmails: { type: Boolean, default: false },
      weeklyDigest: { type: Boolean, default: true },
      profileVisible: { type: Boolean, default: true },
      showProgressToOthers: { type: Boolean, default: false },
    },
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
    createdAt: { type: Date, default: Date.now },
    paymentStatus: { type: String, enum: ["paid", "unpaid"], default: "unpaid" },
    amountPaid:    { type: Number, default: 0 },
    advancePaid:   { type: Number, default: 0 },
    certIssued:    { type: Boolean, default: false },
    offerSent:     { type: Boolean, default: false }
  })
);

// ── Certificate requests (save for approval) ──
const CertificateRequest = mongoose.model(
  "CertificateRequest",
  new mongoose.Schema({
    studentName:   { type: String, required: true },
    certificateId: { type: String, required: true },
    courseTitle:   { type: String, default: "" },
    collegeName:   { type: String, default: "" },
    issueDate:     { type: String, default: "" },
    status:        { type: String, enum: ["pending", "approved", "declined"], default: "pending" },
    pdfData:       { type: Buffer },
    pdfMimeType:   { type: String, default: "application/pdf" },
    pdfFileName:   { type: String, default: "certificate.pdf" },
    createdAt:     { type: Date, default: Date.now },
    reviewedAt:    { type: Date },
    reviewNote:    { type: String, default: "" },
  })
);

// ── Course model ──
const lessonSchema = new mongoose.Schema({
  title: String,
  duration: { type: Number, default: 0 },
  video: { type: String, default: "" },
  pdfs: [{ type: String }],
  code: [{ type: String }],
  assignments: { type: String, default: "" },
  quizzes: [{
    question: String,
    options: [String],
    correct: { type: Number, default: 0 },
  }],
}, { _id: false });

const moduleSchema = new mongoose.Schema({
  title: String,
  lessons: [lessonSchema],
}, { _id: false });

const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { type: String, default: "Web Development" },
  level: { type: String, default: "Beginner" },
  instructor: { type: String, required: true },
  price: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  students: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  status: { type: String, enum: ["Draft", "Published"], default: "Draft" },
  thumbnail: { type: String, default: "" },
  description: { type: String, default: "" },
  document: { type: String, default: "" },
  youtubeUrl: { type: String, default: "" },
  outcomes: [{ type: String }],
  requirements: [{ type: String }],
  modules: [moduleSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: String, default: () => new Date().toISOString().slice(0, 10) },
});

courseSchema.set("toJSON", {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

const Course = mongoose.model("Course", courseSchema);

const CourseEnrollment = mongoose.model(
  "CourseEnrollment",
  new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Credential", required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    progress: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    certificateEarned: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  })
);

const Notification = mongoose.model(
  "Notification",
  new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "Credential", required: true },
    type: { type: String, default: "system" },
    title: { type: String, required: true },
    text: { type: String, required: true },
    link: { type: String, default: "" },
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  })
);

const PlatformSettings = mongoose.model(
  "PlatformSettings",
  new mongoose.Schema({
    siteName: { type: String, default: "Skillfull Technologies" },
    supportEmail: { type: String, default: "skillfulltec@gmail.com" },
    allowNewSignups: { type: Boolean, default: true },
    maintenanceMode: { type: Boolean, default: false },
  })
);

const ActivityLog = mongoose.model(
  "ActivityLog",
  new mongoose.Schema({
    type: { type: String, default: "system" },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
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

function formatDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

async function notify(userId, { type, title, text, link }) {
  try {
    await Notification.create({ user: userId, type, title, text, link: link || "" });
  } catch (err) {
    console.warn("⚠️  Failed to create notification:", err.message);
  }
}

async function logActivity(type, text) {
  try {
    await ActivityLog.create({ type, text });
  } catch (err) {
    console.warn("⚠️  Failed to log activity:", err.message);
  }
}

// -------------------- AUTH MIDDLEWARE --------------------
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "No token provided" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secretkey");
    req.userId = decoded.id;
    req.userRole = decoded.role || "student";
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function adminOnly(req, res, next) {
  if (req.userRole !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

// -------------------- AUTH ROUTES --------------------

// REGISTER — no OTP, straight signup with name, username, email, phone, password
app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        message: "Username, email and password are required"
      });
    }

    const existingUser = await Credential.findOne({
      $or: [
        { email },
        { username }
      ]
    });

    if (existingUser) {
      return res.status(400).json({
        message: "Email or username already exists"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await Credential.create({
      username,
      email,
      password: hashedPassword,
      role: "student",
      name: "",
      phone: ""
    });

    const token = jwt.sign(
      {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role
      },
      process.env.JWT_SECRET || "secretkey",
      {
        expiresIn: "7d"
      }
    );

    await logActivity(
      "signup",
      `${newUser.username} registered`
    );

    res.status(201).json({
      message: "Registration successful",
      token,
      role: newUser.role,
      username: newUser.username
    });

  } catch (err) {
    console.error("Register Error:", err);

    if (err.code === 11000) {
      return res.status(400).json({
        message: "Email already exists"
      });
    }

    res.status(500).json({
      message: "Registration failed"
    });
  }
});

// LOGIN
app.post("/login", async (req, res) => {
  try {
    const { identifier, email, password } = req.body;

    const loginValue = identifier || email;

    console.log("Login Value:", loginValue);

    console.log("=================================");
console.log("LOGIN REQUEST");
console.log("Identifier:", loginValue);

const totalUsers = await Credential.countDocuments();
console.log("Total Users:", totalUsers);

const allUsers = await Credential.find({}, "username email role");
console.log("Users:", allUsers);

const user = await Credential.findOne({
  $or: [
    { username: loginValue },
    { email: loginValue },
  ],
});

console.log("Found User:", user);
console.log("=================================");

    if (!user) {
      return res.status(400).json({
        message: "User not found",
      });
    }

    // rest of your code...

    if (user.status === "Suspended") {
      return res.status(403).json({ message: "This account has been suspended. Contact support." });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Invalid password" });

    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      { id: user._id, email: user.email, username: user.username, role: user.role },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "7d" }
    );

    res.json({ message: "Login successful", token, role: user.role, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Login error" });
  }
});

// -------------------- COURSES ROUTES --------------------

app.get("/courses", auth, async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });
    res.json(courses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch courses" });
  }
});

app.get("/courses/:id", auth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: "Course not found" });
    res.json(course);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch course" });
  }
});

app.post("/courses", auth, adminOnly, async (req, res) => {
  try {
    const payload = { ...req.body, updatedAt: formatDate(new Date()) };
    const course = await Course.create(payload);
    logActivity(
      course.status === "Published" ? "publish" : "system",
      course.status === "Published"
        ? `"${course.title}" was published`
        : `"${course.title}" was added as a draft`
    );
    res.status(201).json(course);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create course" });
  }
});

app.put("/courses/:id", auth, adminOnly, async (req, res) => {
  try {
    const before = await Course.findById(req.params.id);
    if (!before) return res.status(404).json({ message: "Course not found" });

    const payload = { ...req.body, updatedAt: formatDate(new Date()) };
    const course = await Course.findByIdAndUpdate(req.params.id, payload, { new: true });

    if (before.status !== "Published" && course.status === "Published") {
      logActivity("publish", `"${course.title}" was published`);
    }

    res.json(course);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update course" });
  }
});

app.delete("/courses/:id", auth, adminOnly, async (req, res) => {
  try {
    await Course.findByIdAndDelete(req.params.id);
    await CourseEnrollment.deleteMany({ course: req.params.id });
    res.json({ message: "Course deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete course" });
  }
});

app.post("/courses/:id/enroll", auth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: "Course not found" });

    const existing = await CourseEnrollment.findOne({ student: req.userId, course: course._id });
    if (existing) return res.status(400).json({ message: "Already enrolled in this course" });

    await CourseEnrollment.create({ student: req.userId, course: course._id });
    course.students += 1;
    await course.save();

    const student = await Credential.findById(req.userId);

    await notify(req.userId, {
      type: "enroll",
      title: "You're enrolled",
      text: `You successfully enrolled in "${course.title}".`,
      link: "/courses",
    });
    logActivity("enroll", `${student?.username || "A student"} enrolled in "${course.title}"`);

    res.status(201).json({ message: "Enrolled successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to enroll" });
  }
});

app.put("/courses/:id/progress", auth, async (req, res) => {
  try {
    const { progress } = req.body;
    if (progress === undefined || progress < 0 || progress > 100) {
      return res.status(400).json({ message: "progress must be a number between 0 and 100" });
    }

    const enrollment = await CourseEnrollment.findOne({ student: req.userId, course: req.params.id }).populate("course");
    if (!enrollment) return res.status(404).json({ message: "Not enrolled in this course" });

    const justCompleted = !enrollment.completed && progress >= 100;
    enrollment.progress = progress;
    if (justCompleted) {
      enrollment.completed = true;
      enrollment.certificateEarned = true;
    }
    await enrollment.save();

    if (justCompleted) {
      await notify(req.userId, {
        type: "cert",
        title: "Certificate earned",
        text: `You earned a certificate in "${enrollment.course.title}". Nice work!`,
        link: "/profile",
      });
    }

    res.json({ progress: enrollment.progress, completed: enrollment.completed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update progress" });
  }
});

// -------------------- DASHBOARD ROUTE --------------------
app.get("/dashboard", auth, async (req, res) => {
  try {
    if (req.userRole === "admin") {
      const [totalStudents, totalCourses, courses, recentActivity] = await Promise.all([
        Credential.countDocuments({ role: "student" }),
        Course.countDocuments(),
        Course.find().sort({ students: -1 }).limit(4),
        ActivityLog.find().sort({ createdAt: -1 }).limit(5),
      ]);

      const allCourses = await Course.find();
      const totalRevenue = allCourses.reduce((s, c) => s + (c.students || 0) * (c.price || 0), 0);

      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const newSignupsWeek = await Credential.countDocuments({
        role: "student",
        createdAt: { $gte: weekAgo },
      });

      const signupUsers = await Credential.find({ role: "student", createdAt: { $gte: weekAgo } });
      const weeklySignups = [0, 0, 0, 0, 0, 0, 0];
      signupUsers.forEach((u) => {
        const day = new Date(u.createdAt).getDay();
        const idx = day === 0 ? 6 : day - 1;
        weeklySignups[idx] += 1;
      });

      res.json({
        totalStudents,
        totalCourses,
        totalRevenue,
        newSignupsWeek,
        weeklySignups,
        topCourses: courses.map((c) => ({
          id: c._id,
          title: c.title,
          students: c.students,
          rating: c.rating,
        })),
        activity: recentActivity.map((a) => ({
          id: a._id,
          type: a.type,
          text: a.text,
          time: timeAgo(a.createdAt),
        })),
      });
    } else {
      const enrollments = await CourseEnrollment.find({ student: req.userId }).populate("course");
      const continueLearning = enrollments
        .filter((e) => !e.completed)
        .slice(0, 5)
        .map((e) => ({
          id: e.course?._id,
          title: e.course?.title,
          progress: e.progress,
          category: e.course?.category,
        }));

      const recommended = await Course.find({ status: "Published" }).limit(2);
      const notifs = await Notification.find({ user: req.userId }).sort({ createdAt: -1 }).limit(5);

      res.json({
        hoursLearned: enrollments.reduce((s, e) => s + (e.course?.duration || 0) * (e.progress / 100), 0) | 0,
        coursesEnrolled: enrollments.length,
        coursesCompleted: enrollments.filter((e) => e.completed).length,
        certificates: enrollments.filter((e) => e.certificateEarned).length,
        continueLearning,
        recommended: recommended.map((c) => ({
          id: c._id,
          title: c.title,
          category: c.category,
          students: c.students,
        })),
        activity: notifs.map((n) => ({
          id: n._id,
          type: n.type,
          text: n.text,
          time: timeAgo(n.createdAt),
        })),
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load dashboard" });
  }
});

// -------------------- NOTIFICATIONS ROUTES --------------------

app.get("/notifications", auth, async (req, res) => {
  try {
    const notifs = await Notification.find({ user: req.userId }).sort({ createdAt: -1 });
    res.json(
      notifs.map((n) => ({
        id: n._id,
        type: n.type,
        title: n.title,
        text: n.text,
        link: n.link,
        read: n.read,
        time: timeAgo(n.createdAt),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
});

app.put("/notifications/mark-all-read", auth, async (req, res) => {
  try {
    await Notification.updateMany({ user: req.userId, read: false }, { read: true });
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to mark notifications as read" });
  }
});

app.put("/notifications/:id", auth, async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { read: req.body.read !== undefined ? req.body.read : true },
      { new: true }
    );
    if (!notif) return res.status(404).json({ message: "Notification not found" });
    res.json(notif);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update notification" });
  }
});

app.delete("/notifications/:id", auth, async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, user: req.userId });
    res.json({ message: "Notification removed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to remove notification" });
  }
});

// -------------------- PROFILE ROUTES --------------------

app.get("/profile", auth, async (req, res) => {
  try {
    const user = await Credential.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const base = {
      name: user.name,
      username: user.username,
      email: user.email,
      phone: user.phone,
      bio: user.bio,
      role: user.role,
      joinedAt: formatDate(user.createdAt),
    };

    if (user.role === "admin") {
      const [coursesManaged, studentsManaged] = await Promise.all([
        Course.countDocuments(),
        Credential.countDocuments({ role: "student" }),
      ]);
      return res.json({ ...base, coursesManaged, studentsManaged });
    }

    const enrollments = await CourseEnrollment.find({ student: user._id }).populate("course");
    res.json({
      ...base,
      hoursLearned: Math.round(
        enrollments.reduce((s, e) => s + (e.course?.duration || 0) * (e.progress / 100), 0)
      ),
      coursesEnrolled: enrollments.length,
      certificates: enrollments.filter((e) => e.certificateEarned).length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

app.put("/profile", auth, async (req, res) => {
  try {
    const { name, username, email, phone, bio } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (username !== undefined) update.username = username;
    if (email !== undefined) update.email = email;
    if (phone !== undefined) update.phone = phone;
    if (bio !== undefined) update.bio = bio;

    const user = await Credential.findByIdAndUpdate(req.userId, update, { new: true });
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      name: user.name,
      username: user.username,
      email: user.email,
      phone: user.phone,
      bio: user.bio,
    });
  } catch (err) {
    console.error(err);
    if (err.code === 11000) {
      return res.status(400).json({ message: "That email is already in use" });
    }
    res.status(500).json({ message: "Failed to update profile" });
  }
});

app.put("/profile/password", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new password are required" });
    }

    const user = await Credential.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(400).json({ message: "Current password is incorrect" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: "Password updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update password" });
  }
});

// -------------------- SETTINGS ROUTES --------------------

app.get("/settings", auth, async (req, res) => {
  try {
    const user = await Credential.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const body = { settings: user.settings };
    if (req.userRole === "admin") {
      let platform = await PlatformSettings.findOne();
      if (!platform) platform = await PlatformSettings.create({});
      body.platform = platform;
    }
    res.json(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch settings" });
  }
});

app.put("/settings", auth, async (req, res) => {
  try {
    const user = await Credential.findByIdAndUpdate(
      req.userId,
      { settings: req.body },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ settings: user.settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save settings" });
  }
});

app.put("/settings/platform", auth, adminOnly, async (req, res) => {
  try {
    let platform = await PlatformSettings.findOne();
    if (!platform) {
      platform = await PlatformSettings.create(req.body);
    } else {
      Object.assign(platform, req.body);
      await platform.save();
    }
    res.json(platform);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save platform settings" });
  }
});

app.delete("/account", auth, async (req, res) => {
  try {
    await Credential.findByIdAndDelete(req.userId);
    await CourseEnrollment.deleteMany({ student: req.userId });
    await Notification.deleteMany({ user: req.userId });
    res.json({ message: "Account deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete account" });
  }
});

// -------------------- STUDENTS ROUTES (admin only) --------------------

app.get("/students", auth, adminOnly, async (req, res) => {
  try {
    const students = await Credential.find({ role: "student" }).sort({ createdAt: -1 });
    const results = await Promise.all(
      students.map(async (s) => {
        const enrollments = await CourseEnrollment.find({ student: s._id }).populate("course");
        return {
          id: s._id,
          name: s.name,
          username: s.username,
          email: s.email,
          phone: s.phone,
          status: s.status,
          joinedAt: formatDate(s.createdAt),
          lastActive: timeAgo(s.lastLogin || s.createdAt),
          certificates: enrollments.filter((e) => e.certificateEarned).length,
          courses: enrollments
            .filter((e) => e.course)
            .map((e) => ({
              id: e.course._id,
              title: e.course.title,
              category: e.course.category,
              progress: e.progress,
            })),
        };
      })
    );
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch students" });
  }
});

app.put("/students/:id", auth, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    if (status && !["Active", "Inactive", "Suspended"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const student = await Credential.findOneAndUpdate(
      { _id: req.params.id, role: "student" },
      { status },
      { new: true }
    );
    if (!student) return res.status(404).json({ message: "Student not found" });

    if (status) {
      await notify(student._id, {
        type: "system",
        title: "Account status updated",
        text: `Your account status was changed to "${status}".`,
        link: "/settings",
      });
    }

    res.json({ id: student._id, status: student.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update student" });
  }
});

app.delete("/students/:id", auth, adminOnly, async (req, res) => {
  try {
    const student = await Credential.findOneAndDelete({ _id: req.params.id, role: "student" });
    if (!student) return res.status(404).json({ message: "Student not found" });
    await CourseEnrollment.deleteMany({ student: req.params.id });
    await Notification.deleteMany({ user: req.params.id });
    res.json({ message: "Student removed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to remove student" });
  }
});

// -------------------- ENROLLMENT ROUTES (public certificate flow) --------------------

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

app.get("/api/admin/enrollments", auth, adminOnly, async (req, res) => {
  try {
    const enrollments = await Enrollment.find().sort({ createdAt: -1 });
    res.json(enrollments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Failed to fetch enrollments" });
  }
});

app.put("/api/admin/enrollments/:id", auth, adminOnly, async (req, res) => {
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

app.delete("/api/admin/enrollments/:id", auth, adminOnly, async (req, res) => {
  try {
    await Enrollment.findByIdAndDelete(req.params.id);
    res.json({ msg: "Enrollment deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Delete failed" });
  }
});

// -------------------- CERTIFICATE ROUTES --------------------

app.post("/api/admin/certificates/save", auth, adminOnly, upload.single("certificate"), async (req, res) => {
  try {
    const { studentName, certificateId, courseTitle, collegeName, issueDate } = req.body;

    if (!studentName || !certificateId) {
      return res.status(400).json({ msg: "studentName and certificateId are required" });
    }

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

app.get("/api/admin/certificates/pending", auth, adminOnly, async (req, res) => {
  try {
    const requests = await CertificateRequest
      .find({}, { pdfData: 0 })
      .sort({ createdAt: -1 });

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

app.put("/api/admin/certificates/:id/status", auth, adminOnly, async (req, res) => {
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

    if (status === "approved") {
      await Enrollment.findOneAndUpdate(
        { certificateId: cert.certificateId },
        { certIssued: true }
      );
      console.log(`✅ Certificate approved & enrollment updated: ${cert.certificateId}`);

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

app.get("/api/certificates/:certificateId/download", async (req, res) => {
  try {
    const cert = await CertificateRequest.findOne({
      certificateId: req.params.certificateId,
      status: "approved"
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

// -------------------- ADMIN EMAIL ROUTE --------------------

app.post("/api/admin/send-email", auth, adminOnly, async (req, res) => {
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
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});