const mongoose = require("mongoose");

const detectionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: true,
    },
    imageUrl: {
        type: String,
        required: true,
    },
    imageMeta: {
        type: Object,
        default: {},
    },
    description: {
        type: String,
        default: "",
    },
    model: {
        type: String,
        default: "",
    },
    result: {
        type: Object,
        required: false,
        default: {},
    },
    medications: {
        type: Object,
        required: false,
    },
    // Flattened fields for easier querying/analytics
    condition: { type: String, default: "" },
    confidence: { type: Number, default: null },
    advice: { type: String, default: "" },
    urgency: { type: String, default: "" },
    completionId: { type: String, default: "" },
    raw: {
        type: String,
        required: true,
    },
},{
    timestamps : true,
});

module.exports = mongoose.model("detection", detectionSchema);
