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
          "You are a dermatologist assistant. Analyze skin lesion images. Respond ONLY in compact JSON with keys: condition (string), confidence (0-1), advice (string), urgency (one of: 'emergency','soon','routine','none'), medications (object with fields: otc [array of strings], prescription [array of strings], caution [string]). Always return the most likely condition with confidence. If multiple conditions are possible, return the most probable one with confidence and mention uncertainty in advice. OTC items should be non-prescription and region-agnostic (e.g., benzoyl peroxide 2.5–5%, adapalene 0.1%). Prescription items must include a clinician disclaimer in 'caution' and avoid exact dosing. Do NOT include any text outside the JSON object."
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Analyze the attached image and respond in JSON only. Do not include code fences or any extra text—return a single JSON object.${extraText}` },
          {
            type: "image_url",
            image_url: { url: imageUrl },
          },
        ],
      },
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
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

    const condition = parsed?.condition || "";
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

    // 4. Monthly Scans Analysis (Last 6 Months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyScans = await Detection.aggregate([
      {
        $match: {
          userId: _id,
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    // Format monthly data for chart (e.g., "Jan", "Feb")
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const formattedMonthlyStats = monthlyScans.map(item => ({
      month: monthNames[item._id.month - 1],
      scans: item.count
    }));

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
