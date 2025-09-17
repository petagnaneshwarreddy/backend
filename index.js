// server.js

// Import necessary packages
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config(); // Loads environment variables from a .env file

// Create the Express application
const app = express();

// Middleware: functions that run on every request
app.use(cors()); // Allows cross-origin requests from your frontend
app.use(express.json()); // Parses incoming JSON data from the request body

// Define a port for the server to run on
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected successfully! ✅'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define the Mongoose schema for the contact form (already exists)
const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  message: { type: String, required: true },
}, {
  timestamps: true,
});

const Contact = mongoose.model('Contact', contactSchema);

// Updated Mongoose schema for course enrollments
const enrollmentSchema = new mongoose.Schema({
  certificateId: { type: String, required: true, unique: true }, // Add the certificateId field
  courseTitle: { type: String, required: true },
  fullName: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  collegeName: { type: String, required: true },
  state: { type: String, required: true },
  duration: { type: String, required: true },
}, {
  timestamps: true,
});

const Enrollment = mongoose.model('Enrollment', enrollmentSchema);

// API Route for the contact form
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ msg: 'Please enter all fields' });
  }
  try {
    const newContact = new Contact({ name, email, message });
    await newContact.save();
    res.status(201).json({ msg: 'Thank you for your message!' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error. Please try again later.' });
  }
});

// Updated API Route for course enrollment form submissions
app.post('/api/enroll', async (req, res) => {
  const { certificateId, courseTitle, fullName, email, phone, collegeName, state, duration } = req.body;
  
  if (!certificateId || !courseTitle || !fullName || !email || !phone || !collegeName || !state || !duration) {
    return res.status(400).json({ msg: 'Please fill out all enrollment fields.' });
  }
  
  try {
    const newEnrollment = new Enrollment({
      certificateId,
      courseTitle,
      fullName,
      email,
      phone,
      collegeName,
      state,
      duration,
    });
    
    await newEnrollment.save();
    res.status(201).json({ msg: 'Enrollment successful!', certificateId: newEnrollment.certificateId });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error. Please try again later.' });
  }
});

// Start the server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));