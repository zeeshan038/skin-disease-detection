const express = require("express");
require("dotenv").config();
const cors = require("cors");
const app = express();

// Paths
const apiRoutes = require("./routes/index");
const connectDb = require("./config/db");

// Connect to DB
connectDb();

// Middleware
app.use(cors({
  origin: ["https://fyp-frontend-lovat.vercel.app" , "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api", apiRoutes);

// Error Handling Middleware
app.use((err, req, res, next) => {
  const multer = require("multer");
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        status: false,
        msg: "Multer Error: Unexpected field name. Please use 'image' as the key for your file upload.",
        field: err.field
      });
    }
  }
  res.status(err.status || 500).json({
    status: false,
    msg: err.message || "Internal Server Error"
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});