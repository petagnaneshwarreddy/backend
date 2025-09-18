const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer"); // New: Import nodemailer
require("dotenv").config(); // New: Load environment variables

const app = express();
app.use(express.json());

// ✅ Allow requests from your frontend (Vercel)
app.use(cors({
  origin: ["https://skillfull-technologies.vercel.app"], // replace with your actual Vercel URL
  methods: ["GET", "POST"],
  credentials: true
}));

// New: Create a Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ✅ MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ MongoDB connected ✅"))
.catch(err => console.error("❌ MongoDB connection error:", err));

// ✅ Define Schema & Model
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

// ✅ API route to save enrollment
app.post("/api/enroll", async (req, res) => {
  try {
    const enrollment = new Enrollment(req.body);
    await enrollment.save();

    // New: Define email content with WhatsApp link
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: enrollment.email,
      subject: `Enrollment Confirmation for ${enrollment.courseTitle}`,
      html: `
        <h1>Hello ${enrollment.fullName},</h1>
        <p>Thank you for enrolling in our course **${enrollment.courseTitle}**.</p>
        <p>Your enrollment has been successfully submitted. We will contact you shortly with further details.</p>
        <p>In the meantime, you can join our WhatsApp community to stay updated and connect with other students:</p>
        <p><strong><a href="https://chat.whatsapp.com/CtzXvTddE0aGQ6vASHzs6e">Join our WhatsApp Group</a></strong></p>
        <br>
        <p>Best regards,</p>
        <p>The Skillfull Technologies Team</p>
      `,
    };

    // New: Send the email
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

// ✅ New API route to verify certificate by ID
app.get("/api/verify/:certificateId", async (req, res) => {
  try {
    const { certificateId } = req.params;
    const enrollment = await Enrollment.findOne({ certificateId: certificateId });

    if (!enrollment) {
      return res.status(200).json({ msg: "ID not present" });
    }

    res.status(200).json(enrollment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error while fetching certificate details." });
  }
});

app.get("/", (req, res) => {
  res.json({ message: "Backend is running 🚀" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});