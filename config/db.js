// NPM Package
const mongoose = require("mongoose");

const uri = process.env.MONGO_URI;

const connectDb = async () => {
  // Check if URI exists
  if (!uri) {
    console.error("❌ MONGO_URI is not defined in environment variables");
    console.error("Please check your .env file");
    return;
  }

  console.log("🔄 Attempting to connect to MongoDB...");
  console.log("📍 URI format check:", uri.substring(0, 20) + "...");

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    });
    console.log("✅ MongoDB Connection Successful");
  } catch (error) {
    console.error("❌ Error occurred while connecting to DB");
    console.error("Error Code:", error.code);
    console.error("Error Message:", error.message);

    // Provide helpful suggestions based on error type
    if (error.code === 'ENOTFOUND') {
      console.error("\n💡 Suggestions:");
      console.error("1. Check if your MONGO_URI uses 'mongodb+srv://' protocol");
      console.error("2. Verify your cluster hostname is correct");
      console.error("3. Check your internet connection");
      console.error("4. Ensure your IP is whitelisted in MongoDB Atlas Network Access");
    } else if (error.message.includes('authentication')) {
      console.error("\n💡 Suggestions:");
      console.error("1. Verify your database username and password");
      console.error("2. Check if password contains special characters (they need URL encoding)");
    }
  }
};

module.exports = connectDb;
