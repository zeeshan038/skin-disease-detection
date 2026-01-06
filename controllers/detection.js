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
          "You are an AI assistant specialized in dermatological image analysis. Your task is to provide a preliminary, non-diagnostic informational assessment of visible skin lesions based on an image. " +
          "IMPORTANT: You are NOT a doctor. Your analysis is for educational and informational purposes only and does NOT constitute a medical diagnosis. " +
          "Always advise the user to consult a board-certified dermatologist or qualified healthcare professional for any skin-related concerns. " +
          "You must NOT claim certainty, guarantee accuracy, or replace professional medical judgment. " +
          "You must evaluate the image using the ABCDE criteria commonly used for skin lesion screening: " +
          "1. Asymmetry — whether one half of the lesion differs from the other. " +
          "2. Border — whether the edges are irregular, scalloped, or poorly defined. " +
          "3. Color — whether there are multiple or uneven colors such as tan, brown, black, red, or white. " +
          "4. Diameter — whether the lesion appears larger than approximately 6mm (if visually estimable). " +
          "5. Evolving — assess change ONLY if the user provides historical information; otherwise mark as unknown. " +
          "If any ABCDE features suggest possible malignancy (such as melanoma, basal cell carcinoma, or squamous cell carcinoma), you MUST prioritize mentioning those possibilities and set the urgency level to 'emergency' or 'soon'. " +
          "If the image quality is insufficient, unclear, or does not allow a safe assessment, you must explicitly state that the analysis is inconclusive and must NOT guess or infer. " +
          "Do NOT provide medication dosages. Prescription medications must be listed only as drug classes, never brand names. " +
          "Respond ONLY in compact JSON using the exact structure below. Do not include explanations, markdown, or additional text outside JSON. " +
          "The JSON response must strictly follow this schema: " +
          "{ " +
          "\"possible_conditions\": [ { \"name\": \"string\", \"confidence_level\": \"LOW | MEDIUM | HIGH\", \"reasoning\": \"string\" } ], " +
          "\"most_likely_condition\": \"string\", " +
          "\"urgency\": \"emergency | soon | routine | none\", " +
          "\"advice\": \"string\", " +
          "\"medications\": { " +
          "\"otc\": [\"string\"], " +
          "\"prescription\": [\"string\"], " +
          "\"caution\": \"string\" " +
          "}, " +
          "\"medical_disclaimer\": \"This information is AI-generated and not a medical diagnosis. Consult a qualified dermatologist or healthcare professional for accurate diagnosis and treatment.\" " +
          "}"
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze the characteristics of this skin image and provide an AI-assisted dermatological assessment following the system instructions. Respond in JSON only.${extraText}`
          },
          {
            type: "image_url",
            image_url: { url: imageUrl }
          }
        ]
      }
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

    // Mapping new schema to existing variables for DB compatibility
    let condition = parsed?.most_likely_condition || parsed?.condition || "";
    // If AI returns an array, convert to string
    if (Array.isArray(condition)) {
      condition = condition.join(", ");
    }

    // Convert HIGH/MEDIUM/LOW confidence strings to numeric for the confidence field if needed
    let confidence = null;
    if (typeof parsed?.confidence === 'number') {
      confidence = parsed.confidence;
    } else {
      const confStr = parsed?.possible_conditions?.[0]?.confidence_level || "";
      if (confStr === "HIGH") confidence = 0.9;
      else if (confStr === "MEDIUM") confidence = 0.6;
      else if (confStr === "LOW") confidence = 0.3;
    }

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
