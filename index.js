// -------------------- IMPORTS & CONFIG --------------------
const express = require("express");           
const mongoose = require("mongoose");         
const cors = require("cors");                 
const nodemailer = require("nodemailer");     
const bcrypt = require("bcrypt");             
const jwt = require("jsonwebtoken");          
require("dotenv").config();                   

const app = express();

// -------------------- MIDDLEWARE --------------------
app.use(express.json());  

// CORS setup
app.use(cors({
    origin: ["https://skillfull-technologies.vercel.app"],
    methods: ["GET", "POST"],
    credentials: true
}));

// -------------------- EMAIL SETUP --------------------
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

// -------------------- DATABASE CONNECTION --------------------
mongoose.connect(process.env.MONGO_URI, { 
    useNewUrlParser: true, 
    useUnifiedTopology: true 
})
.then(() => console.log("✅ MongoDB connected ✅"))
.catch(err => console.error("❌ MongoDB connection error:", err));

// -------------------- MODELS --------------------
const CredentialSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const Credential = mongoose.model("Credential", CredentialSchema);

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

const OtpSchema = new mongoose.Schema({
    email: { type: String, required: true },
    otp: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 300 }
});
const Otp = mongoose.model("Otp", OtpSchema);

// -------------------- ROUTES --------------------

// -------------------- ENROLLMENT ROUTE --------------------
app.post("/api/enroll", async (req, res) => {
    try {
        const { courseTitle, fullName, email, phone, collegeName, state, duration, certificateId } = req.body;

        // Save enrollment in DB
        const enrollment = new Enrollment({
            courseTitle,
            fullName,
            email,
            phone,
            collegeName,
            state,
            duration,
            certificateId
        });
        await enrollment.save();

        // Prepare email with verification link
        const verifyLink = `https://skillfull-technologies.vercel.app/verify/${certificateId}`;

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: `Enrollment Confirmation: ${courseTitle}`,
            html: `
                <h1>Hello ${fullName},</h1>
                <p>Thank you for enrolling in <strong>${courseTitle}</strong>.</p>
                <p>Your enrollment has been successfully submitted. Below is your certificate ID:</p>
                <p><strong>${certificateId}</strong></p>
                <p>You can verify your certificate <a href="${verifyLink}">here</a>.</p>
                <p>Join our WhatsApp community:</p>
                <p><a href="https://chat.whatsapp.com/CtzXvTddE0aGQ6vASHzs6e">Join WhatsApp Group</a></p>
                <br><p>Best regards,</p>
                <p>Skillfull Technologies Team</p>
            `
        };

        // Send email
        try {
            await transporter.sendMail(mailOptions);
            console.log(`✅ Enrollment email sent to ${email}`);
        } catch (emailError) {
            console.error("❌ Error sending enrollment email:", emailError);
            // Rollback DB entry if email fails
            await Enrollment.deleteOne({ _id: enrollment._id });
            return res.status(500).json({ msg: "Enrollment failed: Unable to send confirmation email." });
        }

        res.status(201).json({ msg: "Enrollment submitted successfully! Check your email for confirmation." });

    } catch (err) {
        console.error("❌ Enrollment route error:", err);
        res.status(500).json({ msg: "Server error while processing enrollment." });
    }
});

// -------------------- ROOT ROUTE --------------------
app.get("/", (req, res) => {
    res.json({ message: "Backend is running 🚀" });
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
