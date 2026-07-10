require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const Credential = mongoose.model(
  "Credential",
  new mongoose.Schema({
    username: String,
    email: { type: String, unique: true },
    password: String,
    role: { type: String, enum: ["student", "admin"], default: "student" },
    phone: { type: String, default: "" },
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
    createdAt: { type: Date, default: Date.now },
  })
);

const ADMIN_USERNAME = "Admin";
const ADMIN_EMAIL = "admin@skillfulltechnologies.com";
const ADMIN_PASSWORD = "peta";

async function seedAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");

    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

    const existing = await Credential.findOne({
      $or: [{ username: ADMIN_USERNAME }, { email: ADMIN_EMAIL }],
    });

    if (existing) {
      existing.username = ADMIN_USERNAME;
      existing.email = ADMIN_EMAIL;
      existing.password = hashedPassword;
      existing.role = "admin";
      existing.status = "Active";
      await existing.save();
      console.log(`✅ Existing account updated to admin: ${ADMIN_USERNAME}`);
    } else {
      await Credential.create({
        username: ADMIN_USERNAME,
        email: ADMIN_EMAIL,
        password: hashedPassword,
        role: "admin",
        status: "Active",
      });
      console.log(`✅ Admin account created: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
    }

    console.log("\nLogin with:");
    console.log(`  username or email: ${ADMIN_USERNAME}`);
    console.log(`  password:          ${ADMIN_PASSWORD}`);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seedAdmin();