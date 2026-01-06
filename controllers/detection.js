//NPM Packages
const fs = require("fs");
const OpenAI = require("openai");
const cloudinary = require("../utils/cloudinary");

//models
const Detection = require("../models/detection");

/**
 * @desciption detect skin
 * @route POST /api/user/detect
 * @access Private
 */
module.exports.detectSkin = async (req, res) => {
  const { _id } = req.user;
  const { description } = req.body;

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        status: false,
        msg: "OPENAI_API_KEY is not set in environment",
      });
    }

    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({
        status: false,
        msg: "Cloudinary environment variables are missing",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        status: false,
        msg: "No image uploaded. Use form-data with field 'image'",
      });
    }
    const image = req.file.path;


    // Upload to Cloudinary
    const uploadRes = await cloudinary.uploader.upload(image, {
      folder: "skin-detections",
      resource_type: "image",
    });
    const imageUrl = uploadRes.secure_url;
    console.log("imageUrl", imageUrl);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const extraText = description && description.trim()
      ? `\nPatient notes: ${description.trim()}`
      : "\nPatient notes: (none provided)";

    const messages = [
      {
        role: "system",
        content:
          "You are an AI assistant specialized in dermatological analysis. Your task is to provide a preliminary informational assessment of skin lesions. " +
          "IMPORTANT: You are NOT a doctor. Your analysis is for educational purposes only and is not a clinical diagnosis. " +
          "Always advise the user to consult a board-certified dermatologist for any skin concerns. " +
          "You must evaluate the image using the ABCDE criteria: " +
          "1. Asymmetry (is one half unlike the other?) " +
          "2. Border (is it irregular, scalloped, or poorly defined?) " +
          "3. Color (are there multiple shades of tan, brown, black, or red?) " +
          "4. Diameter (is it larger than 6mm?) " +
          "5. Evolving (based on user notes, is it changing?). " +
          "If any of these features suggest malignancy (like melanoma or basal cell carcinoma), you MUST prioritize mentioning that possibility and setting high urgency. " +
          "If the image is not clear enough, or if it violates safety policies, state that in the 'condition' field. " +
          "Respond ONLY in compact JSON with keys: condition (string - most likely condition), confidence (0-1), advice (general care and next steps), urgency (one of: 'emergency','soon','routine','none'), medications (object with fields: otc [array], prescription [array of classes, NOT brand names], caution [string])."
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Analyze the characteristics of this skin image and suggest likely conditions or next steps. Respond in JSON only.${extraText}` },
          {
            type: "image_url",
            image_url: { url: imageUrl },
          },
        ],
      },
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.1,
      messages,
    });

    const content = completion?.choices?.[0]?.message?.content || "";

    let parsed = null;
    try {
      let jsonText = content.trim();
      const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fence) {
        jsonText = fence[1].trim();
      } else {
        jsonText = jsonText.replace(/^```|```$/g, '').trim();
      }

      parsed = JSON.parse(jsonText);
    } catch (_) {
      try {
        const t = (content || '').toString();
        const start = t.indexOf('{');
        const end = t.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          parsed = JSON.parse(t.slice(start, end + 1));
        }
      } catch (_) { }
    }

    try {
      fs.unlink(image, () => { });
    } catch (_) { }

    // Prepare metadata and flattened fields
    const imageMeta = {
      width: uploadRes?.width,
      height: uploadRes?.height,
      bytes: uploadRes?.bytes,
      format: uploadRes?.format,
      public_id: uploadRes?.public_id,
      version: uploadRes?.version,
      created_at: uploadRes?.created_at,
    };
    const modelName = completion?.model || "gpt-4o-mini";
    const completionId = completion?.id || "";

    let condition = parsed?.condition || "";
    // If AI returns an array, convert to string to avoid DB validation error
    if (Array.isArray(condition)) {
      condition = condition.join(", ");
    }
    const confidence = typeof parsed?.confidence === 'number' ? parsed.confidence : null;
    const advice = parsed?.advice || "";
    const urgency = parsed?.urgency || "";

    // save it in db
    await Detection.create({
      userId: _id,
      imageUrl,
      imageMeta,
      description: description || "",
      model: modelName,
      result: parsed || null,
      medications: parsed?.medications || null,
      condition,
      confidence,
      advice,
      urgency,
      completionId,
      raw: content,
    });

    return res.status(200).json({
      status: true,
      userId: _id,
      imageUrl,
      result: parsed || null,
      condition,
      confidence,
      advice,
      urgency,
      medications: parsed?.medications || null,
      model: modelName,
      completionId,
      raw: content,
    });
  } catch (error) {
    console.error("detectSkin error:", error?.response?.data || error?.message || error);
    return res.status(500).json({
      status: false,
      msg: "Detection failed",
      error: error?.message || "Unknown error",
    });
  }
};


/**
 * @desciption get user detections
 * @route POST /api/detection/users-activity
 * @access Private
 */
module.exports.getUserActivity = async (req, res) => {
  const { _id } = req.user;
  try {
    const userDetections = await Detection.find({ userId: _id }).sort({ createdAt: -1 });
    return res.status(200).json({
      status: true,
      msg: "All user activity",
      data: userDetections
    })
  } catch (error) {
    return res.status(500).json(
      {
        status: false,
        msg: error.message
      }
    )

  }
}

/**
 * @description get dashboard statistics
 * @route GET /api/detect/dashboard-stats
 * @access Private
 */
module.exports.getDashboardStats = async (req, res) => {
  const { _id } = req.user;

  try {
    // 1. Total Scans
    const totalScans = await Detection.countDocuments({ userId: _id });

    // 2. Unique Conditions
    const uniqueConditionsList = await Detection.distinct("condition", { userId: _id });
    const detectedConditions = uniqueConditionsList.length;

    // 3. Average Confidence (Accuracy Rate)
    const avgConfidenceQuery = await Detection.aggregate([
      { $match: { userId: _id, confidence: { $ne: null } } },
      { $group: { _id: null, avg: { $avg: "$confidence" } } }
    ]);
    const accuracyRate = avgConfidenceQuery.length > 0 ? (avgConfidenceQuery[0].avg * 100).toFixed(1) : 0;

    // 4. Monthly Scans Analysis (Current Year)
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);

    const monthlyScans = await Detection.aggregate([
      {
        $match: {
          userId: _id,
          createdAt: { $gte: startOfYear }
        }
      },
      {
        $group: {
          _id: { $month: "$createdAt" },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    // Format monthly data for chart (showing all 12 months with 0 if no scans)
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const formattedMonthlyStats = monthNames.map((month, index) => {
      const dbMonth = monthlyScans.find(item => item._id === index + 1);
      return {
        month,
        scans: dbMonth ? dbMonth.count : 0
      };
    });

    // 5. Conditions Distribution (Conditions Overview)
    const conditionsOverview = await Detection.aggregate([
      { $match: { userId: _id } },
      {
        $group: {
          _id: "$condition",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 } // Top 5 conditions
    ]);

    const formattedConditions = conditionsOverview.map(item => ({
      name: item._id || "Unknown",
      value: item.count
    }));

    return res.status(200).json({
      status: true,
      stats: {
        totalScans,
        detectedConditions,
        accuracyRate: `${accuracyRate}%`,
        monthlyScans: formattedMonthlyStats,
        conditionsOverview: formattedConditions
      }
    });

  } catch (error) {
    console.error("Dashboard stats error:", error);
    return res.status(500).json({
      status: false,
      msg: "Failed to fetch dashboard stats",
      error: error.message
    });
  }
};
