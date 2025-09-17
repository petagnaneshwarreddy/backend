const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(express.json());

app.use(cors({
  origin: ["https://your-frontend.vercel.app"],
  methods: ["GET", "POST"],
  credentials: true
}));

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ MongoDB connected"))
.catch(err => console.error("❌ MongoDB connection error:", err));

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

app.get("/api/verify/:certificateId", async (req, res) => {
  try {
    const { certificateId } = req.params;
    const enrollment = await Enrollment.findOne({ certificateId: certificateId });

    if (!enrollment) {
      // ✅ Change here: Return a 200 OK status with a custom message
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